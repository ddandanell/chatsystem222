/**
 * B3: a decision is irreversible, so it must name the object it is about.
 *
 * `decision_records` is append-only: `reviewConversation` refuses a decided turn, there is no undo
 * and no delete path anywhere in `src/`. Until an undo exists, the only protection against recording
 * a verdict on the wrong person — a stale tab, a row that scrolled, a shared screen — is to make the
 * operator name the object, and to check that name on the server.
 *
 * The same three functions are used by the desk (to render the confirmation) and by the store (to
 * enforce it), so the sentence the operator reads and the string the server compares can never drift.
 *
 * No database, no network, no I/O.
 */

export type ConfirmationSubject = {
  contactName: string | null;
  conversationId: string;
};

/** Collapse whitespace: "  Maya  Chen " and "Maya Chen" are the same person. */
function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The name the operator has to confirm, as it is shown on the desk.
 * An unnamed contact still gets a stable, readable handle rather than an empty confirm prompt.
 */
export function decisionTarget(subject: ConfirmationSubject): string {
  const name = tidy(subject.contactName ?? "");
  if (name) return name;
  const tail = tidy(subject.conversationId).slice(-6);
  return tail ? `unnamed contact ${tail}` : "unnamed contact";
}

/** Compare without case or spacing noise; never accept an empty confirmation. */
export function confirmationMatches(value: string | null | undefined, target: string): boolean {
  if (typeof value !== "string") return false;
  const typed = tidy(value);
  if (!typed) return false;
  return typed.toLocaleLowerCase("en") === tidy(target).toLocaleLowerCase("en");
}

/** One sentence, used verbatim in the UI and in the refusal, so both say the same thing. */
export function confirmationPrompt(target: string): string {
  return `This records a decision for ${target} and cannot be undone. Type the name to confirm.`;
}

export const CONFIRMATION_REFUSAL =
  "Name the person you are deciding before recording a verdict. Nothing was recorded.";
