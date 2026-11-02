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
import { ThreadHistory } from "@/components/inbox/thread-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  deskFilterCounts,
  getConversation,
  getRecordedDecision,
  getRecordedDecisionForConversation,
  listDeskQueue,
  listStoredKnowledge,
} from "@/data/mychef-store";
import { parseDeskFilter } from "@/lib/desk-filters";
import { computeContactResponseMetrics } from "@/lib/contact-response";
import { draftAgeLabel, draftFreshness } from "@/lib/thread-memory";
import { getWorkspaceAccess } from "@/lib/context";
import { canReview } from "@/lib/workspace-access";
import { cn } from "cn";

/**
 * MC-182: URL parsing lives in `@/lib/desk-filters` so the store, the chips and the page cannot
 * disagree about which filter a URL means. `needs_review` stays a working alias of `needs_reply`.
 */
async function recordedFor(id: string) {
  const byDecision = await getRecordedDecision(id).catch(() => null);
  if (byDecision) return byDecision;
  return getRecordedDecisionForConversation(id).catch(() => null);
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
  const filter = parseDeskFilter(filterRaw);
  // The route's subject heading is the conversation this page is about (MC-022 follow-up): the
  // page owns one h1 and it must not repeat the word "Draft" already used by an h2 below.
  let subjectHeading: string | null = null;
  const [inbox, counts, recorded, conversation] = await Promise.all([
    listDeskQueue(filter, page, search),
    deskFilterCounts(search),
    selectedId ? recordedFor(selectedId) : Promise.resolve(null),
    selectedId ? getConversation(selectedId) : Promise.resolve(null),
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
      // A recorded turn stays readable: the whole loaded thread, with the verdict under it.
      subjectHeading = conversation?.contact_name ?? recorded.contact_name ?? null;
      workspace = conversation ? (
        <ThreadHistory
          slug={slug}
          contactName={conversation.contact_name}
          messages={conversation.messages}
          messageCount={conversation.messageCount}
          recorded={{
            id: recorded.id,
            human_decision: recorded.human_decision,
            reason_code: recorded.reason_code,
            rationale: recorded.rationale,
            edited_draft: recorded.edited_draft,
            contact_name: recorded.contact_name,
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <Alert className="max-w-md text-left">
            <AlertTitle>Thread unavailable</AlertTitle>
            <AlertDescription>
              This decision is in the ledger, but the conversation could not be loaded. Sending stays off.
            </AlertDescription>
          </Alert>
          <Link
            href={`/${slug}/inbox?filter=decided`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
          >
            Back to history
          </Link>
        </div>
      );
    } else {
      const access = await getWorkspaceAccess(slug);
      // MC-168: nothing is generated in the render path. The stored draft paints on the first byte
      // and the desk refreshes behind it, so opening a client never waits on a generator. Whether a
      // write is needed at all is decided from timestamps by draftFreshness().
      const now = new Date();
      const canDraft =
        conversation != null &&
        !conversation.decided &&
        access.status === "ok" &&
        canReview(access.ctx.role);
      const freshness = conversation
        ? draftFreshness(conversation.thread ?? conversation.messages, conversation.draft, now)
        : { needsDraft: false, reason: "fresh" as const };
      const draftError: string | null = null;
      const draftAge = conversation?.draft
        ? draftAgeLabel(conversation.draft.created_at, now)
        : null;
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
            needsDraft={canDraft && freshness.needsDraft}
            draftAge={draftAge}
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
                    thread: conversation.draft.thread ?? null,
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
          counts={counts}
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
