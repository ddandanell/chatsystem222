/**
 * MC-182 + CS round 3 — the queue must reach every conversation, every chip must say how many rows it
 * opens, and "decided" must mean "the guest's newest message is covered", not "something was ever
 * decided here".
 *
 * The defect: `listDeskQueue()` treated `needs_review` and `all` as one filter
 * (`pendingOnly = filter === "needs_review" || filter === "all"`), so both ran
 * `status = 'needs_reply' and no decision record`. Measured against production 2026-11-01:
 * 791 conversations = 121 needs_reply + 670 waiting, 119 inside the one predicate, 672 reachable
 * from no filter at all.
 *
 * What these tests can and cannot prove, stated plainly:
 *  - They prove the partition, the predicates, the turn rule and the chip wiring as logic, without a
 *    database.
 *  - They cannot prove Postgres returns those rows. That is `tests/desk-filters.db.test.ts`, which
 *    executes the exported SQL against a real fixture database and is skipped when no fixture is
 *    configured. Live counts are recorded in
 *    shared/mychef-ops/evidence/2026-11-02/eng-mc182-turn-model.md.
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
  TOMBSTONE_STATUS,
  bucketCaseSql,
  conversationBucket,
  coveredByDecision,
  decisionCovers,
  emptyFilterCounts,
  isVisible,
  lensWhereSql,
  matchesFilter,
  newestDecision,
  parseDeskFilter,
  queueWhereSql,
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

const T1 = "2026-11-01T03:21:06.432Z";
const T2 = "2026-11-01T03:48:17.909Z";
const T3 = "2026-11-01T07:29:32.477Z";
const T4 = "2026-11-01T10:08:03.963Z";

function decision(createdAt: string, overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    id: `d-${createdAt}`,
    created_at: createdAt,
    reason_code: null,
    human_decision: null,
    rejected_alternative: null,
    ...overrides,
  };
}

function state(
  status: string | null,
  options: { decisions?: DecisionState[]; newestInboundAt?: string | null } = {},
): ConversationState {
  return {
    status,
    decisions: options.decisions ?? [],
    newestInboundAt: options.newestInboundAt ?? null,
  };
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
    for (const decisions of [[], [decision(T2)]]) {
      for (const newestInboundAt of [null, T1]) {
        const row = state(status, { decisions, newestInboundAt });
        const matches = STATE_FILTERS.filter((id) => matchesFilter(id, row));
        assert.equal(
          matches.length,
          1,
          `${JSON.stringify(row)} matched ${matches.length} states: ${matches.join(", ")}`,
        );
        assert.equal(matches[0], conversationBucket(row));
        buckets.push(matches[0]);
      }
    }
  }
  // A partition means no state can absorb another: with 4 states over 72 rows each state must be
  // reachable, or one of them is decoration.
  for (const id of STATE_FILTERS) {
    assert.ok(buckets.includes(id), `no fixture row lands in ${id}`);
  }
});

test("filter=all set-equals the union of the state filters, and the states are pairwise disjoint", () => {
  const rows = STATUS_GRID.flatMap((status, statusIndex) =>
    [[], [decision(T2)]].flatMap((decisions, decidedIndex) =>
      [null, T1].map((newestInboundAt, inboundIndex) => ({
        id: `c-${statusIndex}-${decidedIndex}-${inboundIndex}`,
        state: state(status, { decisions, newestInboundAt }),
      })),
    ),
  );

  const all = new Set(rows.filter((row) => matchesFilter("all", row.state)).map((row) => row.id));
  const union = new Set<string>();
  for (const filter of STATE_FILTERS) {
    const matched = new Set(rows.filter((row) => matchesFilter(filter, row.state)).map((row) => row.id));
    for (const id of matched) {
      assert.ok(!union.has(id), `${id} is in two states at once`);
      union.add(id);
    }
  }

  assert.equal(all.size, rows.length, "all must contain every visible row");
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
  // CS round 3: the decided arm is turn-bound, not "a decision row exists".
  const decidedArm = STATE_RULES.find((rule) => rule.id === "decided");
  assert.ok(decidedArm, "the decided arm disappeared");
  assert.ok(decidedArm.sql.includes("decision_records"), "decided must read the ledger");
  assert.ok(
    decidedArm.sql.includes("direction = 'inbound'") &&
      decidedArm.sql.includes("m.created_at > d.created_at"),
    "decided must compare the decision with the newest inbound message",
  );
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
  assert.ok(store.includes("queueWhereSql(filter)"), "listDeskQueue must use the shared predicate");
  assert.ok(store.includes("bucketCaseSql()"), "counts must use the same bucket expression");
  assert.ok(store.includes("lensWhereSql("), "both decision lenses must use the shared lens predicate");
  // No surface may hand-write the needs_reply predicate again: that is how the badge and the chip
  // drifted apart in the first place.
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
  assert.equal(
    [...queueBody.matchAll(/not exists \(\s*select 1 from mychef_inbox\.decision_records/g)].length,
    0,
    "the hand-written 'no decision record' subtraction survived inside the queue functions",
  );
});

test("a reason lens is always inside decided, whatever the ledger says", () => {
  const ledger: DecisionState[] = [
    decision(T2, { reason_code: "auto_sent_candidate", human_decision: "approved", rejected_alternative: "" }),
    decision(T2, { reason_code: "needs_human", human_decision: "approved", rejected_alternative: "" }),
    decision(T2, { reason_code: "good_as_drafted", human_decision: "rejected", rejected_alternative: "escalated" }),
    decision(T2, { reason_code: "good_as_drafted", human_decision: "edited", rejected_alternative: "" }),
    decision(T2, { reason_code: null, human_decision: null, rejected_alternative: null }),
  ];
  for (const d of ledger) {
    for (const status of ["waiting", "needs_reply", "closed"]) {
      for (const newestInboundAt of [null, T1, T3]) {
        const row = state(status, { decisions: [d], newestInboundAt });
        for (const lens of REASON_FILTERS) {
          if (matchesFilter(lens, row)) {
            assert.ok(
              matchesFilter("decided", row),
              `${lens} claimed a conversation that is not decided: ${JSON.stringify(row)}`,
            );
          }
        }
      }
    }
  }
  // The live ledger has 1 escalated decision and 0 auto-send candidates; both predicates must be
  // able to say no, or a chip with 0 is indistinguishable from a chip that never matches.
  assert.ok(
    !matchesFilter(
      "escalated",
      state("waiting", {
        decisions: [
          decision(T2, { reason_code: "good_as_drafted", human_decision: "approved", rejected_alternative: "" }),
        ],
      }),
    ),
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
  // The live shape, read with transaction_read_only=on on 2026-11-01 and again on 2026-11-02.
  const census = [
    ...Array.from({ length: 119 }, (_, i) => ({
      status: "needs_reply",
      decisions: [] as DecisionState[],
      id: `nr${i}`,
    })),
    // The two live threads that were decided while still status = 'needs_reply': the decision is
    // newer than the only inbound message on each.
    { status: "needs_reply", decisions: [decision(T2)], id: "txbmzOgP9S1M0PBbFZLy" },
    { status: "needs_reply", decisions: [decision(T4)], id: "Olr4HehkV7lnkqYRZVFJ" },
    ...Array.from({ length: 668 }, (_, i) => ({
      status: "waiting",
      decisions: [] as DecisionState[],
      id: `w${i}`,
    })),
    // The two August seed rows: A4FN has no inbound at all, 0zAs one from 2026-08-03.
    { status: "waiting", decisions: [decision("2026-11-01T01:17:46.929Z")], id: "A4FNMhVs3tJmKKRTDi0j", inboundAt: null },
    { status: "waiting", decisions: [decision("2026-11-01T01:18:31.360Z")], id: "0zAsetrUmD4CdbpAiDpz", inboundAt: "2026-08-03T01:12:31.000Z" },
  ];
  assert.equal(census.length, 791);
  const rows = census.map((row) => ({
    ...row,
    newestInboundAt: "inboundAt" in row ? (row.inboundAt as string | null) : row.decisions.length > 0 ? T1 : null,
  }));

  const oldPredicate = (row: (typeof rows)[number]) => row.status === "needs_reply" && row.decisions.length === 0;
  const oldReached = rows.filter(oldPredicate).length;
  assert.equal(oldReached, 119, "the old predicate must reproduce the 119 the desk showed");
  assert.equal(rows.length - oldReached, 672, "672 conversations had no filter at all");

  const reached = new Set(rows.filter((row) => matchesFilter("all", row)).map((row) => row.id));
  assert.equal(reached.size, 791);
  const unreached = rows.filter((row) => !STATE_FILTERS.some((id) => matchesFilter(id, row)));
  assert.deepEqual(unreached, [], "every conversation must be in a state filter");

  const byBucket = (id: DeskFilter) => rows.filter((row) => conversationBucket(row) === id).length;
  // The four numbers an operator sees, and they add up to the census.
  assert.equal(byBucket("needs_reply"), 119);
  assert.equal(byBucket("waiting"), 668);
  assert.equal(byBucket("decided"), 4);
  assert.equal(byBucket("closed"), 0);
  assert.equal(byBucket("needs_reply") + byBucket("waiting") + byBucket("decided") + byBucket("closed"), 791);
});

test("a decision covers the newest inbound; a guest follow-up re-opens the thread", () => {
  // Decision older than the guest's newest message: the turn is open again.
  const reopened = state("needs_reply", { decisions: [decision(T1)], newestInboundAt: T2 });
  assert.equal(coveredByDecision(reopened), false);
  assert.equal(conversationBucket(reopened), "needs_reply");
  // The inbound path is what re-opens it: `ghl-inbound.ts` writes status = 'needs_reply'.
  assert.ok(
    read("src/lib/ghl-inbound.ts").includes("status = 'needs_reply'"),
    "the inbound path must re-open the thread",
  );

  // Decision at the same instant as the message still covers it (SQL uses `>`, this mirrors it).
  assert.equal(decisionCovers(decision(T2), T2), true);
  assert.equal(decisionCovers(decision(T2), T3), false);
  assert.equal(decisionCovers(decision(T2), null), true, "a guest who never wrote is covered");
  assert.equal(coveredByDecision(state("waiting", { decisions: [] })), false);
  assert.equal(newestDecision([decision(T1), decision(T3), decision(T2)])?.created_at, T3);
});

test("a conversation in the tombstone status is in no filter and in no count", () => {
  const drill = state(TOMBSTONE_STATUS, { decisions: [], newestInboundAt: T1 });
  assert.equal(isVisible(drill), false);
  assert.equal(matchesFilter("all", drill), false, "the tombstone must not appear in all");
  for (const id of STATE_FILTERS) assert.equal(matchesFilter(id, drill), false, `tombstone matched ${id}`);
  // Even with a decision, and even if the status differs only in case or padding.
  assert.equal(matchesFilter("decided", state(TOMBSTONE_STATUS, { decisions: [decision(T2)] })), false);
  assert.equal(matchesFilter("all", state(" DONE ", {})), false);

  const store = read("src/data/mychef-store.ts");
  assert.ok(store.includes('visibleConversationSql("c")'), "the chip counts must exclude the tombstone");
  assert.ok(store.includes('queueWhereSql("needs_reply")'), "the dashboard badge must use the shared predicate");
  assert.equal(
    [...store.matchAll(/queueWhereSql\(filter\)/g)].length,
    2,
    "both queue queries (count and rows) must use the shared predicate",
  );
  // A tombstoned row is one UPDATE away from the queue and needs no DELETE (the runtime has none).
  assert.equal(TOMBSTONE_STATUS, "done", "the tombstone must stay inside the status CHECK constraint");
});

test("the dashboard badge, the queue chip and the review list read one needs_reply predicate", () => {
  const store = read("src/data/mychef-store.ts");
  const dashboard = store.slice(
    store.indexOf("export async function dashboardCounts("),
    store.indexOf("export async function dashboardReviewStats("),
  );
  assert.ok(
    dashboard.includes('queueWhereSql("needs_reply")'),
    "the dashboard badge must come from the same predicate as the chip",
  );
  assert.equal(
    [...dashboard.matchAll(/not exists \(/g)].length,
    0,
    "the dashboard must not subtract decision rows by hand",
  );
  const listInbox = store.slice(
    store.indexOf("export async function listInbox("),
    store.indexOf("export type DraftMeta"),
  );
  assert.equal(
    [...listInbox.matchAll(/not exists \(\s*select 1 from mychef_inbox\.decision_records/g)].length,
    0,
    "the pending-review list must not subtract decision rows by hand",
  );
  assert.ok(listInbox.includes('queueWhereSql("needs_reply")'), "the review list must use the shared predicate");
  // One predicate string, three call sites: chip, badge, list.
  assert.equal(stateWhereSql("needs_reply"), `(${bucketCaseSql()}) = 'needs_reply'`);
  assert.equal(queueWhereSql("needs_reply").includes("'done'"), true);
  assert.ok(lensWhereSql("escalated").includes("decision_records"));
});
