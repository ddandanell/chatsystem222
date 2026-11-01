/**
 * Operator accounts. scrypt hash on integration_connections. Never log the password. Do not auto-send.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { appPool } from "@/db/client";
import { usesMychefInbox } from "@/db/mode";
import { operatorRole, type Role } from "@/lib/roles";

const scrypt = promisify(scryptCallback);
const WORKSPACE = "mychef";

/**
 * The same set as a workspace role, including viewer.
 *
 * "viewer" is a member: an operator row may say viewer and it must stay viewer. It used to fall
 * through a three-value allowlist into reviewer, which can draft and record decisions.
 */
export type OperatorRole = Role;

export type Operator = {
  email: string;
  name: string;
  role: OperatorRole;
  approved: boolean;
  /** The row's own switch, kept separate from `approved` so the directory can tell the two apart. */
  enabled: boolean;
};

type OperatorConfig = {
  purpose?: string;
  email?: string;
  name?: string;
  role?: string;
  approved?: boolean;
};

function operatorId(email: string) {
  return `operator:${email.trim().toLowerCase()}`;
}

function asRole(value: string | undefined): OperatorRole {
  // Unrecognised jsonb resolves to viewer (read-only), never to reviewer (can write).
  return operatorRole(value);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function toOperator(id: string, config: OperatorConfig | null, enabled: boolean): Operator | null {
  if (config?.purpose !== "operator") return null;
  const email = (config.email || id.replace(/^operator:/, "")).trim().toLowerCase();
  if (!email.includes("@")) return null;
  return {
    email,
    name: config.name?.trim() || email,
    role: asRole(config.role),
    approved: enabled && config.approved !== false,
    enabled,
  };
}

let bootstrapReady = false;

export async function ensureBootstrapOperator() {
  if (!usesMychefInbox()) return;
  if (bootstrapReady) return;
  const email = (process.env.OPERATOR_BOOTSTRAP_EMAIL || "bali@mychef.id").trim().toLowerCase();
  const password = process.env.OPERATOR_BOOTSTRAP_PASSWORD ?? "";
  if (!email.includes("@") || password.length < 8) return;
  const id = operatorId(email);
  const existing = await appPool.query<{ encrypted_secret: string }>(
    `select encrypted_secret from mychef_inbox.integration_connections
     where workspace_id = $1 and id = $2`,
    [WORKSPACE, id],
  );
  const stored = existing.rows[0]?.encrypted_secret ?? "";
  // Skip when the stored scrypt hash already matches the bootstrap password.
  if (stored.startsWith("scrypt$") && stored.split("$").length === 3) {
    if (await verifyPassword(password, stored)) {
      bootstrapReady = true;
      return;
    }
  }
  const hash = await hashPassword(password);
  const name = email === "bali@mychef.id" ? "Bali" : email;
  await appPool.query(
    `insert into mychef_inbox.integration_connections as existing_operator
       (workspace_id, id, kind, label, encrypted_secret, config, enabled, updated_at)
     values ($1, $2, 'ai', $3, $4, $5::jsonb, true, now())
     on conflict (workspace_id, id) do update
       set encrypted_secret = excluded.encrypted_secret,
           -- Merge, never replace: the row also holds recovery_email and the reset-token fields,
           -- and a wholesale config write would silently delete them.
           config = existing_operator.config || excluded.config,
           enabled = true,
           updated_at = now()`,
    [
      WORKSPACE,
      id,
      name,
      hash,
      JSON.stringify({ purpose: "operator", email, name, role: "owner", approved: true }),
    ],
  );
  bootstrapReady = true;
}

export async function verifyOperator(email: string, password: string): Promise<Operator | null> {
  if (!usesMychefInbox()) return null;
  await ensureBootstrapOperator();
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@") || !password) return null;
  const result = await appPool.query<{
    id: string;
    encrypted_secret: string;
    config: OperatorConfig | null;
    enabled: boolean;
  }>(
    `select id, encrypted_secret, config, enabled
     from mychef_inbox.integration_connections
     where workspace_id = $1 and id = $2 and kind = 'ai'`,
    [WORKSPACE, operatorId(normalized)],
  );
  const row = result.rows[0];
  const operator = row ? toOperator(row.id, row.config, row.enabled) : null;
  if (!row || !operator?.approved) return null;
  const matches = await verifyPassword(password, row.encrypted_secret);
  if (!matches) return null;
  return operator;
}

export async function findOperator(email: string): Promise<Operator | null> {
  if (!usesMychefInbox()) return null;
  await ensureBootstrapOperator();
  const normalized = email.trim().toLowerCase();
  const result = await appPool.query<{
    id: string;
    config: OperatorConfig | null;
    enabled: boolean;
  }>(
    `select id, config, enabled
     from mychef_inbox.integration_connections
     where workspace_id = $1 and id = $2`,
    [WORKSPACE, operatorId(normalized)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toOperator(row.id, row.config, row.enabled);
}

export async function listOperators(): Promise<Operator[]> {
  if (!usesMychefInbox()) return [];
  await ensureBootstrapOperator();
  const result = await appPool.query<{
    id: string;
    config: OperatorConfig | null;
    enabled: boolean;
  }>(
    `select id, config, enabled
     from mychef_inbox.integration_connections
     where workspace_id = $1 and id like 'operator:%' and kind = 'ai'
     order by id`,
    [WORKSPACE],
  );
  return result.rows
    .map((row) => toOperator(row.id, row.config, row.enabled))
    .filter((row): row is Operator => Boolean(row));
}

export async function saveOperator(input: {
  email: string;
  name: string;
  password?: string;
  role: OperatorRole;
  approved: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: "Enter a valid email." };
  }
  const id = operatorId(email);
  const existing = await appPool.query<{ encrypted_secret: string; config: OperatorConfig | null }>(
    `select encrypted_secret, config
     from mychef_inbox.integration_connections
     where workspace_id = $1 and id = $2`,
    [WORKSPACE, id],
  );
  const password = input.password?.trim() ?? "";
  let hash = existing.rows[0]?.encrypted_secret ?? "";
  if (password) {
    if (password.length < 8) return { ok: false as const, error: "Use at least 8 characters." };
    hash = await hashPassword(password);
  }
  if (!hash.startsWith("scrypt$")) {
    return { ok: false as const, error: "Set a password for a new operator." };
  }
  const name = input.name.trim() || email;
  const ownerLock = email === (process.env.OPERATOR_BOOTSTRAP_EMAIL || "bali@mychef.id").trim().toLowerCase();
  const approved = ownerLock ? true : input.approved;
  const role = ownerLock ? "owner" : input.role;
  await appPool.query(
    `insert into mychef_inbox.integration_connections as existing_operator
       (workspace_id, id, kind, label, encrypted_secret, config, enabled, updated_at)
     values ($1, $2, 'ai', $3, $4, $5::jsonb, $6, now())
     on conflict (workspace_id, id) do update
       set label = excluded.label,
           encrypted_secret = excluded.encrypted_secret,
           -- Merge, never replace. An owner editing a name or a role must not wipe the recovery
           -- address or an in-flight reset token on that operator; before this, it did.
           config = existing_operator.config || excluded.config,
           enabled = excluded.enabled,
           updated_at = now()`,
    [
      WORKSPACE,
      id,
      name,
      hash,
      JSON.stringify({ purpose: "operator", email, name, role, approved }),
      approved,
    ],
  );
  return { ok: true as const };
}
