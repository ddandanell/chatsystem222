## Turn model — a follow-up re-opens the thread (CS-001)

A **turn** is the newest inbound message in a conversation. A conversation is **decided** when a
`decision_records` row exists at or after that message; otherwise it is **open**. One definition,
one SQL predicate (`OPEN_TURN_DECISION_PREDICATE` in `src/lib/turn-state.ts`), used by every
conversation list, every count and every draft/review guard.

Why: `decided` used to mean "any decision ever", so reviewing a thread removed it from the queue
and every draft and review path refused it permanently — including after the guest wrote again.
That silently hid new work and is what CS-001 reported.

What follows from the definition:

- A guest follow-up makes the thread **open** again, so it returns to the queue and the composer,
  the AI draft and the Agent path work on the new message. Recording the new decision supersedes
  the old one; the earlier decision stays in the ledger, it is not edited or deleted.
- Recording a decision for a turn that is already decided is still refused, and the refusal now
  means exactly that: `This message was already decided. Nothing newer has arrived.`
- `reviewConversation` takes a `for update` lock on the conversation row inside its transaction and
  re-reads the turn before writing, so an inbound landing mid-review, or a second reviewer on the
  same turn, cannot produce two decisions for one message.
- `conversations.status` is deliberately **not** part of the definition. Status stays the coarse
  queue gate (`needs_reply`); the guards must not refuse a thread the desk is showing.
- The desk resolves a conversation id to its newest decision (`getLatestDecisionForConversation`)
  and only shows the "Already recorded" panel when that decision covers the newest message. Before
  this, a conversation id was cast to a uuid, threw, and the error was swallowed.

Not included: the "previously decided" strip on a re-opened thread, and writing `status` back after
a decision (needs the value decision D-CS001-a). Both are UI/bookkeeping follow-ups, not part of the
defect.
