/**
 * Residual C of the same defect class as tests/viewer-role-defaults.test.ts: a role assumed rather
 * than stated.
 *
 * A. saveOperatorAction floors a missing `role` field at viewer (shipped in #19). That floor only
 *    protects callers that send no role. The create form itself still preselected "Reviewer", so
 *    an admin who did not touch the select submitted a role that can approve and send. The action
 *    cannot tell "chose reviewer" from "left the default alone", so the form must state the least
 *    privilege that can still sign in, and the default must be in the option list it renders.
 *
 * No database, no network, no render: the assertion is against the shipped source, the same way
 * tests/audit-view.test.ts asserts the shipped audit string. The positive control below proves the
 * Reviewer option is still offered, so this test cannot pass by deleting the role.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/[workspace]/settings/access/page.tsx");
const ACTIONS = join(process.cwd(), "src/app/[workspace]/settings/access/actions.ts");

function roleSelect(source: string) {
  const select = source.match(/<select[^>]*name="role"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, "the create form must still have a role select");
  const tag = select![0].slice(0, select![0].indexOf(">"));
  const options = [...select![1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const selected = tag.match(/defaultValue="([^"]+)"/);
  return { tag, options, defaultValue: selected ? selected[1] : null };
}

test("the create form preselected reviewer; it must preselect the least privilege that can sign in", () => {
  const { defaultValue, options } = roleSelect(readFileSync(PAGE, "utf8"));
  assert.equal(defaultValue, "viewer", "an untouched select must not submit a reviewer");
  assert.ok(
    options.includes("viewer"),
    "the preselected value must exist as an option, or the browser falls back to the first one",
  );
});

test("the source holds no reviewer preselection anywhere in the access form", () => {
  const source = readFileSync(PAGE, "utf8");
  assert.doesNotMatch(source, /defaultValue="reviewer"/, "no form field may default to reviewer");
});

test("positive control: Reviewer is still offered, so the default was changed, not the option removed", () => {
  const { options } = roleSelect(readFileSync(PAGE, "utf8"));
  assert.deepEqual(options, ["reviewer", "viewer", "admin", "owner"], "every role must stay selectable");
});

test("the submit handler's floor still matches the form default, so both agree", () => {
  const source = readFileSync(ACTIONS, "utf8");
  assert.match(
    source,
    /roleOf\(String\(formData\.get\("role"\) \?\? "viewer"\)\)/,
    "an absent role field must still resolve to viewer in the action",
  );
  const page = roleSelect(readFileSync(PAGE, "utf8"));
  assert.equal(page.defaultValue, "viewer", "the form default and the action floor must not diverge");
});
