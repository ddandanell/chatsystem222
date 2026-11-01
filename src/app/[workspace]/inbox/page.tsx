/**
 * Inbox route — three-pane desk for myCHEF; legacy card queue for local Docker tenants.
 * Panes: queue | workspace | context (see MychefDesk).
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
import Link from "next/link";
import { draftAction } from "@/app/[workspace]/inbox/actions";
import { MychefDesk } from "@/app/[workspace]/inbox/desk";
import { DraftComposer } from "@/components/draft-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { QueueTabs } from "@/components/queue-tabs";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { listDecisions } from "@/lib/decisions";
import { excerpt, formatConfidence, formatWhen } from "@/lib/format";
import { decisionLabel, reasonLabel } from "@/lib/reason-codes";
import { canReview } from "@/lib/workspace-access";

export const metadata = { title: "Inbox" };

export default async function InboxPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/inbox">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const status = query.status === "reviewed" ? "reviewed" : "pending_review";
  if (usesMychefInbox()) {
    const page = Number(query.page ?? "1");
    const search = typeof query.q === "string" ? query.q : "";
    const filter = typeof query.filter === "string" ? query.filter : undefined;
    return (
      <>
        {/* MychefDesk owns the visible panes and renders the route's single h1 from the
            conversation row it already loaded. A second sr-only "Inbox" h1 here gave
            /mychef/inbox two h1s. */}
        <MychefDesk
          slug={access.ctx.orgSlug}
          filterRaw={filter}
          page={page}
          search={search}
        />
      </>
    );
  }
  const rows = await listDecisions(access.ctx.orgId, status);
  const draft = draftAction.bind(null, access.ctx.orgSlug);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium tracking-tight">Review queue</h1>
          <p className="text-sm text-muted-foreground">
            Inbound text stays as it arrived. You record what should have been sent.
          </p>
        </div>
        <QueueTabs slug={access.ctx.orgSlug} status={status} />
      </div>
      {status === "pending_review" ? (
        canReview(access.ctx.role) ? (
          <DraftComposer action={draft} />
        ) : (
          <Alert>
            <AlertTitle>View only</AlertTitle>
            <AlertDescription>
              Your role can read this queue. A reviewer, admin, or owner pastes a message to draft a reply.
            </AlertDescription>
          </Alert>
        )
      ) : null}
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {status === "pending_review" ? "Nothing is waiting" : "No reviewed decisions"}
            </EmptyTitle>
            <EmptyDescription>
              {status === "pending_review"
                ? "New drafts land here. Nothing sends on its own."
                : "Accepted, edited, rejected, and escalated replies show up here with their reason."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/${access.ctx.orgSlug}/inbox/${row.id}`} className="block">
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{formatConfidence(row.confidence)} confidence</Badge>
                      {row.humanDecision ? (
                        <Badge variant="secondary">{decisionLabel(row.humanDecision)}</Badge>
                      ) : (
                        <Badge>Pending</Badge>
                      )}
                      {row.reasonCode ? (
                        <Badge variant="outline">{reasonLabel(row.reasonCode)}</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {formatWhen(row.receivedAt)}
                      </span>
                    </div>
                    <CardTitle>{excerpt(row.inboundBody, 140)}</CardTitle>
                    <CardDescription>{excerpt(row.draftText, 180)}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
