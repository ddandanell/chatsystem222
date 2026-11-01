/**
 * Local eval cases against knowledge. Writes audit_log. Do not auto-send.
 */
import { desc } from "drizzle-orm";
import { evalAction } from "@/app/[workspace]/ledger-actions";
import { usesMychefInbox } from "@/db/mode";
import { evalCases, evalRuns } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { listAudit } from "@/data/mychef-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getWorkspaceAccess } from "@/lib/context";
import { excerpt } from "@/lib/format";
import { reasonLabel } from "@/lib/reason-codes";
import { canReview } from "@/lib/workspace-access";

export const metadata = { title: "Evals" };

export default async function EvalsPage({
  params,
}: PageProps<"/[workspace]/evals">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const run = evalAction.bind(null, access.ctx.orgSlug);
  const neon = usesMychefInbox();
  const audit = neon ? await listAudit() : [];
  const evalAudit = audit.filter((row) => row.action.startsWith("eval:"));
  const rows = neon
    ? []
    : await withTenant(access.ctx.orgId, async (tx) => {
        return tx.select().from(evalCases).orderBy(desc(evalCases.createdAt));
      });
  const runs = neon
    ? []
    : await withTenant(access.ctx.orgId, async (tx) => {
        return tx.select().from(evalRuns).orderBy(desc(evalRuns.createdAt));
      });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium tracking-tight">Eval cases</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            The local drafter runs each case. A case passes when the draft contains the required phrase and omits the forbidden one. No provider is called.
          </p>
        </div>
        {canReview(access.ctx.role) ? (
          <form action={run}>
            <Button type="submit">Run evals</Button>
          </form>
        ) : null}
      </div>
      {neon ? (
        <ul className="flex flex-col gap-3">
          <li className="rounded-xl border px-4 py-3 text-sm">
            Deposit inside 14 days — must include “non-refundable”, must not include “full refund”.
          </li>
          <li className="rounded-xl border px-4 py-3 text-sm">
            Allergy — must include “allergy”, must not include “we cannot accommodate”.
          </li>
        </ul>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No eval cases</EmptyTitle>
            <EmptyDescription>This workspace has no golden scenarios yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const latest = runs.find((run) => run.evalCaseId === row.id);
            return (
              <li key={row.id} className="flex flex-col gap-2 rounded-xl border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">{row.name}</h3>
                  <Badge variant={latest ? (latest.passed ? "secondary" : "outline") : "outline"}>
                    {latest ? (latest.passed ? "Pass" : "Fail") : "Not run"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{excerpt(row.inboundText, 220)}</p>
                <p className="text-sm">
                  Expect {row.expectedDecision ?? "—"} · {reasonLabel(row.expectedReasonCode)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {neon && evalAudit.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {evalAudit.map((row) => (
            <li key={row.id} className="flex flex-wrap gap-2 text-sm">
              <Badge variant={row.action === "eval:pass" ? "secondary" : "outline"}>
                {row.action === "eval:pass" ? "Pass" : "Fail"}
              </Badge>
              <span>{row.record_id}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
