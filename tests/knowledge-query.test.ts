/**
 * Guard tests for the SQL gate that feeds the retrieval policy. Pure string assertions: no database
 * connection is opened and no provider is called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_COUNTS_SQL,
  KNOWLEDGE_RETRIEVAL_SQL,
  MYCHEF_RETRIEVAL_SCOPE,
} from "@/lib/retrieval-policy";

const normalized = KNOWLEDGE_RETRIEVAL_SQL.replace(/\s+/g, " ").toLowerCase();

test("the knowledge query is workspace-parameterised, never string-interpolated", () => {
  assert.match(normalized, /where workspace_id = \$1/);
  assert.ok(!normalized.includes("mychef'"), "workspace must come from a parameter, not a literal");
});

test("the knowledge query requires approval (the audit finding F1 fix)", () => {
  assert.match(normalized, /status = 'approved'/);
  assert.ok(
    !normalized.includes("is distinct from 'retired'"),
    "the retired-only exclusion admitted every pending row",
  );
});

test("the knowledge query keeps candidate sources out, including NULL sources", () => {
  assert.match(normalized, /coalesce\(source, ''\) not in \('ledger-rule', 'learning-pass'\)/);
});

test("the scope under test is the mychef project, not the whole workspace", () => {
  assert.equal(MYCHEF_RETRIEVAL_SCOPE.workspaceId, "mychef");
  assert.equal(MYCHEF_RETRIEVAL_SCOPE.projectId, "mychef");
});

test("the counts query reads metadata only and stays workspace-scoped", () => {
  const counts = KNOWLEDGE_COUNTS_SQL.replace(/\s+/g, " ").toLowerCase();
  assert.match(counts, /where workspace_id = [$]1/);
  assert.match(counts, /group by 1, 2, 3, 4/);
  assert.ok(!counts.includes("content"), "pending document bodies must not be loaded for counts");
});
