/**
 * Phase 3 menu catalog. Prices format for a person to copy.
 * A menu is not a draft source, and a playbook does not send.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyCandidate } from "@/lib/retrieval-policy";
import {
  addDish,
  formatWhatsApp,
  parseDishInput,
  parseMenu,
  playbookText,
  searchDishes,
  serializeMenu,
} from "@/lib/menu-engine";

const ROOT = process.cwd();

test("a dish stores an integer price and refuses a made-up one", () => {
  const parsed = parseDishInput({
    menuName: "Villa Friday",
    course: "Main",
    dish: "Grilled fish",
    allergens: ["fish", "not-a-real-allergen"],
    price: "150,000",
    note: "Line caught",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.dish.priceIdr, 150000);
  assert.deepEqual(parsed.dish.allergens, ["fish"]);
  const blank = parseDishInput({
    menuName: "Villa Friday",
    course: "Main",
    dish: "Soup",
    allergens: [],
    price: "",
    note: "",
  });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.dish.priceIdr, null);
});

test("WhatsApp text and the confirmation playbook stay unsent", () => {
  const menu = addDish({ name: "Villa Friday", courses: [] }, "Main", {
    name: "Grilled fish",
    allergens: ["fish"],
    priceIdr: 150000,
    note: "",
  });
  const text = formatWhatsApp(menu);
  assert.match(text, /\*Villa Friday\*/);
  assert.match(text, /• Grilled fish — IDR 150,000/);
  assert.match(text, /Allergens: fish/);
  const confirmation = playbookText("confirmation", menu);
  assert.match(confirmation, /not sent from the console/);
  assert.match(confirmation, /Grilled fish/);
  assert.doesNotMatch(confirmation, /I have sent|message was sent/i);
  const again = parseMenu(serializeMenu(menu));
  assert.equal(again?.courses[0]?.dishes[0]?.priceIdr, 150000);
});

test("search finds a dish by allergen and an approved menu is not draft knowledge", () => {
  const hits = searchDishes(
    [
      {
        id: "menu-1",
        menu: addDish({ name: "Villa Friday", courses: [] }, "Main", {
          name: "Grilled fish",
          allergens: ["fish"],
          priceIdr: null,
          note: "",
        }),
      },
    ],
    "fish",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.dish.name, "Grilled fish");
  const verdict = classifyCandidate({
    id: "menu-1",
    title: "Villa Friday",
    content: "Grilled fish IDR 150000",
    status: "approved",
    source: "menu",
    project_id: "mychef",
    workspace_id: "mychef",
  });
  assert.equal(verdict.eligible, false);
  if (!verdict.eligible) assert.equal(verdict.reason, "candidate_source");
});

test("the menus page is a catalog, not a send button", () => {
  const page = readFileSync(join(ROOT, "src/app/[workspace]/menus/page.tsx"), "utf8");
  assert.match(page, /<h1 className="text-2xl font-medium tracking-tight">Menus<\/h1>/);
  assert.match(page, /Nothing on this page is sent/);
  assert.doesNotMatch(page, /sendMessage|whatsappInboundReady\s*=\s*true/);
});
