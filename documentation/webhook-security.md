# Inbound webhook security and idempotency

Endpoint: `POST /api/webhooks/ghl`. It writes `contacts`, `conversations`, `messages`, `drafts` and
`webhook_receipts` in schema `mychef_inbox`. It never sends anything.

Code: `src/lib/webhook-auth.ts` (authentication), `src/lib/ghl-inbound.ts` (payload → rows),
`src/app/api/webhooks/ghl/route.ts` (HTTP shape). Tests: `tests/webhook-auth.test.ts`,
`tests/ghl-inbound.test.ts`.

## The two defects this fixes

1. **The endpoint failed open.** `authorizeGhl` returned `{ ok: true, verified: false }` whenever
   `GHL_WEBHOOK_SECRET` was unset, so a missing environment variable turned a write endpoint into a
   public one.
2. **Replay protection was optional.** The freshness check ran only when `x-ghl-timestamp` was
   present, so a captured request could be replayed forever by deleting the header. Only a static
   secret was compared; no signature over the body existed.

## What is accepted now

| Condition | Result |
|---|---|
| `GHL_WEBHOOK_SECRET` blank/absent | **503**. Misconfiguration, not authentication. `MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS=1` overrides this in a non-production process only. |
| `x-ghl-timestamp` absent, empty or non-numeric | **401**. Always required, in both modes. |
| timestamp outside ±300 s | **401**. |
| `x-ghl-signature` present and valid | **200**, mode `signature`, HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, header form `sha256=<hex>`. |
| `x-ghl-signature` present and invalid | **401**. Never falls back to the shared secret. |
| `GHL_WEBHOOK_REQUIRE_SIGNATURE=1` and no signature | **401**. Turns the shared-secret mode off for this deployment. |
| `x-ghl-secret` or `Authorization: Bearer` equals the secret (constant-time) | **200**, mode `shared-secret`. |
| anything else | **401**. |

The acceptance mode is chosen by server configuration, never by the sender: a sender cannot downgrade
a signature-required endpoint by omitting the signature.

Secrets are never echoed in a response, a log line or a receipt. The only values returned are
`verified` (boolean) and `verification` (the mode name).

## Why a timestamp is mandatory even in shared-secret mode

A static shared secret has no per-request proof. The timestamp at least bounds the window in which a
captured request is accepted. Within that window, a replay is turned into a no-op by idempotency
below rather than by authentication.

## Idempotency

The event key is `ghl:<messageId>` (hashed and prefixed when the id is not URL-safe). One inbound
message id produces:

- one `messages` row (`on conflict (workspace_id, id) do nothing`), and
- one `drafts` row, written only when that message insert actually inserted.

A repeat of the same delivery returns HTTP 200 with `"duplicate": true`, `"draftCreated": false`, and
writes a receipt under the same `event_key`. It does not create a second draft and does not re-run
retrieval.

## Failure behaviour

A database failure after authentication:

- writes a receipt under `ghl:error-<sha256(rawBody)[0:32]>`, so retries collapse onto one row
  instead of appending a row per attempt (the previous key embedded `Date.now()`),
- returns **500** with `{ ok: false, retryable: true }`.

Returning 202 on failure would tell GHL the event had been accepted when nothing had been stored.
A genuine schema mismatch therefore repeats the 500; that is the honest signal and the receipt holds
the reason. If the receipt write itself fails, the response is still 500.

## What GHL (or a proxy) must send

```
x-ghl-timestamp: 1793521800            # epoch seconds or milliseconds, ±300 s
x-ghl-signature: sha256=<hex>          # HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
```

`signWebhookBody(secret, timestamp, rawBody)` in `src/lib/webhook-auth.ts` produces that header, and
`signatureBase()` is exported so an adapter and its tests cannot disagree about the signed string.

## Limitations, stated plainly

- No nonce/seen-signature store: idempotency is per message id, not per request. A replayed request
  with a *different* message id inside the window would be treated as a new event.
- `MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS` exists for local development only; it is ignored when
  `NODE_ENV=production`.
- The endpoint still cannot send. Sending is not connected and stays behind human approval.

## How this was verified

`npm test` — 71 tests, 0 failures, including: no secret → 503; blank secret → 503; local opt-in
ignored in production; missing timestamp → 401 with the right secret; stale/future timestamp → 401;
valid signature accepted with no shared-secret header; tampered body → 401; signature without raw
body → 401; signature-required mode refuses a secret-only request; replay of one event produces one
draft and one receipt key; a failure receipt key is derived from the body.

`npm run typecheck` (Next typegen + `tsc --noEmit`) is clean on a fresh checkout, and `npm run build`
compiles. No database was written and no provider was called by the tests.
