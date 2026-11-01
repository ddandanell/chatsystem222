/**
 * One live provider call, no database write, to prove the agent's request/parse path against the
 * real stored BYOK key. Run manually:
 *   node --env-file=.env.local --import tsx scripts/live-provider-probe.ts
 * It prints the provider, model, latency and whether the JSON parsed. It never prints the key.
 */
import { completeWithProvider, parseAgentOutput } from "@/lib/agent-provider";

async function main() {
  const password = process.env.MYCHEF_DATABASE_URL;
  if (!password) {
    console.log("MYCHEF_DATABASE_URL is not available to this shell");
    return;
  }
  process.env.DATABASE_URL =
    "postgresql://mychef_runtime:" +
    encodeURIComponent(password) +
    "@ep-bitter-fire-azf4encj-pooler.c-3.ap-southeast-1.aws.neon.tech/mychef?sslmode=verify-full";

  const { appPool } = await import("@/db/client");
  const result = await completeWithProvider(
    "mychef",
    {
      system:
        "You are a probe. Return JSON only with keys reply, why, why_not, escalate. reply is one short sentence.",
      user: 'Say "agent probe ok" in the reply.',
    },
    {},
  );

  if (result.ok) {
    const parsed = parseAgentOutput(result.text);
    console.log("provider", result.provider, "model", result.model, "latencyMs", result.latencyMs);
    console.log("usage", JSON.stringify(result.usage));
    console.log(
      "parsed",
      parsed ? "ok reply=" + JSON.stringify(parsed.reply.slice(0, 80)) : "NOT PARSED",
    );
  } else {
    console.log("FAILED", result.reason, result.error);
  }
  await appPool.end();
}

main().catch((error) => {
  console.log("SCRIPT FAILED", error instanceof Error ? error.message : error);
});
