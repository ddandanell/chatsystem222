/**
 * Tests for the password-reset rules.
 *
 * Everything asserted here is a decision the reset path makes before it touches a row or a mail
 * server: how a token is minted, whether the stored one may still be spent, how the rate limit
 * counts, and what a new password has to clear. The database and Nylas halves are exercised
 * separately; a test here must never need either.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ADDRESS_REQUESTS,
  MAX_IDENTIFIER_REQUESTS,
  MIN_PASSWORD_LENGTH,
  RATE_WINDOW_MS,
  RESET_TTL_MS,
  buildResetLink,
  checkPassword,
  classifyReset,
  generateResetToken,
  hashResetToken,
  isValidResetTokenShape,
  nextAttemptState,
  normalizeBaseUrl,
  readResetState,
  resetExpiry,
  resetIssuedAt,
} from "@/lib/password-reset";
import { NEUTRAL_FORGOT_MESSAGE, RESET_MINUTES } from "@/lib/reset-copy";

const NOW = Date.parse("2026-11-01T06:00:00.000Z");

function state(overrides: Partial<Record<string, unknown>> = {}) {
  return readResetState({
    reset_hash: "a".repeat(64),
    reset_issued_at: new Date(NOW).toISOString(),
    reset_expires_at: new Date(NOW + RESET_TTL_MS).toISOString(),
    ...overrides,
  });
}

test("a minted token is 32 random bytes in url-safe base64 and only its hash is storable", () => {
  const { token, hash } = generateResetToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashResetToken(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.notEqual(hash, hashResetToken(generateResetToken().token));
});

test("hashing is stable, which is what makes the stored hash a lookup key", () => {
  const token = generateResetToken().token;
  assert.equal(hashResetToken(token), hashResetToken(token));
});

test("the token shape gate refuses anything that is not 43 url-safe characters", () => {
  const good = generateResetToken().token;
  assert.equal(isValidResetTokenShape(good), true);
  assert.equal(isValidResetTokenShape(`${good}=`), false);
  assert.equal(isValidResetTokenShape(good.slice(0, 42)), false);
  assert.equal(isValidResetTokenShape(`${good}a`), false);
  assert.equal(isValidResetTokenShape(""), false);
  assert.equal(isValidResetTokenShape(null), false);
  assert.equal(isValidResetTokenShape(undefined), false);
  assert.equal(isValidResetTokenShape(12345), false);
  assert.equal(isValidResetTokenShape("../../etc/passwd"), false);
  assert.equal(isValidResetTokenShape(`${good.slice(0, 42)}+`), false);
});

test("the token lives for fifteen minutes from the moment it is issued", () => {
  assert.equal(RESET_TTL_MS, 15 * 60 * 1000);
  assert.equal(RESET_MINUTES, 15);
  assert.equal(Date.parse(resetExpiry(NOW)) - Date.parse(resetIssuedAt(NOW)), RESET_TTL_MS);
  assert.equal(resetIssuedAt(NOW), new Date(NOW).toISOString());
});

test("an unreadable config is treated as no token at all, not as a valid one", () => {
  assert.deepEqual(readResetState(null), {
    hash: null,
    issuedAt: null,
    expiresAt: null,
    usedAt: null,
  });
  const junk = readResetState({
    reset_hash: "not-a-hash",
    reset_issued_at: "yesterday",
    reset_expires_at: 42,
    reset_used_at: {},
  });
  assert.deepEqual(junk, { hash: null, issuedAt: null, expiresAt: null, usedAt: null });
  assert.equal(classifyReset(junk, NOW), "missing");
});

test("a fresh token is valid, and one second too late it is not", () => {
  assert.equal(classifyReset(state(), NOW), "valid");
  assert.equal(classifyReset(state(), NOW + RESET_TTL_MS - 1), "valid");
  assert.equal(classifyReset(state(), NOW + RESET_TTL_MS), "expired");
  assert.equal(classifyReset(state(), NOW + RESET_TTL_MS + 60_000), "expired");
});

test("a spent token cannot be spent twice, even before its expiry", () => {
  const used = state({ reset_used_at: new Date(NOW + 1000).toISOString() });
  assert.equal(classifyReset(used, NOW + 2000), "used");
  // A hash cleared by a successful reset is simply gone.
  assert.equal(classifyReset(readResetState({}), NOW), "missing");
});

test("a token with no expiry is refused rather than treated as eternal", () => {
  assert.equal(classifyReset(state({ reset_expires_at: undefined }), NOW), "missing");
});

test("the per-identifier cap allows three requests an hour and refuses the fourth", () => {
  let previous: { attempts: number; windowStart: string } | undefined;
  const seen: boolean[] = [];
  for (let index = 0; index < 4; index += 1) {
    const next = nextAttemptState(previous, NOW + index * 1000);
    seen.push(next.allowed);
    previous = { attempts: next.attempts, windowStart: next.windowStart };
  }
  assert.deepEqual(seen, [true, true, true, false]);
  assert.equal(previous?.attempts, 4);
  assert.equal(MAX_IDENTIFIER_REQUESTS, 3);
});

test("the window expires an hour after it opened, not an hour after the last request", () => {
  const first = nextAttemptState(undefined, NOW);
  const second = nextAttemptState(first, NOW + 30 * 60 * 1000);
  const third = nextAttemptState(second, NOW + 59 * 60 * 1000);
  assert.equal(third.allowed, true);
  const fourth = nextAttemptState(third, NOW + 59 * 60 * 1000);
  assert.equal(fourth.allowed, false);
  // One hour after the window opened, the count starts again.
  const afterWindow = nextAttemptState(fourth, NOW + RATE_WINDOW_MS);
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.attempts, 1);
});

test("a window stamped in the future does not lock the operator out", () => {
  const next = nextAttemptState(
    { attempts: 9, windowStart: new Date(NOW + 60 * 60 * 1000).toISOString() },
    NOW,
  );
  assert.equal(next.allowed, true);
  assert.equal(next.attempts, 1);
});

test("the per-address cap is the same arithmetic at a higher limit", () => {
  assert.equal(MAX_ADDRESS_REQUESTS, 10);
  const allowed = nextAttemptState({ attempts: 9, windowStart: new Date(NOW).toISOString() }, NOW, MAX_ADDRESS_REQUESTS);
  assert.equal(allowed.allowed, true);
  const refused = nextAttemptState({ attempts: 10, windowStart: new Date(NOW).toISOString() }, NOW, MAX_ADDRESS_REQUESTS);
  assert.equal(refused.allowed, false);
});

test("the password floor is twelve characters, stricter than the bootstrap path", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(checkPassword("short").ok, false);
  assert.deepEqual(checkPassword("elevenchars"), { ok: false, code: "too_short" });
  assert.deepEqual(checkPassword("twelve chars"), { ok: true });
  assert.deepEqual(checkPassword("a much longer passphrase for the console"), { ok: true });
});

test("blank, padded and unreadable passwords are refused", () => {
  assert.deepEqual(checkPassword(""), { ok: false, code: "blank" });
  assert.deepEqual(checkPassword("            "), { ok: false, code: "blank" });
  assert.deepEqual(checkPassword(null), { ok: false, code: "blank" });
  assert.deepEqual(checkPassword(undefined), { ok: false, code: "blank" });
  assert.deepEqual(checkPassword("x".repeat(201)), { ok: false, code: "too_long" });
});

test("obvious passwords are refused even at a legal length", () => {
  assert.deepEqual(checkPassword("password1234"), { ok: false, code: "too_obvious" });
  assert.deepEqual(checkPassword("mychefpassword"), { ok: false, code: "too_obvious" });
  assert.deepEqual(checkPassword("PASSWORD1234"), { ok: false, code: "too_obvious" });
  assert.deepEqual(checkPassword("aaaaaaaaaaaa"), { ok: false, code: "too_obvious" });
  assert.deepEqual(checkPassword("abababababab"), { ok: false, code: "too_obvious" });
});

test("a new password may not contain the account it protects", () => {
  assert.deepEqual(checkPassword("bali-password-2026", "bali@mychef.id"), {
    ok: false,
    code: "uses_account",
  });
  assert.deepEqual(checkPassword("BALI-secret-phrase", "bali@mychef.id"), {
    ok: false,
    code: "uses_account",
  });
  assert.deepEqual(checkPassword("quiet-orchid-harbour", "bali@mychef.id"), { ok: true });
});

test("the reset link is built only from a real token and an http(s) origin", () => {
  const token = generateResetToken().token;
  assert.equal(
    buildResetLink("https://console.mychef.id", token),
    `https://console.mychef.id/login/reset?token=${token}`,
  );
  assert.equal(
    buildResetLink("https://console.mychef.id/", token),
    `https://console.mychef.id/login/reset?token=${token}`,
  );
  assert.equal(buildResetLink(null, token), null);
  assert.equal(buildResetLink("", token), null);
  assert.equal(buildResetLink("javascript:alert(1)", token), null);
  assert.equal(buildResetLink("file:///etc/passwd", token), null);
  assert.equal(buildResetLink("https://user:pass@console.mychef.id", token), null);
  assert.equal(buildResetLink("not a url", token), null);
  assert.equal(buildResetLink("https://console.mychef.id", "short"), null);
});

test("a base url keeps its scheme and host and loses its trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://console.mychef.id/"), "https://console.mychef.id");
  assert.equal(normalizeBaseUrl("http://localhost:4317"), "http://localhost:4317");
  assert.equal(normalizeBaseUrl("  https://console.mychef.id  "), "https://console.mychef.id");
  assert.equal(normalizeBaseUrl("mailto:x@y.z"), null);
  assert.equal(normalizeBaseUrl(undefined), null);
});

test("the confirmation text is one string, identical whoever asks", () => {
  assert.match(NEUTRAL_FORGOT_MESSAGE, /If that address is registered/);
  assert.match(NEUTRAL_FORGOT_MESSAGE, /15 minutes/);
  // Nothing in it may hint at account existence.
  assert.doesNotMatch(NEUTRAL_FORGOT_MESSAGE, /not found|unknown|no account|does not exist/i);
});
