/**
 * MC-141: a crashed panel is contained, and the screen does not leak the internals.
 *
 * Before this, the workspace boundary printed `error.message` verbatim. In production that is either
 * the generic Next.js sentence (no help) or, for a database error, a query fragment or a stack frame
 * in front of an operator. The rules now live in a pure function so they are testable, and the
 * boundaries are checked as files so a missing one is a failing test rather than a blank console.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorCopy } from "@/lib/error-copy";

const ROOT = process.cwd();
const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

test("outside production the developer sees the real sentence", () => {
  const copy = errorCopy({ message: "boom: field is required", production: false });
  assert.equal(copy.detail, "boom: field is required");
  assert.equal(copy.showsRawMessage, true);
});

test("outside production an empty message still yields a usable sentence", () => {
  const copy = errorCopy({ message: "   ", production: false });
  assert.match(copy.detail, /Nothing was sent/);
  assert.equal(copy.showsRawMessage, false);
});

test("a database error never reaches the screen in production", () => {
  const copy = errorCopy({
    message: 'invalid input syntax for type uuid: "not-a-uuid"',
    digest: "abc123",
    production: true,
  });
  assert.match(copy.detail, /Nothing was sent/);
  assert.doesNotMatch(copy.detail, /uuid|invalid input/i);
  assert.equal(copy.showsRawMessage, false);
  assert.equal(copy.reference, "Reference abc123");
});

test("connection errors, stacks, SQL and secret words are all refused in production", () => {
  const samples = [
    "connect ECONNREFUSED 10.0.0.1:5432",
    "at obj.query (/app/src/db/client.ts:69:24)",
    "select * from mychef_inbox.operators",
    "scrypt$1$2$3",
    "Minified React error #418; visit https://react.dev/errors/418",
  ];
  for (const message of samples) {
    const copy = errorCopy({ message, production: true });
    assert.match(copy.detail, /Nothing was sent/, message);
    assert.ok(!copy.detail.includes(message), message);
  }
});

test("a short human sentence is kept in production", () => {
  const copy = errorCopy({ message: "This conversation is no longer available.", production: true });
  assert.equal(copy.detail, "This conversation is no longer available.");
});

test("an over-long message falls back instead of filling the panel", () => {
  const copy = errorCopy({ message: "x".repeat(400), production: true });
  assert.match(copy.detail, /Nothing was sent/);
});

test("a multi-line message falls back, because stacks arrive that way", () => {
  const copy = errorCopy({ message: "first line\n    at somewhere", production: true });
  assert.match(copy.detail, /Nothing was sent/);
});

test("the digest is quoted as-is, and an absent or blank digest is not invented", () => {
  assert.equal(errorCopy({ message: "x", digest: "  d1g3st  ", production: true }).reference, "Reference d1g3st");
  assert.equal(errorCopy({ message: "x", production: true }).reference, null);
  assert.equal(errorCopy({ message: "x", digest: "   ", production: true }).reference, null);
});

test("every segment that can render a page has an error boundary", () => {
  for (const file of [
    "src/app/error.tsx",
    "src/app/global-error.tsx",
    "src/app/[workspace]/error.tsx",
    "src/app/[workspace]/inbox/error.tsx",
  ]) {
    assert.ok(existsSync(join(ROOT, file)), `${file} is missing`);
    const body = source(file);
    assert.match(body, /errorCopy/, `${file} must use the shared copy rules`);
    assert.doesNotMatch(body, /\{error\.message\}/, `${file} must not print the raw message`);
    assert.match(body, /reset/, `${file} must offer a way to retry`);
  }
});

test("the global boundary renders its own document, as Next.js requires", () => {
  const body = source("src/app/global-error.tsx");
  assert.match(body, /<html/);
  assert.match(body, /<body/);
  assert.match(body, /"use client"/);
});

test("the boundaries promise that nothing was sent", () => {
  assert.match(
    errorCopy({ message: "", production: true }).detail,
    /Nothing was sent to a guest and no decision was recorded/,
  );
});
