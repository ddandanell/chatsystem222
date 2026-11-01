/**
 * Conversation agent panel. Do not auto-send.
 *
 * Purpose: the operator presses Agent at the top of the conversation, sees exactly where the agent
 * is focused (this client, this thread, approved knowledge only), adds an instruction, and gets a
 * reply written into the same draft the review gate already governs. The panel never approves and
 * never sends; it reports which provider answered, or that the local fallback wrote the text.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, SparklesIcon } from "lucide-react";
import {
  agentDraftAction,
  type AgentActionState,
} from "@/app/[workspace]/inbox/mychef-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export function AgentPanel({
  conversationId,
  contactName,
  channel,
  messageCount,
}: {
  conversationId: string;
  contactName: string | null;
  channel: string | null;
  messageCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<AgentActionState>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await agentDraftAction(conversationId, instruction);
      setState(result);
      if (result?.ok) router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-tap
        onClick={() => {
          setState(null);
          setOpen(true);
        }}
      >
        <SparklesIcon data-icon="inline-start" aria-hidden />
        Agent
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Agent</SheetTitle>
            <SheetDescription>
              Focused on {contactName ?? "this contact"}
              {channel ? ` via ${channel}` : ""}. This conversation only, {messageCount} message
              {messageCount === 1 ? "" : "s"}, approved knowledge only.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <label className="flex flex-col gap-2 text-sm" htmlFor="agent-instruction">
              <span className="font-medium">What should it write?</span>
              <Textarea
                id="agent-instruction"
                data-tap
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Optional. For example: keep it short and warm, mention the villa date."
                rows={3}
                maxLength={600}
              />
              <span className="text-xs text-muted-foreground">
                The agent drafts one reply. You approve or edit it; nothing is sent.
              </span>
            </label>

            <Button
              type="button"
              data-tap
              onClick={run}
              disabled={pending}
              className="min-h-11 w-full"
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SparklesIcon data-icon="inline-start" aria-hidden />
              )}
              {pending ? "Drafting…" : "Draft reply with agent"}
            </Button>

            {state?.error ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>No draft written</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            {state?.ok && state.draftText ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{state.provider}</Badge>
                  <span className="text-xs text-muted-foreground">{state.model}</span>
                  {state.escalate ? <Badge variant="outline">A person must handle this</Badge> : null}
                </div>
                {state.notice ? (
                  <Alert>
                    <AlertTriangleIcon />
                    <AlertTitle>{state.fellBack ? "Local fallback" : "Heads up"}</AlertTitle>
                    <AlertDescription>{state.notice}</AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-sm whitespace-pre-wrap">{state.draftText}</p>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Why: </span>
                    {state.why}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Why not: </span>
                    {state.whyNot}
                  </p>
                </div>
                {state.sources?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {state.sources.map((source) => (
                      <Badge key={source.id} variant="outline">
                        {source.title}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No approved source was cited. Do not approve a price or a promise on this text.
                  </p>
                )}
                <Button type="button" variant="outline" data-tap onClick={() => setOpen(false)}>
                  Close and review the draft
                </Button>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              The agent cannot approve its own text, publish a rule, or send. Sending is off for
              every channel in this console.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
