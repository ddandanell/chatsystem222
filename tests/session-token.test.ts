/**
 * Tests for the console session gate.
 *
 * The proxy used to accept any cookie with the right name, so a forged value reached the app shell
 * and only the layout refused it. These tests mint real Auth.js JWEs with next-auth's own `encode`,
 * then prove the proxy accepts what Auth.js signed and turns away what it did not — plus the
 * expiry path, the tampered-token path and the production/no-secret case.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "next-auth/jwt";
import {
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  checkSessionToken,
  sessionGate,
} from "@/lib/session-token";

const SECRET = "test-secret-not-a-real-one-0123456789";

// Auth.js overwrites any exp in the payload with iat + maxAge, so an expired token is minted with a
// negative maxAge rather than a past exp.
async function mint(options: { secret?: string; salt?: string; maxAge?: number } = {}) {
  return encode({
    token: { sub: "user-1", email: "qa@example.test" },
    secret: options.secret ?? SECRET,
    salt: options.salt ?? SESSION_COOKIE,
    ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
  });
}

test("a cookie Auth.js signed is accepted, with its subject", async () => {
  const token = await mint();
  const state = await checkSessionToken({
    token,
    secret: SECRET,
    cookieName: SESSION_COOKIE,
  });
  assert.equal(state.state, "valid");
  assert.equal(state.state === "valid" && state.subject, "user-1");
});

test("no cookie is 'none', not 'invalid'", async () => {
  for (const empty of [undefined, null, "", "   "]) {
    const state = await checkSessionToken({
      token: empty,
      secret: SECRET,
      cookieName: SESSION_COOKIE,
    });
    assert.equal(state.state, "none");
  }
});

test("a forged cookie signed with another secret is refused", async () => {
  const forged = await mint({ secret: "attacker-secret-0123456789abcdef" });
  const state = await checkSessionToken({
    token: forged,
    secret: SECRET,
    cookieName: SESSION_COOKIE,
  });
  assert.equal(state.state, "invalid");
  assert.equal(state.state === "invalid" && state.reason, "decode_failed");
});

test("a cookie signed for another salt (cookie name) is refused", async () => {
  const wrongSalt = await mint({ salt: SECURE_SESSION_COOKIE });
  const state = await checkSessionToken({
    token: wrongSalt,
    secret: SECRET,
    cookieName: SESSION_COOKIE,
  });
  assert.equal(state.state, "invalid");
});

test("garbage and a truncated real token are both refused, never thrown", async () => {
  const real = await mint();
  for (const token of ["not-a-jwt", "a.b.c", real.slice(0, real.length - 8), "eyJhbGciOiJIUzI1NiJ9.e30.x"]) {
    const state = await checkSessionToken({ token, secret: SECRET, cookieName: SESSION_COOKIE });
    assert.equal(state.state, "invalid", token.slice(0, 20));
  }
});

test("an expired token is invalid for that reason, not decode_failed", async () => {
  const expired = await mint({ maxAge: -60 });
  const state = await checkSessionToken({
    token: expired,
    secret: SECRET,
    cookieName: SESSION_COOKIE,
  });
  assert.equal(state.state, "invalid");
  assert.equal(state.state === "invalid" && state.reason, "expired");
});

test("with no AUTH_SECRET the check reports no_secret and never claims valid", async () => {
  const token = await mint();
  for (const secret of [undefined, null, "", "  "]) {
    const state = await checkSessionToken({ token, secret, cookieName: SESSION_COOKIE });
    assert.equal(state.state, "invalid");
    assert.equal(state.state === "invalid" && state.reason, "no_secret");
  }
});

test("the gate: public paths pass, a valid session passes, anything else goes to login", () => {
  const valid = { state: "valid", subject: "user-1" } as const;
  assert.equal(sessionGate({ publicPath: true, state: { state: "none" }, production: true }), "next");
  assert.equal(sessionGate({ publicPath: false, state: valid, production: true }), "next");
  assert.equal(sessionGate({ publicPath: false, state: { state: "none" }, production: true }), "login");

  for (const reason of ["decode_failed", "expired"] as const) {
    assert.equal(
      sessionGate({ publicPath: false, state: { state: "invalid", reason }, production: true }),
      "login",
    );
    assert.equal(
      sessionGate({ publicPath: false, state: { state: "invalid", reason }, production: false }),
      "login",
    );
  }
});

test("the gate: a missing secret fails closed in production and stays open only in dev", () => {
  const noSecret = { state: "invalid", reason: "no_secret" } as const;
  assert.equal(sessionGate({ publicPath: false, state: noSecret, production: true }), "login");
  assert.equal(sessionGate({ publicPath: false, state: noSecret, production: false }), "next");
});
