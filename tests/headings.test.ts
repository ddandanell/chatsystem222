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
  assert.match(
    layout,
    /<p className="truncate text-base font-medium sm:text-lg">\{ctx\.orgName\}<\/p>/,
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
  assert.match(read("src/app/[workspace]/inbox/page.tsx"), /<h1 className="sr-only">Inbox<\/h1>/);
  assert.match(read("src/app/[workspace]/inbox/[id]/page.tsx"), /<h1 className="sr-only">Draft<\/h1>/);
});
