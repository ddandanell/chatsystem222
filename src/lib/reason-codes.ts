/**
 * Review reason codes, their learning-queue routing, and human decisions. Do not auto-send.
 *
 * One table decides where a correction goes. Before this, `queueTypeForReason()` in
 * learning-queue.ts, `statementFor()` in mychef-store.ts and `diagnose()` in learning-loop.ts each
 * carried their own hard-coded lists, so a code added to the UI but not to those lists was counted
 * nowhere: the desk collected the correction and the learning pass produced no proposal. Every code
 * now declares its queue type, its learning group and its candidate statement here, and
 * `tests/reason-registry.test.ts` fails when a code is missing any of them.
 */
export type ReasonGroup = "knowledge_gap" | "procedure_gap" | "escalation" | "retrieval";

export type ReasonSpec = {
  code: string;
  label: string;
  /** Queue column on the Learning Queue. */
  queue: "Missing Knowledge" | "Tone" | "Outdated" | "Suggested";
  /** knowledge.category written by the learning pass. */
  group: ReasonGroup;
  /** One sentence a person can approve, retire or edit. Never published automatically. */
  statement: string;
  /** false = a good outcome, not a correction; excluded from the learning pass. */
  learnable: boolean;
};

export const REASON_SPECS: readonly ReasonSpec[] = [
  {
    code: "wrong_policy",
    label: "Wrong policy",
    queue: "Missing Knowledge",
    group: "knowledge_gap",
    statement: "State the policy that applies before answering, and name it.",
    learnable: true,
  },
  {
    code: "wrong_fact",
    label: "Wrong fact",
    queue: "Outdated",
    group: "knowledge_gap",
    statement: "Use only the approved fact for this detail; an outdated figure must be corrected.",
    learnable: true,
  },
  {
    code: "too_formal",
    label: "Too formal",
    queue: "Tone",
    group: "procedure_gap",
    statement: "Keep the MyChef voice warm and direct; no corporate phrasing.",
    learnable: true,
  },
  {
    code: "too_casual",
    label: "Too casual",
    queue: "Tone",
    group: "procedure_gap",
    statement: "Keep the MyChef voice warm but professional; no slang.",
    learnable: true,
  },
  {
    code: "missed_upsell",
    label: "Missed upsell",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Offer the relevant add-on once, when the thread supports it.",
    learnable: true,
  },
  {
    code: "should_have_asked",
    label: "Should have asked",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Ask the missing detail before quoting anything that depends on it.",
    learnable: true,
  },
  {
    code: "customer_angry",
    label: "Customer is angry",
    queue: "Suggested",
    group: "escalation",
    statement: "Hand an angry or distressed guest to a person; do not answer with a draft.",
    learnable: true,
  },
  {
    code: "needs_human",
    label: "Needs a human",
    queue: "Suggested",
    group: "escalation",
    statement: "Escalate this class of request to a person.",
    learnable: true,
  },
  {
    code: "missing_knowledge",
    label: "Missing knowledge",
    queue: "Missing Knowledge",
    group: "knowledge_gap",
    statement: "Say what is confirmed and ask for the detail; never fill a gap with a guess.",
    learnable: true,
  },
  {
    code: "irrelevant_source",
    label: "Irrelevant source",
    queue: "Outdated",
    group: "retrieval",
    statement: "Do not lean on the cited source for this tag.",
    learnable: true,
  },
  {
    code: "good_as_drafted",
    label: "Good as drafted",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "No correction: the draft was approved as written.",
    learnable: false,
  },

  // The nine codes the desk was collecting without a queue, a statement or a group.
  {
    code: "too_long",
    label: "Too long",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Answer in at most three short paragraphs; length must follow the ask.",
    learnable: true,
  },
  {
    code: "wrong_price",
    label: "Wrong price",
    queue: "Outdated",
    group: "knowledge_gap",
    statement: "Quote a price only from an approved source; never infer, round or re-currency a rate.",
    learnable: true,
  },
  {
    code: "invented_detail",
    label: "Invented detail",
    queue: "Missing Knowledge",
    group: "knowledge_gap",
    statement: "State only details the guest gave or an approved source confirms; ask instead of inventing.",
    learnable: true,
  },
  {
    code: "ignored_question",
    label: "Ignored the question",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Answer the question the guest asked first, before anything else in the reply.",
    learnable: true,
  },
  {
    code: "wrong_recommendation",
    label: "Wrong recommendation",
    queue: "Outdated",
    group: "knowledge_gap",
    statement: "Recommend only what approved knowledge supports, and name the source.",
    learnable: true,
  },
  {
    code: "multiple_asks",
    label: "Too many asks",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Ask one thing per reply; a list of questions loses the guest.",
    learnable: true,
  },
  {
    code: "no_next_step",
    label: "No next step",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "End with one clear next step: a question or a confirmed action.",
    learnable: true,
  },
  {
    code: "off_brand",
    label: "Off brand",
    queue: "Tone",
    group: "procedure_gap",
    statement: "Follow the house tone: warm, direct, no hype, no promises a person has not approved.",
    learnable: true,
  },
  {
    code: "repeats_guest",
    label: "Repeats the guest",
    queue: "Suggested",
    group: "procedure_gap",
    statement: "Acknowledge what the guest said in a few words and move the thread forward; never repeat it back.",
    learnable: true,
  },
] as const;

/** The picker, in table order. */
export const REASON_CODES = REASON_SPECS.map((spec) => ({
  code: spec.code,
  label: spec.label,
})) as readonly { code: string; label: string }[];

export type ReasonCode = string;

const byCode = new Map(REASON_SPECS.map((spec) => [spec.code, spec]));

export function isReasonCode(value: string): value is ReasonCode {
  return byCode.has(value);
}

export function reasonSpec(code: string | null | undefined): ReasonSpec | null {
  return code ? (byCode.get(code) ?? null) : null;
}

export function reasonLabel(code: string | null | undefined): string {
  return reasonSpec(code)?.label ?? code ?? "—";
}

/** Codes that become learning candidates. Unknown codes are learnable (a new correction is still a
 *  signal) but they get no statement until they are registered, and the registry test forbids that. */
export function isLearnableReasonCode(code: string): boolean {
  const spec = reasonSpec(code);
  return spec ? spec.learnable : true;
}

export const HUMAN_DECISIONS = [
  { value: "accepted", label: "Accepted" },
  { value: "edited", label: "Edited" },
  { value: "rejected", label: "Rejected" },
  { value: "escalated", label: "Escalated" },
] as const;

export type HumanDecision = (typeof HUMAN_DECISIONS)[number]["value"];

export function isHumanDecision(value: string): value is HumanDecision {
  return HUMAN_DECISIONS.some((item) => item.value === value);
}

export function decisionLabel(value: string | null | undefined): string {
  return HUMAN_DECISIONS.find((item) => item.value === value)?.label ?? value ?? "—";
}

export const OUTCOMES = [
  "booked",
  "closed",
  "refunded",
  "no_response",
  "complaint",
  "ongoing",
] as const;

export type Outcome = (typeof OUTCOMES)[number];
