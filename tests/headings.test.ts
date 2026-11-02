/**
 * MC-022: one page-level h1 per route, and the workspace name is a label, not the heading.
 *
 * Measured before this change (production build, signed-in reviewer, 1440x900): every one of the 13
 * list routes rendered exactly one h1 and it was the shell's workspace name — `myCHEF` — on all of
 * them, while the page's own subject sat in an `<h2 className="text-2xl …">`. /mychef/inbox and
 * /mychef/dashboard had no page-subject heading at all (inbox hands the body to MychefDesk;
 * dashboard's 2xl heading is the workspace name a second time).
 *
 * Semantics only: no class changed on any heading, no new token, no new component, no restyle. The
 * visual placement of the subject on dashboard and inbox is deferred to the UX spec's header
 * pattern, so there it is a screen-reader heading for now.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PAGES = [
  "src/app/[workspace]/audit/page.tsx",
  "src/app/[workspace]/candidates/page.tsx",
  "src/app/[workspace]/dashboard/page.tsx",
  "src/app/[workspace]/evals/page.tsx",
  "src/app/[workspace]/import/page.tsx",
  "src/app/[workspace]/inbox/page.tsx",
  "src/app/[workspace]/inbox/[id]/page.tsx",
  "src/app/[workspace]/knowledge/page.tsx",
  "src/app/[workspace]/knowledge/[id]/page.tsx",
  "src/app/[workspace]/settings/access/page.tsx",
  "src/app/[workspace]/settings/autopilot/page.tsx",
  "src/app/[workspace]/settings/keys/page.tsx",
  "src/app/[workspace]/settings/webhooks/page.tsx",
  "src/app/[workspace]/team/page.tsx",
];

test("the workspace name is not an h1", () => {
  const layout = read("src/app/[workspace]/layout.tsx");
  assert.doesNotMatch(layout, /<h1[\s>]/, "the shell must not own the page heading");
  // UX-0224 added `min-w-0` to this label so it can be the only item that shrinks in a header row
  // that no longer wraps; the heading-bearing classes are the part this test is about.
  assert.match(
    layout,
    /<p className="[^"]*\btruncate text-base font-medium sm:text-lg\b[^"]*">\{ctx\.orgName\}<\/p>/,
    "the workspace name keeps its classes but is a label",
  );
});

test("every workspace route declares a page-level h1", () => {
  for (const page of PAGES) {
    const source = read(page);
    assert.match(source, /<h1[\s>]/, `${page} must declare an h1`);
  }
});

test("no page subject is left as a 2xl h2 where a subject heading exists", () => {
  for (const page of PAGES) {
    const source = read(page);
    if (page.endsWith("dashboard/page.tsx")) {
      // The workspace name must not reappear here as a heading at all: it is the shell label, and
      // printing it again as the largest heading was the defect UX-0203 named.
      assert.doesNotMatch(source, /\{access\.ctx\.orgName\}/, "the dashboard must not repeat the workspace name");
      continue;
    }
    assert.doesNotMatch(
      source,
      /<h2 className="text-2xl font-medium tracking-tight">/,
      `${page} must not keep its page title as an h2`,
    );
  }
});

test("the promoted headings kept their classes, so nothing moved on screen", () => {
  const promoted = [
    "src/app/[workspace]/audit/page.tsx",
    "src/app/[workspace]/dashboard/page.tsx",
    "src/app/[workspace]/evals/page.tsx",
    "src/app/[workspace]/import/page.tsx",
    "src/app/[workspace]/team/page.tsx",
    "src/app/[workspace]/knowledge/page.tsx",
  ];
  for (const page of promoted) {
    assert.match(
      read(page),
      /<h1 className="text-2xl font-medium tracking-tight">/,
      `${page} must promote its existing heading without restyling it`,
    );
  }
});

test("the routes without a visible subject heading use a screen-reader h1 until the spec lands", () => {
  assert.doesNotMatch(
    read("src/app/[workspace]/dashboard/page.tsx"),
    /className="sr-only"/,
    "dashboard's subject is visible now, so it must not also carry a screen-reader duplicate",
  );
  // Flipped 2026-11-01: MychefDesk renders the route's single h1 from the conversation row, so the
  // page must add none. Asserted on the desk branch only: the legacy tenant branch below keeps its
  // own visible <h1>Review queue</h1>, and that branch never renders the desk.
  const inboxPage = read("src/app/[workspace]/inbox/page.tsx");
  const deskBranch = inboxPage.slice(
    inboxPage.indexOf("if (usesMychefInbox())"),
    inboxPage.indexOf("<MychefDesk"),
  );
  assert.ok(deskBranch.length > 0, "the desk branch must still exist");
  assert.doesNotMatch(
    deskBranch,
    /<h1[\s>]/,
    "inbox/page.tsx must not declare an h1 in the MychefDesk branch: the desk already renders it",
  );
  assert.match(read("src/app/[workspace]/inbox/desk.tsx"), /<h1 className="sr-only">/);
});

test("the thread's h1 names the open conversation, not the word Draft", () => {
  const desk = read("src/app/[workspace]/inbox/desk.tsx");
  assert.match(
    desk,
    /<h1 className="sr-only">\s*\{subjectHeading \? `Conversation with \$\{subjectHeading\}` : "Inbox"\}\s*<\/h1>/,
    "the desk renders the route's single h1 from the conversation row it already loaded",
  );
  const page = read("src/app/[workspace]/inbox/[id]/page.tsx");
  assert.doesNotMatch(
    page,
    /<h1 className="sr-only">Draft<\/h1>/,
    "the page must not print a second h1 that repeats the h2 below it",
  );
});

/**
 * The defect this guards: MC-022 promoted the page subject to h1 and demoted the shell's
 * workspace name to a <p>, which left the old h3 section headings with no h2 above them.
 * The presence checks above cannot see that; order can.
 */
test("no page skips a heading level on the way down", () => {
  for (const page of PAGES) {
    const source = read(page);
    const levels = [...source.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    assert.ok(levels.length > 0, `${page} must declare a heading`);
    let previous = 0;
    for (const [index, level] of levels.entries()) {
      if (level === 1) {
        previous = 1;
        continue;
      }
      assert.ok(
        level <= previous + 1,
        `${page}: heading #${index + 1} is h${level} after h${previous} — that skips a level`,
      );
      previous = level;
    }
  }
});
