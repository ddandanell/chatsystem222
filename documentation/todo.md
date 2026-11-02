# MyChef to-do

A Digital Sous Chef for private-chef work. It drafts replies, you say why a draft is right or wrong, and the knowledge stays in MyChef. Automatic sending comes last.

We do these in order. A later step does not start until the one above it is usable.

## Now

1. Finish the console already in progress: candidate rules, evals, outcomes, audit log, grouped knowledge, and provider keys.
2. Keep the Neon database `mychef`. Do not throw away contacts, conversations, messages, areas, projects, or the 12 knowledge rows. Add the review tables around them.
3. Keys you can paste while logged in: Vercel AI Gateway and DeepSeek first, then OpenAI, Anthropic, Google, Azure, and Bedrock. The key never goes back to the browser. No key means a local draft, not a live model call.

## Next, in order

4. Home dashboard. After login, show what needs you: pending reviews, acceptance rate, escalations, and today’s model spend. Each number opens the list it counts.
5. Inbox as a decision line, not a chat app. Desktop: queue, draft, and sources side by side. Mobile: one screen at a time. Approve, edit, reject, or escalate. “I don’t like the way this is written” opens why and why-not. That correction is saved.
6. Knowledge base grouped by private-chef work: bookings, dietary, pricing, staffing, complaints, tone, and playbooks. Edit a draft, test it, then publish. Old versions stay.
7. Learning queue. Corrections cluster into suggestions. You approve a new rule or dismiss it. Nothing becomes a live rule by itself. **Done on `cursor/learning-queue-cbls`** (Approve → situational; cron + manual; no auto-send).
8. Import the ChatGPT project knowledge into those groups, as raw archive first, then curated positions. The existing 12 knowledge rows stay.

## Later, when the loop works (still Phase 1–2)

9. GoHighLevel as the front door. A new message creates a pending draft. Approve sends it. No send until you approve.
10. Nightly pass that turns the day’s edits into suggestions for the morning.
11. Dashboard trends: how often you accept a draft, how much you edit it, and which reason codes show up.
12. Multi-language (e.g. Indonesian client ↔ English reviewer view).
13. Auto-pilot only for high-confidence, low-risk answers, with a switch you can turn off. Angry clients, VIPs, and unusual requests stay with a person.

## Phase 3+ — mapped only, do not build yet

See [Roadmap](./roadmap.md). Phase 3 has started as the Menus page: courses, allergens, prices, copy-only playbooks, and WhatsApp-formatted text. It does not send, and drafts cannot quote it. Business intelligence and full autopilot stay unstarted.

## Not the way we do it

- Do not dump every old chat into search and call that the knowledge base.
- Do not let the model rewrite rules on its own.
- Do not start fully automatic.
- Do not store API keys in the browser.
- Do not trust a workspace id sent by the browser. The database enforces the workspace.
- Clerk, Upstash, Langfuse, and a Vercel deploy wait until the console works on Neon.
