# MyChef to-do

A Digital Sous Chef for private-chef work. It drafts replies, you say why a draft is right or wrong, and the knowledge stays in MyChef. Automatic sending comes last.

Each step is marked. The order of what is left is in [roadmap.md](./roadmap.md). A later phase does not start until Phase 1 and 2 are trustworthy.

## Now

The phase status lives in [roadmap.md](./roadmap.md) (marked 3 November 2026, Asia/Kuala_Lumpur). The console pages below are in the product. The remaining work is still Phase 1 and 2.

1. **Built.** Candidate rules, evals, outcomes, audit log, grouped knowledge, and the provider-key screen.
2. **Built.** The Neon database `mychef` is the store. Contacts, conversations, messages, areas, projects, and the original knowledge rows stay. Review tables sit around them.
3. **Built as a screen. Waiting on a key.** Paste Vercel AI Gateway and DeepSeek first, then OpenAI, Anthropic, Google, Azure, and Bedrock. The key never goes back to the browser. No key means a local draft, not a live model call.

## Already in the product

4. **Built.** Home dashboard. After login, show what needs you: pending reviews, acceptance rate, and escalations. Each number opens the list it counts. Model spend stays zero until a provider reports it.
5. **Built.** Inbox as a decision line. Desktop: queue, draft, and sources side by side. Mobile: one screen at a time. Approve, edit, reject, or escalate. “I don’t like the way this is written” opens why and why-not. That correction is saved. Sending stays off.
6. **Built.** Knowledge base grouped by private-chef work: bookings, dietary, pricing, staffing, complaints, tone, and playbooks, plus unclassified. Edit a draft, test it, then publish. Old versions stay.
7. **Built.** Learning queue. Corrections cluster into suggestions. You approve a new rule or dismiss it. Nothing becomes a live rule by itself. Approve files a situational snippet. The nightly cron and the manual pass both exist. Nothing is sent.
8. **Started.** Import the ChatGPT project knowledge into those groups, as raw archive first, then curated positions. The import screen exists. Curation still waits on a person. The existing knowledge rows stay.

## Later, when the loop works (still Phase 1–2)

9. **Half built.** GoHighLevel is the front door. A new message creates a pending draft. Approve does not send it yet. Delivery waits until that path is trusted.
10. **Built.** Nightly pass that turns the day’s edits into suggestions for the morning (`GET /api/cron/learn`).
11. **Started.** Dashboard trends: acceptance rate is on the dashboard. Edit distance and a reason-code breakdown are not.
12. **Not built.** Multi-language (e.g. Indonesian client, English reviewer view, reply in the guest’s language). This is the next Phase 2 product after a real key and a trusted approve path.
13. **Built, default off.** Auto-pilot only for high-confidence, low-risk answers, with a switch you can turn off. It can mark a candidate. It cannot deliver. Angry clients, VIPs, and unusual requests stay with a person.

## Phase 3+ — mapped only, do not build yet

See [Roadmap](./roadmap.md): Menu Engine & sales playbooks, BI & profitability, then full autopilot (WhatsApp multi-turn, calendar, PDF/payment). Design hooks only; no implementation until Phase 1–2 are trusted.

## Not the way we do it

- Do not dump every old chat into search and call that the knowledge base.
- Do not let the model rewrite rules on its own.
- Do not start fully automatic.
- Do not store API keys in the browser.
- Do not trust a workspace id sent by the browser. The database enforces the workspace.
- Clerk, Upstash, Langfuse, and a Vercel deploy wait until the console works on Neon.
