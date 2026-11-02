/**
 * The bootstrap operator path creates the first owner, and never touches one that already exists.
 *
 * The regression these lock down: with OPERATOR_BOOTSTRAP_PASSWORD set to anything of 8+ characters
 * whose hash did not match the stored one, ensureBootstrapOperator() rewrote encrypted_secret, set
 * enabled = true and wrote role: owner, approved: true on the row it found. A single environment
 * variable could therefore reset the owner's password, undo a deliberate "Disabled" and re-grant the
 * owner role — reached from an unauthenticated auth call, not from the console.
 *
 * These are unit tests against an injected pool: no Postgres, no network, no operator row touched.
 * The four statements the function can issue are observable, so "writes nothing" is asserted as an
 * empty write log rather than inferred from a comment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureBootstrapOperator, type OperatorPool } from "@/lib/operators";

const ROOT = process.cwd();

type Call = { text: string; values?: unknown[] };

function poolWith(...results: unknown[][]) {
  const calls: Call[] = [];
  let index = 0;
  const pool: OperatorPool & { calls: Call[] } = {
    calls,
    query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const rows = index < results.length ? results[index] : [];
      index += 1;
      return Promise.resolve({ rows });
    },
  };
  return pool;
}

function writes(calls: Call[]) {
  return calls.filter((call) => !/^\s*select\b/i.test(call.text));
}

function withBootstrapEnv(password: string, email?: string, body?: () => Promise<void>) {
  const before = {
    password: process.env.OPERATOR_BOOTSTRAP_PASSWORD,
    email: process.env.OPERATOR_BOOTSTRAP_EMAIL,
    database: process.env.DATABASE_URL,
  };
  // usesMychefInbox() decides from the DSN's user, so the app role has to be present for the code
  // under test to run at all. No connection is opened: the pool is injected.
  process.env.DATABASE_URL = "postgres://mychef_runtime:local-only@127.0.0.1:5432/mychef";
  process.env.OPERATOR_BOOTSTRAP_PASSWORD = password;
  if (email === undefined) delete process.env.OPERATOR_BOOTSTRAP_EMAIL;
  else process.env.OPERATOR_BOOTSTRAP_EMAIL = email;
  const restore = () => {
    for (const [name, value] of [
      ["OPERATOR_BOOTSTRAP_PASSWORD", before.password],
      ["OPERATOR_BOOTSTRAP_EMAIL", before.email],
      ["DATABASE_URL", before.database],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  return body ? body().finally(restore) : restore;
}

test("an existing operator row is left alone, so the env var cannot reset the owner's password", async () => {
  const pool = poolWith([{ id: "operator:bali@mychef.id" }]);
  await withBootstrapEnv("a-different-password", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
  });
  assert.equal(pool.calls.length, 1, "one read, and nothing else");
  assert.match(pool.calls[0].text, /^\s*select\b/i);
  assert.deepEqual(writes(pool.calls), [], "no statement of any kind may write to an existing row");
});

test("a deliberately disabled owner row stays disabled", async () => {
  const pool = poolWith([{ id: "operator:bali@mychef.id" }]);
  await withBootstrapEnv("a-different-password", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
  });
  const calls = pool.calls.map((call) => call.text.toLowerCase());
  assert.equal(
    calls.some((text) => text.includes("enabled")),
    false,
    "the bootstrap path must not name enabled at all, in a read or a write",
  );
});

test("an existing row is not even read for its hash, so a stored typo cannot be overwritten", async () => {
  const pool = poolWith([{ id: "operator:bali@mychef.id" }]);
  await withBootstrapEnv("a-different-password", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
  });
  const joined = pool.calls.map((call) => call.text).join("\n");
  assert.equal(joined.includes("encrypted_secret"), false, "no read of the credential, so no reason to rewrite it");
});

test("a missing row is created once, as the owner, with a conflict-safe insert", async () => {
  const pool = poolWith([], []);
  await withBootstrapEnv("bootstrap-pass-1", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
  });
  assert.equal(pool.calls.length, 2, "one select, one insert");
  const insert = pool.calls[1];
  assert.match(insert.text, /insert into mychef_inbox\.integration_connections/i);
  assert.match(insert.text, /on conflict \(workspace_id, id\) do nothing/i);
  assert.equal(/\bdo update\b/i.test(insert.text), false, "creation must not become an upsert");
  assert.equal(/\bset\b/i.test(insert.text), false, "no assignment clause in the create path");
  assert.deepEqual(insert.values?.slice(0, 3), ["mychef", "operator:bali@mychef.id", "Bali"]);
  const config = JSON.parse(String(insert.values?.[4]));
  assert.deepEqual(config, {
    purpose: "operator",
    email: "bali@mychef.id",
    name: "Bali",
    role: "owner",
    approved: true,
  });
});

test("a second boot after the row appears writes nothing, so the path is idempotent", async () => {
  const pool = poolWith([], [], [{ id: "operator:bali@mychef.id" }]);
  await withBootstrapEnv("bootstrap-pass-1", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
    await ensureBootstrapOperator({ pool });
  });
  assert.equal(pool.calls.length, 3, "select + insert, then a single select");
  assert.equal(writes(pool.calls).length, 1, "exactly one insert across two boots");
});

test("a password under eight characters creates nothing at all", async () => {
  const pool = poolWith([]);
  await withBootstrapEnv("short", "bali@mychef.id", async () => {
    await ensureBootstrapOperator({ pool });
  });
  assert.deepEqual(pool.calls, []);
});

test("an email without an @ creates nothing at all", async () => {
  const pool = poolWith([]);
  await withBootstrapEnv("bootstrap-pass-1", "not-an-email", async () => {
    await ensureBootstrapOperator({ pool });
  });
  assert.deepEqual(pool.calls, []);
});

test("with no email set, the documented bootstrap identity is still bali@mychef.id", async () => {
  const pool = poolWith([], []);
  await withBootstrapEnv("bootstrap-pass-1", undefined, async () => {
    await ensureBootstrapOperator({ pool });
  });
  assert.equal(pool.calls[1].values?.[1], "operator:bali@mychef.id");
});

test("the source of the function contains no update statement", () => {
  const source = readFileSync(join(ROOT, "src/lib/operators.ts"), "utf8");
  const start = source.indexOf("export async function ensureBootstrapOperator(");
  const end = source.indexOf("export async function verifyOperator(");
  assert.ok(start > 0 && end > start, "the function must still exist, and still precede verifyOperator");
  const body = source.slice(start, end);
  assert.equal(/\bdo update\b/i.test(body), false, "no upsert in the bootstrap path");
  assert.equal(/\bset\s+encrypted_secret\b/i.test(body), false, "no hash rewrite in the bootstrap path");
  assert.match(body, /on conflict \(workspace_id, id\) do nothing/);
});
