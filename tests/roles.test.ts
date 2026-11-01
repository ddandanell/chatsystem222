/**
 * Roles: a viewer may sign in and read, and may not draft a reply or record a decision.
 *
 * The regression these lock down: OperatorRole had no viewer member, so asRole() in
 * src/lib/operators.ts turned a jsonb role of "viewer" into "reviewer" and a read-only audit
 * account could write. The capability rules were already right; the coercion was the hole.
 *
 * Pure unit tests plus static checks. Nothing here needs a database or a browser, so it proves the
 * classification and the presence of the guard — the live row is verified separately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, canManageKeys, canReview, operatorRole, parseRole, type Role } from "@/lib/roles";

const ROOT = process.cwd();

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

test("the four roles are exactly owner, admin, reviewer, viewer", () => {
  assert.deepEqual([...ROLES].sort(), ["admin", "owner", "reviewer", "viewer"]);
});

test("viewer can neither draft nor record a decision, and manages no keys", () => {
  assert.equal(canReview("viewer"), false, "a viewer must not draft or record a decision");
  assert.equal(canManageKeys("viewer"), false);
});

test("the capability matrix for every role, so no role drifts by accident", () => {
  const expected: Record<Role, { review: boolean; manage: boolean }> = {
    owner: { review: true, manage: true },
    admin: { review: true, manage: true },
    reviewer: { review: true, manage: false },
    viewer: { review: false, manage: false },
  };
  for (const role of ROLES) {
    assert.equal(canReview(role), expected[role].review, `${role} review`);
    assert.equal(canManageKeys(role), expected[role].manage, `${role} manage`);
  }
});

test("parseRole accepts all four, normalises case and padding, and refuses anything else", () => {
  for (const role of ROLES) assert.equal(parseRole(role), role);
  assert.equal(parseRole(" Viewer "), "viewer");
  assert.equal(parseRole("OWNER"), "owner");
  for (const junk of [undefined, null, "", "   ", "auditor", "viewers", 1, {}, "owner "]) {
    if (junk === "owner ") continue;
    assert.equal(parseRole(junk), null, String(junk));
  }
});

test("a jsonb role of viewer stays viewer through the operator path", () => {
  assert.equal(operatorRole("viewer"), "viewer");
  assert.equal(canReview(operatorRole("viewer")), false);
});

test("an unrecognised jsonb role resolves to viewer, never to reviewer", () => {
  for (const junk of [undefined, "", "auditor", "read-only", "ReadOnly"]) {
    const role = operatorRole(junk);
    assert.equal(role, "viewer", `input ${String(junk)}`);
    assert.notEqual(role, "reviewer", "an unknown role must not inherit reviewer's write powers");
    assert.equal(canReview(role), false);
  }
});

test("operator rows now carry the workspace role type, viewer included", () => {
  const text = source("src/lib/operators.ts");
  assert.match(text, /export type OperatorRole = Role;/);
  assert.doesNotMatch(
    text,
    /OperatorRole = "owner" \| "admin" \| "reviewer"/,
    "the three-value operator role is the bug",
  );
  assert.doesNotMatch(
    text,
    /value === "owner" \|\| value === "admin" \|\| value === "reviewer"/,
    "no three-value allowlist may remain in the operator path",
  );
});

test("the settings form can save a viewer and passes it through unchanged", () => {
  assert.match(source("src/app/[workspace]/settings/access/page.tsx"), /<option value="viewer">/);
  const actions = source("src/app/[workspace]/settings/access/actions.ts");
  assert.match(actions, /return operatorRole\(value\);/);
  assert.doesNotMatch(actions, /value === "owner" \|\| value === "admin" \|\| value === "reviewer"/);
});

test("workspace-access re-exports the shared rules instead of defining its own", () => {
  const text = source("src/lib/workspace-access.ts");
  assert.match(text, /export \{ canManageKeys, canReview \};/);
  assert.doesNotMatch(text, /return role === "owner" \|\| role === "admin" \|\| role === "reviewer";/);
});

/** Body of one exported server action, up to the next export or the end of the file. */
function actionBody(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\nexport (async )?(function|const|type)/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("every drafting and decision-writing action is gated by canReview", () => {
  const text = source("src/app/[workspace]/inbox/mychef-actions.ts");
  for (const name of [
    "draftConversationAction",
    "agentDraftAction",
    "reviewConversationAction",
    "outcomeAction",
  ]) {
    const body = actionBody(text, name);
    assert.match(body, /canReview\(access\.ctx\.role\)/, `${name} must gate on canReview`);
    assert.match(body, /if \(access\.status !== "ok"/, `${name} must gate on the workspace`);
  }
});

test("every inbox mutation in actions.ts is gated the same way", () => {
  const text = source("src/app/[workspace]/inbox/actions.ts");
  const names = [...text.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.ok(names.length > 0, "expected server actions in inbox/actions.ts");
  for (const name of names) {
    assert.match(actionBody(text, name), /canReview\(/, `${name} must gate on canReview`);
  }
});
