/**
 * MC-181 (David's 18:44 complaint): the inbox desk squeezed the thread to zero.
 *
 * Measured before the change, at main faab9ba: the thread column was header + TimeStrip +
 * scroll area + composer in one flex column, and only the scroll area could shrink. TimeStrip
 * (time-strip.tsx) was a px-4/py-4 wrapper around a p-4 bordered box with a label, a hint and a
 * 5-column grid — roughly 170px that could not shrink. The composer was shrink-0 and ~440px:
 * a standing "Sending is not connected" Alert plus a rows={6} textarea plus five actions. At a
 * 900px window the two fixed blocks took nearly the whole column before the thread got a pixel.
 * Nothing overlapped; the thread was compressed to its minimum, which is what he photographed.
 *
 * Second defect, same cause family: the context rail was forced from lg (1024). Queue 320 +
 * rail 384 left 320-576px of thread between 1024 and 1279.
 *
 * These are source-level assertions, the same contract headings.test.ts uses, plus one behavioural
 * test of the new pure clock line. They cannot see a rendered pixel; the pixel evidence is the
 * 1440x900 and 390x844 screenshots under shared/mychef-ops/evidence/.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeContactResponseMetrics, threadClockLabel } from "../src/lib/contact-response";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const REVIEW = "src/components/inbox/desk-review.tsx";
const SHELL = "src/components/inbox/desk-shell.tsx";

/** The thread column: from the section that owns it to the composer that closes it. */
function threadColumn(source: string): string {
  const start = source.indexOf('className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"');
  assert.ok(start > 0, "the thread column section must still exist");
  const end = source.indexOf("</section>", start);
  assert.ok(end > start, "the thread column must still be closed by </section>");
  return source.slice(start, end);
}

test("the response strip is out of the thread column, and the thread shows one clock line", () => {
  const source = read(REVIEW);
  const column = threadColumn(source);

  assert.doesNotMatch(
    column,
    /<TimeStrip\b/,
    "TimeStrip must not render inside the thread column: it is the block that ate the messages",
  );
  assert.equal(
    source.split("<TimeStrip").length - 1,
    1,
    "TimeStrip renders once, in Context > Client, not once per place that wants the metrics",
  );
  assert.match(
    column,
    /data-slot="thread-clock"[\s\S]{0,240}\{threadClockLabel\(metrics\)\}/,
    "the column carries one clock line built from the same metrics",
  );
});

test("the five metrics live in Context > Client, above the client facts", () => {
  const source = read(REVIEW);
  const clientTab = source.slice(source.indexOf('value="client"'));
  const strip = clientTab.indexOf("<TimeStrip metrics={metrics} />");
  const facts = clientTab.indexOf("<dt className=\"text-xs text-muted-foreground\">Phone</dt>");
  assert.ok(strip > 0, "the client tab must render the strip");
  assert.ok(facts > 0 && strip < facts, "the strip sits above the facts, inside the same tab");
  assert.match(
    source,
    /<ContextPanel \{\.\.\.contextProps\} \/>/,
    "ContextPanel still receives its props from one object, so the rail and the sheet agree",
  );
});

test("the composer is one capped block: no standing alert, no six-row textarea", () => {
  const source = read(REVIEW);
  const column = threadColumn(source);

  assert.doesNotMatch(
    column,
    /<AlertTitle>Sending is not connected<\/AlertTitle>/,
    "the standing alert block is gone from the thread column",
  );
  assert.match(
    column,
    /data-slot="composer-send-note"[\s\S]{0,260}Sending is not connected/,
    "the same warning survives as a one-line note in the composer footer",
  );
  assert.match(
    column,
    /rows=\{3\}[\s\S]{0,120}max-h-40[\s\S]{0,80}overflow-y-auto/,
    "the draft textarea starts small, auto-grows (field-sizing-content on the primitive) and caps with an internal scroll",
  );
  assert.doesNotMatch(column, /rows=\{6\}/, "the six-row box is what pushed the thread out of the column");
});

test("the scroll area keeps a floor, and the composer stays pinned below it", () => {
  const source = read(REVIEW);
  const column = threadColumn(source);

  assert.match(
    column,
    /data-slot="thread-scroll"[\s\S]{0,80}min-h-\[45%\]/,
    "the thread scroll area holds a floor of 45% of the desk, so a long header cannot reclaim it",
  );
  assert.doesNotMatch(
    column,
    /min-h-\[45dvh\]/,
    "45dvh is measured against the window, not the desk: under 153px of app chrome it pushed the composer past the fold",
  );
  const composerIndex = column.indexOf('className="z-10 min-h-[10rem] shrink');
  assert.ok(composerIndex > 0, "the composer is still a shrink-0 block");
  assert.ok(
    column.indexOf('data-slot="thread-scroll"') < composerIndex,
    "the composer follows the scroll area, so it is pinned at the bottom of the thread",
  );
  assert.match(
    column.slice(composerIndex, composerIndex + 220),
    /shrink overflow-y-auto/,
    "the composer gives height back before the thread does, and scrolls inside itself when the diff block appears",
  );
});

test("a thread opens on its newest message", () => {
  const source = read(REVIEW);
  assert.match(
    source,
    /threadRef[\s\S]{0,200}\[data-slot="scroll-area-viewport"\]/,
    "the column finds the scroll viewport it owns",
  );
  assert.match(
    source,
    /viewport\.scrollTop = viewport\.scrollHeight/,
    "opening a conversation scrolls to the bottom, not to the oldest message",
  );
  assert.match(
    source,
    /\}, \[conversation\.id, conversation\.messages\.length\]\)/,
    "the scroll re-runs when the open conversation or its message count changes",
  );
});

test("three panes exist only from xl; lg-xl falls back to the existing sheet", () => {
  const review = read(REVIEW);

  assert.match(
    review,
    /<aside className="hidden min-h-0 w-96 shrink-0 flex-col border-l border-border bg-muted\/50 xl:flex">/,
    "the context rail is a pane from xl only",
  );
  assert.doesNotMatch(
    review,
    /<aside className="hidden min-h-0 w-96[^"]*lg:flex/,
    "the rail must not be forced at lg, where it left 320-576px for the thread",
  );
  assert.match(
    review,
    /<div className="flex min-h-0 flex-1 flex-col xl:flex-row">/,
    "the two-column split starts at xl with the rail",
  );
  assert.match(
    review,
    /window\.matchMedia\("\(max-width: 1279px\)"\)/,
    "below xl the context tab opens the sheet instead of writing to an invisible pane",
  );
  assert.match(
    review,
    /className="xl:hidden"[\s\S]{0,120}openContext\(contextTab, \{ forceSheet: true \}\)/,
    "the Context button is visible exactly where the rail is not",
  );
});

test("the queue pane keeps its lg column, so lg-xl is two panes and never clips", () => {
  const shell = read(SHELL);
  assert.match(
    shell,
    /lg:w-80/,
    "the queue column still appears at lg — the rail was the block that did not fit, not the queue",
  );
  assert.doesNotMatch(shell, /xl:w-80/, "the queue was not moved to xl; that would leave one pane at 1024");
});

test("the clock line reads as one sentence, and says when a thread has no messages", () => {
  const now = new Date("2026-11-01T09:02:00Z");
  const inboundLast = computeContactResponseMetrics(
    [
      { direction: "inbound", created_at: "2026-11-01T07:00:00Z" },
      { direction: "inbound", created_at: "2026-11-01T07:00:00Z" },
    ],
    "2026-11-01T07:00:00Z",
    now,
  );
  assert.equal(inboundLast.waitingLabel, "2h 2m");
  assert.match(
    threadClockLabel(inboundLast),
    /^Waiting 2h 2m · last \d{1,2} \w{3}, \d{2}:\d{2}$/,
    "the line names the wait, then the last activity, and nothing else",
  );

  const guestLast = computeContactResponseMetrics(
    [
      { direction: "inbound", created_at: "2026-11-01T06:00:00Z" },
      { direction: "outbound", created_at: "2026-11-01T08:00:00Z" },
    ],
    "2026-11-01T08:00:00Z",
    now,
  );
  assert.equal(guestLast.waitingOnGuest, true);
  assert.match(
    threadClockLabel(guestLast),
    /^Waiting on guest · 1h 2m · last \d{1,2} \w{3}, \d{2}:\d{2}$/,
    "when the ball is with the guest the line says so instead of repeating 'Waiting'",
  );

  const empty = computeContactResponseMetrics([], null, now);
  assert.equal(
    threadClockLabel(empty),
    "No messages yet",
    "an empty thread does not print 'Waiting — · last —'",
  );
});
