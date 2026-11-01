/**
 * Lists audit_log for the workspace, with the actor. Do not auto-send.
 *
 * QA-W6-04: this page used to map listAudit() rows down to {id, when, kind, summary}, so
 * actor_id was selected by the query and then dropped here. Every row now carries its actor
 * (see src/lib/audit-view.ts). On the Neon path the value always exists; on the self-hosted
 * path feedback_events and rules carry an owner, and audit_events has no actor column at all,
 * which is shown as "not recorded" rather than as a blank.
 *
 * The page keeps its own h1 (MC-022): the list is a component so its output can be rendered in a
 * test, but the route heading stays here, where the route declares it.
 */
import { desc, inArray } from "drizzle-orm";
import { AuditList } from "@/components/audit-list";
import { listAudit } from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { auditEvents, feedbackEvents, rules, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  AUDIT_DESCRIPTION,
  NOT_RECORDED_ACTOR,
  auditActorLabel,
  sortAuditRows,
  toAuditRowView,
  type AuditRowView,
} from "@/lib/audit-view";
import { getWorkspaceAccess } from "@/lib/context";
import { reasonLabel } from "@/lib/reason-codes";

export const metadata = { title: "Audit" };

export default async function AuditPage({
  params,
}: PageProps<"/[workspace]/audit">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;

  let rows: AuditRowView[];

  if (usesMychefInbox()) {
    const audit = await listAudit();
    rows = audit.map(toAuditRowView);
  } else {
    rows = await withTenant(access.ctx.orgId, async (tx) => {
      const feedback = await tx
        .select()
        .from(feedbackEvents)
        .orderBy(desc(feedbackEvents.createdAt));
      const events = await tx.select().from(auditEvents).orderBy(desc(auditEvents.createdAt));
      const ruleRows = await tx.select().from(rules).orderBy(desc(rules.createdAt));

      const actorIds = [
        ...new Set(
          [...feedback.map((row) => row.actorId), ...ruleRows.map((row) => row.ownerId)].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ];
      const actors = actorIds.length
        ? await tx
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(inArray(users.id, actorIds))
        : [];
      const actorById = new Map(actors.map((row) => [row.id, row.name ?? row.email]));

      return sortAuditRows([
        ...feedback.map((row) => ({
          id: row.id,
          when: row.createdAt,
          kind: "feedback",
          actor: auditActorLabel(row.actorId ? (actorById.get(row.actorId) ?? row.actorId) : null),
          summary: `${row.humanDecision} · ${reasonLabel(row.reasonCode)} · ${row.rationale ?? ""}`,
        })),
        ...events.map((row) => ({
          id: row.id,
          when: row.createdAt,
          kind: row.kind,
          // audit_events has no actor column, so there is no identity to print. Saying so is
          // honest; a blank cell would read as "nobody wrote this".
          actor: NOT_RECORDED_ACTOR,
          summary: row.summary,
        })),
        ...ruleRows.map((row) => ({
          id: `rule-${row.id}`,
          when: row.createdAt,
          kind: "rule",
          actor: auditActorLabel(row.ownerId ? (actorById.get(row.ownerId) ?? row.ownerId) : null),
          summary: `${row.status} · evidence ${row.evidenceCount} · ${row.statement}`,
        })),
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Audit</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {AUDIT_DESCRIPTION}
        </p>
      </div>
      <AuditList rows={rows} />
    </div>
  );
}
