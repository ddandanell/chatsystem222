"use client";
/**
 * Three-pane review cockpit. Approve records a decision. Do not auto-send.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { ActionState } from "@/app/[workspace]/inbox/cockpit-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { channelAdapterLabel } from "@/channels/inbound";
import { formatWhenKl } from "@/lib/format";
import { INBOX_TAGS, tagLabel, type InboxTag } from "@/lib/inbox-tags";
import { REASON_CODES } from "@/lib/reason-codes";
import type { InboxCard, InboxFilter } from "@/data/inbox-board";
import { cn } from "cn";

export type InboxSelection = {
  id: string;
  name: string;
  channel: string;
  tags: InboxTag[];
  contactId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  messages: { id: string; direction: string; body: string; at: string }[];
  draft: string;
  confidence: number | null;
  why: string;
  sources: { id: string; title: string }[];
  decided: boolean;
};

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "auto_sent", label: "Auto-sent" },
  { id: "escalated", label: "Escalated" },
];

function confidenceDot(value: number | null) {
  if (value == null) return "bg-muted-foreground/40";
  return value >= 0.7 ? "bg-primary" : "bg-muted-foreground";
}

export function InboxCockpit({
  slug,
  filter,
  query,
  items,
  selected,
  canReview,
  tagged,
  approveAction,
  regenerateAction,
  retagAction,
}: {
  slug: string;
  filter: InboxFilter;
  query: string;
  items: InboxCard[];
  selected: InboxSelection | null;
  canReview: boolean;
  tagged: string;
  approveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  regenerateAction: (formData: FormData) => Promise<void>;
  retagAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(selected?.draft ?? "");
  const [pane, setPane] = useState<"client" | "brain">(tagged ? "client" : "brain");
  const formRef = useRef<HTMLFormElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [state, submit, pending] = useActionState(approveAction, null);
  const edited = selected ? draft.trim() !== selected.draft.trim() : false;
  const index = items.findIndex((item) => item.id === selected?.id);
  const nextId = index >= 0 ? items[index + 1]?.id ?? items[0]?.id ?? "" : items[0]?.id ?? "";

  // Reset local edits before rendering a different selection/server draft.
  const [selection, setSelection] = useState({ id: selected?.id, draft: selected?.draft, tagged });
  const [wasEdited, setWasEdited] = useState(edited);
  if (selection.id !== selected?.id || selection.draft !== selected?.draft || selection.tagged !== tagged) {
    setSelection({ id: selected?.id, draft: selected?.draft, tagged });
    setDraft(selected?.draft ?? "");
    setPane(tagged ? "client" : "brain");
    setWasEdited(false);
  } else if (wasEdited !== edited) {
    setWasEdited(edited);
    if (edited) setPane("brain");
  }

  const href = useMemo(() => {
    return (id?: string, nextFilter = filter) => {
      const params = new URLSearchParams();
      if (nextFilter !== "needs_review") params.set("filter", nextFilter);
      if (query) params.set("q", query);
      if (id) params.set("id", id);
      const search = params.toString();
      return `/${slug}/inbox${search ? `?${search}` : ""}`;
    };
  }, [filter, query, slug]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        formRef.current?.requestSubmit();
        return;
      }
      if (typing) return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const step = event.key === "j" ? 1 : -1;
        const next = items[Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + step))];
        if (next) router.push(href(next.id));
      }
      if (event.key === "a") formRef.current?.requestSubmit();
      if (event.key === "e") draftRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, index, items, router]);

  return (
    <div className="grid min-h-[36rem] gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)_minmax(16rem,30%)]">
      <section className={cn("flex min-h-0 flex-col gap-3 overflow-hidden rounded-xl border", selected && "max-lg:hidden")}>
        <form action={`/${slug}/inbox`} className="flex flex-col gap-2 p-3">
          <Input name="q" defaultValue={query} placeholder="Search guests" aria-label="Search guests" />
          {filter !== "needs_review" ? <input type="hidden" name="filter" value={filter} /> : null}
        </form>
        <div className="flex gap-1 overflow-x-auto px-3">
          {FILTERS.map((item) => (
            <Link
              key={item.id}
              href={href(selected?.id, item.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs whitespace-nowrap",
                filter === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-sm text-muted-foreground">Nothing in this filter.</li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <Link
                  href={href(item.id)}
                  className={cn(
                    "flex flex-col gap-1 border-l-2 px-3 py-3",
                    item.id === selected?.id ? "border-l-primary bg-muted" : "border-l-transparent hover:bg-muted/60",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", confidenceDot(item.confidence))} />
                    <span className="truncate text-sm font-medium">{item.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{item.snippet || "No inbound text"}</span>
                  <span className="flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant={tag === "vip" ? "default" : "outline"}>
                        {tagLabel(tag)}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">{formatWhenKl(item.at)}</span>
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className={cn("flex min-h-0 flex-col gap-3 overflow-y-auto", !selected && "max-lg:hidden")}>
        {!selected ? (
          <div className="flex flex-1 flex-col justify-center gap-2 rounded-xl border px-4 py-8">
            <p className="text-sm font-medium">Choose a conversation</p>
            <p className="text-sm text-muted-foreground">Sending is not connected. Approving records the decision and does not message the guest.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={href()} className="text-sm text-muted-foreground lg:hidden">Back</Link>
              <h2 className="text-lg font-medium">{selected.name}</h2>
              <Badge variant="outline">{channelAdapterLabel(selected.channel)}</Badge>
              {selected.confidence != null ? (
                <Badge variant="secondary">{Math.round(selected.confidence * 100)}% confidence</Badge>
              ) : null}
            </div>
            <Alert>
              <AlertTitle>Sending is not connected.</AlertTitle>
              <AlertDescription>Approve records the reply in the ledger. It does not send it.</AlertDescription>
            </Alert>
            <ol className="flex flex-col gap-2">
              {selected.messages.map((message) => (
                <li
                  key={message.id}
                  className={cn(
                    "max-w-[85%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap",
                    message.direction === "inbound" ? "bg-muted" : "ml-auto",
                  )}
                >
                  {message.body}
                </li>
              ))}
            </ol>
            <form ref={formRef} action={submit} className="sticky bottom-0 flex flex-col gap-3 rounded-xl border bg-background p-3">
              <input type="hidden" name="id" value={selected.id} />
              <input type="hidden" name="original" value={selected.draft} />
              <input type="hidden" name="next_id" value={nextId === selected.id ? "" : nextId} />
              <input type="hidden" name="tag" value={selected.tags[0] ?? "private_chef"} />
              <label className="flex flex-col gap-1 text-sm" htmlFor="inbox-draft">
                AI suggested reply{selected.confidence != null ? ` (${Math.round(selected.confidence * 100)}%)` : ""}
                <Textarea
                  ref={draftRef}
                  id="inbox-draft"
                  name="final_text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className={cn("min-h-28", edited && "border-primary")}
                  disabled={!canReview || selected.decided}
                />
              </label>
              {edited ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="text-muted-foreground line-through whitespace-pre-wrap">{selected.draft}</p>
                  <p className="whitespace-pre-wrap">{draft}</p>
                  <label className="flex flex-col gap-1">
                    Why this change
                    <select name="reason_code" className="h-8 rounded-lg border bg-background px-2" defaultValue="too_formal">
                      {REASON_CODES.filter((reason) => reason.code !== "good_as_drafted").map((reason) => (
                        <option key={reason.code} value={reason.code}>{reason.label}</option>
                      ))}
                    </select>
                  </label>
                  <Textarea name="rationale" placeholder="Why the guest should get this wording" required={edited} />
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="remember" value="on" />
                    Remember this for next time
                  </label>
                </div>
              ) : null}
              {state?.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Not saved</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}
              {canReview && !selected.decided ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="mode" value="approve" disabled={pending}>Approve</Button>
                  <Button type="submit" name="mode" value="escalate" variant="outline" disabled={pending}>Escalate to human</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This conversation already has a decision.</p>
              )}
            </form>
            {canReview && !selected.decided ? (
              <form action={regenerateAction}>
                <input type="hidden" name="id" value={selected.id} />
                <input type="hidden" name="tag" value={selected.tags[0] ?? ""} />
                <Button type="submit" variant="outline" size="sm">Regenerate</Button>
              </form>
            ) : null}
            <div className="lg:hidden">
              <Context
                slug={slug}
                selected={selected}
                pane={pane}
                setPane={setPane}
                tagged={tagged}
                canReview={canReview}
                retagAction={retagAction}
              />
            </div>
          </>
        )}
      </section>

      <aside className="hidden min-h-0 overflow-y-auto lg:block">
        {selected ? (
          <Context
            slug={slug}
            selected={selected}
            pane={pane}
            setPane={setPane}
            tagged={tagged}
            canReview={canReview}
            retagAction={retagAction}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Client and sources show here.</p>
        )}
      </aside>
    </div>
  );
}

function Context({
  slug,
  selected,
  pane,
  setPane,
  tagged,
  canReview,
  retagAction,
}: {
  slug: string;
  selected: InboxSelection;
  pane: "client" | "brain";
  setPane: (pane: "client" | "brain") => void;
  tagged: string;
  canReview: boolean;
  retagAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <Tabs value={pane} onValueChange={(value) => setPane(value === "client" ? "client" : "brain")}>
      <TabsList>
        <TabsTrigger value="client">Client info</TabsTrigger>
        <TabsTrigger value="brain">AI brain</TabsTrigger>
      </TabsList>
      <TabsContent value="client" className="flex flex-col gap-3 pt-3">
        {tagged ? <p className="text-sm text-muted-foreground">Updating AI knowledge… Draft refreshed for {tagLabel(tagged)}.</p> : null}
        <dl className="grid gap-2 text-sm">
          <div><dt className="text-muted-foreground">Phone</dt><dd>{selected.phone ?? "Not stored"}</dd></div>
          <div><dt className="text-muted-foreground">Email</dt><dd>{selected.email ?? "Not stored"}</dd></div>
          <div><dt className="text-muted-foreground">Address</dt><dd>{selected.address ?? "Not stored"}</dd></div>
          <div><dt className="text-muted-foreground">Channel</dt><dd>{channelAdapterLabel(selected.channel)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {INBOX_TAGS.map((tag) => (
            <form key={tag.id} action={retagAction}>
              <input type="hidden" name="id" value={selected.id} />
              <input type="hidden" name="tag" value={tag.id} />
              <Button type="submit" size="sm" variant={selected.tags.includes(tag.id) ? "default" : "outline"} disabled={!canReview || selected.decided}>
                {tag.label}
              </Button>
            </form>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="brain" className="flex flex-col gap-3 pt-3">
        <p className="text-sm whitespace-pre-wrap">{selected.why || "No reasoning stored for this draft yet. Regenerate to attach sources."}</p>
        <ul className="flex flex-col gap-2">
          {selected.sources.length === 0 ? (
            <li className="text-sm text-muted-foreground">No sources cited.</li>
          ) : (
            selected.sources.map((source) => (
              <li key={source.id}>
                <Link href={`/${slug}/knowledge/${source.id}`} className="text-sm underline-offset-4 hover:underline">
                  {source.title}
                </Link>
              </li>
            ))
          )}
        </ul>
        <p className="text-xs text-muted-foreground">J and K move the queue. E edits. A or Cmd+Enter approves. Sending stays off.</p>
      </TabsContent>
    </Tabs>
  );
}
