/**
 * Tests for the three hardening rules added after review: the in-memory address key is a hash and
 * not the address, the window is bounded by eviction rather than by clearing everything, and the
 * reset page asks for no referrer.
 *
 * Nothing here needs a database, a mail server or a browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RATE_WINDOW_MS,
  hashAddressKey,
  pruneAddressWindow,
  type AddressWindowEntry,
} from "@/lib/password-reset";
import nextConfig from "../next.config";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");

function windowOf(entries: Array<[string, AddressWindowEntry]>) {
  return new Map<string, AddressWindowEntry>(entries);
}

test("the address key is a hash, not the address", () => {
  const address = "203.0.113.42";
  const key = hashAddressKey(address);
  assert.notEqual(key, address);
  assert.equal(key.includes(address), false);
  assert.equal(key.includes("203"), false);
  assert.match(key, /^[0-9a-f]{32}$/);
});

test("the same address always hashes the same, and different addresses do not collide", () => {
  assert.equal(hashAddressKey("203.0.113.42"), hashAddressKey("203.0.113.42"));
  assert.equal(hashAddressKey("203.0.113.42"), hashAddressKey("  203.0.113.42  "));
  assert.notEqual(hashAddressKey("203.0.113.42"), hashAddressKey("203.0.113.43"));
});

test("a window below the cap is left completely alone", () => {
  const window = windowOf([
    ["a", { attempts: 1, windowStart: new Date(NOW).toISOString() }],
    ["b", { attempts: 2, windowStart: new Date(NOW - 1000).toISOString() }],
  ]);
  pruneAddressWindow(window, NOW, 500);
  assert.equal(window.size, 2);
});

test("expired entries are dropped first, so a quiet window keeps its live counters", () => {
  const stale = new Date(NOW - RATE_WINDOW_MS - 1).toISOString();
  const fresh = new Date(NOW).toISOString();
  const window = windowOf([
    ["old-1", { attempts: 10, windowStart: stale }],
    ["old-2", { attempts: 10, windowStart: stale }],
    ["live", { attempts: 7, windowStart: fresh }],
    ["live-2", { attempts: 1, windowStart: fresh }],
  ]);
  pruneAddressWindow(window, NOW, 4);
  assert.equal(window.has("old-1"), false);
  assert.equal(window.has("old-2"), false);
  assert.equal(window.has("live"), true);
  assert.equal(window.get("live")?.attempts, 7);
  assert.equal(window.has("live-2"), true);
});

test("at the cap with nothing expired, the oldest entries go and the newest stay", () => {
  const entries: Array<[string, AddressWindowEntry]> = [];
  for (let i = 0; i < 5; i += 1) {
    entries.push([`key-${i}`, { attempts: 1, windowStart: new Date(NOW - (5 - i) * 1000).toISOString() }]);
  }
  const window = windowOf(entries);
  pruneAddressWindow(window, NOW, 3);
  assert.equal(window.size, 2);
  assert.equal(window.has("key-4"), true);
  assert.equal(window.has("key-3"), true);
  assert.equal(window.has("key-0"), false);
});

test("eviction never clears the whole window, which is what an abusive client wants", () => {
  const entries: Array<[string, AddressWindowEntry]> = [];
  for (let i = 0; i < 600; i += 1) {
    entries.push([`k${i}`, { attempts: 1, windowStart: new Date(NOW - i).toISOString() }]);
  }
  const window = windowOf(entries);
  pruneAddressWindow(window, NOW, 500);
  assert.ok(window.size < 500, `expected under the cap, got ${window.size}`);
  assert.ok(window.size > 400, `expected most counters kept, got ${window.size}`);
});

test("the reset page is served with Referrer-Policy: no-referrer", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((entry) => entry.source === "/login/reset");
  assert.ok(rule, "no header rule for /login/reset");
  const header = rule.headers.find((h) => h.key.toLowerCase() === "referrer-policy");
  assert.ok(header, "no Referrer-Policy on /login/reset");
  assert.equal(header.value, "no-referrer");
});

test("the no-referrer rule does not spread to the whole site", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const broad = rules.filter((entry) => entry.source === "/(.*)" || entry.source === "/:path*");
  for (const entry of broad) {
    assert.equal(
      entry.headers.some((h) => h.key.toLowerCase() === "referrer-policy"),
      false,
      "Referrer-Policy must not be set site-wide by this change",
    );
  }
});
