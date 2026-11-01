/**
 * Lists audit_log for the workspace. Do not auto-send.
 */
import { desc } from "drizzle-orm";
import { listAudit } from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { auditEvents, feedbackEvents, rules } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getWorkspaceAccess } from "@/lib/context";
import { formatWhen } from "@/lib/format";
import { reasonLabel } from "@/lib/reason-codes";

export const metadata = { title: "Audit" };

export default async function AuditPage({
  params,
}: PageProps<"/[workspace]/audit">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;

  if (usesMychefInbox()) {
    const rows = await listAudit();
    return (
      <AuditList
        rows={rows.map((row) => ({
          id: row.id,
          when: row.created_at,
          kind: row.action.startsWith("rule:") ? "rule" : row.action.startsWith("outcome:") ? "outcome" : row.action,
          summary: `${row.action} · ${row.record_id}`,
        }))}
      />
    );
  }

  const rows = await withTenant(access.ctx.orgId, async (tx) => {
    const feedback = await tx.select().from(feedbackEvents).orderBy(desc(feedbackEvents.createdAt));
    const events = await tx.select().from(auditEvents).orderBy(desc(auditEvents.createdAt));
    const ruleRows = await tx.select().from(rules).orderBy(desc(rules.createdAt));
    return [
      ...feedback.map((row) => ({
        id: row.id,
        when: row.createdAt,
        kind: "feedback",
        summary: `${row.humanDecision} · ${reasonLabel(row.reasonCode)} · ${row.rationale ?? ""}`,
      })),
      ...events.map((row) => ({
        id: row.id,
        when: row.createdAt,
        kind: row.kind,
        summary: row.summary,
      })),
      ...ruleRows.map((row) => ({
        id: `rule-${row.id}`,
        when: row.createdAt,
        kind: "rule",
        summary: `${row.status} · evidence ${row.evidenceCount} · ${row.statement}`,
      })),
    ].sort((left, right) => right.when.getTime() - left.when.getTime());
  });

  return <AuditList rows={rows} />;
}

function AuditList({
  rows,
}: {
  rows: { id: string; when: Date; kind: string; summary: string }[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Audit</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Feedback and rule status changes for this workspace. Other workspaces are not listed.
        </p>
      </div>
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No audit events</EmptyTitle>
            <EmptyDescription>Reviews and rule changes will show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{row.kind}</Badge>
                <span className="text-muted-foreground">{formatWhen(row.when)}</span>
              </div>
              <p>{row.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
