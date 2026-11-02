# GitHub + Vercel deploy

Verified by QA on 2026-11-01 04:19Z against the live deployment.

| Fact | Value |
| --- | --- |
| GitHub | `ddandanell/chatsystem222`, branch `main` |
| Vercel project | `prj_AIYNRUT5LXDLRRoF2lasAgYeUGtH` (project name `chatsystem`) |
| Production domain | `https://console.mychef.id` — attached, `verified: true`, Vercel nameservers |
| Second alias | `https://chatsystem-sooty.vercel.app` (same project) |
| Git link on the project | `ddandanell/AICHATSYSTEM`, `sourceless: true` — **not** `chatsystem222` |
| Auto-deploy on push | **off** |

`numini-co/inbox-mychef`, `cursor/decision-ledger-console-d800` and `/cursor/stores/...` paths are stale. They do not exist for this project and must not be followed.

## Clone and run

```bash
git clone https://github.com/ddandanell/chatsystem222.git
cd chatsystem222
npm install
cp .env.example .env.local      # fill names, never commit the file
npm test                        # 76 tests
npm run typecheck               # next typegen && tsc --noEmit
npm run build
npm run dev
```

Node: `.nvmrc` pins 22; the QA box ran 24.22.1 with no issue. Neon role for `DATABASE_URL` and `KEY_READER_DATABASE_URL` is `mychef_runtime`, which cannot create schema objects — never run `db:setup` against Neon.

## Environment (Vercel, Production)

Names only; values live in the Vercel project and in the gitignored `.env.local`.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon `mychef` / schema `mychef_inbox`, role `mychef_runtime` |
| `KEY_READER_DATABASE_URL` | same database, reader role |
| `AUTH_SECRET` | session token signing |
| `BYOK_ENCRYPTION_KEY` | encrypts stored provider keys server-side |
| `CRON_SECRET` | bearer for `GET /api/cron/learn`; empty means the route refuses everything |
| `GHL_WEBHOOK_SECRET` | inbound webhook secret; empty means 503 for every event |
| `AUTH_URL` | `https://console.mychef.id` |

Optional: `GHL_WEBHOOK_REQUIRE_SIGNATURE=1` refuses the shared-secret mode and requires `x-ghl-signature`. Unset today, so a request with a valid `x-ghl-timestamp` within ±300s and the shared secret is accepted.

### `OPERATOR_BOOTSTRAP_PASSWORD` creates an owner; it never overwrites one

`ensureBootstrapOperator()` (`src/lib/operators.ts`) runs on auth calls. It **creates** `operator:bali@mychef.id` when that row does not exist, and returns untouched when it does — it never reads, verifies or writes a stored hash, never changes `role`, and never sets `enabled = true` on an existing row. The insert is `on conflict (workspace_id, id) do nothing`, so two concurrent boots cannot overwrite each other either.

Before 2026-11-01 it did the opposite: when the variable held at least 8 characters and did not match the stored scrypt hash, it rewrote `encrypted_secret`, set `enabled = true` and wrote `role: owner, approved: true`. One environment variable was then enough to reset the owner's password, re-enable a deliberately disabled owner and re-grant the owner role, from any unauthenticated request that reached an auth call. That path is gone; `tests/bootstrap-operator.test.ts` fails if an existing row is touched or an `update` returns to this function.

Keep the variable unset in production anyway: the row exists there, so the only password path is the reset flow (`/login/reset`). Operator passwords are scrypt hashes with no recovery path — a reset, not a lookup.

Related history worth keeping: with **zero** environment variables the project had no `DATABASE_URL`, so `usesMychefInbox()` was false and `/login` served the local demo branch — an email field, a Name field, demo buttons and no password input. Nobody could sign in. If `/login` ever lacks a password field again, check the env list before the database.

## Deploy

Auto-deploy is off. The project's git link points at `ddandanell/AICHATSYSTEM` with `sourceless: true`, and `PATCH /v9/projects` rejects both `link` and `gitRepository` (`400 should NOT have additional property`). **A merge to `main` therefore does not reach production.**

Until the link is repointed to `chatsystem222` in the Vercel dashboard, every release is an explicit deployment creation on the project with `gitSource` repo id `1441419404`, `ref: main`, `type: production`, then verification below. Two releases must not run concurrently.

## Verify after deploy

1. `curl -s -o /dev/null -w '%{http_code}' https://console.mychef.id/login` → `200`, and the body contains `name="password"`.
2. Owner sign-in succeeds and lands on `/mychef/inbox` with the real queue (113 conversations on 2026-11-01), not the Maya Chen / Jonah Hale demo list.
3. `/mychef/dashboard`, `/mychef/candidates` (nav label Learning), `/mychef/knowledge`, `/mychef/evals`, `/mychef/audit`, `/mychef/settings/keys`, `/mychef/settings/access`, `/mychef/settings/autopilot`, `/mychef/settings/webhooks`, `/mychef/team`, `/mychef/import` all return `200`.
4. `POST /api/webhooks/ghl` without `x-ghl-timestamp` refuses (401/503) and never returns `202`. A repeated delivery returns `duplicate: true` and creates no second draft.
5. A signed-in draft shown in the UI quotes only approved, in-project knowledge; with 0 approved rows it must say there is no source.

## Access protection

`ssoProtection` is `all_except_custom_domains`, so `console.mychef.id` is public and guarded only by an operator password. Bot QA signs in with a limited reviewer operator rather than SSO; turning on Vercel Authentication for production would break that path, so decide deliberately.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run typecheck`, `npm run build` on pushes to `main` and `cursor/**` and on every PR, with stub env values so module imports resolve. It does not deploy.

## Agent note

Branches are merged into `main` through PRs; nothing is force-pushed. `cursor/*` tips on the remote are historical and either contained in `main` or superseded. Older notes told agents to mirror an "Origin" remote first — that remote does not exist for this project.
