/**
 * CS-001: "decided" is a property of the latest turn, not of the conversation.
 *
 * Purpose: one definition of *when a conversation is decided*, shared by the desk queue, the
 * dashboard count, the legacy inbox list and the four review/draft guards, so none of them can
 * drift from the others.
 *
 * Tables read (through the SQL constant below): decision_records, messages, conversations.
 * Do not auto-send. Nothing in this module writes, sends, or calls a provider.
 *
 * Why a turn: `decision_records` rows accumulate per conversation and were treated as a permanent
 * flag. Once a thread was decided the queue dropped it and every draft/review path refused it
 * forever — including after the guest wrote again, which is the "supersede instead of refuse"
 * defect CS-001 reports. The fix is to bound the decision test by the newest inbound message, so a
 * later guest message re-opens the thread and the operator can decide the new turn.
 *
 * The conversation `status` column is deliberately NOT part of this definition. Status stays the
 * coarse queue gate (`status = 'needs_reply'`), and ignoring it here keeps the guards from refusing
 * a thread the desk is showing. See shared/mychef-ops/cs001-fix-shape-2026-11-01.md §3.
 */

export type TurnState = "open" | "decided";

export type TurnInput = {
  /** Newest inbound message in the conversation, or null when nothing inbound was ever stored. */
  lastInboundAt?: Date | string | null;
  /** Newest decision recorded on the conversation, or null when it was never reviewed. */
  lastDecisionAt?: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A conversation is decided when a decision exists at or after its newest inbound message.
 * Equal timestamps count as decided: the decision was written for that message.
 * A conversation with no inbound message but a decision stays decided, so a review of an empty
 * thread is not resurrected as fresh work.
 */
export function turnState(input: TurnInput): TurnState {
  const decision = toMs(input.lastDecisionAt);
  if (decision === null) return "open";
  const inbound = toMs(input.lastInboundAt);
  if (inbound === null) return "decided";
  return decision >= inbound ? "decided" : "open";
}

/** Convenience for guards that read `conversation.decided`. */
export function isDecided(input: TurnInput): boolean {
  return turnState(input) === "decided";
}

/**
 * The predicate spliced into every conversation list and count.
 *
 * It refers to the conversation row as `c`, so it can only be used where that alias is in scope.
 * It mirrors `turnState()` exactly: no decision -> row stays; decision older than the newest
 * inbound -> row comes back. Keeping one string means the badge, the list and the guards cannot
 * disagree about what "open" means.
 */
export const OPEN_TURN_DECISION_PREDICATE = `not exists (
         select 1 from mychef_inbox.decision_records d
         where d.workspace_id = c.workspace_id
           and d.conversation_id = c.id
           and d.created_at >= coalesce(
             (select max(m.created_at) from mychef_inbox.messages m
              where m.workspace_id = c.workspace_id
                and m.conversation_id = c.id
                and m.direction = 'inbound'),
             '-infinity'::timestamptz)
       )`;
