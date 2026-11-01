# MyChef handoff — read this first

If you are a new agent joining Inbox mychef / MyChef, start here. Then open the linked docs and `notes.md`.

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
| `documentation/learning-queue.md` | Learning Queue operator notes (shipped) |
| `documentation/retrieval-policy.md` | What a draft may quote: approval gate and project scope |
| `documentation/isolation-evidence.md` | How isolation is measured; strict gate for RLS work |
| `documentation/knowledge-groups.md` | Seven knowledge groups plus `unclassified` |
| This file | Agent handoff |

The old `/cursor/stores/bc-5928a827-…` paths are gone. If a document or code comment still points there,
treat the link as dead and use the table above.

## Code and branches

- Canonical repo: `ddandanell/chatsystem222`, branch `main`. One mainline; no Cursor worker checkouts.
- Local run: `npm ci`, then `npm run dev` (port 4317).
- Change path: `fix/…` branch → `npm test` → `next typegen && npx tsc --noEmit` → `npm run build` → PR → merge on the head SHA.
- `npm run lint` currently fails on `main` with three pre-existing `react-hooks/set-state-in-effect` errors
  (two in `inbox-cockpit.tsx`, one in `desk-review.tsx`). That is release-gate debt, not a new regression.
- Do not commit secrets. The app role is `mychef_runtime`; schema changes need a human with owner credentials.


## Database (Neon mychef)

- Host pattern: `ep-bitter-fire-azf4encj` ap-southeast-1, database `mychef`.
- App role: `mychef_runtime` — **not** owner; cannot CREATE TABLE / CREATE EXTENSION. Schema changes need `mychef_owner` connection string from the user.
- Schema in use: `mychef_inbox` (not public).
- Counts on 1 Nov 2026 (read-only, role `mychef_runtime`): 1 workspace (`mychef`), 5 projects (`mychef` plus four
  foreign projects), 5 areas, 784 contacts, 786 conversations (114 in the needs-review queue), 12,353 messages,
  14 knowledge rows (12 pending, 2 retired, **0 approved**), 0 knowledge revisions, 4 drafts, 2 decision records,
  2 feedback, 9 audit rows, 0 api_usage rows.
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
- Inbox listing needs_reply, knowledge list (12 rows), draft copilot (local drafter if no key), feedback → decision_records/feedback.
- Import page for ChatGPT exports (raw under gitignored `data/raw/mychef`; approve creates new pending knowledge, does not overwrite 12).
- GHL webhook receive stub: creates conversation/message/draft, never sends.
- **Learning Queue (CBLS) shipped on `cursor/learning-queue-cbls`:** typed queue (Missing Knowledge / Tone / Outdated / Suggested), AI vs human evidence diff, Approve → `situational` knowledge / Dismiss → retired, idempotent nightly cron + manual pass (`learn:processed` audit, no DDL), curated 12 untouched, no auto-send. See README Learning Queue section and `internal/learning-queue-cbls.md`.
- Docs: todo, agent-spec, blueprint, inbox UX, CBLS, this handoff.

## Still blocked / next

1. Neon **owner** connection string → create ledger/pgvector tables if still needed; install RLS.
2. ~~Finish 3-pane inbox per inbox-ux.md.~~ Shipped on `cursor/inbox-three-pane-ui` (Phase 1 desk only; see `docs/inbox-three-pane-shipped.md`). Phase 3–5 deferred.
3. ~~Welcome login + keys UI~~ — shipped on `cursor/welcome-login-keys` (scrypt operators, BYOK keys, autopilot OFF). See `internal/welcome-login-keys-ship.md`.
4. Wire real provider draft when key stored.
5. Real GHL send only after explicit approve path + token.
6. WhatsApp adapter later (channel seam in `src/channels/inbound.ts`; `whatsappInboundReady = false`).
7. ChatGPT project bulk import curation.
8. Tag-scoped retrieval / auto-pilot acceptance gate (after Learning Queue is in daily use).

## Codebase comments for workers

Every non-trivial module should start with a short file header: purpose, tables touched, “do not auto-send”, and link to the doc above. Prefer README sections: How to run, Env vars (names only), Architecture pointers to this handoff.

## How to resume in 5 minutes

1. Read this file, `todo.md`, `roadmap.md`, then `README.md` in this folder.
2. `git clone https://github.com/ddandanell/chatsystem222`, `git checkout main`, `npm ci`.
3. Confirm `.env.local` has DATABASE_URL (not in git) and AUTH_SECRET.
4. `npm run dev`; open `http://127.0.0.1:4317/login` and sign in as an approved operator.
5. Continue the highest open item in `todo.md`; keep auto-send off.
