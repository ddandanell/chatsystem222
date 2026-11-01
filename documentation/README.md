# Inbox mychef — documentation

Project docs for the myCHEF operations console (decision ledger, inbox desk, knowledge, keys).

## Repository

- **GitHub (canonical):** [ddandanell/chatsystem222](https://github.com/ddandanell/chatsystem222), branch `main`.
- The old `numini-co/inbox-mychef` repository and the `cursor/decision-ledger-console-d800` branch are retired.
  They are not readable any more and must not be named as a ship tip.
- Work arrives on a `fix/…` branch, passes the gate, and merges to `main`; nothing ships from a Cursor store.
- **Tests:** `npm test` (node:test via tsx). **Typecheck:** `next typegen && npx tsc --noEmit`.
  **Lint:** `npm run lint`. **Build:** `npm run build`.
- **Deploy:** [deploy/github-vercel.md](./deploy/github-vercel.md)
- **State on 1 Nov 2026:** `main` = `b564f1972415f0ba7aa62d4777f25faebebeea95`; the console is **not deployed**.
  `mychef.id` is the marketing website, not this console.

## Start here

| Doc | Purpose |
|-----|---------|
| [roadmap.md](./roadmap.md) | Phase 1–5 product map (do not start Phase 3–5 early) |
| [todo.md](./todo.md) | Ordered build list |
| [handoff.md](./handoff.md) | Agent / engineer onboarding |
| [local-and-vercel.md](./local-and-vercel.md) | Local Mac + Vercel notes |
| [deploy/github-vercel.md](./deploy/github-vercel.md) | Clone from GitHub, link Vercel, env, CI |

## Product UX

| Doc | Purpose |
|-----|---------|
| [inbox-ux.md](./inbox-ux.md) | Three-pane inbox brief |
| [inbox-design-system.md](./inbox-design-system.md) | shadcn desk contract (layout, tokens, spacing) |
| [contact-response-desk.md](./contact-response-desk.md) | Timers, always-on AI draft, correct→learn |
| [inbox-three-pane-shipped.md](./inbox-three-pane-shipped.md) | What Phase 1 desk already shipped |
| [cbls-architecture.md](./cbls-architecture.md) | Case-Based Learning |
| [learning-queue.md](./learning-queue.md) | Learning Queue operator notes |

## Architecture

| Doc | Purpose |
|-----|---------|
| [agent-spec.md](./agent-spec.md) | Schema, RLS, reason codes |
| [technical-blueprint.md](./technical-blueprint.md) | Stack, BYOK, multi-tenant |
| [architecture.md](./architecture.md) | Original four-store foundation |

## App README

How to run the app: see the root [README.md](../README.md).
