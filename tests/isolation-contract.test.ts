/**
 * Safety contract tests for the isolation and retrieval evidence scripts, and for the request path.
 *
 * These are static checks: they cannot prove the live database is isolated (scripts/verify-isolation.ts
 * does that), but they catch the mistakes that would make every later claim false:
 *   1. an owner/migration connection string reaching the serving path;
 *   2. an "evidence" script that quietly writes to the database it is inspecting.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

/** Standalone operator CLIs. Nothing in the app may import them. */
const OWNER_CLI_ENTRYPOINTS = ["src/db/migrate.ts", "src/db/seed.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(join(ROOT, "src")).filter((file) => /\.(ts|tsx)$/.test(file));

const WRITE_SQL =
  /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table|truncate|create\s+table|grant\s+|revoke\s+)/i;

test("only the two operator CLIs read an owner/migration connection string", () => {
  const offenders = sourceFiles
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return /MIGRATION_DATABASE_URL|OWNER_DATABASE_URL|mychef_owner/.test(text);
    })
    .map((file) => relative(ROOT, file))
    .sort();
  assert.deepEqual(offenders, [...OWNER_CLI_ENTRYPOINTS].sort());
});

test("no request-path module imports the operator CLIs", () => {
  const offenders = sourceFiles
    .map((file) => relative(ROOT, file))
    .filter((file) => !OWNER_CLI_ENTRYPOINTS.includes(file))
    .filter((file) => /from\s+["'][^"']*(db\/migrate|db\/seed)["']/.test(readFileSync(join(ROOT, file), "utf8")));
  assert.deepEqual(offenders, [], "migrate/seed must stay CLI-only");
});

test("the app role allowlist keeps mychef_runtime and refuses an unknown role", () => {
  const client = readFileSync(join(ROOT, "src/db/client.ts"), "utf8");
  assert.match(client, /APP_ROLES\s*=\s*new Set\(\[[^\]]*"mychef_runtime"/);
  assert.match(client, /throw new Error\(\s*`Refusing database user/);
});

test("verify-isolation is read-only and gates on --strict", () => {
  const text = readFileSync(join(ROOT, "scripts/verify-isolation.ts"), "utf8");
  assert.doesNotMatch(text, WRITE_SQL, "the isolation probe must not contain write SQL");
  assert.match(text, /--strict/);
  assert.match(text, /if \(STRICT && !dbEnforced\)/);
});

test("verify-retrieval-policy is read-only", () => {
  const text = readFileSync(join(ROOT, "scripts/verify-retrieval-policy.ts"), "utf8");
  assert.doesNotMatch(text, WRITE_SQL, "the retrieval probe must not contain write SQL");
});

test("CI runs the unit tests before the build", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const testAt = ci.indexOf("npm test");
  const buildAt = ci.indexOf("npm run build");
  assert.ok(testAt > -1, "CI must run npm test");
  assert.ok(buildAt > testAt, "tests must run before the build");
});
