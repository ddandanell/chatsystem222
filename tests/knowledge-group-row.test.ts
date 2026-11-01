/**
 * Stored-row filing: a row from another project is never filed as this project's knowledge.
 *
 * Live example that motivated this: "Bali Villa Books available project context" is a pending note
 * for another project, and the title heuristic filed it under "bookings" because the title contains
 * the word "book". `groupForRow` refuses to guess across a project boundary.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { groupForRow } from "../src/lib/knowledge-groups";

test("another project's note is unclassified even when its title names a group", () => {
  assert.equal(
    groupForRow({ title: "Bali Villa Books available project context", project_id: "bali-villa-books" }),
    "unclassified",
  );
  assert.equal(
    groupForRow({ title: "Cooking Class Bali pricing and menu reference", project_id: "cooking-class-bali" }),
    "unclassified",
  );
});

test("another project's explicit scope is also refused", () => {
  assert.equal(groupForRow({ title: "Class pricing", scope: "pricing", project_id: "private-tutoring-bali" }), "unclassified");
});

test("this project's rows are filed from scope first, then title", () => {
  assert.equal(groupForRow({ title: "Tone guidance", scope: "pricing", project_id: "mychef" }), "pricing");
  assert.equal(groupForRow({ title: "02-04-MENU_PRICING_REFERENCE.md", project_id: "mychef" }), "pricing");
  assert.equal(groupForRow({ title: "01-00-MASTER_SYSTEM_PROMPT.md", project_id: "mychef" }), "playbooks");
  assert.equal(groupForRow({ title: "Tone of voice for villa guests", project_id: "mychef" }), "tone");
});

test("rows with no project, or a global marker, are still filed", () => {
  assert.equal(groupForRow({ title: "Allergy handling policy", project_id: null }), "dietary");
  assert.equal(groupForRow({ title: "Allergy handling policy", project_id: "global" }), "dietary");
  assert.equal(groupForRow({ title: "Allergy handling policy", project_id: " workspace " }), "dietary");
});

test("project matching is case- and whitespace-insensitive", () => {
  assert.equal(groupForRow({ title: "Shift roster", project_id: " MyChef " }), "staffing");
});

test("a different current-project context changes the answer, not the row", () => {
  const row = { title: "Class pricing", project_id: "cooking-class-bali" };
  assert.equal(groupForRow(row), "unclassified");
  assert.equal(groupForRow(row, "cooking-class-bali"), "pricing");
});
