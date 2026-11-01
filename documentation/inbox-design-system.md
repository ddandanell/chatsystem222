# Inbox design system — stock SaaS desk

**Branch to implement:** `cursor/inbox-three-pane-ui` (stack contact timers on this desk)  
**Product brief:** [contact-response-desk.md](./contact-response-desk.md)  
**UX brief:** [inbox-ux.md](./inbox-ux.md)  
**Handoff:** [handoff.md](./handoff.md)

## Stack (non-negotiable)

| Layer | Choice |
|-------|--------|
| UI | **shadcn/ui** already in repo (`base-nova`, Tailwind v4, Lucide). Add missing primitives via CLI (`ScrollArea`, `Avatar`, `Sidebar` if needed) — do not invent one-offs. |
| Layout | Full-height **three-pane inbox** (Intercom / Front pattern). |
| Styling | Semantic tokens only (`bg-background`, `bg-muted/50`, `text-muted-foreground`, `border-border`). No random hex, no purple glow theme, no ad-hoc CSS files. |
| Icons | `lucide-react` only. |

Do **not** use raw instructional text as the page. Do **not** hand-roll list rows, tabs, or buttons when a shadcn component exists.

## Design System Prompt (agent must follow)

> You are a senior product designer. Refactor `/mychef/inbox` and `/mychef/inbox/[id]`. Do not use raw HTML chrome or plain text as layout. You must use shadcn/ui, Tailwind CSS, and Lucide React icons.
>
> 1. **Layout:** Full-height three-pane split. Left pane (`w-80`, `border-r`, `bg-muted/50`): searchable scrollable conversation list. Center pane (`flex-1`, `bg-background`): chat thread with date dividers and message bubbles. Right pane (`w-96`, `border-l`, `bg-muted/50`): contact context + AI details. Mobile: list → detail → context sheet — never three columns on small screens.
> 2. **Visual hierarchy:** Left/right muted; center background. AI suggestion card uses `border-primary/20` and a quiet ring (`ring-1 ring-primary/10`) — no neon glow. Sticky action footer under the draft.
> 3. **Components:** Prefer `ScrollArea`, `Avatar`, `Badge`, `Tabs`, `Textarea`, `Card`, `Button`, `Separator`, `Input`, `Select`, `Alert`, `Field`/`FieldGroup`. Interactive elements need hover + focus-visible rings from the design system.
> 4. **Typography & space:** Message bodies `text-sm`; timestamps `text-xs text-muted-foreground`. **8-point spacing grid** (`gap-2` / `gap-4` / `p-4` / `p-6`). No `space-y-*`; use `flex flex-col gap-*`.
> 5. **Behavior:** Always show an AI suggestion card when a conversation is open. Top strip shows Started, Waiting, Your avg reply, Guest avg reply (see contact-response-desk.md). “How it came to this” opens AI Brain. Edit → feedback → remember writes pending situational knowledge. **Sending is not connected** — Approve records the ledger only.
> 6. **Data:** Neon `mychef_inbox` only; no DDL; filter `workspace_id = 'mychef'`.

## Global shell (same console)

Keep existing workspace header / `ConsoleNav` unless you add a shadcn `Sidebar` without breaking other routes. Routes remain: Dashboard, Inbox, Knowledge, Keys, Access, Settings, Candidates, …

## Pane contracts

### Left — Queue (`w-80`)

- Filter tabs: Needs Review | Escalated | Auto-Sent | All (map to existing statuses / reason marks).
- Search input.
- Scrollable cards: name, one-line snippet, relative timestamp, status `Badge`, optional confidence dot.
- Active row: muted background + left accent border.

### Center — Workbench (`flex-1`)

- **Time strip** (Started / Waiting / Your avg / Guest avg) — Card or bordered strip, not free text.
- Message history with bubbles (guest vs staff), date dividers.
- Sticky **AI Draft** card: header with confidence `Badge`, `Textarea` body, footer actions Approve | Regenerate | Escalate | How it came to this.
- Banner: sending not connected / autopilot off as `Alert`.

### Right — Context (`w-96`)

- `Tabs`: **Client** | **Why** (AI Brain).
- Client: identity, channel, tags; tag change re-drafts.
- Why: sources list, reasoning, feedback form (reason codes + why + remember).

## Colour: one theme

There is one theme. No `.dark` block, no `@custom-variant dark`, no `dark:` utility. Tokens live in
`:root`; the contrast baseline is pinned by `tests/no-dark-mode.test.ts`. See
[one-theme.md](./one-theme.md).

## Acceptance

- Open `/mychef/inbox` and `/mychef/inbox/[id]`: looks like a stock ops desk, not a markdown checklist.
- Every open thread shows time metrics + AI draft card without hunting.
- Components are from `src/components/ui/*` (+ newly added shadcn primitives).
- Push branch; leave a Try Live URL; no auto-send; no Phase 3–5 scope creep.
