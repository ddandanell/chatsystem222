# MyChef AI Operations Console — Master Roadmap

Strategic goal: a proprietary, self-improving AI that handles inquiries, learns MyChef nuance, later manages menus, then business intelligence.

**Status, 3 November 2026 (Asia/Kuala_Lumpur).** Phase 1 and Phase 2 are the work we have been doing. Phase 3, 4, and 5 are mapped and have not been started. Do not start them until the remaining Phase 1 and 2 items below are trustworthy.

This status is the code on `main` in this repository. A merge does not update `https://console.mychef.id`. Production moves only on an explicit deploy. See [deploy/github-vercel.md](./deploy/github-vercel.md).

## Where we are

The console can draft, a person can correct, and the correction can become a learning suggestion. The desk is the three-pane inbox. Knowledge is grouped and retrieval stays on approved rows. GoHighLevel can open a conversation. Nothing is delivered from this console.

## Where we go next

Stay inside Phase 1 and 2, in this order:

1. Paste a real provider key (Vercel AI Gateway and DeepSeek first) so a draft is a model call. With no key, the desk keeps the local draft.
2. Keep delivery off. Approve writes the ledger. A GoHighLevel send waits until that approve path is trusted and a token exists.
3. Deploy the current `main` to `console.mychef.id` when that project is available. The menu regroup (History, and Settings as its own list) is a separate review and is not part of this status.
4. When the owner connection string is available: forced RLS, then a real embedding index. The runtime role cannot run that DDL.
5. Multi-language: detect the guest language (Indonesian first), show English to the reviewer, reply in the guest’s language.
6. Only after those are trusted: Phase 3.

## Phase 1 — Core engine & inbox (in progress)

Goal: AI drafts → human reviews → human corrects → system can learn.

- **Built.** Decision ledger. A review writes the decision and the feedback.
- **Built.** Knowledge editor, seven groups plus an honest unclassified state, and an approval gate on what a draft may quote.
- **Built in the app, blocked on the owner.** Workspace queries filter to the workspace. Forced row-level security still needs the Neon owner connection.
- **Built.** Three-pane inbox: queue, thread and draft, client and why. Approve, edit, reject, and escalate record the ledger.
- **Built as a local stand-in.** Embeddings used for ranking are hashed in the app. A database vector index waits on owner DDL.
- **Built.** GoHighLevel webhook receives a message and opens a draft. It does not send.
- **Not built.** Send on approve. Delivery stays disconnected on purpose.
- **Built.** Feedback form: reason, why, and why-not.

## Phase 2 — Learning flywheel & localization (in progress)

Goal: self-improving + international clients.

- **Not built.** Multi-language reviewer view. The drafter is told to reply in the guest’s language. There is no detect-and-translate review screen yet.
- **Built.** Learning Queue and situational snippets. Approve files a snippet. Dismiss retires it. The nightly pass is `GET /api/cron/learn`. Nothing becomes a live rule by itself.
- **Started.** Tag-scoped retrieval. Contact tags are passed as a hint when knowledge is ranked. VIP, Catering, and Vegan are not a finished scope product yet.
- **Built, default off.** Auto-pilot Tier 1 has a confidence switch. It can mark a candidate. It cannot deliver the reply.

## Phase 3 — Menu Engine & sales playbooks (not started)

- Tables: menus, menu_courses, dishes
- Menu builder UI (courses, allergens, prices)
- AI dish/menu search via tools
- Lifecycle playbook buttons: official confirmation, polite goodbye, 3-day check-in
- WhatsApp-friendly menu formatting

## Phase 4 — Business intelligence & profitability (not started)

- Analytics: volume, conversion, geo heatmaps
- Conversion pattern tags from closed deals
- Grocery costing / margin on dishes and events
- AI weekly insight box in plain English

## Phase 5 — Full autopilot & deep integration (not started)

- Multi-turn WhatsApp/email automation
- Calendar availability + blocking
- PDF proposals + payment links (Stripe/GHL)

## Why this order

Brain and memory first (Phases 1–2). Menu and analytics only after the AI is trusted. Architecture today should leave hooks for channels, tags, and structured culinary data — without building those UIs yet.

See also: [Handoff](./handoff.md), [To-do](./todo.md), [CBLS](./cbls-architecture.md), [Inbox UX](./inbox-ux.md).
