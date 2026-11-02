# Run MyChef locally + on Vercel

The console is a Next.js app. GitHub's production branch is `main`. There is no separate deploy
branch. Vercel does not deploy a push by itself; see [deploy/github-vercel.md](./deploy/github-vercel.md).

## Manual local run

```bash
git clone https://github.com/ddandanell/chatsystem222.git
cd chatsystem222
npm install
cp .env.example .env.local
# Set: DATABASE_URL, KEY_READER_DATABASE_URL, AUTH_SECRET, BYOK_ENCRYPTION_KEY,
#      AUTH_URL, OPERATOR_BOOTSTRAP_EMAIL, OPERATOR_BOOTSTRAP_PASSWORD
npm run dev
```

Open http://127.0.0.1:4317/login — `bali@mychef.id` + the account's password.

Use the Neon `mychef` pooled connection string with role `mychef_runtime` (gitignored `.env.local`
only). That role is not the owner: it cannot create tables, extensions or policies.

Check the tree before trusting it:

```bash
npm test            # unit + contract tests, no database needed
npm run typecheck   # next typegen, then tsc --noEmit
npm run build
```

## Vercel

- Repository: <https://github.com/ddandanell/chatsystem222>, production branch `main`.
- `vercel.json` sets install/build commands, region `sin1`, and the daily Learning Queue cron
  (`/api/cron/learn`, 18:00 UTC, bearer `CRON_SECRET`).
- Environment variables: the names in `.env.example`. Set `AUTH_URL` to the deployment origin.
  Never commit values.
- A push to `main` does not deploy. Production is an explicit deployment of this repository
  onto `prj_AIYNRUT5LXDLRRoF2lasAgYeUGtH`. See [deploy/github-vercel.md](./deploy/github-vercel.md).

The live console is [https://console.mychef.id](https://console.mychef.id). The same deployment
answers on [https://chatsystem-sooty.vercel.app](https://chatsystem-sooty.vercel.app).
`https://inbox-mychef-gilt.vercel.app` is not this project.

## Do not

- Do not put secrets in git.
- Do not enable auto-send until a human chooses to.
- Do not run `db:setup` or the Docker migrations against Neon; they build a parallel schema over the
  preserved `mychef_inbox` tables.
