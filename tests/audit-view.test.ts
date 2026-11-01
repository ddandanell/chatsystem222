/**
 * QA-W6-04: /mychef/audit listed kind, time and summary but dropped actor_id, so rows that say
 * `actor product-qa` in the database rendered with no actor at all and could not settle who
 * wrote a row. These tests fix the seam: the mapping keeps the actor, absence is labelled, and
 * the rendered list carries one actor per row.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NOT_RECORDED_ACTOR,
  UNKNOWN_ACTOR,
  auditActorLabel,
  auditKind,
  sortAuditRows,
  toAuditRowView,
  type AuditRowView,
} from "@/lib/audit-view";
import { AuditList } from "@/components/audit-list";

const WHEN = new Date("2026-11-01T08:22:40.902Z");

function sourceRow(overrides: Partial<Parameters<typeof toAuditRowView>[0]> = {}) {
  return {
    id: "df28e3dc-223d-4d60-82fd-ed14388dffdd",
    actor_id: "product-qa",
    action: "operator.test-write.quarantined",
    record_id: "operator:setup.probe@mychef.id",
    created_at: WHEN,
    ...overrides,
  };
}

test("the live actor reaches the view instead of being dropped", () => {
  const view = toAuditRowView(sourceRow());
  assert.equal(view.actor, "product-qa");
  assert.equal(view.id, "df28e3dc-223d-4d60-82fd-ed14388dffdd");
  assert.equal(view.when.getTime(), WHEN.getTime());
  assert.equal(view.summary, "operator.test-write.quarantined · operator:setup.probe@mychef.id");
});

test("an actor id that is a uuid is shown verbatim, not resolved by guesswork", () => {
  const id = "d72d3e30-195d-402b-9092-272cd7240f08";
  assert.equal(auditActorLabel(id), id);
  assert.equal(toAuditRowView(sourceRow({ actor_id: id })).actor, id);
});

test("an empty actor is labelled, never left blank", () => {
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(auditActorLabel(value), UNKNOWN_ACTOR);
  }
  assert.notEqual(UNKNOWN_ACTOR.trim(), "");
});

test("a schema without an actor column says so, and is distinct from an empty value", () => {
  assert.notEqual(NOT_RECORDED_ACTOR, UNKNOWN_ACTOR);
  assert.notEqual(NOT_RECORDED_ACTOR.trim(), "");
});

test("rule and outcome prefixes shorten the kind but not the summary", () => {
  assert.equal(auditKind("rule:activate"), "rule");
  assert.equal(auditKind("outcome:booked"), "outcome");
  assert.equal(auditKind("operator.created"), "operator.created");
  const view = toAuditRowView(sourceRow({ action: "outcome:booked", record_id: "d-1" }));
  assert.equal(view.kind, "outcome");
  assert.equal(view.summary, "outcome:booked · d-1");
});

test("sorting is newest first and does not wobble when timestamps collide", () => {
  const base = {
    when: WHEN,
    kind: "operator.created",
    actor: "product-qa",
    summary: "x · y",
  };
  const rows: AuditRowView[] = [
    { ...base, id: "b" },
    { ...base, id: "a" },
    { ...base, id: "c", when: new Date("2026-11-01T09:00:00.000Z") },
  ];
  const sorted = sortAuditRows(rows);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["c", "a", "b"],
  );
  // The input is not mutated: the page renders what it was given, in the order it built it.
  assert.deepEqual(
    rows.map((row) => row.id),
    ["b", "a", "c"],
  );
});

test("the list renders one actor per row, including the labelled fallbacks", () => {
  const rows = [
    toAuditRowView(sourceRow()),
    toAuditRowView(sourceRow({ id: "second", actor_id: null })),
    toAuditRowView(sourceRow({ id: "third", actor_id: "d72d3e30-195d-402b-9092-272cd7240f08" })),
  ];
  const html = renderToStaticMarkup(createElement(AuditList, { rows }));

  const actors = html.match(/data-audit-actor="[^"]*"/g) ?? [];
  assert.equal(actors.length, rows.length, "every row must carry an actor");
  assert.ok(html.includes('data-audit-actor="product-qa"'), "the live actor must render");
  assert.ok(html.includes(">product-qa<"), "the actor must be visible text, not only an attribute");
  assert.ok(html.includes(`>${UNKNOWN_ACTOR}<`), "an empty actor renders its label");
  assert.ok(html.includes("d72d3e30-195d-402b-9092-272cd7240f08"));
  assert.ok(html.includes("by"), "the row says who acted");
  assert.ok(!html.includes("undefined"), "no literal undefined in the markup");
});

test("an empty table still renders the empty state", () => {
  const html = renderToStaticMarkup(createElement(AuditList, { rows: [] }));
  assert.ok(html.includes("No audit events"));
  assert.ok(!html.includes("data-audit-actor"));
});
