/**
 * ENG-2 (part 5): the audit route described itself as "Feedback and rule status changes", which
 * is wrong in both directions. The list carries key, operator, import and decision changes too,
 * and since #21 it shows the actor on every row — the one fact the page exists to settle. Copy
 * that misdescribes the list is how an audit page stops being read, so the sentence is asserted
 * here rather than left to drift.
 *
 * The route description is one exported constant, so this is a real assertion on the rendered
 * string; the empty state is rendered through the component. The only source assertion is that
 * the route renders that constant instead of keeping a second copy of the sentence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AUDIT_DESCRIPTION, toAuditRowView } from "@/lib/audit-view";
import { AuditList } from "@/components/audit-list";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("the audit description names the actor, which is what the list is for", () => {
  assert.match(AUDIT_DESCRIPTION, /actor/);
  assert.match(AUDIT_DESCRIPTION, /newest first/);
});

test("the audit description no longer claims the list is feedback and rule status only", () => {
  assert.doesNotMatch(AUDIT_DESCRIPTION, /Feedback and rule status changes/);
  assert.ok(!/feedback and rule status/i.test(AUDIT_DESCRIPTION));
});

test("the route renders the one description constant and keeps no second copy", () => {
  const source = read("src/app/[workspace]/audit/page.tsx");
  assert.match(source, /\{AUDIT_DESCRIPTION\}/);
  assert.doesNotMatch(source, /Feedback and rule status changes/);
  assert.equal(source.split("AUDIT_DESCRIPTION").length - 1, 2, "import plus one render, no third use");
});

test("the empty state describes the same list, with the actor", () => {
  const html = renderToStaticMarkup(createElement(AuditList, { rows: [] }));
  assert.match(html, /Changes recorded in this workspace will show up here, with the actor\./);
  assert.doesNotMatch(html, /Reviews and rule changes will show up here/);
});

test("a populated row still renders the actor beside the copy the page promises", () => {
  const row = toAuditRowView({
    id: "row-1",
    actor_id: "product-qa",
    action: "operator.test-write.quarantined",
    record_id: "operator:setup.probe@mychef.id",
    created_at: new Date("2026-11-01T08:22:40.902Z"),
  });
  const html = renderToStaticMarkup(createElement(AuditList, { rows: [row] }));
  assert.match(html, /data-audit-actor="product-qa"/);
  assert.match(html, /by/);
  assert.doesNotMatch(html, /Reviews and rule changes will show up here/);
});
