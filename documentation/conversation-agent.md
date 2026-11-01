# Conversation agent — focused drafting from the desk

Status: implemented on branch `feat/conversation-agent`, stacked on `fix/mobile-qa-blockers`.
Not merged, not deployed. No schema change, no credential change, no send path.

## What it does

The operator opens a conversation and presses **Agent** at the top of the thread. The panel shows
exactly where the agent is focused — this client, this conversation, this project, this many
messages, approved knowledge only — takes an optional instruction ("keep it short and warm"), and
writes one reply into the same `mychef_inbox.drafts` row family the review gate already governs.
Approve / edit / escalate are unchanged, and nothing is sent.

## Where it is focused

`src/lib/agent-context.ts` builds the prompt:

- workspace, project, conversation id, client name, channel, status, tags, client facts;
- the last 20 messages **of this conversation only**, each capped at 2000 characters, labelled
  `<message from="guest">` so the model is told this is data, not instructions;
- approved knowledge only: the output of the shared retrieval gate
  (`rankKnowledgeFromDatabase`, approval-gated and project-scoped) is passed through a second
  filter, so pending, retired, candidate-source, foreign-project and other-workspace rows cannot
  reach the prompt even if a caller builds the context by hand;
- the operator instruction, capped at 600 characters, framed as a colleague's note.

## Provider path

`src/lib/agent-provider.ts` tries the stored BYOK key for **Vercel AI Gateway** first, then
**DeepSeek** (`PRIMARY_PROVIDERS`), 20 s ceiling per call, `response_format: json_object`. The key
is read server-side, sent only in an `Authorization` header, and redacted from any error string
before it can be shown or logged. A provider failure is a reason code (`no_key`, `timeout`,
`provider_error`, `empty`), never a stack trace and never a credential.

Models default to `deepseek/deepseek-chat` (gateway) and `deepseek-chat`; override with
`MYCHEF_AGENT_MODEL_GATEWAY` / `MYCHEF_AGENT_MODEL_DEEPSEEK`. The other four providers in
`PROVIDERS` are not wired into the chain yet: Azure and Bedrock also need an endpoint and request
signing, which this slice does not store.

## Always a reply

David's requirement is that pressing Agent always leaves text to work with. `runConversationAgent`
never returns an empty draft:

- provider answered with a usable `reply` → that text;
- provider returned prose, an empty reply, a timeout, an error, or there is no key → a local reply
  from `localAgentReply()`, which quotes one approved line when it has one and otherwise asks for
  the date, the guest count and the villa — and states no price, menu, date or availability;
- every fallback records `provider: "local"` and a notice that names the reason.

`confidence` is `null` on every agent draft. A model draft has no probability, and storing the
lexical score as one is what made "auto-send above 0.90" look defensible when it was not.

## Human review stays mandatory

- Angry, allergy/dietary, refund, complaint, legal, safety, press and VIP messages are detected
  deterministically (`sensitiveReasons`) and the draft is flagged even if the model says otherwise.
  The reply is still written; a person still decides.
- The agent cannot approve, publish a rule, or send. It writes `kind = 'ai'` drafts only.
- The panel and the draft card both say so: "The agent drafts; you approve. Nothing is sent."

## Provenance

Every agent draft stores, in `source_ids` and `prompt_version` (both JSON text/jsonb):

`promptVersion`, `provider`, `model`, `fellBack`, `notice`, `latencyMs`, `instruction`, the cited
sources, `why`, `whyNot`, `escalate`, and the retrieval block (`policyVersion`, workspace, project,
eligible count, exclusion summary). A reviewer can tell which rules and which provider produced
the text they are looking at.

## Verification

- `tests/conversation-agent.test.ts` — 26 tests, no database and no network: focus, isolation from
  other conversations, the second knowledge gate, prompt-injection framing, provider order, no-key,
  timeout, empty completion, redaction, JSON parsing, escalation, and the "always a reply" contract.
- `scripts/agent-smoke.ts` — writes and then removes one draft against the dev database, proving the
  insert and provenance columns end to end.
- `scripts/live-provider-probe.ts` — one real provider call against the stored key, no database
  write; prints provider, model, latency and whether the JSON parsed.

Full suite on this branch: 102 tests pass, `next typegen` + `tsc --noEmit` clean, `next build`
compiles, eslint clean on the added files.
