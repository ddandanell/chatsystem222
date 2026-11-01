# Inbox mychef — documentation

Project docs for the myCHEF operations console (decision ledger, inbox desk, knowledge, keys).

## Repository

- **GitHub (canonical):** [ddandanell/chatsystem222](https://github.com/ddandanell/chatsystem222), branch `main`. There is no deploy branch; every ship tip is merged into `main`.
- **Stale, do not follow:** `numini-co/inbox-mychef` and `cursor/decision-ledger-console-d800`. Verified absent on 2026-11-01.
- **Vercel project:** `prj_AIYNRUT5LXDLRRoF2lasAgYeUGtH` (`chatsystem`); production domain `https://console.mychef.id`; alias `https://chatsystem-sooty.vercel.app`.
- **Deploy:** [deploy/github-vercel.md](./deploy/github-vercel.md)
- **Never set `OPERATOR_BOOTSTRAP_PASSWORD` in the production project** — see the warning in the deploy doc.

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
| [cs001-turn-model.md](./cs001-turn-model.md) | A guest follow-up re-opens a decided thread (turn model) |
| [inbox-three-pane-shipped.md](./inbox-three-pane-shipped.md) | What Phase 1 desk already shipped |
| [cbls-architecture.md](./cbls-architecture.md) | Case-Based Learning |
| [learning-queue.md](./learning-queue.md) | Learning Queue operator notes |

## Architecture

| Doc | Purpose |
|-----|---------|
| [retrieval-policy.md](./retrieval-policy.md) | What a draft may quote: approval gate and project scope |
| [isolation-evidence.md](./isolation-evidence.md) | How to measure RLS/policy state; strict acceptance gate for step C |
| [knowledge-groups.md](./knowledge-groups.md) | Seven groups plus an honest `unclassified` state; filing never grants retrieval |
| [agent-spec.md](./agent-spec.md) | Schema, RLS, reason codes |
| [technical-blueprint.md](./technical-blueprint.md) | Stack, BYOK, multi-tenant |
| [architecture.md](./architecture.md) | Original four-store foundation |

## App README

How to run the app: see the root [README.md](../README.md).
