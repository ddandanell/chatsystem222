/**
 * The team directory: real operator rows, real status, no infrastructure note.
 *
 * The regression these lock down: /[workspace]/team printed "This Neon role cannot create a
 * membership table. The signed-in session is the owner of myCHEF." to every session, including a
 * reviewer, and showed one row while five operator rows existed. Two separate defects — an internal
 * infrastructure note shown as product copy, and a role assertion made to a reader who is not that
 * role.
 *
 * Pure status rules plus static checks. Nothing here needs a database or a browser: it proves the
 * classification and that the page cannot drift back to the old copy. The live rows are verified
 * separately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { operatorStatus } from "@/lib/roles";

const ROOT = process.cwd();

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

const PAGE = "src/app/[workspace]/team/page.tsx";

test("an operator row's status distinguishes disabled from awaiting approval", () => {
  assert.equal(operatorStatus({ enabled: false, approved: false }), "disabled", "switched off");
  assert.equal(operatorStatus({ enabled: true, approved: false }), "awaiting-approval", "gated");
  assert.equal(operatorStatus({ enabled: true, approved: true }), "active");
});

test("the switch wins over the gate: a disabled row is never reported as awaiting approval", () => {
  // toOperator() computes approved as enabled && config.approved !== false, so this pair is what a
  // revoked-and-switched-off row actually holds.
  assert.notEqual(operatorStatus({ enabled: false, approved: true }), "active");
  assert.equal(operatorStatus({ enabled: false, approved: true }), "disabled");
});

test("the team page no longer prints the Neon-role infrastructure note", () => {
  const page = source(PAGE);
  assert.doesNotMatch(page, /cannot create a membership table/i);
  assert.doesNotMatch(page, /This Neon role/i);
});

test("the team page asserts no role about the reader", () => {
  const page = source(PAGE);
  assert.doesNotMatch(page, /is the owner of/i);
  assert.doesNotMatch(page, /you are (an?|the) (owner|admin|reviewer)/i);
  assert.doesNotMatch(page, /the signed-in session is/i);
});

test("the team page renders the real operator rows, not one synthesised row", () => {
  const page = source(PAGE);
  assert.match(page, /listOperators\(\)/, "the directory must come from the operator rows");
  assert.match(page, /operator\.length === 0|operators\.map\(/, "rows must be mapped, with an empty state");
  assert.match(page, /operatorStatus\(/, "status must come from the tested pure function");
  assert.match(page, /STATUS_LABEL\[status\]/, "every status must render its label");
});

test("the directory renders no secret, hash or reset token", () => {
  const page = source(PAGE);
  assert.doesNotMatch(page, /encrypted_secret/i);
  assert.doesNotMatch(page, /reset_hash/i);
  assert.doesNotMatch(page, /reset_token/i);
  assert.doesNotMatch(page, /config\./, "the directory must not reach into raw operator config");
});

test("operator rows carry enabled separately from approved, so the two states stay distinct", () => {
  const operators = source("src/lib/operators.ts");
  assert.match(operators, /enabled: boolean;/, "Operator must expose the row's own switch");
  assert.match(operators, /approved: enabled && config\.approved !== false/);
  assert.match(operators, /\n\s+enabled,\n/, "toOperator must return the switch it was given");
});
