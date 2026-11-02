/**
 * The receipt a decision leaves behind. UX-0211.
 *
 * The desk had a receipt and threw it away: `reviewConversationAction()` returns
 * `{ message, id }` — "Review recorded. Nothing was sent." plus the decision id — and `submit()`
 * read only `result.error`, then navigated to the next thread. An irreversible verdict therefore
 * landed with nothing on screen saying it happened, and the only witness was the audit log.
 *
 * These helpers are pure so the wording is testable without a DOM: the headline names the decision,
 * the body is the server's own sentence verbatim (never re-worded here, because the "nothing was
 * sent" half is a claim about the write, and only the write knows it), and the id is shortened for
 * display with the full value kept in the title.
 */

export type RecordedDecision = "accepted" | "edited" | "rejected" | "escalated";

const HEADLINES: Record<RecordedDecision, string> = {
  accepted: "Accepted and recorded",
  edited: "Correction recorded",
  rejected: "Rejected and recorded",
  escalated: "Escalated and recorded",
};

export function receiptHeadline(decision: RecordedDecision): string {
  return HEADLINES[decision];
}

/** First 8 characters of a uuid, or null when the action did not return one. */
export function shortDecisionId(id: string | null | undefined): string | null {
  const trimmed = (id ?? "").trim();
  if (trimmed.length < 8) return null;
  return trimmed.slice(0, 8);
}

/**
 * The body line. The server's sentence passes through untouched; when the action returned none the
 * receipt says only "Recorded." — it does not manufacture a "nothing was sent" claim client-side.
 */
export function receiptSentence(serverMessage: string | null | undefined): string {
  const trimmed = (serverMessage ?? "").trim();
  return trimmed ? trimmed : "Recorded.";
}
