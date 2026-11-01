/**
 * Self-service password recovery for console operators.
 *
 * Storage lives in the operator row's existing `config` jsonb — mychef_runtime cannot create
 * schema objects, and waiting on an owner-run migration would couple a security fix to a separate
 * release. Nothing here creates tables, and nothing here touches a row that is not an operator.
 *
 * What is stored: sha256(token) and three timestamps. What is never stored, logged or returned:
 * the token itself after it has been mailed.
 *
 * The send is transactional and triggered by a person at the keyboard. No marketing, no list, no
 * background job. Autopilot is untouched by this module.
 */
import "server-only";
import { appPool } from "@/db/client";
import {
  MAX_ADDRESS_REQUESTS,
  MAX_IDENTIFIER_REQUESTS,
  RESET_TTL_MS,
  buildResetLink,
  checkPassword,
  classifyReset,
  generateResetToken,
  hashAddressKey,
  hashResetToken,
  isValidResetTokenShape,
  nextAttemptState,
  normalizeBaseUrl,
  pruneAddressWindow,
  readResetState,
  resetExpiry,
  resetIssuedAt,
} from "@/lib/password-reset";
import { hashPassword } from "@/lib/operators";

const WORKSPACE = "mychef";
const NYLAS_US_HOST = "https://api.us.nylas.com";
const SEND_TIMEOUT_MS = 8000;

export type TransportState = "configured" | "unconfigured";

/** Whether a mail transport exists at all. Read from env only; never logged as a value. */
export function resetTransport(): TransportState {
  const key = process.env.NYLAS_API_KEY;
  const grant = process.env.NYLAS_GRANT_ID;
  return key && grant ? "configured" : "unconfigured";
}

function resetSender(): string {
  return (process.env.NYLAS_FROM_EMAIL || "bali@private-chef-in-bali.online").trim();
}

/**
 * Per-address cap on reset requests.
 *
 * Deliberately in memory: there is nowhere durable to put it without DDL, and an unknown address
 * has no operator row to write to. It is therefore per server instance and best-effort, which is
 * stated in the PR body rather than hidden. The per-identifier cap is durable, in jsonb, and that
 * is the control that actually holds; this one is abuse friction only.
 *
 * The map is keyed by a hash of the address, never by the address itself, and the key is never
 * logged. Bounded by pruneAddressWindow: expired entries first, then oldest-first eviction.
 */
const addressWindow = new Map<string, { attempts: number; windowStart: string }>();
const ADDRESS_WINDOW_MAX_KEYS = 500;

function addressAllowed(address: string, now: number): boolean {
  if (!address || address === "unknown") return true;
  pruneAddressWindow(addressWindow, now, ADDRESS_WINDOW_MAX_KEYS);
  const key = hashAddressKey(address);
  const next = nextAttemptState(addressWindow.get(key), now, MAX_ADDRESS_REQUESTS);
  addressWindow.set(key, { attempts: next.attempts, windowStart: next.windowStart });
  return next.allowed;
}

/** Test seam: the in-memory cap must not leak between tests. */
export function resetAddressWindow() {
  addressWindow.clear();
}

type RecoveryRow = {
  id: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
};

export type ResetRequest = {
  /** Whether a token was issued. Never sent to the client. */
  issued: boolean;
  /** Present only when a token was issued and a link could be built. */
  to?: string;
  link?: string;
  /** Why nothing was sent, for the server log. Never returned to the caller. */
  reason:
    | "issued"
    | "unconfigured"
    | "no_account"
    | "disabled"
    | "no_recovery_address"
    | "rate_limited"
    | "address_limited"
    | "no_base_url"
    | "error";
};

function emailId(email: string) {
  return `operator:${email.trim().toLowerCase()}`;
}

function recoveryAddress(config: Record<string, unknown> | null): string {
  const value = config?.recovery_email;
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

/**
 * Mint and store a reset token for one operator.
 *
 * One live token per operator: storing the new hash overwrites the old one, so an earlier link
 * stops working the moment a new one is requested.
 */
export async function requestReset(input: {
  email: string;
  address?: string;
  baseUrl?: string | null;
  now?: number;
}): Promise<ResetRequest> {
  const now = input.now ?? Date.now();
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { issued: false, reason: "no_account" };
  if (!addressAllowed(input.address ?? "unknown", now)) {
    return { issued: false, reason: "address_limited" };
  }
  if (resetTransport() === "unconfigured") {
    return { issued: false, reason: "unconfigured" };
  }

  const result = await appPool.query<RecoveryRow>(
    `select id, enabled, config
       from mychef_inbox.integration_connections
      where workspace_id = $1 and id = $2 and kind = 'ai'`,
    [WORKSPACE, emailId(email)],
  );
  const row = result.rows[0];
  if (!row) return { issued: false, reason: "no_account" };
  if (!row.enabled || (row.config ?? {}).purpose !== "operator") {
    return { issued: false, reason: "disabled" };
  }

  // Count the attempt before deciding, so a burst cannot slip past the cap by racing.
  const attempt = nextAttemptState(
    { attempts: row.config?.reset_attempts, windowStart: row.config?.reset_window_start },
    now,
    MAX_IDENTIFIER_REQUESTS,
  );
  await appPool.query(
    `update mychef_inbox.integration_connections
        set config = config || jsonb_build_object(
              'reset_attempts', $3::int,
              'reset_window_start', $4::text),
            updated_at = now()
      where workspace_id = $1 and id = $2`,
    [WORKSPACE, row.id, attempt.attempts, attempt.windowStart],
  );
  if (!attempt.allowed) return { issued: false, reason: "rate_limited" };

  const to = recoveryAddress(row.config);
  if (!to) return { issued: false, reason: "no_recovery_address" };

  const base = normalizeBaseUrl(input.baseUrl ?? process.env.AUTH_URL);
  const { token, hash } = generateResetToken();
  const link = buildResetLink(base, token);
  if (!link) return { issued: false, reason: "no_base_url" };

  // The token is written only when it can actually be delivered.
  const stored = await appPool.query(
    `update mychef_inbox.integration_connections
        set config = config || jsonb_build_object(
              'reset_hash', $3::text,
              'reset_issued_at', $4::text,
              'reset_expires_at', $5::text,
              'reset_used_at', null),
            updated_at = now()
      where workspace_id = $1 and id = $2 and enabled = true
      returning id`,
    [WORKSPACE, row.id, hash, resetIssuedAt(now), resetExpiry(now)],
  );
  if (stored.rowCount !== 1) return { issued: false, reason: "error" };

  return { issued: true, to, link, reason: "issued" };
}

export type ResetVerdictForPage = "valid" | "missing" | "expired" | "used";

/** Does this token open the reset page at all? Read-only; the POST decides for real. */
export async function inspectResetToken(token: unknown): Promise<ResetVerdictForPage> {
  if (!isValidResetTokenShape(token)) return "missing";
  const result = await appPool.query<{ config: Record<string, unknown> | null; enabled: boolean }>(
    `select config, enabled
       from mychef_inbox.integration_connections
      where workspace_id = $1 and kind = 'ai' and config->>'reset_hash' = $2`,
    [WORKSPACE, hashResetToken(token)],
  );
  const row = result.rows[0];
  if (!row || !row.enabled) return "missing";
  return classifyReset(readResetState(row.config));
}

export type ResetResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "expired" | "used" | "too_short" | "too_obvious" | "uses_account" | "blank" | "too_long" };

/**
 * Spend the token and set the new password.
 *
 * The update carries the hash and the expiry in its WHERE clause, so two racing submissions can
 * only ever produce one winner: the second finds no row because the first cleared the hash.
 */
export async function completeReset(input: {
  token: unknown;
  password: unknown;
  now?: number;
}): Promise<ResetResult> {
  const now = input.now ?? Date.now();
  if (!isValidResetTokenShape(input.token)) return { ok: false, code: "invalid" };
  const hash = hashResetToken(input.token);

  const found = await appPool.query<{
    id: string;
    enabled: boolean;
    config: Record<string, unknown> | null;
  }>(
    `select id, enabled, config
       from mychef_inbox.integration_connections
      where workspace_id = $1 and kind = 'ai' and config->>'reset_hash' = $2`,
    [WORKSPACE, hash],
  );
  const row = found.rows[0];
  if (!row || !row.enabled) return { ok: false, code: "invalid" };

  const verdict = classifyReset(readResetState(row.config), now);
  if (verdict === "used") return { ok: false, code: "used" };
  if (verdict === "expired") return { ok: false, code: "expired" };
  if (verdict !== "valid") return { ok: false, code: "invalid" };

  const accountEmail =
    typeof row.config?.email === "string" ? row.config.email : row.id.replace(/^operator:/, "");
  const policy = checkPassword(input.password, accountEmail);
  if (!policy.ok) return { ok: false, code: policy.code };

  const newHash = await hashPassword(String(input.password).trim());
  const spent = await appPool.query(
    `update mychef_inbox.integration_connections
        set encrypted_secret = $3,
            config = (config - 'reset_hash' - 'reset_issued_at' - 'reset_expires_at')
                     || jsonb_build_object(
                          'reset_used_at', $4::text,
                          'reset_count', coalesce((config->>'reset_count')::int, 0) + 1),
            updated_at = now()
      where workspace_id = $1 and id = $2
        and enabled = true
        and config->>'reset_hash' = $5
        and (config->>'reset_expires_at') is not null
        and (config->>'reset_expires_at')::timestamptz > now()
      returning id`,
    [WORKSPACE, row.id, newHash, new Date(now).toISOString(), hash],
  );
  if (spent.rowCount !== 1) return { ok: false, code: "expired" };

  // Audit row: the action and who, never the token and never the hash.
  //
  // The completion row carries the operator email, not "self-service" (ruling, 2026-11-01): the
  // request row is the anonymous one and carries self-service, but by the time the token is spent
  // the row that names which account was reset is known, and that is what an audit reader needs.
  await appPool.query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, 'operator.password.reset', $3)`,
    [WORKSPACE, accountEmail, row.id],
  );

  return { ok: true };
}

/**
 * Send the link through Nylas v3 (US host).
 *
 * Fail closed and quiet: a missing key, a missing grant, a timeout or a non-2xx all end here
 * without throwing upward, because the caller must answer the same thing either way. Nothing
 * about the message is logged — no recipient, no link, no token.
 */
export async function deliverResetMail(input: {
  to: string;
  link: string;
  email: string;
}): Promise<"sent" | "unconfigured" | "failed"> {
  const key = process.env.NYLAS_API_KEY;
  const grant = process.env.NYLAS_GRANT_ID;
  if (!key || !grant) {
    console.warn("reset_transport=unconfigured");
    return "unconfigured";
  }

  const minutes = Math.round(RESET_TTL_MS / 60000);
  const body = [
    "MyChef — console password reset",
    "",
    `A reset was requested for the MyChef console account ${input.email}.`,
    "",
    `Open this link to choose a new password. It expires in ${minutes} minutes and works once:`,
    "",
    input.link,
    "",
    "If you did not ask for this, ignore this email. Nothing has changed and your current password still works.",
    "",
    "Messages sent from this address are transactional only.",
  ].join("\n");

  try {
    const response = await fetch(
      `${NYLAS_US_HOST}/v3/grants/${encodeURIComponent(grant)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: [{ email: input.to }],
          from: resetSender(),
          subject: "Reset your MyChef console password",
          body,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      // Status only: the body can echo the recipient.
      console.error(`reset_transport=failed status=${response.status}`);
      return "failed";
    }
    console.info("reset_transport=sent");
    return "sent";
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`reset_transport=failed reason=${name}`);
    return "failed";
  }
}
