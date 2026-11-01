# MyChef handoff — read this first

If you are a new agent joining MyChef, start here, then open the linked docs.

## What this project is

A **Digital Sous Chef** operations console: draft replies to client messages, capture why a human accepted/edited/rejected, learn via situational case snippets, automate only later. Not a chatbot wrapper.

Mental model: LLM = reasoning, GHL (later WhatsApp) = channel adapters, MCP/tools = hands, durable assets = decision ledger + curated knowledge + evals.

## Where things live

| Path | Purpose |
|------|---------|
| `documentation/todo.md` | Near-term ordered steps |
| `documentation/roadmap.md` | Master phases 1–5 (3–5 not started) |
| `documentation/agent-spec.md` | DDL, RLS, reason codes, learning loop |
| `documentation/technical-blueprint.md` | Stack, BYOK, multi-tenant |
| `documentation/architecture.md` | Original four-store foundation |
| `documentation/inbox-ux.md` | 3-pane inbox UX |
| `documentation/contact-response-desk.md` | Contact open: timers, always-on AI draft, correct→learn |
| `documentation/inbox-design-system.md` | Strict shadcn three-pane desk contract + agent prompt |
| `documentation/cbls-architecture.md` | Case-Based Learning System |
| `documentation/learning-queue.md` | Learning Queue operator notes |
| `documentation/retrieval-policy.md` | What a draft may quote: approval gate and project scope |
| `documentation/webhook-security.md` | Inbound webhook authentication, replay window, idempotency |
| `documentation/isolation-evidence.md` | How to measure RLS/policy state; strict acceptance gate for step C |
| `documentation/knowledge-groups.md` | Seven groups plus an honest `unclassified` state; filing never grants retrieval |
| `documentation/local-and-vercel.md` | Local run and deploy notes |
| This file | Agent handoff |

## Code and branches

Canonical repository: <https://github.com/ddandanell/chatsystem222>, branch `main`. Feature work goes on a narrow branch, through a pull request, and lands on `main` only after `npm test`, `npm run typecheck` and `npm run build` pass. There is no separate deploy branch.

The old notes pointed at `numini-co/inbox-mychef`, `cursor/decision-ledger-console-d800` and Cursor store paths (`/cursor/stores/...`). All of those are stale and were removed; do not follow them. Remaining `cursor/*` branches on the remote are historical feature tips, merged into `main` or superseded.

Do not commit secrets. `.env.local` stays gitignored.

## Database (Neon mychef)

- Host pattern: `ep-bitter-fire-azf4encj` ap-southeast-1, database `mychef`.
- App role: `mychef_runtime` — **not** owner; cannot CREATE TABLE / CREATE EXTENSION. Schema changes need `mychef_owner` connection string from the user.
- Schema in use: `mychef_inbox` (not public).
- Important counts when last inventoried: 1 workspace (`mychef` / myCHEF), 12 knowledge, 782 contacts, 784 conversations (~115 needs_reply), 12343 messages, decision_records/feedback often empty until reviews happen.
- Console should filter by `workspace_id` for that workspace. Forced RLS from agent-spec could not be installed without owner rights.
- Connection string belongs only in gitignored `.env.local` (DATABASE_URL). Never commit it.
- Neon Auth URLs exist separately (auth + JWKS); those are not the Postgres URL.

## Hard product rules

1. Human review first; auto-send last and default OFF.
2. Do not dump raw chats into a vector DB as “knowledge.”
3. Do not let the model rewrite rules without human approval.
4. Provider keys: server-side encryption only; UI shows last-4 hint.
5. Channels are adapters (GHL now; WhatsApp Business later — design for pluggable inbound/outbound, do not build WhatsApp yet).
6. Run fully automatic between steps; stop only for missing secrets or destructive DB choices.
7. Approved console owner email: `bali@mychef.id` (password seeded hashed — never log plaintext).
8. Prefer Vercel AI Gateway and DeepSeek keys first among BYOK providers.

## Done so far (high level)

- Multi-tenant decision ledger prototype, then pivoted onto live Neon `mychef_inbox`.
- Inbox listing needs_reply, knowledge list, draft copilot (local drafter if no key), feedback → decision_records/feedback.
- Import page for ChatGPT exports (raw under gitignored `data/raw/mychef`; approve creates new pending knowledge, does not overwrite the imported rows).
- GHL webhook receive stub: creates conversation/message/draft, never sends. Authentication fails closed; see `documentation/webhook-security.md`.
- Retrieval is approval-gated and project-scoped on both the interactive and webhook paths; see `documentation/retrieval-policy.md`.
- Knowledge rows carry one of seven groups plus an honest `unclassified`; see `documentation/knowledge-groups.md`.
- Docs: todo, agent-spec, blueprint, inbox UX, CBLS, this handoff.

## Still blocked / next

1. Neon **owner** connection string → additive migrations and RLS. The runtime role cannot execute DDL.
2. Provider drafting with a real stored key (Gateway + DeepSeek first).
3. Real GHL send only after an explicit approve path and token. Sending is off.
4. WhatsApp adapter later (channel seam in `src/channels/inbound.ts`; `whatsappInboundReady = false`).
5. ChatGPT project bulk import curation (8 pending MyChef imports await a human approver).
6. Durable raw archive: `data/raw/mychef` is on the local filesystem and is not durable on Vercel.
7. Vercel project access for `prj_AIYNRUT5LXDLRRoF2lasAgYeUGtH` is unverified; no deploy step may assume it.

## Codebase comments for workers

Every non-trivial module should start with a short file header: purpose, tables touched, “do not auto-send”, and a link to the doc above. Prefer README sections: How to run, Env vars (names only), Architecture pointers to this handoff.

## How to resume in 5 minutes

1. Read this file, then `documentation/todo.md`.
2. Clone `https://github.com/ddandanell/chatsystem222` and check out `main`.
3. Confirm `.env.local` has DATABASE_URL (not in git).
4. `npm run dev` on port 4317; open `/login`.
5. Run `npm test`, `npm run typecheck` and `npm run build` before trusting any claim about the tree.
