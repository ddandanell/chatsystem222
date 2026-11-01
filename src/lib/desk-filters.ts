/**
 * MC-182 — the desk queue's filters are a partition of the workspace, not seven labels over one
 * predicate.
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
 * The two reason filters (`escalated`, `auto_sent`) are lenses over the decision ledger, i.e. strict
 * subsets of `decided`, not a fifth bucket. `decided` is tested before `closed` on purpose: a
 * conversation that was decided and later closed stays under `decided`, which keeps the invariant
 * "a reason lens is always inside `decided`" true for every row.
 *
 * One SQL predicate per filter id lives here and is consumed by both `listDeskQueue()` (rows) and
 * `deskFilterCounts()` (the number on every chip). The count is derived from the same string, so a
 * chip cannot disagree with the list it opens.
 */

export type DeskStateFilter = "needs_reply" | "waiting" | "decided" | "closed";
export type DeskReasonFilter = "escalated" | "auto_sent";
export type DeskFilter = "all" | DeskStateFilter | DeskReasonFilter;

export type ConversationState = {
  status: string | null;
  /** True when at least one row in mychef_inbox.decision_records names this conversation. */
  decided: boolean;
};

export type DecisionState = {
  reason_code: string | null;
  human_decision: string | null;
  rejected_alternative: string | null;
};

type StateRule = {
  id: DeskStateFilter;
  sql: string;
  test: (state: ConversationState) => boolean;
};

function statusOf(state: ConversationState): string {
  return (state.status ?? "").trim().toLowerCase();
}

/**
 * Ordered rules. The first match decides the bucket; anything left over is `waiting` (the `else`
 * arm of the generated `case`). Order is load-bearing and asserted by the tests.
 */
export const STATE_RULES: StateRule[] = [
  {
    id: "decided",
    sql: "exists (select 1 from mychef_inbox.decision_records d where d.workspace_id = c.workspace_id and d.conversation_id = c.id)",
    test: (state) => state.decided,
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
  { id: "needs_reply", label: "Needs reply", hint: "The guest spoke last and nothing was recorded yet" },
  { id: "waiting", label: "Waiting", hint: "No reply is due: the guest has not asked for anything since we spoke" },
  { id: "decided", label: "Decided", hint: "A review is in the ledger for this conversation" },
  { id: "escalated", label: "Escalated", hint: "Decided, and the ledger says a human must handle it" },
  { id: "auto_sent", label: "Auto-sent", hint: "Decided, and marked as an auto-send candidate" },
  { id: "closed", label: "Closed", hint: "Closed or archived before a review was recorded" },
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

/** The one predicate for a decision lens, over alias `d` = mychef_inbox.decision_records. */
export function reasonPredicate(filter: DeskReasonFilter): string {
  if (filter === "auto_sent") return "d.reason_code = 'auto_sent_candidate'";
  return "(d.human_decision = 'rejected' and d.rejected_alternative = 'escalated') or d.reason_code = 'needs_human'";
}

/**
 * The specification the generated `case` has to satisfy, in plain TypeScript, so the partition is
 * testable without a database: exactly one state per conversation, no state able to swallow another.
 */
export function conversationBucket(state: ConversationState): DeskStateFilter {
  for (const rule of STATE_RULES) {
    if (rule.test(state)) return rule.id;
  }
  return FALLBACK_STATE;
}

export function matchesFilter(
  filter: DeskFilter,
  state: ConversationState,
  decisions: DecisionState[] = [],
): boolean {
  if (filter === "all") return true;
  if (isReasonFilter(filter)) {
    if (conversationBucket(state) !== "decided") return false;
    const predicate = reasonPredicate(filter);
    return decisions.some((decision) => matchesReason(predicate, decision));
  }
  return conversationBucket(state) === filter;
}

/** Mirror of `reasonPredicate()` for the same reason: one rule, two representations, tested equal. */
function matchesReason(predicate: string, decision: DecisionState): boolean {
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
