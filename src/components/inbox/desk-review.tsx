/**
 * Center + right panes: thread, sticky AI draft, Client | Why tabs.
 * Purpose: always-on suggestion; Approve = ledger only; edit→feedback→remember.
 * Mobile: list → detail → context sheet (never three columns).
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-design-system.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/contact-response-desk.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  BrainIcon,
  PanelRightIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  draftConversationAction,
  reviewConversationAction,
  updateTagsAction,
} from "@/app/[workspace]/inbox/mychef-actions";
import { AgentPanel } from "@/components/inbox/agent-panel";
import { CategoryBadge } from "@/components/inbox/category-badge";
import { DiffText } from "@/components/inbox/diff-text";
import { TimeStrip } from "@/components/inbox/time-strip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CategoryTagId } from "@/lib/contact-tags";
import { threadClockLabel, type ContactResponseMetrics } from "@/lib/contact-response";
import { channelLabel } from "@/lib/channels";
import { formatConfidence, formatWhen, initials } from "@/lib/format";
import { REASON_CODES } from "@/lib/reason-codes";
import { cn } from "cn";

export type DeskConversation = {
  id: string;
  contact_name: string | null;
  status: string;
  channel: string | null;
  tags: string[];
  categories: CategoryTagId[];
  facts: {
    phone?: string;
    email?: string;
    address?: string;
  };
  messages: { id: string; direction: string; body: string; created_at: Date | string }[];
  draft: {
    body: string;
    model: string | null;
    sources: { id: string; title: string; kind?: string }[];
    confidence: number | null;
    why: string;
    whyNot: string;
    escalate?: boolean;
  } | null;
};

function dayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function dayLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function sourceIsApproved(
  id: string,
  knowledgeStatus: Record<string, string>,
): boolean {
  return knowledgeStatus[id] === "approved";
}

type ContextTab = "client" | "why";

function ContextPanel({
  conversation,
  knowledgeTitles,
  knowledgeStatus,
  contextTab,
  setContextTab,
  editing,
  dirty,
  reasonCode,
  setReasonCode,
  rationale,
  setRationale,
  whyNot,
  setWhyNot,
  remember,
  setRemember,
  tagDraft,
  setTagDraft,
  pending,
  updatingTags,
  saveTags,
  sourceOpen,
  setSourceOpen,
  metrics,
}: {
  conversation: DeskConversation;
  metrics: ContactResponseMetrics;
  knowledgeTitles: Record<string, string>;
  knowledgeStatus: Record<string, string>;
  contextTab: ContextTab;
  setContextTab: (tab: ContextTab) => void;
  editing: boolean;
  dirty: boolean;
  reasonCode: string;
  setReasonCode: (code: string) => void;
  rationale: string;
  setRationale: (value: string) => void;
  whyNot: string;
  setWhyNot: (value: string) => void;
  remember: boolean;
  setRemember: (value: boolean) => void;
  tagDraft: string;
  setTagDraft: (value: string) => void;
  pending: boolean;
  updatingTags: boolean;
  saveTags: () => void;
  sourceOpen: string | null;
  setSourceOpen: (id: string | null | ((prev: string | null) => string | null)) => void;
}) {
  return (
    <Tabs
      value={contextTab}
      onValueChange={(value) => setContextTab(value === "why" ? "why" : "client")}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="border-b border-border px-4 py-3">
        <TabsList className="w-full">
          <TabsTrigger value="client" className="flex-1 gap-1.5">
            <UserRoundIcon className="size-3.5" />
            Client
          </TabsTrigger>
          <TabsTrigger value="why" className="flex-1 gap-1.5">
            <BrainIcon className="size-3.5" />
            Why
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="client"
        className="flex min-h-0 flex-1 flex-col overflow-hidden data-hidden:hidden"
      >
        {/* MC-181: the response clock lives with the client facts now, not above the thread. */}
        <TimeStrip metrics={metrics} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4">
            <dl className="flex flex-col gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd>{conversation.facts.phone || "—"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd>{conversation.facts.email || "—"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Address</dt>
                <dd className="whitespace-pre-wrap">{conversation.facts.address || "—"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Channel</dt>
                <dd>{channelLabel(conversation.channel)}</dd>
              </div>
            </dl>
            <Separator />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tags">Tags</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {conversation.categories.map((id) => (
                    <CategoryBadge key={id} id={id} />
                  ))}
                  {conversation.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                  {conversation.tags.length === 0 && conversation.categories.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No tags yet. Try Catering or Private Chef.
                    </span>
                  ) : null}
                </div>
                <FieldDescription>
                  Saving refreshes knowledge and regenerates the draft.
                </FieldDescription>
                <Input
                  id="tags"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  className="bg-background"
                  placeholder="Private Chef, Catering, VIP"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={saveTags}
                  className="w-fit"
                >
                  {updatingTags ? "Updating AI knowledge…" : "Save tags & re-draft"}
                </Button>
              </Field>
            </FieldGroup>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="why" className="min-h-0 flex-1 overflow-hidden data-hidden:hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4 text-sm">
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Sources used</h3>
              {(conversation.draft?.sources.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">No sources cited yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {conversation.draft?.sources.map((source) => {
                    const approved = sourceIsApproved(source.id, knowledgeStatus);
                    return (
                      <li key={source.id} className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="text-left text-sm underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                            onClick={() =>
                              setSourceOpen((prev) => (prev === source.id ? null : source.id))
                            }
                          >
                            {knowledgeTitles[source.id] ?? source.title}
                          </button>
                          {approved ? null : (
                            <Badge variant="outline" className="text-destructive">
                              {knowledgeStatus[source.id] ?? "unknown"} · not approved
                            </Badge>
                          )}
                        </span>
                        {sourceOpen === source.id ? (
                          <p className="mt-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                            Open Knowledge for the full rule. Id: {source.id}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {conversation.draft?.sources.some(
                (source) => !sourceIsApproved(source.id, knowledgeStatus),
              ) ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                  This draft is older than the approval gate. The sources marked
                  &ldquo;not approved&rdquo; are historical citations, not myCHEF policy. Do not
                  approve the reply on their authority.
                </p>
              ) : null}
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Reasoning</h3>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {conversation.draft?.why ||
                  "Draft a reply to see why the model chose this text."}
              </p>
              {conversation.draft?.whyNot ? (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  Why not copy a past reply: {conversation.draft.whyNot}
                </p>
              ) : null}
            </div>

            {editing || dirty ? (
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="font-medium">Suggest how it should be</h3>
                  <p className="text-xs text-muted-foreground">
                    Approve records your edit in the ledger. With Remember on, a pending
                    situational case is queued — curated rules stay untouched.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {REASON_CODES.filter((item) => item.code !== "good_as_drafted").map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setReasonCode(item.code)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        reasonCode === item.code
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background hover:bg-muted",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="rationale">Why this reply</FieldLabel>
                    <Textarea
                      id="rationale"
                      value={rationale}
                      onChange={(event) => setRationale(event.target.value)}
                      rows={3}
                      className="bg-background"
                      placeholder="What should we say next time?"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="why-not">Why not the AI draft</FieldLabel>
                    <Textarea
                      id="why-not"
                      value={whyNot}
                      onChange={(event) => setWhyNot(event.target.value)}
                      rows={2}
                      className="bg-background"
                      placeholder="What was wrong or missing?"
                    />
                  </Field>
                  <Field orientation="horizontal" className="items-center">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(checked) => setRemember(checked === true)}
                      id="remember"
                    />
                    <FieldLabel htmlFor="remember" className="font-normal">
                      Remember this for next time (pending situational case)
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Edit the draft or press E to open the correct → learn form.
              </p>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

export function DeskReview({
  slug,
  conversation,
  nextId,
  knowledgeTitles,
  knowledgeStatus,
  metrics,
  draftError: initialDraftError = null,
}: {
  slug: string;
  conversation: DeskConversation;
  nextId: string | null;
  knowledgeTitles: Record<string, string>;
  knowledgeStatus: Record<string, string>;
  metrics: ContactResponseMetrics;
  draftError?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftText, setDraftText] = useState(conversation.draft?.body ?? "");
  const [editing, setEditing] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>("client");
  const [contextOpen, setContextOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("good_as_drafted");
  const [rationale, setRationale] = useState("");
  const [whyNot, setWhyNot] = useState("");
  const [remember, setRemember] = useState(true);
  const [tagDraft, setTagDraft] = useState(conversation.tags.join(", "));
  const [updatingTags, setUpdatingTags] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(initialDraftError);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const dirty = useMemo(
    () => Boolean(conversation.draft && draftText.trim() !== conversation.draft.body.trim()),
    [conversation.draft, draftText],
  );

  function openContext(tab: ContextTab, opts?: { forceSheet?: boolean }) {
    setContextTab(tab);
    const mobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1279px)").matches;
    if (opts?.forceSheet || mobile) setContextOpen(true);
  }

  function goNext() {
    if (nextId) router.push(`/${slug}/inbox/${nextId}`);
    else router.push(`/${slug}/inbox`);
  }

  function submit(decision: "accepted" | "edited" | "escalated") {
    startTransition(async () => {
      setError(null);
      const form = new FormData();
      const human =
        decision === "accepted" && dirty
          ? "edited"
          : decision === "accepted"
            ? "accepted"
            : decision;
      form.set("human_decision", human);
      form.set("final_text", human === "escalated" ? conversation.draft?.body ?? "" : draftText);
      form.set(
        "reason_code",
        human === "accepted" ? "good_as_drafted" : reasonCode || "needs_human",
      );
      form.set(
        "rationale",
        human === "accepted"
          ? "Accepted the draft as written."
          : rationale.trim() ||
              (human === "escalated" ? "Escalated to a human." : "Edited before recording."),
      );
      form.set(
        "why_not",
        human === "accepted"
          ? "No alternative was needed."
          : whyNot.trim() ||
              (human === "escalated" ? "A person should take this." : "The draft needed a correction."),
      );
      if (remember && human === "edited") form.set("remember", "on");
      const result = await reviewConversationAction(conversation.id, null, form);
      if (result?.error) {
        setError(result.error);
        return;
      }
      goNext();
    });
  }

  function regenerate() {
    startTransition(async () => {
      setError(null);
      setDraftError(null);
      try {
        await draftConversationAction(conversation.id);
        router.refresh();
      } catch {
        setDraftError("Could not generate a draft. Try Regenerate.");
      }
    });
  }

  function saveTags() {
    startTransition(async () => {
      setUpdatingTags(true);
      setError(null);
      const tags = tagDraft
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await updateTagsAction(conversation.id, tags);
      setUpdatingTags(false);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  useEffect(() => {
    setDraftText(conversation.draft?.body ?? "");
    setEditing(false);
    setContextTab("client");
    setContextOpen(false);
    setReasonCode("good_as_drafted");
    setRationale("");
    setWhyNot("");
    setRemember(true);
    setTagDraft(conversation.tags.join(", "));
    setError(null);
    setDraftError(initialDraftError);
    setSourceOpen(null);
  }, [conversation.id, conversation.draft?.body, conversation.tags, initialDraftError]);

  // MC-181: a thread opens on the newest message, not on its oldest scroll position.
  useEffect(() => {
    const viewport = threadRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [conversation.id, conversation.messages.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit(dirty ? "edited" : "accepted");
        return;
      }
      if (typing) return;
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        submit(dirty ? "edited" : "accepted");
      }
      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        setEditing(true);
        openContext("why");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const messageGroups = useMemo(() => {
    const groups: { key: string; label: string; items: DeskConversation["messages"] }[] = [];
    for (const message of conversation.messages) {
      const key = dayKey(message.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(message);
      else groups.push({ key, label: dayLabel(message.created_at), items: [message] });
    }
    return groups;
  }, [conversation.messages]);

  const contextProps = {
    conversation,
    knowledgeTitles,
    knowledgeStatus,
    contextTab,
    setContextTab,
    editing,
    dirty,
    reasonCode,
    setReasonCode,
    rationale,
    setRationale,
    whyNot,
    setWhyNot,
    remember,
    setRemember,
    tagDraft,
    setTagDraft,
    pending,
    updatingTags,
    saveTags,
    sourceOpen,
    setSourceOpen,
    metrics,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-4 lg:px-6">
          <Avatar size="sm">
            <AvatarFallback>{initials(conversation.contact_name)}</AvatarFallback>
          </Avatar>
          <h2 className="text-sm font-medium">{conversation.contact_name ?? "Contact"}</h2>
          <Badge variant="outline">{conversation.status}</Badge>
          <Badge variant="secondary">{channelLabel(conversation.channel)}</Badge>
          {conversation.categories.map((id) => (
            <CategoryBadge key={id} id={id} />
          ))}
          <div className="ml-auto flex items-center gap-2">
            <AgentPanel
              conversationId={conversation.id}
              contactName={conversation.contact_name}
              channel={conversation.channel}
              messageCount={conversation.messages.length}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="xl:hidden"
              onClick={() => openContext(contextTab, { forceSheet: true })}
            >
              <PanelRightIcon data-icon="inline-start" />
              Context
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="lg:hidden"
              render={<Link href={`/${slug}/inbox`} />}
              nativeButton={false}
            >
              Queue
            </Button>
          </div>
        </header>

        {/* MC-181: one line of clock instead of a ~170px strip above the thread. */}
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground lg:px-6">
          <span
            data-slot="thread-clock"
            className="block truncate tabular-nums"
            title={metrics.waitingAbsolute}
          >
            {threadClockLabel(metrics)}
          </span>
        </div>

        <div
          ref={threadRef}
          data-slot="thread-scroll"
          className="min-h-[45%] flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 px-4 py-4 lg:px-6">
              {messageGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
              ) : (
                messageGroups.map((group) => (
                  <div key={group.key} className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                      <Separator className="flex-1" />
                      <span className="text-xs text-muted-foreground">{group.label}</span>
                      <Separator className="flex-1" />
                    </div>
                    {group.items.map((message) => {
                      const inbound = message.direction === "inbound";
                      return (
                        <div
                          key={message.id}
                          className={cn("flex", inbound ? "justify-start" : "justify-end")}
                        >
                          <div
                            className={cn(
                              "flex max-w-[92%] flex-col gap-1 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                              inbound
                                ? "bg-muted text-foreground"
                                : "border border-border bg-background",
                            )}
                          >
                            <span className="text-xs text-muted-foreground">
                              {inbound ? "Guest" : "myCHEF"} · {formatWhen(message.created_at)}
                            </span>
                            <p>{message.body}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="z-10 min-h-[10rem] shrink overflow-y-auto border-t border-border bg-background/95 p-4 backdrop-blur lg:p-6">
          <div className="flex flex-col gap-3">
            {conversation.draft ? (
              <Card
                className={cn(
                  "border-primary/20 ring-1 ring-primary/10",
                  editing || dirty ? "border-primary/40" : null,
                )}
              >
                <CardHeader className="border-b border-border/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <SparklesIcon className="size-4 text-muted-foreground" />
                      AI suggested reply
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      {conversation.draft.confidence != null ? (
                        <Badge variant="secondary">
                          {formatConfidence(conversation.draft.confidence)} confidence
                        </Badge>
                      ) : null}
                      {conversation.draft.escalate ? (
                        <Badge variant="outline">Escalate flagged</Badge>
                      ) : null}
                      {conversation.draft.sources[0] ? (
                        <Badge
                          variant="outline"
                          className={
                            sourceIsApproved(
                              conversation.draft.sources[0].id,
                              knowledgeStatus,
                            )
                              ? undefined
                              : "text-destructive"
                          }
                          title={
                            sourceIsApproved(
                              conversation.draft.sources[0].id,
                              knowledgeStatus,
                            )
                              ? "Approved source"
                              : "Historical citation. This source is not approved."
                          }
                        >
                          {knowledgeTitles[conversation.draft.sources[0].id] ??
                            conversation.draft.sources[0].title}
                          {sourceIsApproved(
                            conversation.draft.sources[0].id,
                            knowledgeStatus,
                          )
                            ? null
                            : " · unapproved"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={draftText}
                    onChange={(event) => {
                      setDraftText(event.target.value);
                      setEditing(true);
                      setContextTab("why");
                      if (event.target.value.trim() !== conversation.draft?.body.trim()) {
                        setReasonCode((prev) =>
                          prev === "good_as_drafted" ? "too_casual" : prev,
                        );
                      }
                    }}
                    onFocus={() => {
                      if (dirty || editing) setContextTab("why");
                    }}
                    rows={3}
                    className="max-h-40 min-h-20 overflow-y-auto bg-background"
                    aria-label="AI suggested reply"
                  />
                  {dirty ? (
                    <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Diff before record · correct → learn
                      </p>
                      <DiffText original={conversation.draft.body} edited={draftText} />
                    </div>
                  ) : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 bg-card">
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => submit(dirty ? "edited" : "accepted")}
                  >
                    {pending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <SendIcon data-icon="inline-start" />
                    )}
                    {dirty ? "Approve correction" : "Approve"}
                  </Button>
                  <Button type="button" variant="outline" disabled={pending} onClick={regenerate}>
                    <RefreshCwIcon data-icon="inline-start" />
                    Regenerate
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setReasonCode("needs_human");
                      setRationale("Escalated to a human.");
                      setWhyNot("A person should take this.");
                      submit("escalated");
                    }}
                  >
                    Escalate
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => openContext("why")}
                  >
                    <BrainIcon data-icon="inline-start" />
                    How it came to this
                  </Button>
                  <span className="self-center text-xs text-muted-foreground">
                    A approve · E edit · ⌘ Enter
                  </span>
                  <span
                    data-slot="composer-send-note"
                    className="flex w-full items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <AlertTriangleIcon className="size-3.5 shrink-0" />
                    Sending is not connected — Approve records the decision in the ledger only.
                  </span>
                </CardFooter>
              </Card>
            ) : (
              <Card className="border-primary/20 ring-1 ring-primary/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <SparklesIcon className="size-4 text-muted-foreground" />
                    AI suggested reply
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Alert variant={draftError ? "destructive" : "default"}>
                    <AlertTitle>{draftError ? "Draft failed" : "No draft yet"}</AlertTitle>
                    <AlertDescription>
                      {draftError ??
                        "Generate a suggestion so the reply stays on screen while you review."}
                    </AlertDescription>
                  </Alert>
                  <Button type="button" disabled={pending} onClick={regenerate} className="w-fit">
                    {pending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <RefreshCwIcon data-icon="inline-start" />
                    )}
                    Regenerate
                  </Button>
                </CardContent>
              </Card>
            )}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not record</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="hidden min-h-0 w-96 shrink-0 flex-col border-l border-border bg-muted/50 xl:flex">
        <ContextPanel {...contextProps} />
      </aside>

      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Context</SheetTitle>
            <SheetDescription>
              Client facts and why this draft — same AI Brain as the desktop right pane.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/50">
            <ContextPanel {...contextProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
