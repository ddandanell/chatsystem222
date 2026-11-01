/**
 * Nightly learning pass. Reads decision_records and writes pending knowledge only. Do not auto-send.
 *
 * GET /api/cron/learn with Authorization: Bearer CRON_SECRET.
 * Runs runLearningPass against mychef_inbox (decision_records, feedback, knowledge, audit_log).
 * Idempotent: each clustered decision gets one `learn:processed` audit row, so a second pass the same
 * night proposes nothing. Never auto-activates a snippet and never sends.
 * Docs: documentation/cbls-architecture.md, documentation/learning-queue.md.
 */
import { timingSafeEqual } from "node:crypto";
import { runLearningPass } from "@/data/mychef-store";

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "");
  return sameSecret(bearer, secret);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Cron secret was rejected." }, { status: 401 });
  }
  const result = await runLearningPass("cron");
  return Response.json({ ok: true, ...result, sent: false, activated: false });
}
