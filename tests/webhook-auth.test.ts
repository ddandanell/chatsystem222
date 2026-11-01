/**
 * Automated tests for inbound webhook authentication (fail closed).
 * No database, no network, no provider call: pure-function tests over synthetic headers.
 *
 * These encode the finding that `authorizeGhl` used to accept any request when
 * GHL_WEBHOOK_SECRET was unset, on an endpoint that writes contacts, conversations,
 * messages and drafts. They also encode the second finding: freshness was optional, so a captured
 * request could be replayed forever by omitting `x-ghl-timestamp`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeWebhook,
  signWebhookBody,
  signatureBase,
  TIMESTAMP_HEADER,
  WEBHOOK_SKEW_SECONDS,
} from "@/lib/webhook-auth";

const NOW = 1_800_000_000_000; // fixed clock, ms
const NOW_S = Math.floor(NOW / 1000);
const SECRET = "test-secret-value";
const BODY = JSON.stringify({ messageId: "m-1", body: "Can we move dinner to 8pm?" });

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { GHL_WEBHOOK_SECRET: SECRET, ...overrides };
}

/** The ordinary shared-secret request: correct secret plus a fresh timestamp. */
function freshSecretHeaders(extra: Record<string, string> = {}) {
  return headers({ "x-ghl-secret": SECRET, [TIMESTAMP_HEADER]: String(NOW_S), ...extra });
}

function signedHeaders(body = BODY, timestamp = String(NOW_S)) {
  return headers({
    [TIMESTAMP_HEADER]: timestamp,
    "x-ghl-signature": signWebhookBody(SECRET, timestamp, body),
  });
}

test("a missing secret refuses the event instead of accepting it", () => {
  const result = authorizeWebhook(headers({}), {
    env: env({ GHL_WEBHOOK_SECRET: undefined }),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 503);
});

test("a blank or whitespace secret is treated as missing", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const result = authorizeWebhook(headers({ "x-ghl-secret": blank }), {
      env: env({ GHL_WEBHOOK_SECRET: blank }),
      nowMs: NOW,
    });
    assert.equal(result.ok, false, `blank secret ${JSON.stringify(blank)} must be refused`);
    assert.equal(result.ok === false && result.status, 503);
  }
});

test("the local opt-in does not open the endpoint in production", () => {
  const result = authorizeWebhook(headers({}), {
    env: env({ GHL_WEBHOOK_SECRET: undefined, MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS: "1", NODE_ENV: "production" }),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 503);
});

test("the local opt-in allows unverified events only outside production, and says so", () => {
  const result = authorizeWebhook(headers({}), {
    env: env({ GHL_WEBHOOK_SECRET: undefined, MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS: "1", NODE_ENV: "development" }),
    nowMs: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.verified, false);
  assert.equal(result.ok === true && result.mode, "unverified-local");
  assert.equal(result.ok === true && result.reason, "unverified-local");
});

test("a correct secret in x-ghl-secret with a fresh timestamp is verified", () => {
  const result = authorizeWebhook(freshSecretHeaders(), { env: env(), nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.verified, true);
  assert.equal(result.ok === true && result.mode, "shared-secret");
});

test("a correct secret in a bearer token with a fresh timestamp is verified", () => {
  const result = authorizeWebhook(
    headers({ authorization: `Bearer ${SECRET}`, [TIMESTAMP_HEADER]: String(NOW_S) }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, true);
});

test("a wrong secret is refused with 401, not 503", () => {
  const result = authorizeWebhook(
    headers({ "x-ghl-secret": "wrong", [TIMESTAMP_HEADER]: String(NOW_S) }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a secret that only shares a prefix is refused", () => {
  const result = authorizeWebhook(
    headers({ "x-ghl-secret": "test-secret-valu", [TIMESTAMP_HEADER]: String(NOW_S) }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, false);
});

test("an empty presented secret is refused even against a non-empty configured secret", () => {
  const result = authorizeWebhook(
    headers({ "x-ghl-secret": "", [TIMESTAMP_HEADER]: String(NOW_S) }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a fresh timestamp in seconds or milliseconds is accepted", () => {
  for (const timestamp of [String(NOW_S), String(NOW)]) {
    const result = authorizeWebhook(
      headers({ "x-ghl-secret": SECRET, [TIMESTAMP_HEADER]: timestamp }),
      { env: env(), nowMs: NOW },
    );
    assert.equal(result.ok, true, `timestamp ${timestamp} should be fresh`);
  }
});

test("a missing timestamp is refused even with the right secret", () => {
  // The regression: freshness used to be checked only when the header was present, so dropping it
  // made a captured request replayable forever against a static shared secret.
  const result = authorizeWebhook(headers({ "x-ghl-secret": SECRET }), { env: env(), nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
  assert.match(result.ok === false ? result.reason : "", /timestamp/i);
});

test("a stale timestamp is refused even with the right secret (replay)", () => {
  const stale = String(NOW_S - WEBHOOK_SKEW_SECONDS - 1);
  const result = authorizeWebhook(
    headers({ "x-ghl-secret": SECRET, [TIMESTAMP_HEADER]: stale }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a stale signature is refused too, so the signature cannot stand alone", () => {
  const stale = String(NOW_S - WEBHOOK_SKEW_SECONDS - 1);
  const result = authorizeWebhook(signedHeaders(BODY, stale), {
    env: env(),
    nowMs: NOW,
    rawBody: BODY,
  });
  assert.equal(result.ok, false);
});

test("a future timestamp beyond the window is refused", () => {
  const future = String(NOW_S + WEBHOOK_SKEW_SECONDS + 1);
  const result = authorizeWebhook(
    headers({ "x-ghl-secret": SECRET, [TIMESTAMP_HEADER]: future }),
    { env: env(), nowMs: NOW },
  );
  assert.equal(result.ok, false);
});

test("a non-numeric timestamp is refused rather than ignored", () => {
  for (const bad of ["", "  ", "yesterday", "17e9", "-1"]) {
    const result = authorizeWebhook(
      headers({ "x-ghl-secret": SECRET, [TIMESTAMP_HEADER]: bad }),
      { env: env(), nowMs: NOW },
    );
    assert.equal(result.ok, false, `timestamp ${JSON.stringify(bad)} must be refused`);
  }
});

test("a signed body is verified without any shared secret header", () => {
  const result = authorizeWebhook(signedHeaders(), { env: env(), nowMs: NOW, rawBody: BODY });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.mode, "signature");
  assert.equal(result.ok === true && result.verified, true);
});

test("a signature over different bytes is refused", () => {
  const tampered = BODY.replace("8pm", "7pm");
  const result = authorizeWebhook(signedHeaders(), { env: env(), nowMs: NOW, rawBody: tampered });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a signature presented without the raw body is refused, not skipped", () => {
  const result = authorizeWebhook(signedHeaders(), { env: env(), nowMs: NOW });
  assert.equal(result.ok, false);
});

test("a malformed signature is refused", () => {
  for (const bad of ["sha256=", "deadbeef", "sha256=zz"]) {
    const result = authorizeWebhook(
      headers({ [TIMESTAMP_HEADER]: String(NOW_S), "x-ghl-signature": bad }),
      { env: env(), nowMs: NOW, rawBody: BODY },
    );
    assert.equal(result.ok, false, `signature ${JSON.stringify(bad)} must be refused`);
  }
});

test("a wrong signature is not rescued by a correct shared secret when signing is required", () => {
  const result = authorizeWebhook(
    headers({
      "x-ghl-secret": SECRET,
      [TIMESTAMP_HEADER]: String(NOW_S),
      "x-ghl-signature": signWebhookBody("another-secret", String(NOW_S), BODY),
    }),
    { env: env(), nowMs: NOW, rawBody: BODY },
  );
  assert.equal(result.ok, false);
});

test("GHL_WEBHOOK_REQUIRE_SIGNATURE refuses a shared-secret-only request", () => {
  const result = authorizeWebhook(freshSecretHeaders(), {
    env: env({ GHL_WEBHOOK_REQUIRE_SIGNATURE: "1" }),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("the signed base string is exactly timestamp.body", () => {
  assert.equal(signatureBase(" 123 ", BODY), `123.${BODY}`);
});

test("a refusal never echoes the configured secret", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "presented-value" }), {
    env: env({ GHL_WEBHOOK_SECRET: "configured-value-do-not-echo" }),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("configured-value-do-not-echo"), false);
});
