# Decision confirmation — name the object before an irreversible verdict (B3)

A decision is append-only. `reviewConversation` refuses a decided turn, there is no undo, and no
delete path exists for `decision_records` anywhere in `src/`. Until an undo exists, the protection
against recording a verdict on the wrong person — a stale tab, a row that moved, a shared screen —
is that the operator must **name the person** and the server must check that name.

## Where it lives

`src/lib/decision-confirmation.ts` — one target, one comparison, one refusal sentence, used by the
desk to render the prompt and by the store to enforce it, so the two can never drift.

| Function | Purpose |
|---|---|
| `decisionTarget({ contactName, conversationId })` | The name to confirm. Contact name, whitespace collapsed; an unnamed contact becomes `unnamed contact <last 6 of id>` so the prompt is never empty. |
| `confirmationMatches(typed, target)` | Case- and spacing-insensitive equality. An empty answer never matches. |
| `confirmationPrompt(target)` | The sentence the desk shows, naming the object and stating that it cannot be undone. |
| `CONFIRMATION_REFUSAL` | The refusal the store returns; says the object must be named and nothing was recorded. |

## The gate

1. **Desk** (`src/components/inbox/desk-review.tsx`): Approve, Escalate, `A` and `⌘/Ctrl+Enter` all
   open a confirmation sheet that names the person and asks for the name to be typed. The record
   button stays disabled until the typed name matches.
2. **Action** (`reviewConversationAction`): a submit without `confirm_object=on` is refused before
   any store call. This is what stops a bare POST or a replayed form.
3. **Store** (`reviewConversation`): compares `confirmName` against the conversation's own name and
   returns `CONFIRMATION_REFUSAL` when it does not match — before the transaction opens, so a
   refusal writes nothing.

Nothing here sends anything. The confirmation is a ledger-quality gate, not a channel step.

## Tests

`tests/decision-confirmation.test.ts` — helper behaviour (tidying, unnamed fallback, case/space
insensitivity, empty-never-matches) and the real store: missing name refused with zero writes, wrong
name refused with zero writes, correct name records exactly one decision and one feedback row, every
write still binds the workspace first.

`tests/viewer-write-paths.test.ts` — the existing positive control now carries the confirmation
fields, and a new case proves a verdict without them never reaches a write entry point.

## Not covered

The legacy Docker-only `FeedbackForm` path (`/mychef/inbox/[id]` when `usesMychefInbox()` is false)
is unchanged. In Neon mode that route renders the desk, so production always goes through the gate
above; the legacy two-column review is a local-tenant path with no contact row loaded to name.
