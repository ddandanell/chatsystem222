/**
 * MC-182 — the queue must reach every conversation, and every chip must say how many rows it opens.
 *
 * The defect: `listDeskQueue()` treated `needs_review` and `all` as one filter
 * (`pendingOnly = filter === "needs_review" || filter === "all"`), so both ran
 * `status = 'needs_reply' and no decision record`. Measured against production 2026-11-01:
 * 791 conversations = 121 needs_reply + 670 waiting, 119 inside the one predicate, 672 reachable
 * from no filter at all.
 *
 * What these tests can and cannot prove, stated plainly:
 *  - They prove the partition, the predicates and the chip wiring as logic, without a database.
 *  - They cannot prove Postgres returns those rows; the generated SQL was executed read-only
 *    against the live workspace on 2026-11-01 and the counts are recorded in
 *    shared/mychef-ops/evidence/2026-11-01/eng-mc182-desk-filters.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DESK_FILTERS,
  DESK_FILTER_IDS,
  FALLBACK_STATE,
  REASON_FILTERS,
  STATE_FILTERS,
  STATE_RULES,
  bucketCaseSql,
  conversationBucket,
  emptyFilterCounts,
  matchesFilter,
  parseDeskFilter,
  reasonPredicate,
  stateWhereSql,
  type ConversationState,
  type DecisionState,
  type DeskFilter,
} from "@/lib/desk-filters";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every status this build has met, plus the ones a future importer may write. */
const STATUS_GRID: (string | null)[] = [
  "needs_reply",
  "waiting",
  "closed",
  "archived",
  "paused",
  "Needs_Reply",
  "  waiting  ",
  "",
  null,
];

test("every conversation lands in exactly one state, including statuses this build has never seen", () => {
  const buckets: DeskFilter[] = [];
  for (const status of STATUS_GRID) {
    for (const decided of [false, true]) {
      const state: ConversationState = { status, decided };
      const matches = STATE_FILTERS.filter((id) => matchesFilter(id, state));
      assert.equal(
        matches.length,
        1,
        `${JSON.stringify(state)} matched ${matches.length} states: ${matches.join(", ")}`,
      );
      assert.equal(matches[0], conversationBucket(state));
      buckets.push(matches[0]);
    }
  }
  // A partition means no state can absorb another: with 4 states over 18 rows each state must be
  // reachable, or one of them is decoration.
  for (const id of STATE_FILTERS) {
    assert.ok(buckets.includes(id), `no fixture row lands in ${id}`);
  }
});

test("filter=all set-equals the union of the state filters, and the states are pairwise disjoint", () => {
  const rows = STATUS_GRID.flatMap((status, statusIndex) =>
    [false, true].map((decided, decidedIndex) => ({
      id: `c-${statusIndex}-${decidedIndex}`,
      state: { status, decided } as ConversationState,
    })),
  );

  const all = new Set(rows.filter((row) => matchesFilter("all", row.state)).map((row) => row.id));
  const union = new Set<string>();
  for (const filter of STATE_FILTERS) {
    const members = rows.filter((row) => matchesFilter(filter, row.state)).map((row) => row.id);
    for (const id of members) union.add(id);
    for (const other of STATE_FILTERS) {
      if (other === filter) continue;
      const overlap = rows
        .filter((row) => matchesFilter(filter, row.state) && matchesFilter(other, row.state))
        .map((row) => row.id);
      assert.deepEqual(overlap, [], `${filter} and ${other} both claim ${overlap.join(", ")}`);
    }
  }

  assert.equal(all.size, rows.length, "all must contain every row");
  assert.deepEqual([...union].sort(), [...all].sort(), "the union of the states must equal all");
  assert.equal(union.size, rows.length, "the union of the states must contain every row");
});

test("the generated case cannot fall through: one arm per state rule, in order, then the else", () => {
  const sql = bucketCaseSql();
  const arms: string[] = [...sql.matchAll(/when ([\s\S]*?) then '([a-z_]+)'/g)].map(
    (match) => match[2] ?? "",
  );
  assert.deepEqual(arms, STATE_RULES.map((rule) => rule.id), "case arms must follow STATE_RULES");
  assert.ok(sql.trimEnd().endsWith(`else '${FALLBACK_STATE}'\n     end`), sql);
  for (const id of STATE_FILTERS) {
    const occurrences: number =
      arms.filter((arm: string) => arm === id).length + (id === FALLBACK_STATE ? 1 : 0);
    assert.equal(occurrences, 1, `${id} must appear exactly once in the case: ${occurrences}`);
  }
  // The two things that made the old single predicate wrong cannot be reintroduced silently.
  assert.ok(!/status = 'needs_reply'[\s\S]*status = 'needs_reply'/.test(sql), "duplicated condition");
});

test("a chip cannot count rows another chip opens: each state filter is the bucket compared to its own id", () => {
  const predicates = new Map<string, DeskFilter>();
  for (const filter of STATE_FILTERS) {
    const sql = stateWhereSql(filter);
    assert.equal(sql, `(${bucketCaseSql()}) = '${filter}'`);
    assert.equal(predicates.get(sql) ?? filter, filter, `${filter} shares a predicate with another state`);
    predicates.set(sql, filter);
  }
  assert.equal(stateWhereSql("all"), "true", "all is the table with no bucket condition");
  assert.throws(() => stateWhereSql("escalated"), /decision lens/);
  // No two filters may ever run the same SQL again — that was the whole defect.
  const everySql = [...STATE_FILTERS.map((id) => stateWhereSql(id)), stateWhereSql("all")];
  assert.equal(new Set(everySql).size, everySql.length);
});

test("the store's list and the store's counts read their predicates from one module", () => {
  const store = read("src/data/mychef-store.ts");
  assert.ok(
    !/pendingOnly\s*=\s*filter === "needs_review"/.test(store),
    "the collapsed pendingOnly branch is back in mychef-store.ts",
  );
  assert.ok(store.includes("stateWhereSql(filter)"), "listDeskQueue must use stateWhereSql");
  assert.ok(store.includes("bucketCaseSql()"), "counts must use the same bucket expression");
  assert.ok(store.includes("reasonPredicate("), "both decision lenses must use reasonPredicate");
  // Scoped to the two queue functions: `listInbox()` (the legacy local-tenant list, also used by
  // the dashboard's "pending review" strip) still carries the old narrow predicate and is reported
  // separately — MC-182 changes the desk queue, not another surface's query.
  const queueBody = store.slice(
    store.indexOf("export async function listDeskQueue("),
    store.indexOf("export async function updateContactTags("),
  );
  assert.ok(queueBody.includes("deskFilterCounts"), "the queue functions were not found");
  assert.equal(
    [...queueBody.matchAll(/c\.status = 'needs_reply'/g)].length,
    0,
    "a hand-written status condition survived inside the queue functions",
  );
});

test("a reason lens is always inside decided, whatever the ledger says", () => {
  const decisions: DecisionState[] = [
    { reason_code: "auto_sent_candidate", human_decision: "approved", rejected_alternative: "" },
    { reason_code: "needs_human", human_decision: "approved", rejected_alternative: "" },
    { reason_code: "good_as_drafted", human_decision: "rejected", rejected_alternative: "escalated" },
    { reason_code: "good_as_drafted", human_decision: "edited", rejected_alternative: "" },
    { reason_code: null, human_decision: null, rejected_alternative: null },
  ];
  for (const decision of decisions) {
    for (const decided of [true, false]) {
      const state: ConversationState = { status: "waiting", decided };
      for (const lens of REASON_FILTERS) {
        if (matchesFilter(lens, state, [decision])) {
          assert.ok(
            matchesFilter("decided", state, [decision]),
            `${lens} claimed a conversation that is not decided: ${JSON.stringify(decision)}`,
          );
        }
      }
    }
  }
  // The live ledger has 1 escalated decision and 0 auto-send candidates; both predicates must be
  // able to say no, or a chip with 0 is indistinguishable from a chip that never matches.
  assert.ok(
    !matchesFilter("escalated", { status: "waiting", decided: true }, [
      { reason_code: "good_as_drafted", human_decision: "approved", rejected_alternative: "" },
    ]),
  );
  const predicate = reasonPredicate("escalated");
  assert.equal(reasonPredicate("auto_sent"), "d.reason_code = 'auto_sent_candidate'");
  assert.ok(predicate.includes("human_decision = 'rejected'") && predicate.includes("needs_human"));
});

test("?filter=needs_review still filters, and junk falls back to the default", () => {
  assert.equal(parseDeskFilter("needs_review"), "needs_reply", "legacy links must keep filtering");
  assert.equal(parseDeskFilter("waiting"), "waiting");
  assert.equal(parseDeskFilter("decided"), "decided");
  assert.equal(parseDeskFilter(undefined), "needs_reply");
  assert.equal(parseDeskFilter(""), "needs_reply");
  assert.equal(parseDeskFilter("nonsense"), "needs_reply");
});

test("every chip carries its own count, and no filter is a chip without a number", () => {
  assert.deepEqual(DESK_FILTER_IDS, DESK_FILTERS.map((item) => item.id));
  assert.equal(new Set(DESK_FILTER_IDS).size, DESK_FILTER_IDS.length, "duplicate chip id");
  for (const id of [...STATE_FILTERS, ...REASON_FILTERS, "all"] as DeskFilter[]) {
    assert.ok(DESK_FILTER_IDS.includes(id), `${id} has no chip, so its rows stay invisible`);
  }
  const counts = emptyFilterCounts();
  assert.deepEqual(Object.keys(counts).sort(), [...DESK_FILTER_IDS].sort());

  const pane = read("src/components/inbox/queue-pane.tsx");
  assert.ok(pane.includes("DESK_FILTERS.map("), "the pane must render the shared filter table");
  assert.ok(pane.includes("counts[item.id]"), "every chip must read its count");
  assert.ok(pane.includes("data-count-for={item.id}"), "the count must be inspectable on the chip");
  assert.ok(!/const FILTERS: \{ id: DeskFilter; label: string \}\[\]/.test(pane), "pane has its own filter list again");
  const desk = read("src/app/[workspace]/inbox/desk.tsx");
  assert.ok(desk.includes("deskFilterCounts(search)"), "the desk must load the counts");
  assert.ok(desk.includes("counts={counts}"), "the desk must pass the counts to the pane");
});

test("the 791-conversation census from production: 672 unreachable before, 0 after", () => {
  // The live shape, read with transaction_read_only=on on 2026-11-01.
  const census = [
    ...Array.from({ length: 119 }, (_, i) => ({ status: "needs_reply", decided: false, id: `nr${i}` })),
    ...Array.from({ length: 2 }, (_, i) => ({ status: "needs_reply", decided: true, id: `nrd${i}` })),
    ...Array.from({ length: 668 }, (_, i) => ({ status: "waiting", decided: false, id: `w${i}` })),
    ...Array.from({ length: 2 }, (_, i) => ({ status: "waiting", decided: true, id: `wd${i}` })),
  ];
  assert.equal(census.length, 791);

  const oldPredicate = (row: (typeof census)[number]) => row.status === "needs_reply" && !row.decided;
  const oldReached = census.filter(oldPredicate).length;
  assert.equal(oldReached, 119, "the old predicate must reproduce the 119 the desk showed");
  assert.equal(census.length - oldReached, 672, "672 conversations had no filter at all");

  const reached = new Set(
    census
      .filter((row) => matchesFilter("all", { status: row.status, decided: row.decided }))
      .map((row) => row.id),
  );
  assert.equal(reached.size, 791);
  const unreached = census.filter((row) => {
    return !STATE_FILTERS.some((id) => matchesFilter(id, { status: row.status, decided: row.decided }));
  });
  assert.deepEqual(unreached, [], "every conversation must be in a state filter");
  // And the number the operator now sees before scrolling: waiting is the 668 that was invisible.
  const waiting = census.filter((row) => conversationBucket(row) === "waiting").length;
  assert.equal(waiting, 668);
});
