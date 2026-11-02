/**
 * MC-182 + CS round 3 — the desk queue's filters are a partition of the workspace, not seven labels
 * over one predicate.
 *
 * The defect this file replaces: `listDeskQueue()` treated `needs_review` and `all` as the same
 * filter (`pendingOnly = filter === "needs_review" || filter === "all"`), so both ran
 * `status = 'needs_reply' and no decision record`. Measured on production data 2026-11-01: 791
 * conversations, 119 reachable, 672 with no filter at all — a conversation in `status = 'waiting'`
 * could not be opened from the queue by any URL.
 *
 * The repair is structural, not a second `if`: every conversation is assigned exactly one state by
 * one `case` expression (`bucketCaseSql`), and each state filter is `bucket = '<id>'`. `all` is the
 * same table with no bucket condition, so `all` equals the union of the states by construction and
 * the states are disjoint by construction. Adding a conversation status later cannot create an
 * unreachable row: an unrecognised status falls into the `else` arm (`waiting`) instead of nowhere.
 *
 * CS round 3, the turn model (CS-001, MC-182 addendum 2026-11-01 18:08 +08). Before this, `decided`
 * meant "a decision row exists", and the query subtracted those rows by hand with a second
 * `not exists (decision_records)`. That asks *was this ever decided?* when the operator needs *was
 * the guest's newest message decided?*. Two live threads were filed as decided while still
 * `status = 'needs_reply'` (90f3471d on txbmzOgP, 5f8355c0 on Olr4Hehk), so the dashboard badge
 * said 119 while the column said 121. Now `decided` is turn-bound — one decision covers the current
 * turn when no inbound message is newer than it (`decisionCoversSql`) — and one predicate, exported
 * here, is read by the queue rows, the chip counts and the dashboard badge.
 *
 * The status column is the second half of the same model: `ghl-inbound.ts` already writes
 * `status = 'needs_reply'` when the guest writes, and `reviewConversation()` now writes
 * `status = 'waiting'` in the verdict transaction. So a guest follow-up re-enters the queue through
 * the inbound path, and the ledger alone no longer decides what is open.
 *
 * `done` is reserved as the tombstone status (`TOMBSTONE_STATUS`): the only value in the column's
 * CHECK constraint that no query counts. It is how a fixture or an archived row is kept invisible in
 * every filter and every badge without needing DELETE (which `mychef_runtime` does not have), and it
 * is reversible by one UPDATE back to `needs_reply`.
 *
 * The two reason filters (`escalated`, `auto_sent`) are lenses over the decision ledger, i.e. strict
 * subsets of `decided`, not a fifth bucket. They read the newest decision per conversation — the one
 * in force — so a lens can never count a conversation twice or name a thread `decided` does not
 * also open.
 *
 * One SQL predicate per filter id lives here and is consumed by both `listDeskQueue()` (rows) and
 * `deskFilterCounts()` (the number on every chip). The count is derived from the same string, so a
 * chip cannot disagree with the list it opens.
 */

export type DeskStateFilter = "needs_reply" | "waiting" | "decided" | "closed";
export type DeskReasonFilter = "escalated" | "auto_sent";
export type DeskFilter = "all" | DeskStateFilter | DeskReasonFilter;

/** A decision row, reduced to what the turn model and the two lenses read. */
export type DecisionState = {
  id: string;
  /** `created_at`, ISO string or Date. */
  created_at: string | Date;
  reason_code: string | null;
  human_decision: string | null;
  rejected_alternative: string | null;
};

export type ConversationState = {
  status: string | null;
  /** Every decision row on the conversation. Coverage is computed from `created_at`. */
  decisions: DecisionState[];
  /** `created_at` of the newest inbound message, or null when the guest never wrote. */
  newestInboundAt: string | Date | null;
};

type StateRule = {
  id: DeskStateFilter;
  sql: string;
  test: (state: ConversationState) => boolean;
};

/**
 * The one status no desk query counts. It is inside the column's CHECK constraint
 * (`needs_reply`, `waiting`, `done`), so setting it needs no DDL, and it is the value that makes a
 * row invisible in every filter and every badge while remaining one UPDATE away from the queue.
 */
export const TOMBSTONE_STATUS = "done";

function statusOf(state: ConversationState): string {
  return (state.status ?? "").trim().toLowerCase();
}

/** The tombstone rule, over alias `c` = mychef_inbox.conversations. */
export function visibleConversationSql(alias = "c"): string {
  return `coalesce(${alias}.status, '') <> '${TOMBSTONE_STATUS}'`;
}

export function isVisible(state: ConversationState): boolean {
  return statusOf(state) !== TOMBSTONE_STATUS;
}

function timeOf(value: string | Date | null): number {
  if (value === null) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/**
 * One decision covers the turn when no inbound message is newer than it. A decision written at the
 * same instant as the message that prompted it still covers it (`>` in the SQL, `>=` here).
 */
export function decisionCovers(decision: DecisionState, newestInboundAt: string | Date | null): boolean {
  const inbound = timeOf(newestInboundAt);
  if (Number.isNaN(inbound)) return true;
  const decidedAt = timeOf(decision.created_at);
  if (Number.isNaN(decidedAt)) return false;
  return decidedAt >= inbound;
}

export function coveredByDecision(state: ConversationState): boolean {
  return state.decisions.some((decision) => decisionCovers(decision, state.newestInboundAt));
}

/** The same rule as SQL, over alias `c` = mychef_inbox.conversations. */
export function decisionCoversSql(alias = "c"): string {
  return `exists (
         select 1 from mychef_inbox.decision_records d
          where d.workspace_id = ${alias}.workspace_id and d.conversation_id = ${alias}.id
            and not exists (
              select 1 from mychef_inbox.messages m
               where m.workspace_id = ${alias}.workspace_id and m.conversation_id = ${alias}.id
                 and m.direction = 'inbound' and m.created_at > d.created_at
            ))`;
}

/**
 * Ordered rules. The first match decides the bucket; anything left over is `waiting` (the `else`
 * arm of the generated `case`). Order is load-bearing and asserted by the tests: `decided` before
 * `closed` keeps "a reason lens is always inside decided" true for a thread that was decided and
 * later closed, and `needs_reply` last keeps a re-opened thread out of `decided` only when no
 * decision covers the new turn.
 */
export const STATE_RULES: StateRule[] = [
  {
    id: "decided",
    sql: decisionCoversSql("c"),
    test: (state) => coveredByDecision(state),
  },
  {
    id: "closed",
    sql: "c.status in ('closed', 'archived')",
    test: (state) => state.status === null ? false : ["closed", "archived"].includes(statusOf(state)),
  },
  {
    id: "needs_reply",
    sql: "c.status = 'needs_reply'",
    test: (state) => statusOf(state) === "needs_reply",
  },
];

/** The arm the generated `case` falls through to. Never appears as a `when` above. */
export const FALLBACK_STATE: DeskStateFilter = "waiting";

export const STATE_FILTERS: DeskStateFilter[] = [...STATE_RULES.map((rule) => rule.id), FALLBACK_STATE];

export const REASON_FILTERS: DeskReasonFilter[] = ["escalated", "auto_sent"];

/** Chip order for the queue pane. Reason lenses sit next to `decided` because they are inside it. */
export const DESK_FILTERS: { id: DeskFilter; label: string; hint: string }[] = [
  { id: "needs_reply", label: "Needs reply", hint: "The guest spoke last and no review covers that message yet" },
  { id: "waiting", label: "Waiting", hint: "No reply is due: the guest has not asked for anything since we spoke" },
  { id: "decided", label: "Decided", hint: "A review covers the newest guest message" },
  { id: "escalated", label: "Escalated", hint: "Decided, and the newest review says a human must handle it" },
  { id: "auto_sent", label: "Auto-sent", hint: "Decided, and the newest review marks it an auto-send candidate" },
  { id: "closed", label: "Closed", hint: "Closed or archived before a review covered the newest message" },
  { id: "all", label: "All", hint: "Every conversation in the workspace" },
];

export const DESK_FILTER_IDS: DeskFilter[] = DESK_FILTERS.map((item) => item.id);

export function isDeskFilter(value: string | undefined): value is DeskFilter {
  return value !== undefined && (DESK_FILTER_IDS as string[]).includes(value);
}

export function isStateFilter(filter: DeskFilter): filter is DeskStateFilter | "all" {
  return filter === "all" || (STATE_FILTERS as string[]).includes(filter);
}

export function isReasonFilter(filter: DeskFilter): filter is DeskReasonFilter {
  return (REASON_FILTERS as string[]).includes(filter);
}

/**
 * URL parsing. `needs_review` is the pre-MC-182 name of `needs_reply` and stays a working alias so a
 * bookmarked or pasted link keeps filtering instead of silently resetting to the default.
 */
export function parseDeskFilter(value: string | undefined): DeskFilter {
  if (value === undefined || value === "") return "needs_reply";
  if (value === "needs_review") return "needs_reply";
  return isDeskFilter(value) ? value : "needs_reply";
}

/** The single bucket expression, over alias `c` = mychef_inbox.conversations. */
export function bucketCaseSql(): string {
  const arms = STATE_RULES.map((rule) => `when ${rule.sql} then '${rule.id}'`).join("\n       ");
  return `case\n       ${arms}\n       else '${FALLBACK_STATE}'\n     end`;
}

/** The one predicate for a conversation filter. `all` is the same table without a bucket. */
export function stateWhereSql(filter: DeskFilter): string {
  if (filter === "all") return "true";
  if (!isStateFilter(filter)) {
    throw new Error(`${filter} is a decision lens, not a conversation state`);
  }
  return `(${bucketCaseSql()}) = '${filter}'`;
}

/**
 * The predicate every conversation query must use: the tombstone is excluded first, so a drill
 * fixture or an archived row is in no chip and not in `all` either.
 */
export function queueWhereSql(filter: DeskFilter = "all", alias = "c"): string {
  return `(${visibleConversationSql(alias)}) and (${stateWhereSql(filter)})`;
}

/** The newest decision per conversation — the one in force, and the only one a lens reads. */
export function newestDecisionSql(alias = "d"): string {
  return `not exists (
         select 1 from mychef_inbox.decision_records ${alias}2
          where ${alias}2.workspace_id = ${alias}.workspace_id
            and ${alias}2.conversation_id = ${alias}.conversation_id
            and (${alias}2.created_at, ${alias}2.id) > (${alias}.created_at, ${alias}.id)
       )`;
}

/** The one predicate for a decision lens, over alias `d` = mychef_inbox.decision_records. */
export function reasonPredicate(filter: DeskReasonFilter): string {
  if (filter === "auto_sent") return "d.reason_code = 'auto_sent_candidate'";
  return "(d.human_decision = 'rejected' and d.rejected_alternative = 'escalated') or d.reason_code = 'needs_human'";
}

/**
 * A lens query: the newest decision of a visible conversation the ledger says is decided, then the
 * reason. Because the newest decision is unique per conversation, a lens opens at most one row per
 * thread and can never exceed the `decided` chip.
 */
export function lensWhereSql(filter: DeskReasonFilter): string {
  return `(${visibleConversationSql("c")}) and (${decisionCoversSql("c")}) and (${newestDecisionSql("d")}) and (${reasonPredicate(filter)})`;
}

/**
 * The specification the generated `case` has to satisfy, in plain TypeScript, so the partition is
 * testable without a database: exactly one state per visible conversation, no state able to swallow
 * another.
 */
export function conversationBucket(state: ConversationState): DeskStateFilter {
  for (const rule of STATE_RULES) {
    if (rule.test(state)) return rule.id;
  }
  return FALLBACK_STATE;
}

/** `all` includes every visible conversation and nothing else; the tombstone matches no filter. */
export function matchesFilter(
  filter: DeskFilter,
  state: ConversationState,
): boolean {
  if (!isVisible(state)) return false;
  if (filter === "all") return true;
  if (isReasonFilter(filter)) {
    if (conversationBucket(state) !== "decided") return false;
    const newest = newestDecision(state.decisions);
    return newest !== null && matchesReason(reasonPredicate(filter), newest);
  }
  return conversationBucket(state) === filter;
}

/** Newest by `created_at`, then by `id`, mirroring `newestDecisionSql()`. */
export function newestDecision(decisions: DecisionState[]): DecisionState | null {
  return decisions.reduce<DecisionState | null>((newest, decision) => {
    if (newest === null) return decision;
    const a = timeOf(decision.created_at);
    const b = timeOf(newest.created_at);
    if (a > b) return decision;
    if (a === b && decision.id > newest.id) return decision;
    return newest;
  }, null);
}

/** Mirror of `reasonPredicate()` for the same reason: one rule, two representations, tested equal. */
export function matchesReason(predicate: string, decision: DecisionState): boolean {
  const reason = (decision.reason_code ?? "").trim();
  const human = (decision.human_decision ?? "").trim();
  const alternative = (decision.rejected_alternative ?? "").trim();
  if (predicate === "d.reason_code = 'auto_sent_candidate'") return reason === "auto_sent_candidate";
  return (human === "rejected" && alternative === "escalated") || reason === "needs_human";
}

/** Counts for every chip, filled by `deskFilterCounts()` in the store. */
export type DeskFilterCounts = Record<DeskFilter, number>;

export function emptyFilterCounts(): DeskFilterCounts {
  return DESK_FILTER_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {} as DeskFilterCounts);
}
