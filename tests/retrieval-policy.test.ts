/**
 * Automated tests for the approval-gated, project-scoped retrieval policy.
 * No database and no provider call: these are pure-function tests over fixtures that mirror the
 * live mychef_inbox.knowledge rows inspected on 2026-11-01.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MYCHEF_RETRIEVAL_SCOPE,
  RETRIEVAL_POLICY_VERSION,
  classifyCandidate,
  describeExclusions,
  emptyExclusionSummary,
  rankKnowledgeRows,
  retrievalNotice,
  summarizeExcludedGroups,
  type KnowledgeCandidate,
} from "@/lib/retrieval-policy";

function row(overrides: Partial<KnowledgeCandidate> & { id: string }): KnowledgeCandidate {
  return {
    title: "Position",
    content: "Body",
    status: "approved",
    source: "Library:fixture",
    project_id: "mychef",
    workspace_id: "mychef",
    ...overrides,
  };
}

// Live inventory shape: 12 pending imports (8 mychef, 4 other projects) + 2 retired learning rows.
const LIVE_SHAPE: KnowledgeCandidate[] = [
  row({ id: "doc-policies", title: "07-03-BUSINESS_RULES_POLICIES.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-menu", title: "02-04-MENU_PRICING_REFERENCE.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-templates", title: "04-02-RESPONSE_TEMPLATES.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-master", title: "01-00-MASTER_SYSTEM_PROMPT.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-quick", title: "06-05-QUICK_START_GUIDE.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-readme", title: "03-README.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-tone", title: "05-01-VOICE_TONE_GUIDE.md", status: "pending", project_id: "mychef" }),
  row({ id: "doc-owner", title: "Recent owner reply guidance and limits", status: "pending", project_id: "mychef" }),
  row({ id: "doc-books", title: "Bali Villa Books available project context", status: "pending", project_id: "bali-villa-books" }),
  row({ id: "doc-cooking", title: "Cooking Class Bali available project context", status: "pending", project_id: "cooking-class-bali" }),
  row({ id: "doc-platform", title: "Knowledge platform available project context", status: "pending", project_id: "knowledge-platform" }),
  row({ id: "doc-tutoring", title: "Private Tutoring Bali available project context", status: "pending", project_id: "private-tutoring-bali" }),
  row({ id: "learning-pass:missing_knowledge", title: "Situational case (missing_knowledge)", status: "retired", source: "learning-pass" }),
  row({ id: "ledger-rule:too_casual", title: "Situational case (too_casual)", status: "retired", source: "ledger-rule" }),
];

test("live inventory shape: nothing is authoritative while every import is pending", () => {
  const result = rankKnowledgeRows(LIVE_SHAPE, "Can I get the deposit back? The dinner is in five days.");
  assert.equal(result.eligible.length, 0, "no pending or retired row may be quoted");
  assert.equal(result.excluded.total, LIVE_SHAPE.length);
  assert.equal(result.excluded.not_approved, 12);
  assert.equal(result.excluded.candidate_source, 2);
  assert.equal(result.excluded.other_project, 0, "pending is reported before project scope");
  assert.equal(result.policyVersion, RETRIEVAL_POLICY_VERSION);
  assert.equal(result.scope.projectId, "mychef");
});

test("approved in-project knowledge is eligible and ordered by score", () => {
  const result = rankKnowledgeRows(
    [
      row({ id: "deposit", title: "Deposit policy", content: "Deposits are non-refundable inside 14 days." }),
      row({ id: "allergy", title: "Allergy policy", content: "We always ask about allergies and cook separately." }),
    ],
    "My guest has a severe allergy. Can you still cook?",
  );
  assert.deepEqual(result.eligible.map((item) => item.doc.id), ["allergy", "deposit"]);
  assert.ok(result.eligible[0].score > result.eligible[1].score);
  assert.equal(result.excluded.total, 0);
});

test("a pending row that matches perfectly is still excluded, and does not displace approved knowledge", () => {
  const pendingPerfect = row({
    id: "pending-perfect",
    title: "Deposit policy",
    content: "Deposit refund cancellation policy for every booking.",
    status: "pending",
  });
  const approvedWeak = row({
    id: "approved-weak",
    title: "Service area",
    content: "We cook in Canggu, Seminyak and Ubud.",
  });
  const result = rankKnowledgeRows(
    [pendingPerfect, approvedWeak],
    "Deposit refund cancellation policy",
  );
  assert.deepEqual(result.eligible.map((item) => item.doc.id), ["approved-weak"]);
  assert.equal(result.excluded.not_approved, 1);
});

test("another project is a boundary, not a similarity bonus", () => {
  const result = rankKnowledgeRows(
    [
      row({
        id: "books",
        title: "Bali Villa Books available project context",
        content: "Deposit refund cancellation policy for villa bookkeeping.",
        project_id: "bali-villa-books",
      }),
      row({ id: "mine", title: "Service area", content: "We cook in Canggu and Ubud." }),
    ],
    "Deposit refund cancellation policy",
  );
  assert.deepEqual(result.eligible.map((item) => item.doc.id), ["mine"]);
  assert.equal(result.excluded.other_project, 1);
  assert.ok(!result.eligible.some((item) => item.doc.project_id !== "mychef"));
});

test("approved global knowledge is allowed by explicit policy, and refused when policy says so", () => {
  const globalRow = row({ id: "global", project_id: null });
  assert.equal(classifyCandidate(globalRow, MYCHEF_RETRIEVAL_SCOPE).eligible, true);
  assert.deepEqual(
    classifyCandidate(globalRow, { ...MYCHEF_RETRIEVAL_SCOPE, allowApprovedGlobal: false }),
    { eligible: false, reason: "other_project" },
  );
});

test("retired, unknown, blank and missing statuses fail closed", () => {
  assert.deepEqual(classifyCandidate(row({ id: "r", status: "retired" })), {
    eligible: false,
    reason: "retired",
  });
  for (const status of ["draft", "pending_review", "", null]) {
    assert.deepEqual(classifyCandidate(row({ id: "s", status })), {
      eligible: false,
      reason: "not_approved",
    });
  }
});

test("candidate and learning sources are never authoritative, even when marked approved", () => {
  for (const source of ["ledger-rule", "learning-pass"]) {
    assert.deepEqual(classifyCandidate(row({ id: "c", source, status: "approved" })), {
      eligible: false,
      reason: "candidate_source",
    });
  }
  assert.equal(classifyCandidate(row({ id: "s", source: "situational" })).eligible, true);
});

test("a row from another workspace is excluded", () => {
  assert.deepEqual(classifyCandidate(row({ id: "w", workspace_id: "other" })), {
    eligible: false,
    reason: "other_workspace",
  });
});

test("exclusion counts always add up to the number of rows considered", () => {
  const result = rankKnowledgeRows(LIVE_SHAPE.concat([row({ id: "ok" })]), "deposit");
  const counted = Object.entries(result.excluded)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + Number(value), 0);
  assert.equal(counted, result.excluded.total);
  assert.equal(result.excluded.total, LIVE_SHAPE.length);
});

test("an empty eligible set explains itself in plain language", () => {
  const result = rankKnowledgeRows(LIVE_SHAPE, "deposit");
  const notice = retrievalNotice(result);
  assert.ok(notice, "a reviewer must be told why no knowledge was quoted");
  assert.match(notice ?? "", /No approved knowledge/);
  assert.match(notice ?? "", /awaiting approval/);
  assert.match(notice ?? "", /person should answer/);
  assert.equal(retrievalNotice(rankKnowledgeRows([row({ id: "ok" })], "deposit")), null);
});

test("describeExclusions lists only non-zero reasons", () => {
  const summary = { ...emptyExclusionSummary(), retired: 1, other_project: 2, total: 3 };
  assert.equal(describeExclusions(summary), "2 for another project, 1 retired");
  assert.equal(describeExclusions(emptyExclusionSummary()), "none excluded");
});

test("grouped counts explain exactly what was withheld, and never count eligible rows", () => {
  const groups = [
    { status: "pending", source: "Library:x", project_id: "mychef", workspace_id: "mychef", n: 8 },
    { status: "pending", source: "Library:y", project_id: "bali-villa-books", workspace_id: "mychef", n: 3 },
    { status: "retired", source: "learning-pass", project_id: "mychef", workspace_id: "mychef", n: 2 },
    { status: "approved", source: "Library:z", project_id: "mychef", workspace_id: "mychef", n: 4 },
  ];
  const summary = summarizeExcludedGroups(groups);
  assert.deepEqual(summary, {
    other_workspace: 0,
    candidate_source: 2,
    not_approved: 11,
    retired: 0,
    other_project: 0,
    total: 13,
  });
  assert.equal(describeExclusions(summary), "11 awaiting approval, 2 candidate rules");
});
