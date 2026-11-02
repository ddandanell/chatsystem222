/**
 * A decided conversation, read as history: the whole thread stays on screen,
 * and the recorded verdict sits under it. Opening History must not replace
 * the messages with a single inbound card.
 * Do not auto-send.
 */
import Link from "next/link";
import { outcomeAction } from "@/app/[workspace]/inbox/mychef-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { formatWhen } from "@/lib/format";
import { OUTCOMES, decisionLabel, reasonLabel } from "@/lib/reason-codes";
import { cn } from "cn";

type HistoryMessage = {
  id: string;
  direction: string;
  body: string;
  created_at: Date | string;
};

export type RecordedVerdict = {
  id: string;
  human_decision: string;
  reason_code: string;
  rationale: string;
  edited_draft: string;
  contact_name: string | null;
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

export function ThreadHistory({
  slug,
  contactName,
  messages,
  messageCount,
  recorded,
}: {
  slug: string;
  contactName: string | null;
  messages: HistoryMessage[];
  messageCount?: number;
  recorded: RecordedVerdict;
}) {
  const groups: { key: string; label: string; items: HistoryMessage[] }[] = [];
  for (const message of messages) {
    const key = dayKey(message.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(message);
    else groups.push({ key, label: dayLabel(message.created_at), items: [message] });
  }
  const action = outcomeAction.bind(null, recorded.id);
  const name = contactName ?? recorded.contact_name ?? "Contact";

  return (
    <div data-slot="thread-history" className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 lg:px-6">
        <h2 className="text-sm font-medium">{name}</h2>
        <Badge variant="secondary">History</Badge>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 px-4 py-4 lg:px-6">
            {messageCount != null && messageCount > messages.length ? (
              <p className="text-xs text-muted-foreground">
                Latest {messages.length} of {messageCount} messages.
              </p>
            ) : null}
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
            ) : (
              groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">{group.label}</span>
                    <Separator className="flex-1" />
                  </div>
                  {group.items.map((message) => {
                    const inbound = message.direction === "inbound";
                    return (
                      <div key={message.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
                        <div
                          className={cn(
                            "flex max-w-[92%] flex-col gap-1 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                            inbound ? "bg-muted text-foreground" : "border border-border bg-background",
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
      <div className="shrink-0 border-t border-border bg-muted/40 p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recorded decision</CardTitle>
            <CardDescription>The thread above is the history. This verdict does not send.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge>
                {decisionLabel(recorded.human_decision === "approved" ? "accepted" : recorded.human_decision)}
              </Badge>
              <Badge variant="outline">{reasonLabel(recorded.reason_code)}</Badge>
            </div>
            <p className="text-sm whitespace-pre-wrap">{recorded.edited_draft}</p>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{recorded.rationale}</p>
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
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" className="w-fit">
                  Save outcome
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  render={<Link href={`/${slug}/inbox?filter=decided`} />}
                  nativeButton={false}
                >
                  Back to history
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
