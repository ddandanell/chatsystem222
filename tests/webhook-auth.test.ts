/**
 * Automated tests for inbound webhook authentication (fail closed).
 * No database, no network, no provider call: pure-function tests over synthetic headers.
 *
 * These encode the finding that `authorizeGhl` used to accept any request when
 * GHL_WEBHOOK_SECRET was unset, on an endpoint that writes contacts, conversations,
 * messages and drafts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeWebhook, WEBHOOK_SKEW_SECONDS } from "@/lib/webhook-auth";

const NOW = 1_800_000_000_000; // fixed clock, ms
const NOW_S = Math.floor(NOW / 1000);

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { GHL_WEBHOOK_SECRET: "test-secret-value", ...overrides };
}

test("a missing secret refuses the event instead of accepting it", () => {
  const result = authorizeWebhook(headers({}), { env: env({ GHL_WEBHOOK_SECRET: undefined }), nowMs: NOW });
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
  assert.equal(result.ok === true && result.reason, "unverified-local");
});

test("a correct secret in x-ghl-secret is verified", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-value" }), { env: env(), nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.verified, true);
});

test("a correct secret in a bearer token is verified", () => {
  const result = authorizeWebhook(headers({ authorization: "Bearer test-secret-value" }), {
    env: env(),
    nowMs: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.verified, true);
});

test("a wrong secret is refused with 401, not 503", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "wrong" }), { env: env(), nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a secret that only shares a prefix is refused", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-valu" }), { env: env(), nowMs: NOW });
  assert.equal(result.ok, false);
});

test("an empty presented secret is refused even against a non-empty configured secret", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "" }), { env: env(), nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a fresh timestamp in seconds is accepted", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-value", "x-ghl-timestamp": String(NOW_S) }), {
    env: env(),
    nowMs: NOW,
  });
  assert.equal(result.ok, true);
});

test("a stale timestamp is refused even with the right secret (replay)", () => {
  const stale = String(NOW_S - WEBHOOK_SKEW_SECONDS - 1);
  const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-value", "x-ghl-timestamp": stale }), {
    env: env(),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("a future timestamp beyond the window is refused", () => {
  const future = String(NOW_S + WEBHOOK_SKEW_SECONDS + 1);
  const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-value", "x-ghl-timestamp": future }), {
    env: env(),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
});

test("a non-numeric timestamp is refused rather than ignored", () => {
  for (const bad of ["", "  ", "yesterday", "17e9", "-1"]) {
    const result = authorizeWebhook(headers({ "x-ghl-secret": "test-secret-value", "x-ghl-timestamp": bad }), {
      env: env(),
      nowMs: NOW,
    });
    assert.equal(result.ok, false, `timestamp ${JSON.stringify(bad)} must be refused`);
  }
});

test("a refusal never echoes the configured secret", () => {
  const result = authorizeWebhook(headers({ "x-ghl-secret": "presented-value" }), {
    env: env({ GHL_WEBHOOK_SECRET: "configured-value-do-not-echo" }),
    nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("configured-value-do-not-echo"), false);
});
