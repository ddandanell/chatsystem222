/**
 * Local Docker learning loop (rules table).
 *
 * CBLS cousin of runLearningPass on Neon: clusters feedback into candidate rules only. Idempotent
 * via the since-last-rule window. Never auto-activates, never sends. The Neon path lives in
 * src/data/mychef-store.ts (runLearningPass).
 * Docs: documentation/cbls-architecture.md, documentation/learning-queue.md.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { auditEvents, feedbackEvents, rules } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { reasonLabel, type ReasonCode } from "@/lib/reason-codes";

const KNOWLEDGE = new Set<ReasonCode>(["wrong_policy", "wrong_fact", "missing_knowledge"]);
const PROCEDURE = new Set<ReasonCode>([
  "too_formal",
  "too_casual",
  "should_have_asked",
  "missed_upsell",
  "customer_angry",
]);

type Group = "knowledge_gap" | "procedure_gap" | "escalation" | "retrieval";

type Proposal = {
  key: string;
  scope: string;
  statement: string;
  reasonCode: string;
  group: Group;
  evidence: number;
};

function diagnose(reason: string, count: number, sourceId?: string): Proposal | null {
  if (reason === "good_as_drafted") return null;
  if (KNOWLEDGE.has(reason as ReasonCode)) {
    return {
      key: reason,
      scope: "position",
      group: "knowledge_gap",
      reasonCode: reason,
      evidence: count,
      statement: `Propose a position edit. Reviewers marked ${reasonLabel(reason)} ${count} times.`,
    };
  }
  if (PROCEDURE.has(reason as ReasonCode)) {
    return {
      key: reason,
      scope: "playbook",
      group: "procedure_gap",
      reasonCode: reason,
      evidence: count,
      statement: `Propose a playbook edit. Reviewers marked ${reasonLabel(reason)} ${count} times.`,
    };
  }
  if (reason === "needs_human") {
    return {
      key: reason,
      scope: "escalation",
      group: "escalation",
      reasonCode: reason,
      evidence: count,
      statement: `Propose an escalation rule. Reviewers marked Needs a human ${count} times.`,
    };
  }
  if (reason === "irrelevant_source" && sourceId) {
    return {
      key: `${reason}:${sourceId}`,
      scope: `retrieval:${sourceId}`,
      group: "retrieval",
      reasonCode: reason,
      evidence: count,
      statement: `Penalize source ${sourceId}. Reviewers marked it irrelevant ${count} times.`,
    };
  }
  return null;
}

export async function runLearningLoop(orgId: string, actorId: string) {
  return withTenant(orgId, async (tx) => {
    const latest = await tx
      .select({ createdAt: rules.createdAt })
      .from(rules)
      .orderBy(desc(rules.createdAt))
      .limit(1);
    const since = latest[0]?.createdAt ?? new Date(0);
    const feedback = await tx
      .select({
        reasonCode: feedbackEvents.reasonCode,
        sourceMarks: feedbackEvents.sourceMarks,
        createdAt: feedbackEvents.createdAt,
      })
      .from(feedbackEvents)
      .where(gt(feedbackEvents.createdAt, since));

    const buckets = new Map<string, { reason: string; sourceId?: string; count: number }>();
    let goodAsDrafted = 0;
    for (const event of feedback) {
      if (event.reasonCode === "good_as_drafted") {
        goodAsDrafted += 1;
        continue;
      }
      if (event.reasonCode === "irrelevant_source") {
        const marks = event.sourceMarks ?? [];
        const sources = marks.filter((mark) => mark.mark === "irrelevant").map((mark) => mark.id);
        const ids = sources.length > 0 ? sources : ["unknown"];
        for (const sourceId of ids) {
          const key = `irrelevant_source:${sourceId}`;
          const current = buckets.get(key) ?? { reason: "irrelevant_source", sourceId, count: 0 };
          current.count += 1;
          buckets.set(key, current);
        }
        continue;
      }
      const current = buckets.get(event.reasonCode) ?? {
        reason: event.reasonCode,
        count: 0,
      };
      current.count += 1;
      buckets.set(event.reasonCode, current);
    }

    const created: Proposal[] = [];
    for (const bucket of buckets.values()) {
      const proposal = diagnose(bucket.reason, bucket.count, bucket.sourceId);
      if (!proposal || proposal.evidence < 1) continue;
      await tx.insert(rules).values({
        orgId,
        scope: proposal.scope,
        statement: proposal.statement,
        evidenceCount: proposal.evidence,
        ownerId: actorId,
        status: "candidate",
        exceptions: { reason_code: proposal.reasonCode, group: proposal.group },
      });
      created.push(proposal);
    }

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const active = await tx
      .select({
        id: rules.id,
        exceptions: rules.exceptions,
      })
      .from(rules)
      .where(eq(rules.status, "active"));
    let decayed = 0;
    for (const rule of active) {
      const reason =
        rule.exceptions &&
        typeof rule.exceptions === "object" &&
        !Array.isArray(rule.exceptions) &&
        "reason_code" in rule.exceptions
          ? String(rule.exceptions.reason_code)
          : "";
      if (!reason) continue;
      const support = await tx
        .select({ id: feedbackEvents.id })
        .from(feedbackEvents)
        .where(
          and(eq(feedbackEvents.reasonCode, reason), gt(feedbackEvents.createdAt, cutoff)),
        )
        .limit(1);
      if (support.length > 0) continue;
      await tx
        .update(rules)
        .set({ status: "deprecated" })
        .where(and(eq(rules.id, rule.id), eq(rules.status, "active")));
      await tx.insert(auditEvents).values({
        orgId,
        kind: "rule_status",
        summary: `Decayed rule ${rule.id} to deprecated. No supporting feedback in 90 days.`,
      });
      decayed += 1;
    }

    return { created: created.length, goodAsDrafted, decayed, since };
  });
}

export async function setRuleStatus(
  orgId: string,
  ruleId: string,
  status: "active" | "deprecated",
) {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(rules)
      .where(eq(rules.id, ruleId))
      .limit(1);
    const rule = rows[0];
    if (!rule) return { ok: false as const, error: "That rule is not in this workspace." };
    if (status === "active" && rule.status !== "candidate") {
      return { ok: false as const, error: "Only a candidate can be activated." };
    }
    await tx.update(rules).set({ status }).where(eq(rules.id, ruleId));
    await tx.insert(auditEvents).values({
      orgId,
      kind: "rule_status",
      summary: `${status} · evidence ${rule.evidenceCount} · ${rule.statement}`,
    });
    return { ok: true as const, statement: rule.statement, evidence: rule.evidenceCount };
  });
}

export async function countRules(orgId: string) {
  return withTenant(orgId, async (tx) => {
    const result = await tx.execute(
      sql`select status, count(*)::int as n from rules group by status`,
    );
    return result.rows as { status: string; n: number }[];
  });
}
