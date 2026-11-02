# MyChef AI Operations Console — Master Roadmap

Strategic goal: a proprietary, self-improving AI that handles inquiries, learns MyChef nuance, later manages menus, then business intelligence.

Phase 1 and Phase 2 are in progress. Phase 3 has started as a menu catalog only. Phases 4 and 5 are not started. Sending stays off.

## Phase 1 — Core engine & inbox (current)

Goal: AI drafts → human reviews → human corrects → system can learn.

- Decision ledger, knowledge, workspace isolation
- 3-pane Inbox (queue, draft, why)
- Knowledge editor + embeddings when owner DDL allows
- GHL webhook in; send only on approve
- Feedback form (reason + why)

## Phase 2 — Learning flywheel & localization (current / next)

Goal: self-improving + international clients.

- Multi-language: detect (e.g. Indonesian), show English to reviewer, reply in client language
- Learning Queue + CBLS situational snippets
- Tag-scoped retrieval (VIP, Catering, Vegan, …)
- Auto-pilot Tier 1: confidence slider; default OFF until trusted

## Phase 3 — Menu Engine & sales playbooks (started)

The catalog is in the console at `/{workspace}/menus`. Rows are stored in the existing knowledge table with source `menu`, pending, and refused by draft retrieval. New tables wait on the Neon owner connection. Nothing is sent.

- **Started, without new tables.** Courses, dishes, allergens, and prices.
- **Started.** Menu builder on the Menus page.
- **Started as a catalog search.** Dish and allergen search on that page. It is not a tool the drafting agent may call.
- **Started, copy only.** Official confirmation, polite goodbye, and 3-day check-in.
- **Started.** WhatsApp-friendly plain text. The WhatsApp channel itself stays unbuilt.

## Phase 4 — Business intelligence & profitability (later — do not start)

- Analytics: volume, conversion, geo heatmaps
- Conversion pattern tags from closed deals
- Grocery costing / margin on dishes and events
- AI weekly insight box in plain English

## Phase 5 — Full autopilot & deep integration (later — do not start)

- Multi-turn WhatsApp/email automation
- Calendar availability + blocking
- PDF proposals + payment links (Stripe/GHL)

## Why this order

Brain and memory first (Phases 1–2). Menu and analytics only after the AI is trusted. Architecture today should leave hooks for channels, tags, and structured culinary data — without building those UIs yet.

See also: [Handoff](./handoff.md), [To-do](./todo.md), [CBLS](./cbls-architecture.md), [Inbox UX](./inbox-ux.md).
