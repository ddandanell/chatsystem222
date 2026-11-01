/**
 * Server-side completion for the conversation agent. Do not auto-send.
 *
 * Purpose: turn a focused prompt into one reply using the stored BYOK key for Vercel AI Gateway
 * first, then DeepSeek. The key never leaves this module, never reaches the browser, and never
 * appears in an error string or a log line. A refusal is a reason code the caller can explain.
 * Specs: documentation/agent-spec.md, src/lib/gateway.ts (key probe), src/lib/providers.ts.
 * Server-only by construction: it is imported by src/lib/conversation-agent.ts and the store, and
 * nothing here is reachable from a client component. The `server-only` marker package is not used
 * because it throws under `node --test`, which imports this file to test the pure helpers.
 */
import {
  DEEPSEEK_BASE,
  PRIMARY_PROVIDERS,
  PROVIDER_LABELS,
  VERCEL_GATEWAY_DEFAULT,
  type Provider,
} from "@/lib/providers";

/** Hard ceiling for one agent call. The desk shows a fallback draft instead of hanging. */
export const AGENT_TIMEOUT_MS = 20_000;

/** Default models; override per provider with MYCHEF_AGENT_MODEL_GATEWAY / _DEEPSEEK. */
export const DEFAULT_AGENT_MODELS: Partial<Record<Provider, string>> = {
  vercel_gateway: "deepseek/deepseek-chat",
  deepseek: "deepseek-chat",
};

export type AgentCompletion =
  | {
      ok: true;
      text: string;
      provider: Provider;
      model: string;
      latencyMs: number;
      usage: { input: number | null; output: number | null };
    }
  | {
      ok: false;
      reason: "no_key" | "timeout" | "provider_error" | "network" | "empty";
      error: string;
      provider: Provider | null;
    };

export type ProviderKey = { secret: string; baseUrl: string | null };

export type AgentDeps = {
  /** Resolve a stored key. Tests inject a fake so no credential is needed. */
  resolve?: (provider: Provider) => Promise<ProviderKey | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Provider order. Gateway and DeepSeek lead, as the build order requires. */
  order?: readonly Provider[];
};

export function agentModel(provider: Provider): string {
  const env =
    provider === "vercel_gateway"
      ? process.env.MYCHEF_AGENT_MODEL_GATEWAY
      : provider === "deepseek"
        ? process.env.MYCHEF_AGENT_MODEL_DEEPSEEK
        : undefined;
  const fallback = DEFAULT_AGENT_MODELS[provider];
  return (env || fallback || "").trim();
}

export function agentBaseUrl(provider: Provider, baseUrl: string | null): string {
  if (provider === "vercel_gateway") {
    return (baseUrl || VERCEL_GATEWAY_DEFAULT).replace(/\/+$/, "");
  }
  if (provider === "deepseek") return DEEPSEEK_BASE;
  return (baseUrl || "").replace(/\/+$/, "");
}

/** Remove the key from anything that may be shown or logged. */
export function redactSecret(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join("[redacted]");
}

export function buildChatRequest(
  provider: Provider,
  key: ProviderKey,
  messages: { system: string; user: string },
  model: string,
): { url: string; init: RequestInit } {
  const base = agentBaseUrl(provider, key.baseUrl);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", `Bearer ${key.secret}`);
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
    },
  };
}

export type AgentReply = {
  reply: string;
  why: string;
  whyNot: string;
  escalate: boolean;
};

/**
 * The provider is asked for JSON, but a provider can still answer with prose or a fenced block.
 * A reply that is empty after trimming is not a reply, so it is refused rather than stored.
 */
export function parseAgentOutput(raw: string): AgentReply | null {
  if (!raw?.trim()) return null;
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const reply = typeof record.reply === "string" ? record.reply.trim() : "";
  if (!reply) return null;
  const why = typeof record.why === "string" ? record.why.trim().slice(0, 600) : "";
  const whyNot = typeof record.whyNot === "string"
    ? record.whyNot.trim().slice(0, 600)
    : typeof record.why_not === "string"
      ? record.why_not.trim().slice(0, 600)
      : "";
  return {
    reply: reply.slice(0, 4000),
    why,
    whyNot,
    escalate: record.escalate === true,
  };
}

function pickText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  if (first?.message && typeof first.message.content === "string") return first.message.content;
  if (typeof first?.text === "string") return first.text;
  return "";
}

function pickUsage(payload: unknown): { input: number | null; output: number | null } {
  const usage =
    payload && typeof payload === "object"
      ? (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage
      : undefined;
  const input = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const output = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
  return { input, output };
}

/**
 * Try each provider in order. A missing key is not an error — the next provider is tried, and if
 * none has a key the caller falls back to the local draft with a notice that names no credential.
 */
/**
 * Reads the stored BYOK key for one call. Imported lazily so the pure helpers above can be tested
 * without opening a database pool.
 */
async function storedProviderKey(orgId: string, provider: Provider): Promise<ProviderKey | null> {
  const [{ resolveMychefSecret }, { cachedProviderBaseUrl, resolveProviderSecret }] = await Promise.all([
    import("@/data/mychef-store"),
    import("@/lib/secrets"),
  ]);
  const stored = await resolveMychefSecret(provider);
  if (stored?.secret) return { secret: stored.secret, baseUrl: stored.baseUrl };
  const secret = await resolveProviderSecret(orgId, provider);
  if (!secret) return null;
  return { secret, baseUrl: cachedProviderBaseUrl(orgId, provider) };
}

export async function completeWithProvider(
  orgId: string,
  messages: { system: string; user: string },
  deps: AgentDeps = {},
): Promise<AgentCompletion> {
  const order = deps.order ?? PRIMARY_PROVIDERS;
  const resolve = deps.resolve ?? ((provider: Provider) => storedProviderKey(orgId, provider));
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? AGENT_TIMEOUT_MS;

  let sawKey = false;
  let lastFailure: AgentCompletion | null = null;

  for (const provider of order) {
    const model = agentModel(provider);
    if (!model) continue;
    let key: ProviderKey | null = null;
    try {
      key = await resolve(provider);
    } catch {
      key = null;
    }
    if (!key?.secret) continue;
    sawKey = true;

    const started = Date.now();
    const request = buildChatRequest(provider, key, messages, model);
    try {
      const response = await doFetch(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastFailure = {
          ok: false,
          reason: "provider_error",
          error: `${PROVIDER_LABELS[provider]} returned status ${response.status}${body ? `: ${redactSecret(body, key.secret).slice(0, 200)}` : ""}`,
          provider,
        };
        continue;
      }
      const payload: unknown = await response.json();
      const text = pickText(payload);
      if (!text.trim()) {
        lastFailure = { ok: false, reason: "empty", error: `${PROVIDER_LABELS[provider]} returned an empty reply.`, provider };
        continue;
      }
      return {
        ok: true,
        text,
        provider,
        model,
        latencyMs: Date.now() - started,
        usage: pickUsage(payload),
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      lastFailure = {
        ok: false,
        reason: timedOut ? "timeout" : "network",
        error: timedOut
          ? `${PROVIDER_LABELS[provider]} did not answer within ${Math.round(timeoutMs / 1000)}s.`
          : `Could not reach ${PROVIDER_LABELS[provider]}.`,
        provider,
      };
    }
  }

  if (!sawKey) {
    return { ok: false, reason: "no_key", error: "No active provider key is stored for this workspace.", provider: null };
  }
  return (
    lastFailure ?? {
      ok: false,
      reason: "provider_error",
      error: "No provider answered.",
      provider: null,
    }
  );
}
