/**
 * Seven-group knowledge taxonomy contract.
 *
 * The audit found five groups with tone mapped into staffing and playbooks having no group, and a
 * classifier that silently filed every unmatched row under "bookings". These tests pin the seven
 * groups, the honest "unclassified" state, and the rule that filing never changes retrieval rights.
 * Pure functions only: no database, no provider, no send.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KNOWLEDGE_FILTER_GROUPS,
  KNOWLEDGE_GROUPS,
  groupForScope,
  groupForTitle,
  groupLabel,
  isKnowledgeGroup,
  isKnowledgeGroupFilter,
} from "../src/lib/knowledge-groups";
import { classifyCandidate, rankKnowledgeRows } from "../src/lib/retrieval-policy";

const EXPECTED_GROUPS = [
  "bookings",
  "dietary",
  "pricing",
  "staffing",
  "complaints",
  "tone",
  "playbooks",
];

test("the knowledge base has exactly the seven private-chef groups, in order", () => {
  assert.deepEqual(
    KNOWLEDGE_GROUPS.map((group) => group.id),
    EXPECTED_GROUPS,
  );
  assert.equal(new Set(KNOWLEDGE_GROUPS.map((group) => group.label)).size, 7);
});

test("every group has a human label and the filter list adds unclassified exactly once", () => {
  for (const group of KNOWLEDGE_GROUPS) {
    assert.ok(group.label.length > 3, `group ${group.id} needs a real label`);
    assert.equal(group.label, group.label.trim());
  }
  assert.deepEqual(
    KNOWLEDGE_FILTER_GROUPS.map((group) => group.id),
    [...EXPECTED_GROUPS, "unclassified"],
  );
});

test("tone is its own group and is no longer folded into staffing", () => {
  assert.equal(groupForScope("tone"), "tone");
  assert.equal(groupForScope("voice"), "tone");
  assert.equal(groupForScope("tone_and_voice"), "tone");
  assert.notEqual(groupForScope("tone"), "staffing");
  assert.equal(groupForTitle("Tone and voice guidance"), "tone");
});

test("playbooks has a dedicated group and playbook scopes map into it", () => {
  assert.ok(EXPECTED_GROUPS.includes("playbooks"));
  assert.equal(groupForScope("playbook"), "playbooks");
  assert.equal(groupForScope("playbooks"), "playbooks");
  assert.equal(groupForScope("procedures"), "playbooks");
  assert.equal(groupForTitle("Quick start checklist"), "playbooks");
});

test("an unknown or blank scope is reported as unclassified, never silently booked", () => {
  for (const scope of [null, undefined, "", "   ", "mychef", "bali-villa-books", "unknown-scope"]) {
    assert.equal(groupForScope(scope), "unclassified", `scope ${String(scope)} must not be filed`);
  }
  assert.equal(groupForTitle("Owner guidance from last week"), "unclassified");
});

test("scope matching ignores case and surrounding whitespace", () => {
  assert.equal(groupForScope(" PRICING "), "pricing");
  assert.equal(groupForScope("Dietary"), "dietary");
  assert.equal(groupForScope("Complaints"), "complaints");
});

test("a usable scope wins over the title fallback", () => {
  assert.equal(groupForTitle("tone of voice while quoting prices", "pricing"), "pricing");
  assert.equal(groupForTitle("booking question", "dietary"), "dietary");
});

test("title fallback covers each group and stops guessing", () => {
  assert.equal(groupForTitle("Weekend pricing"), "pricing");
  assert.equal(groupForTitle("Allergy handling"), "dietary");
  assert.equal(groupForTitle("Crew shift roster"), "staffing");
  assert.equal(groupForTitle("Angry client escalation"), "complaints");
  assert.equal(groupForTitle("Booking cancellation window"), "bookings");
  assert.equal(groupForTitle("Quarterly plan"), "unclassified");
});

test("group labels are total: unknown input still renders a readable label", () => {
  assert.equal(groupLabel("tone"), "Tone");
  assert.equal(groupLabel("playbooks"), "Playbooks");
  assert.equal(groupLabel("no-such-scope"), "Unclassified");
  assert.equal(groupLabel(null), "Unclassified");
});

test("filter values are validated, so a bad query string cannot blank the page", () => {
  for (const id of EXPECTED_GROUPS) assert.ok(isKnowledgeGroupFilter(id));
  assert.ok(isKnowledgeGroupFilter("unclassified"));
  assert.equal(isKnowledgeGroupFilter("all"), false);
  assert.equal(isKnowledgeGroupFilter(""), false);
  assert.equal(isKnowledgeGroup("unclassified"), false);
  assert.equal(isKnowledgeGroup("bookings"), true);
});

test("filing a row into a group never makes it retrievable", () => {
  const pendingInGroup = {
    id: "doc-pending-pricing",
    title: "Weekend pricing",
    content: "Deposit is 50% for weekend bookings.",
    status: "pending",
    source: "import",
    project_id: "mychef",
    workspace_id: "mychef",
  };
  assert.equal(groupForTitle(pendingInGroup.title, pendingInGroup.project_id), "pricing");
  assert.deepEqual(classifyCandidate(pendingInGroup), { eligible: false, reason: "not_approved" });

  const ranked = rankKnowledgeRows([pendingInGroup], "deposit for weekend booking");
  assert.equal(ranked.eligible.length, 0, "a grouped but unapproved row must not be quoted");
});

test("a title that names another project's group does not import that project's scope", () => {
  const otherProject = {
    id: "doc-cooking-class",
    title: "Cooking class pricing",
    content: "Class pricing note.",
    status: "approved",
    source: "import",
    project_id: "cooking-class-bali",
    workspace_id: "mychef",
  };
  assert.equal(groupForTitle(otherProject.title), "pricing");
  assert.deepEqual(classifyCandidate(otherProject), { eligible: false, reason: "other_project" });
});
