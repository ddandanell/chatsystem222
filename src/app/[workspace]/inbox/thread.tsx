/**
 * Legacy single-thread review (superseded by desk-review for myCHEF).
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
import Link from "next/link";
import { draftConversationAction, outcomeAction, reviewConversationAction } from "@/app/[workspace]/inbox/mychef-actions";
import { getConversation, getRecordedDecision } from "@/data/mychef-store";
import { FeedbackForm } from "@/components/feedback-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { formatWhen } from "@/lib/format";
import { OUTCOMES, decisionLabel, reasonLabel } from "@/lib/reason-codes";

export async function MychefThread({ id }: { id: string }) {
  const recorded = await getRecordedDecision(id).catch(() => null);
  if (recorded) {
    const action = outcomeAction.bind(null, recorded.id);
    return (
      <article className="flex max-w-3xl flex-col gap-5">
        <Link href="/mychef/inbox?status=reviewed" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}>
          Back to reviewed
        </Link>
        <div className="flex flex-wrap gap-2">
          <Badge>{decisionLabel(recorded.human_decision === "approved" ? "accepted" : recorded.human_decision)}</Badge>
          <Badge variant="outline">{reasonLabel(recorded.reason_code)}</Badge>
          {recorded.contact_name ? <Badge variant="secondary">{recorded.contact_name}</Badge> : null}
        </div>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Inbound</h2>
          <p className="text-xs text-muted-foreground">Immutable. Recording an outcome does not change it.</p>
          <blockquote className="rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-wrap">
            {recorded.inbound ?? "No inbound text stored."}
          </blockquote>
        </section>
        <dl className="grid gap-3 rounded-xl border p-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Draft</dt>
            <dd className="whitespace-pre-wrap">{recorded.original_draft}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Why</dt>
            <dd className="whitespace-pre-wrap">{recorded.rationale}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Why not</dt>
            <dd className="whitespace-pre-wrap">{recorded.why_not}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Final text</dt>
            <dd className="whitespace-pre-wrap">{recorded.edited_draft}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Outcome</dt>
            <dd>{recorded.outcome ?? "Not recorded yet."}</dd>
          </div>
        </dl>
        {recorded.reason_code !== "good_as_drafted" &&
        recorded.reason_code !== "auto_sent_candidate" ? (
          <Alert>
            <AlertTitle>Learning Queue</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                Corrections with this reason feed the Learning Queue. Approve or dismiss
                the situational snippet there. Nothing is sent from that page either.
              </span>
              <Link
                href="/mychef/candidates"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
              >
                Open Learning Queue
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        <OutcomeForm action={action} />
      </article>
    );
  }

  const conversation = await getConversation(id);
  if (!conversation) return null;
  const review = reviewConversationAction.bind(null, conversation.id);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/mychef/inbox" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Back to queue
        </Link>
        <Badge>{conversation.contact_name ?? "Contact"}</Badge>
        <Badge variant="outline">{conversation.status}</Badge>
      </div>
      <ol className="flex max-w-3xl flex-col gap-2">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "rounded-lg border px-4 py-3 text-sm whitespace-pre-wrap",
              message.direction === "inbound" ? "bg-card" : "ml-8",
            )}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {message.direction} · {formatWhen(message.created_at)}
            </p>
            {message.body}
          </li>
        ))}
      </ol>
      <Alert>
        <AlertTitle>Automatic sending is not on</AlertTitle>
        <AlertDescription>
          A draft is a proposal. Saving a review does not send a message.
        </AlertDescription>
      </Alert>
      {conversation.draft ? (
        <section className="flex max-w-3xl flex-col gap-3">
          <h2 className="text-sm font-medium">Draft</h2>
          <p className="text-sm whitespace-pre-wrap">{conversation.draft.body}</p>
          <p className="text-xs text-muted-foreground">
            {conversation.draft.model === "local"
              ? "This draft was not produced by a provider."
              : conversation.draft.model}
          </p>
          <a href="#review-form" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
            I don’t like the way this is written.
          </a>
          <FeedbackForm
            action={review}
            draft={conversation.draft.body}
            sources={[]}
            catalog={[]}
          />
        </section>
      ) : (
        <form action={draftConversationAction.bind(null, conversation.id)}>
          <Button type="submit">Draft a reply</Button>
        </form>
      )}
    </div>
  );
}

function OutcomeForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="outcome">
        Outcome
      </label>
      <select id="outcome" name="outcome" className="h-9 rounded-md border bg-background px-3 text-sm" required>
        {OUTCOMES.map((outcome) => (
          <option key={outcome} value={outcome}>
            {outcome}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" className="w-fit">
        Save outcome
      </Button>
    </form>
  );
}
