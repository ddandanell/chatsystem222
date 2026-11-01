# Inbox mychef

Review drafted client replies and record why a reply was right or wrong. The console is a decision ledger, a key vault, and a review queue. It is not a chat window.

**No auto-send.** Approving a draft writes the ledger. It does not message the guest. Auto-pilot defaults off. Phases 3–5 (menu engine, business intelligence, full autopilot) are not started.

Branch: `main`.

Canonical GitHub: [ddandanell/chatsystem222](https://github.com/ddandanell/chatsystem222). Deploy notes: [documentation/local-and-vercel.md](./documentation/local-and-vercel.md).

Product docs in this repo: [documentation/](./documentation/).

Neon schema in use: `mychef_inbox` on database `mychef`, role `mychef_runtime`. That role cannot create tables. Filter every query by `workspace_id`.

## How to run

```bash
git clone https://github.com/ddandanell/chatsystem222.git
cd chatsystem222
npm install
cp .env.example .env.local
# Put real values only in .env.local. Never commit that file.
npm run dev
```

Requires Node.js 20.9+ (`.nvmrc` → 22). The dev server listens on [http://127.0.0.1:4317](http://127.0.0.1:4317). Sign in at `/login`, then open `/mychef/dashboard`.

Mac clone and run steps, including `agent worker start`, are in [LOCAL.md](LOCAL.md).

Local Docker (optional, not Neon):

```bash
docker compose up -d
npm run db:setup
npm run dev
```

`npm run db:migrate` skips role creation when the current user cannot create roles. `npm run verify:rls` is for the local Harbor Kitchen and Northline seed. Do not point it at Neon.

## Env vars

Names only. Values stay in `.env.local` or in the Vercel project settings. Do not commit them.

Required for a Neon or Vercel run (see `.env.example`):

| Name | Used for |
|------|----------|
| `DATABASE_URL` | App Postgres connection. Neon uses `mychef_runtime`. |
| `KEY_READER_DATABASE_URL` | Read path for provider keys. |
| `AUTH_SECRET` | Auth.js session signing. 32 random bytes, base64. |
| `BYOK_ENCRYPTION_KEY` | AES-256-GCM master key for provider secrets. 32 bytes, base64. |
| `AUTH_URL` | Public app URL. Local default is `http://127.0.0.1:4317`. |
| `OPERATOR_BOOTSTRAP_EMAIL` | First approved operator. Default owner is `bali@mychef.id`. |
| `OPERATOR_BOOTSTRAP_PASSWORD` | Hashed with scrypt on first boot. Never log it. |

Optional:

| Name | Used for |
|------|----------|
| `CRON_SECRET` | Bearer token for `GET /api/cron/learn`. When empty, the route refuses the call. |
| `GHL_WEBHOOK_SECRET` | Shared secret for `POST /api/webhooks/ghl`. When empty the endpoint refuses every event (503); it used to accept anything. See [documentation/webhook-security.md](./documentation/webhook-security.md). |
| `MIGRATION_DATABASE_URL` | Local Docker migrations only. Do not point this at Neon. |

## Vercel

`vercel.json` sets framework Next.js, `npm ci` / `npm run build`, region `sin1`, and schedules `GET /api/cron/learn` daily at 02:00 Asia/Kuala_Lumpur (`0 18 * * *` UTC). The cron does not send a guest reply.

Set the required names above on the Vercel project, plus `CRON_SECRET` if the cron should run and `GHL_WEBHOOK_SECRET` if the webhook should require a shared secret. Set `AUTH_URL` to the deployment URL. Leave automatic sending off. Phases 3–5 are not part of this deploy.

Production branch `main`: the Vercel Git integration deploys every push to it ([documentation/local-and-vercel.md](./documentation/local-and-vercel.md)). GitHub Actions CI runs `npm test`, `npm run typecheck` and `npm run build`; it does not deploy. The console is currently served on the generated domain `https://inbox-mychef-gilt.vercel.app`; no custom domain is attached. `npm start` on a laptop still uses port 4317.

## Architecture

Start with the store handoff, then the repo summary in [docs/HANDOFF.md](docs/HANDOFF.md).

- Handoff: [documentation/handoff.md](./documentation/handoff.md)
- Roadmap (phases 1–2 only): [documentation/roadmap.md](./documentation/roadmap.md)
- Inbox UX: [documentation/inbox-ux.md](./documentation/inbox-ux.md)
- Learning queue / CBLS: [documentation/cbls-architecture.md](./documentation/cbls-architecture.md)
- Near-term steps: [documentation/todo.md](./documentation/todo.md)
- Knowledge retrieval policy: [documentation/retrieval-policy.md](./documentation/retrieval-policy.md)
- Webhook security: [documentation/webhook-security.md](./documentation/webhook-security.md)

Settings that are accepted on this branch:

- Provider keys: `/mychef/settings/keys` (`src/app/[workspace]/settings/keys`). Vercel AI Gateway and DeepSeek first. Hint only after save.
- Auto-pilot: `/mychef/settings/autopilot` (`src/app/[workspace]/settings/autopilot`). Switch default **off**. A candidate mark still does not send.

Each workspace is a tenant. Provider keys stay on the server, encrypted with AES-256-GCM. The browser only ever sees a four-character hint.

## Database

The console reads `DATABASE_URL` and `KEY_READER_DATABASE_URL`. Local Docker uses `inbox_app` and `inbox_key_reader`. The Neon project `mychef` is opened as `mychef_runtime`. That role cannot create schemas, tables, or extensions, and it does not own the existing tables, so the ledger is not copied into new `documents` or `chunks` tables. The console reads and writes `mychef_inbox` in place: knowledge, contacts, conversations, messages, drafts, feedback, decision records, audit log, and provider rows on `integration_connections`. Existing knowledge rows stay in `mychef_inbox.knowledge`. No source table is dropped. Put the Neon connection string only in `.env.local`. Do not commit it.

`npm run db:migrate` skips `002_roles.sql` when the current user cannot create roles. `npm run verify:rls` expects the local Harbor Kitchen and Northline Catering seed. Point it at Docker, not Neon.

On Neon, a signed-in session is the owner of the `mychef` workspace. The inbox is the conversations that still need a reply. Automatic sending is not on.

## Run locally

Postgres runs from Docker. The app role is not a superuser and does not own the tables, so row-level security applies.

```bash
docker compose up -d
cp .env.example .env.local
npm install
npm run db:setup
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

Seeded sessions on local Docker:

- Maya Chen (`maya@harbor-kitchen.example`) — owner of Harbor Kitchen. Two drafts are waiting. The reviewed tab is empty.
- Jonah Hale (`jonah@northline.example`) — owner of Northline Catering. The pending queue is empty. One edited reply is already reviewed.

When the console points at Neon, the same Maya account is the owner of myCHEF. Jonah has no membership there. The myCHEF inbox starts empty; the knowledge page lists the copied documents.

A new email creates a user and lands on workspace setup. Create a workspace to see an empty queue, or join a slug as a viewer. This fallback stores no password.

## Auth

Production auth is Clerk Organizations (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) with roles owner, admin, reviewer, and viewer. When those keys are absent, Auth.js credentials sign-in is the local fallback and still writes real user and organization ids.

Optional Google sign-in uses `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

The session resolves the workspace from the URL (`/[workspace]/...`). Client `x-tenant-*` headers are stripped and never trusted.

## Sign in

On the Neon inbox, sign-in is an approved operator email and password. The first owner is `bali@mychef.id`. Set `OPERATOR_BOOTSTRAP_PASSWORD` in `.env.local`. The server stores a scrypt hash on `integration_connections` and does not log the password. Other people are approved at `/mychef/settings/access`.

## Keys

Page: `/mychef/settings/keys`. Code: `src/app/[workspace]/settings/keys` and `src/components/key-manager.tsx`.

`BYOK_ENCRYPTION_KEY` is a 32-byte key, base64-encoded. `.env.example` leaves it empty. Generate it locally and store it only in `.env.local` or Vercel. The same value must stay stable or saved provider keys cannot be decrypted.

Vercel AI Gateway and DeepSeek are the first keys. Gateway defaults to `https://ai-gateway.vercel.sh/v1`. DeepSeek uses `https://api.deepseek.com`. A saved key is shown only as a four-character hint. Rows live on `mychef_inbox.integration_connections` (`kind = ai`, id = provider name). A connection test calls the provider from the server. If no active key is stored, the result is `No active key stored for this provider.` The test does not invent a completion. Azure OpenAI and Bedrock need an endpoint or signing setup this slice does not store, so those tests refuse to send the key. Storing or testing a key does not send a guest reply.

The home dashboard lists waiting reviews, acceptance rate, escalations, and model spend. Spend stays `$0` because this console does not meter a provider call. Drafts stay local until a key is stored, and storing a key still does not send a guest reply.

## Isolation check

```bash
npm run verify:rls
```

The check signs Maya and Jonah into their own workspaces, then reads `decision_records` and `chunks` with each org id set via `set_config('app.current_org_id', ..., true)`. A session scoped to one workspace cannot read the other's decision rows or chunks, including a lookup by the other workspace's id. Retrieval for a Harbor draft does not return Northline chunk ids, and the reverse. With no org id set, the app role sees nothing. The migration superuser can see both, which is how you know the rows exist. The same check tries to insert a chunk whose `org_id` and `document_id` belong to different workspaces. The composite foreign key rejects it.

## Retrieval

Positions and playbooks under `knowledge/` are ingested into `documents` and `chunks` once per seeded workspace, along with each workspace's own decision text. Embeddings are a local 256-dimension hash. No provider is called. On a decision, the page shows similar past decisions and matching knowledge from that workspace only. `documents` and `chunks` use the same forced row-level security policy as the ledger. A chunk can reference a document only when both rows share `org_id`.

## Inbox desk (myCHEF)

On Neon (`mychef_runtime`), `/mychef/inbox` is a full-height **three-pane operations desk** (see agent-store `docs/inbox-ux.md` and `docs/handoff.md`):

1. **Queue** — search; filters All / Needs Review / Auto-Sent / Escalated; cards with name, snippet, time, category badges (Private Chef / Catering / VIP), confidence dot.
2. **Workspace** — response clock (Started / Waiting / averages / Last activity), chat history, sticky AI suggested reply, Approve / Regenerate / Escalate / How it came to this. Approve writes the ledger only; **sending is not connected** (no GHL or WhatsApp send). Edit → Why tab → Remember queues a pending situational case.
3. **Context** — Client Info (phone/email/address/tags; saving tags regenerates the draft) and Why / AI Brain (sources, reasoning, correct→learn form). On mobile this is a sheet, not a third column.

Shortcuts: `J`/`K` queue, `A` approve, `E` edit, `⌘`/`Ctrl`+Enter submit. Mobile: list → detail → context sheet.

Channel kinds are reserved in `src/lib/channels.ts` (`ghl`, `whatsapp_business` planned, `manual`). WhatsApp Business is not built in this slice.

Local Docker Harbor/Northline tenants still use the older card queue and paste-to-draft flow.

## Draft copilot

On the pending inbox (local Docker), a reviewer pastes one client message. Inside that workspace’s row-level security scope, the server loads matching knowledge chunks and similar decisions, then writes a `decision_records` row with status `pending_review`. The row stores draft text, why, why not, confidence, source refs, and whether to escalate. Nothing is sent.

On myCHEF, drafts are created from the desk or the GHL receive stub against `mychef_inbox` knowledge. If no provider key is stored, the draft is deterministic: it quotes the closest position and says it was not produced by a provider. The draft path does not call a provider.

## Import

A signed-in reviewer uploads a ChatGPT project export (`.zip`, `.json`, or `.markdown`) at `/mychef/import`. The file is kept as a raw archive under `data/raw/mychef` for that workspace. That directory is local and is not committed. There is no bytea archive table in `mychef_inbox`, so the bytes are not written into knowledge or webhook receipts. Approving an archive inserts a new pending knowledge row with source `import:<id>`. Existing knowledge rows are not updated.

## GoHighLevel receive stub

`POST /api/webhooks/ghl` accepts a JSON message. If `GHL_WEBHOOK_SECRET` is set, the request must send the same value in `x-ghl-secret` or `Authorization: Bearer`. A message body creates or updates a conversation and a pending local draft. The route never calls a send API. A body that does not fit the inbox tables is written to `webhook_receipts` and listed at `/mychef/settings/webhooks`. Automatic sending stays off.

## Learning Queue (CBLS)

Saving an **Edited** (or learnable Reject) review in the inbox proposes a Learning Queue card with the AI draft, the human reply and the reason as evidence. **Run learning pass** and the nightly cron cluster any remaining unprocessed edits the same way. Knowledge-gap reasons become pending `learning-pass` rows; other reasons become pending `ledger-rule` rows. Cards group by Missing Knowledge, Tone, Outdated and Suggested. **Approve Snippet** stores the case as `situational` knowledge; **Dismiss** retires it. The curated library is never overwritten. Idempotency uses `audit_log` action `learn:processed` per decision (no DDL). `GET /api/cron/learn` requires `Authorization: Bearer` matching `CRON_SECRET` and runs daily at 02:00 Asia/Kuala_Lumpur (18:00 UTC). Nothing auto-activates and nothing is sent.

## What this slice does not do

No GoHighLevel send, no WhatsApp Business API, no MCP, no menu engine, no business-intelligence board, and no automatic send. The receive stub only stores an inbound message and a pending draft.
