# Knowledge groups — seven groups plus an honest unclassified state

Status: implemented on `fix/knowledge-group-taxonomy` (stacked on the retrieval-policy branch). No
schema change, no migration, no row edited or deleted, no send path touched.

## Why this exists

The console filed every knowledge row into five groups: bookings, dietary, pricing, staffing,
complaints. `tone` was mapped into **staffing**, `playbooks` had no group at all, and any scope the
classifier did not recognise was silently relabelled **bookings**. On the live workspace that meant
the eight pending MyChef imports (master prompt, pricing reference, templates, tone, quick start,
operating policies, owner guidance, README) were presented as bookings material, which is both wrong
and the reason a reviewer could not tell tone guidance from staffing policy.

## The taxonomy

| Group id | Label | What belongs here |
|---|---|---|
| `bookings` | Bookings | reservations, cancellations, calendars, guest counts, availability |
| `dietary` | Dietary | allergies, vegan/halal, cross-contamination, substitutions |
| `pricing` | Pricing | rates, deposits, menus and their prices, invoicing, cost exceptions |
| `staffing` | Staffing | crew, shifts, rosters, hiring, who covers what |
| `complaints` | Complaints | angry or unhappy guests, refunds, apologies, escalation |
| `tone` | Tone | voice, wording, phrasing, formality |
| `playbooks` | Playbooks | procedures, checklists, quick-start, response templates and scripts |
| `unclassified` | Unclassified | a real state, not a bucket: nothing known matched |

`unclassified` is a reading filter only. It is deliberately **not** a member of `KNOWLEDGE_GROUPS`,
so the "add a position" form cannot file a new row there — a person must choose one of the seven.

## How a row is filed

1. The row's `scope` column is checked first, case- and whitespace-insensitively.
2. If the scope is unknown or blank, the title is checked in a fixed order: tone → playbooks →
   pricing → dietary → staffing → complaints → bookings.
3. If nothing matches, the row is `unclassified`. It is never defaulted into a group.

Filing is a **reading filter**. It does not set, imply or upgrade a row's status, approval, project
scope or retrieval eligibility. `tests/knowledge-groups.test.ts` pins this: a pending row that files
cleanly under pricing is still refused by `classifyCandidate` as `not_approved`, and an approved row
from `cooking-class-bali` is still refused as `other_project`.

## Files

- `src/lib/knowledge-groups.ts` — the seven groups, the filter list, scope map, title fallback.
- `src/data/mychef-store.ts` — `StoredKnowledge.group` is typed `KnowledgeGroupFilter`.
- `src/app/[workspace]/knowledge/page.tsx` — chips render the seven groups plus Unclassified.
- `tests/knowledge-groups.test.ts` — 11 tests, including the silent-default regression and the
  "filing never grants retrieval rights" contract.
- `tests/knowledge-group-row.test.ts` — 6 tests for the project boundary (another project's note is
  never filed as MyChef knowledge) and global/no-project rows.
- `scripts/verify-groups.ts` — read-only live report (`npm run verify:groups`).

## Live reading of the 14 existing rows (read-only, 2026-11-01)

`npm run verify:groups` against `mychef_inbox` as `mychef_runtime` reports: dietary 1 · playbooks 4 ·
pricing 2 · tone 1 · **unclassified 6** · quotable 0.

| Row | Project | Group |
|---|---|---|
| `01-00-MASTER_SYSTEM_PROMPT.md` | mychef | playbooks |
| `02-04-MENU_PRICING_REFERENCE.md` | mychef | pricing |
| `03-README.md` | mychef | playbooks |
| `04-02-RESPONSE_TEMPLATES.md` | mychef | playbooks |
| `05-01-VOICE_TONE_GUIDE.md` | mychef | tone |
| `06-05-QUICK_START_GUIDE.md` | mychef | playbooks |
| `07-03-BUSINESS_RULES_POLICIES.md` | mychef | **unclassified** |
| `Recent owner reply guidance and limits` | mychef | **unclassified** |
| 4 other-project context notes (bali-villa-books, cooking-class-bali, knowledge-platform, private-tutoring-bali) | other | **unclassified** |
| 2 retired situational cases | mychef | dietary / pricing (still refused: `candidate_source`) |

Two rows stay unclassified on purpose. `07-03-BUSINESS_RULES_POLICIES.md` is 21,656 characters and
covers bookings, dietary and pricing at once; filing it into one group would be false precision, so
it must be **split into focused positions** during curation (the assessment's import step), not
relabelled here. The owner-guidance note is a dated client-specific instruction and needs a human
decision on scope and effective date before it becomes anyone's general rule.

Every one of the 14 rows is still `quotable: false`, which is the point: a tidy group column must
never look like permission to quote.

## What is not done here

Renaming, merging or retagging the existing rows is a **human, approved** action in the knowledge
editor, not a side effect of this patch. Version history (`knowledge_revisions` is still empty) and
edit → test → publish belong to the next patch.
