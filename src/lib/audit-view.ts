/**
 * Audit rows for the console, with the actor kept.
 *
 * QA-W6-04: /mychef/audit rendered kind, time and summary but dropped actor_id, so a row
 * saying `actor product-qa` in the database rendered with no Actor/By/Who text at all and
 * the table could not settle a dispute about who wrote a row. The query always selected
 * actor_id; the page threw it away. These helpers keep it, and label the one case where the
 * source genuinely has no actor column instead of printing a blank.
 *
 * Nothing here invents an identity: an actor id is shown exactly as stored, and an id that
 * cannot be resolved is shown as the id itself, because that still settles who wrote it.
 */

/**
 * What the list is, in one sentence, kept here so a test can assert the sentence itself.
 *
 * The route used to describe itself as "feedback and rule status changes", which was wrong in
 * both directions: the list also carries key, operator and import changes, and it now shows the
 * actor on every row. Copy that misdescribes the list is how an audit page stops being read.
 */
export const AUDIT_DESCRIPTION =
  "Recorded changes for this workspace, newest first, each with the actor that made it. Rows whose source has no actor say so. Other workspaces are not listed.";

/** The table has an actor column, but this row's value is empty or whitespace. */
export const UNKNOWN_ACTOR = "unknown";

/** The source table has no actor column at all, so absence is a schema fact, not a gap. */
export const NOT_RECORDED_ACTOR = "not recorded";

export type AuditSourceRow = {
  id: string;
  actor_id: string | null | undefined;
  action: string;
  record_id: string;
  created_at: Date;
};

export type AuditRowView = {
  id: string;
  when: Date;
  kind: string;
  /** Never empty: an id, or one of the two explicit fallback labels. */
  actor: string;
  summary: string;
};

export function auditActorLabel(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return value === "" ? UNKNOWN_ACTOR : value;
}

/**
 * `rule:` and `outcome:` actions are prefixes on a longer action string; the list shows the
 * shorter kind so the badge column stays scannable. Anything else is shown verbatim.
 */
export function auditKind(action: string): string {
  if (action.startsWith("rule:")) return "rule";
  if (action.startsWith("outcome:")) return "outcome";
  return action;
}

export function auditSummary(action: string, recordId: string): string {
  return `${action} · ${recordId}`;
}

export function toAuditRowView(row: AuditSourceRow): AuditRowView {
  return {
    id: row.id,
    when: row.created_at,
    kind: auditKind(row.action),
    actor: auditActorLabel(row.actor_id),
    summary: auditSummary(row.action, row.record_id),
  };
}

/**
 * Newest first, and stable when two rows share a timestamp: the database writes several audit
 * rows inside one transaction, so identical created_at values are normal (product-qa's row and
 * its counterpart above share 08:22:40.902Z). Sorting only on time would let the order wobble
 * between renders; id breaks the tie deterministically.
 */
export function sortAuditRows(rows: AuditRowView[]): AuditRowView[] {
  return [...rows].sort((left, right) => {
    const delta = right.when.getTime() - left.when.getTime();
    if (delta !== 0) return delta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
