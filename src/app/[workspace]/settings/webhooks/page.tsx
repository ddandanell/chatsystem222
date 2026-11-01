/**
 * Lists webhook_receipts. Does not send. Do not auto-send.
 */
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { appPool } from "@/db/client";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";

export const metadata = { title: "Webhooks" };
export const instant = false;

type Receipt = {
  event_key: string;
  received_at: Date;
  detail: string | null;
  fit: string | null;
  draft_created: string | null;
  conversation_id: string | null;
  excerpt: string | null;
  verified: string | null;
};

function receivedLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

export default async function WebhooksPage({
  params,
}: PageProps<"/[workspace]/settings/webhooks">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;

  const receipts = usesMychefInbox() ? await listReceipts() : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Webhook receipts</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          GoHighLevel is the channel adapter in use. A matching message becomes a conversation and a pending draft. WhatsApp Business can use the same inbound shape later. It is not connected. Nothing on this page sends a reply.
        </p>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {process.env.GHL_WEBHOOK_SECRET?.trim()
            ? "A shared secret is set. Requests must send it in x-ghl-secret or Authorization: Bearer."
            : "No shared secret is set, so every event is refused with 503. Set GHL_WEBHOOK_SECRET before connecting the sender. Only a local run with MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS=1 accepts unverified events."}
        </p>
      </div>
      {!usesMychefInbox() ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Receipts live on the myCHEF inbox</EmptyTitle>
            <EmptyDescription>
              This database is the local ledger. Webhook receipts are written when the console is pointed at mychef_inbox.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : receipts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No receipts yet</EmptyTitle>
            <EmptyDescription>
              POST /api/webhooks/ghl stores a receipt when a message arrives, or when the payload does not fit the inbox tables.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {receipts.map((receipt) => (
            <li key={receipt.event_key} className="flex flex-col gap-2 rounded-xl border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm">{receipt.event_key}</p>
                <Badge variant={receipt.fit === "true" ? "secondary" : "outline"}>
                  {receipt.fit === "true" ? "Fit" : "Logged"}
                </Badge>
                <Badge variant="outline">{receipt.verified === "true" ? "Verified" : "Unverified"}</Badge>
                {receipt.draft_created === "true" ? <Badge>Draft pending</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{receivedLabel(receipt.received_at)}</p>
              {receipt.detail ? <p className="text-sm">{receipt.detail}</p> : null}
              {receipt.excerpt ? (
                <p className="text-sm text-muted-foreground">{receipt.excerpt}</p>
              ) : null}
              {receipt.conversation_id ? (
                <p className="text-sm text-muted-foreground">Conversation {receipt.conversation_id}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function listReceipts(): Promise<Receipt[]> {
  const result = await appPool.query<Receipt>(
    `select event_key,
            received_at,
            payload->>'detail' as detail,
            payload->>'fit' as fit,
            payload->>'draftCreated' as draft_created,
            payload->>'conversationId' as conversation_id,
            left(coalesce(payload->>'excerpt', ''), 160) as excerpt,
            payload->>'verified' as verified
     from mychef_inbox.webhook_receipts
     where workspace_id = 'mychef'
     order by received_at desc
     limit 50`,
  );
  return result.rows;
}
