/**
 * ENG-1, part 3: a refused role has to be visible, not a silent downgrade.
 *
 * The safe half shipped first: an operator row whose role is misspelt, missing or nonsense resolves
 * to viewer, never to reviewer. That is the correct power, but by itself it hides its own cause —
 * the directory printed "viewer" for a row that says "manager", which reads exactly like a
 * deliberate read-only seat, so nobody ever fixes the row.
 *
 * These tests fix the two halves that were missing: the resolver reports *whether* it understood the
 * stored value and what the value said, and both pages that print a role show that fact only for the
 * rows where it is true. Nothing here needs a database: the resolver is pure, and the page checks are
 * static assertions on the rendered branch (the same approach tests/team-directory.test.ts uses).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, canReview, operatorRole, resolveOperatorRole } from "@/lib/roles";

const ROOT = process.cwd();

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

const TEAM_PAGE = "src/app/[workspace]/team/page.tsx";
const ACCESS_PAGE = "src/app/[workspace]/settings/access/page.tsx";

test("each of the four real roles is recognised and keeps its own powers", () => {
  for (const role of ROLES) {
    const resolved = resolveOperatorRole(role);
    assert.equal(resolved.role, role, `${role} must not change`);
    assert.equal(resolved.recognised, true, `${role} is a real role`);
    assert.equal(resolved.stored, role);
    assert.equal(canReview(resolved.role), role !== "viewer", `${role} keeps its write powers`);
  }
});

test("a misspelt role is read-only and is reported as unrecognised", () => {
  for (const junk of ["manager", "auditor", "read-only", "ReadOnly", "admin2", "reviwer"]) {
    const resolved = resolveOperatorRole(junk);
    assert.equal(resolved.role, "viewer", `${junk} must be read-only`);
    assert.equal(resolved.recognised, false, `${junk} was not understood and must say so`);
    assert.equal(resolved.stored, junk, "the directory quotes the value that was stored");
    assert.equal(canReview(resolved.role), false);
  }
});

test("a role with padding or capitals is still recognised, once trimmed", () => {
  for (const value of [" owner ", "Admin", " reviewer\t", "VIEWER"]) {
    const resolved = resolveOperatorRole(value);
    assert.equal(resolved.recognised, true, `${value} names a real role`);
    assert.equal(resolved.role, value.trim().toLowerCase());
  }
});

test("a missing role is unrecognised too, so an unset row is not a quiet viewer", () => {
  for (const missing of [undefined, null, "", "   "]) {
    const resolved = resolveOperatorRole(missing);
    assert.equal(resolved.role, "viewer");
    assert.equal(resolved.recognised, false, "an absent role is not the same fact as a chosen viewer");
    assert.equal(resolved.stored, null, "there is no value to quote back");
  }
});

test("a non-string value cannot masquerade as a recognised role", () => {
  for (const value of [42, true, {}, ["owner"], { role: "owner" }]) {
    const resolved = resolveOperatorRole(value);
    assert.equal(resolved.role, "viewer");
    assert.equal(resolved.recognised, false, `${JSON.stringify(value)} is not a role`);
    assert.equal(resolved.stored, null, "nothing printable is invented from a non-string");
  }
});

test("operatorRole is the resolver's role, so the two can never disagree", () => {
  for (const value of ["owner", "viewer", "manager", undefined, 7]) {
    assert.equal(operatorRole(value), resolveOperatorRole(value).role);
  }
});

test("the operator row carries the resolver's answer, not a constant", () => {
  const text = source("src/lib/operators.ts");
  assert.match(text, /resolveOperatorRole\(config\.role\)/, "the row must go through the resolver");
  assert.match(text, /roleRecognised: resolution\.recognised/);
  assert.match(text, /storedRole: resolution\.stored/);
  assert.doesNotMatch(text, /roleRecognised: true/, "a hardcoded true would hide every bad row");
  assert.doesNotMatch(
    text,
    /value === "owner" \|\| value === "admin" \|\| value === "reviewer"/,
    "the three-value allowlist must stay dead",
  );
});

test("the team page marks an unrecognised row and explains it once, under the table", () => {
  const page = source(TEAM_PAGE);
  assert.match(page, /\{row\.roleRecognised \? null : \(/, "the marker must be conditional on the flag");
  assert.match(page, /data-role-unrecognised/, "the marker must be findable by its own attribute");
  // The explanation lists the affected rows, so the owner knows which row to fix on a phone.
  assert.match(page, /operators\.filter\(\(row\) => !row\.roleRecognised\)/);
  assert.match(page, /unresolved\.map\(\(row\) => \(/);
  assert.match(page, /row\.storedRole/, "the note quotes what the row actually says");
  assert.match(page, /read-only/, "the note states the consequence, not just the parse failure");
  assert.doesNotMatch(page, /roleRecognised \? \(/, "the note must never appear for a valid role");
  // It must not become a paragraph inside the Role cell again: that wrapped badly at 390px.
  assert.doesNotMatch(page, /<TableCell>\s*<span[^>]*>\s*<span[^>]*data-role-unrecognised/);
});

test("the access page prints the same note, where an owner would look to fix the row", () => {
  const page = source(ACCESS_PAGE);
  assert.match(page, /\{operator\.roleRecognised \? null : \(/);
  assert.match(page, /operator\.storedRole/);
  assert.match(page, /data-role-unrecognised/);
  assert.match(page, /read-only/);
});

test("no page promises a fix it cannot perform, or names the reader's role", () => {
  for (const page of [TEAM_PAGE, ACCESS_PAGE]) {
    const text = source(page);
    assert.doesNotMatch(text, /you are (an?|the) (owner|admin|reviewer)/i, page);
    assert.doesNotMatch(text, /will be corrected|has been fixed/i, page);
  }
});
