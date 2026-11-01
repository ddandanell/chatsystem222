/**
 * Tests for the post-sign-in destination.
 *
 * The proxy used to write `callbackUrl` and nothing read it, so every sign-in landed on
 * /mychef/inbox no matter which page was refused; the value it wrote also dropped the query
 * string, so a conversation link could not survive login even if it had been read. These tests
 * pin the two halves that fix that: the value the proxy records (path plus query) and the
 * validation that keeps a crafted value from becoming an open redirect.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginCallback, safeCallbackTarget } from "@/lib/login-callback";

test("the refused path is recorded with its query string", () => {
  assert.equal(
    loginCallback("/mychef/inbox", "?conversation=abc123"),
    "/mychef/inbox?conversation=abc123",
  );
});

test("a path that already carries its query is left alone", () => {
  assert.equal(
    loginCallback("/mychef/inbox?conversation=abc123", ""),
    "/mychef/inbox?conversation=abc123",
  );
});

test("no query means no stray question mark", () => {
  assert.equal(loginCallback("/mychef/candidates", ""), "/mychef/candidates");
  assert.equal(loginCallback("/mychef/candidates", "?"), "/mychef/candidates");
  assert.equal(loginCallback("/mychef/candidates", undefined), "/mychef/candidates");
});

test("a query without its leading question mark still becomes a query", () => {
  assert.equal(loginCallback("/mychef/inbox", "tag=vip"), "/mychef/inbox?tag=vip");
});

test("nothing worth preserving yields no callback", () => {
  assert.equal(loginCallback("/", ""), null);
  assert.equal(loginCallback("", ""), null);
});

test("a query on the root is still a deep link", () => {
  assert.equal(loginCallback("/", "?tab=keys"), "/?tab=keys");
});

test("the callback cannot leave this site", () => {
  const refused = [
    "//evil.example/login",
    "///evil.example",
    "/\\evil.example",
    "\\/evil.example",
    "https://evil.example/login",
    "http://evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.example/login",
    "/login\r\nLocation: https://evil.example",
    "/login\nSet-Cookie: a=b",
  ];
  for (const value of refused) {
    assert.equal(safeCallbackTarget(value), null, value);
  }
  assert.equal(loginCallback("//evil.example", "?x=1"), null);
  assert.equal(loginCallback("https://evil.example", ""), null);
});

test("an over-long value is refused rather than truncated", () => {
  const long = "/mychef/inbox?" + "a".repeat(2500);
  assert.equal(safeCallbackTarget(long), null);
  assert.equal(safeCallbackTarget("/mychef/inbox?" + "a".repeat(1000))?.length, 1014);
});

test("an ordinary internal deep link is accepted, trimmed", () => {
  assert.equal(
    safeCallbackTarget("  /mychef/inbox?conversation=abc&tab=why  "),
    "/mychef/inbox?conversation=abc&tab=why",
  );
  assert.equal(safeCallbackTarget("/"), "/");
});

test("a missing or non-string value is not a target", () => {
  assert.equal(safeCallbackTarget(undefined), null);
  assert.equal(safeCallbackTarget(null), null);
  assert.equal(safeCallbackTarget(""), null);
  assert.equal(safeCallbackTarget("   "), null);
  assert.equal(safeCallbackTarget(42), null);
  assert.equal(safeCallbackTarget(["/mychef/inbox"]), null);
});
