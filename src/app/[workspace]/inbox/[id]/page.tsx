/**
 * Inbox detail route — opens the selected row inside the three-pane desk (myCHEF)
 * or the legacy two-column decision review (local Docker tenants).
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewAction } from "@/app/[workspace]/inbox/[id]/actions";
import { MychefDesk } from "@/app/[workspace]/inbox/desk";
import { FeedbackForm } from "@/components/feedback-form";
import { RetrievalPanel } from "@/components/retrieval-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { getDecision } from "@/lib/decisions";
import { formatConfidence, formatWhen } from "@/lib/format";
import { listKnowledge } from "@/lib/knowledge";
import { retrieveForDecision } from "@/lib/retrieval";
import { decisionLabel, reasonLabel } from "@/lib/reason-codes";
import { canReview } from "@/lib/workspace-access";

export const metadata = { title: "Draft" };

export default async function DecisionPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/inbox/[id]">) {
  const { workspace, id } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  if (usesMychefInbox()) {
    const page = Number(query.page ?? "1");
    const search = typeof query.q === "string" ? query.q : "";
    const filter = typeof query.filter === "string" ? query.filter : undefined;
    return (
      <>
        {/* MychefDesk owns the three panes and the route's single h1 (MC-022 follow-up): the
            heading names the open conversation, so it has to be rendered where that row is read. */}
        <MychefDesk
          slug={access.ctx.orgSlug}
          selectedId={id}
          filterRaw={filter}
          page={page}
          search={search}
        />
      </>
    );
  }
  const decision = await getDecision(access.ctx.orgId, id);
  if (!decision) notFound();
  const catalog = listKnowledge().map((doc) => ({ id: doc.id, title: doc.title }));
  const action = reviewAction.bind(null, access.ctx.orgSlug, decision.id);
  const retrieval = await retrieveForDecision(
    access.ctx.orgId,
    decision.id,
    `${decision.inboundBody}\n${decision.draftText}`,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Legacy path (local Docker tenants): no contact row is read here, so the subject names
          the job rather than repeating the "Draft" h2 directly below it. */}
      <h1 className="sr-only">Conversation review</h1>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${access.ctx.orgSlug}/inbox`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Back to queue
        </Link>
        <Badge variant={decision.status === "reviewed" ? "secondary" : "default"}>
          {decision.status === "reviewed" ? "Reviewed" : "Pending"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {formatConfidence(decision.confidence)} confidence · {formatWhen(decision.receivedAt)}
        </span>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Inbound</h2>
          <p className="text-xs text-muted-foreground">Immutable. The raw message is not editable.</p>
          <blockquote className="rounded-lg border bg-card px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
            {decision.inboundBody}
          </blockquote>
          <h2 className="text-sm font-medium">Draft</h2>
          <div className="rounded-lg border px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
            {decision.draftText}
          </div>
          {decision.status === "pending_review" && decision.rationale ? (
            <dl className="grid gap-3 rounded-lg border px-4 py-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Why</dt>
                <dd className="whitespace-pre-wrap">{decision.rationale}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Why not</dt>
                <dd className="whitespace-pre-wrap">{decision.whyNot}</dd>
              </div>
            </dl>
          ) : null}
        </section>
        <section className="flex flex-col gap-4">
          {decision.status === "reviewed" ? (
            <div className="flex flex-col gap-4 rounded-xl border p-4">
              <h2 className="text-sm font-medium">Recorded decision</h2>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Decision</dt>
                  <dd>{decisionLabel(decision.humanDecision)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{reasonLabel(decision.reasonCode)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Final text</dt>
                  <dd className="whitespace-pre-wrap">{decision.finalText ?? "Nothing was sent."}</dd>
                </div>
              </dl>
            </div>
          ) : canReview(access.ctx.role) ? (
            <FeedbackForm
              action={action}
              draft={decision.draftText}
              sources={decision.sourceRefs ?? []}
              catalog={catalog}
            />
          ) : (
            <Alert>
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>
                Your role can read this draft. A reviewer, admin, or owner records the decision.
              </AlertDescription>
            </Alert>
          )}
        </section>
      </div>
      <RetrievalPanel
        workspace={access.ctx.orgSlug}
        decisions={retrieval.decisions}
        knowledge={retrieval.knowledge}
      />
    </div>
  );
}
