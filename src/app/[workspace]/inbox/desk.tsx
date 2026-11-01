/**
 * Server composer for the myCHEF three-pane desk.
 * Purpose: load queue + selected conversation; ensure AI draft on open; timers.
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-design-system.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/contact-response-desk.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
import Link from "next/link";
import { InboxIcon } from "lucide-react";
import { DeskReview } from "@/components/inbox/desk-review";
import { DeskShell } from "@/components/inbox/desk-shell";
import { QueuePane } from "@/components/inbox/queue-pane";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ensureDraftForConversation,
  getConversation,
  getRecordedDecision,
  listDeskQueue,
  listStoredKnowledge,
  type DeskFilter,
} from "@/data/mychef-store";
import { outcomeAction } from "@/app/[workspace]/inbox/mychef-actions";
import { computeContactResponseMetrics } from "@/lib/contact-response";
import { getWorkspaceAccess } from "@/lib/context";
import { OUTCOMES, decisionLabel, reasonLabel } from "@/lib/reason-codes";
import { canReview } from "@/lib/workspace-access";
import { cn } from "cn";

function parseFilter(value: string | undefined): DeskFilter {
  if (value === "all" || value === "auto_sent" || value === "escalated" || value === "needs_review") {
    return value;
  }
  return "needs_review";
}

export async function MychefDesk({
  slug,
  selectedId,
  filterRaw,
  page,
  search,
}: {
  slug: string;
  selectedId?: string;
  filterRaw?: string;
  page: number;
  search: string;
}) {
  const filter = parseFilter(filterRaw);
  // The route's subject heading is the conversation this page is about (MC-022 follow-up): the
  // page owns one h1 and it must not repeat the word "Draft" already used by an h2 below.
  let subjectHeading: string | null = null;
  const [inbox, recorded] = await Promise.all([
    listDeskQueue(filter, page, search),
    selectedId ? getRecordedDecision(selectedId).catch(() => null) : Promise.resolve(null),
  ]);
  const ids = inbox.rows.filter((row) => row.kind === "conversation").map((row) => row.id);
  const activeId = selectedId ?? null;
  const activeIndex = activeId ? ids.indexOf(activeId) : -1;
  const nextId = activeIndex >= 0 ? ids[activeIndex + 1] ?? null : ids[0] ?? null;

  let workspace: React.ReactNode = (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <InboxIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium tracking-tight">Pick a conversation</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Open a queue item for the response clock, thread, and an AI suggested reply. Approve
          records the ledger only — nothing sends from this desk.
        </p>
      </div>
    </div>
  );

  if (activeId) {
    if (recorded) {
      subjectHeading = recorded.contact_name ?? null;
      const action = outcomeAction.bind(null, recorded.id);
      workspace = (
        <article className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
          <Alert>
            <AlertTitle>Already recorded</AlertTitle>
            <AlertDescription>
              This decision is in the ledger. Sending stays disconnected.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Badge>
              {decisionLabel(
                recorded.human_decision === "approved" ? "accepted" : recorded.human_decision,
              )}
            </Badge>
            <Badge variant="outline">{reasonLabel(recorded.reason_code)}</Badge>
            {recorded.contact_name ? <Badge variant="secondary">{recorded.contact_name}</Badge> : null}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Inbound</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">
                {recorded.inbound ?? "No inbound text stored."}
              </p>
            </CardContent>
          </Card>
          <dl className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Draft</dt>
              <dd className="whitespace-pre-wrap">{recorded.original_draft}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Final</dt>
              <dd className="whitespace-pre-wrap">{recorded.edited_draft}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Why</dt>
              <dd className="whitespace-pre-wrap">{recorded.rationale}</dd>
            </div>
          </dl>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Outcome</CardTitle>
              <CardDescription>Optional follow-up note on what happened after review.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={action} className="flex max-w-md flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="outcome">Outcome</FieldLabel>
                    <Select name="outcome" required defaultValue={OUTCOMES[0]}>
                      <SelectTrigger id="outcome" className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTCOMES.map((outcome) => (
                          <SelectItem key={outcome} value={outcome}>
                            {outcome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <Button type="submit" variant="outline" className="w-fit">
                  Save outcome
                </Button>
              </form>
            </CardContent>
          </Card>
          <Link
            href={`/${slug}/inbox`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
          >
            Back to queue
          </Link>
        </article>
      );
    } else {
      const access = await getWorkspaceAccess(slug);
      let conversation = await getConversation(activeId);
      let draftError: string | null = null;
      if (
        conversation &&
        !conversation.decided &&
        access.status === "ok" &&
        canReview(access.ctx.role)
      ) {
        const ensured = await ensureDraftForConversation(
          conversation.id,
          access.ctx.email || access.ctx.userId,
          conversation,
        );
        if (!ensured.ok) draftError = ensured.error;
        else if (ensured.created && !ensured.draft) {
          draftError = ensured.error ?? "Could not load the AI draft.";
        }
        if (ensured.ok && ensured.conversation) conversation = ensured.conversation;
      }
      if (conversation) {
        subjectHeading = conversation.contact_name ?? null;
        const knowledge = await listStoredKnowledge();
        const titles = Object.fromEntries(knowledge.map((doc) => [doc.id, doc.title]));
        const statuses = Object.fromEntries(knowledge.map((doc) => [doc.id, doc.status]));
        const metrics = computeContactResponseMetrics(
          conversation.messages,
          conversation.last_message_at,
        );
        workspace = (
          <DeskReview
            key={`${conversation.id}:${conversation.draft?.body ?? "empty"}`}
            slug={slug}
            nextId={nextId}
            knowledgeTitles={titles}
            knowledgeStatus={statuses}
            metrics={metrics}
            draftError={draftError}
            conversation={{
              id: conversation.id,
              contact_name: conversation.contact_name,
              status: conversation.status,
              channel: conversation.channel,
              tags: conversation.tags,
              categories: conversation.categories,
              facts: {
                phone: typeof conversation.facts.phone === "string" ? conversation.facts.phone : undefined,
                email: typeof conversation.facts.email === "string" ? conversation.facts.email : undefined,
                address:
                  typeof conversation.facts.address === "string" ? conversation.facts.address : undefined,
              },
              messages: conversation.messages,
              draft: conversation.draft
                ? {
                    body: conversation.draft.body,
                    model: conversation.draft.model,
                    sources: conversation.draft.sources,
                    confidence: conversation.draft.confidence,
                    why: conversation.draft.why,
                    whyNot: conversation.draft.whyNot,
                    escalate: conversation.draft.escalate,
                  }
                : null,
            }}
          />
        );
      } else {
        workspace = (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Conversation not found</AlertTitle>
              <AlertDescription>
                That thread is not in this workspace queue. Pick another item or refresh.
              </AlertDescription>
            </Alert>
            <Link
              href={`/${slug}/inbox`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
            >
              Back to queue
            </Link>
          </div>
        );
      }
    }
  }

  return (
    <DeskShell
      slug={slug}
      ids={ids}
      activeId={activeId}
      queue={
        <QueuePane
          slug={slug}
          filter={filter}
          search={search}
          rows={inbox.rows}
          activeId={activeId}
          total={inbox.total}
          page={inbox.page}
          pageSize={inbox.pageSize}
        />
      }
    >
      <h1 className="sr-only">
        {subjectHeading ? `Conversation with ${subjectHeading}` : "Inbox"}
      </h1>
      {workspace}
    </DeskShell>
  );
}
