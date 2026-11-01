# Retrieval policy — what a draft may quote

Status: implemented and unit-tested (`src/lib/retrieval-policy.ts`, `tests/`). No migration needed.
Owner: MyChef Engineering. Review: MyChef Product & QA.

## Rule

A knowledge row may be quoted in a MyChef draft only when **all** of these hold:

1. it belongs to the workspace being served (`workspace_id = $1`, parameterised);
2. its `status` is exactly `approved`;
3. its `project_id` is the current project (`mychef`), or it is an approved global row
   (`project_id` null / `global` / `workspace`) and the policy allows global knowledge;
4. its `source` is not a candidate source (`ledger-rule`, `learning-pass`).

Anything else — pending, retired, unknown status, another project, another workspace, a candidate
rule — is refused. The refusal reason is counted and shown to the reviewer in plain language
(“12 awaiting approval, 2 candidate rules”), so an empty source panel always explains itself.

Project scope is decided **before** ranking. The project id is deliberately absent from the scoring
haystack: a document from another project can never outrank the right one, and scope is not a
similarity bonus.

## Where it lives

| Piece | File |
|---|---|
| Policy, classifier, ranker, SQL gate, exclusion counts | `src/lib/retrieval-policy.ts` |
| Draft path (`rankKnowledge`, `draftForConversation`) | `src/data/mychef-store.ts` |
| Unit tests (17) | `tests/retrieval-policy.test.ts`, `tests/knowledge-query.test.ts` |
| Live read-only proof | `npm run verify:retrieval` → `scripts/verify-retrieval-policy.ts` |

`draftForConversation` stores the policy version, the scope and the exclusion counts inside the
draft's `source_ids` payload, so a review decision can be traced to the rules that produced it.

## Consequences to keep in mind

- On 1 November 2026 the live workspace had **0 approved** knowledge rows (12 pending imports,
  2 retired learning rows). Drafts therefore quote nothing and say a person should answer, until the
  owner approves rows in the knowledge console. That is the intended safe state.
- The two hard-coded eval cases in `mychef-store.ts` now run against approved knowledge only, so they
  can no longer "pass" by quoting a pending import. Moving them to stored cases with approved
  fixtures is the next console-foundation step.
- Sending is unchanged: no approval, no send. Auto-send remains off.
