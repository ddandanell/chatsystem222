/**
 * G0 draft gate — the quality signal the Approve button was missing.
 *
 * The desk could approve any text as drafted with no statement about what had been checked. CS
 * measured a production draft at 3 of 5 on the C/S/T/R/N rubric and it was approved 12.19 s later,
 * so the operator had no way to see that a bar existed, let alone that this text was under it.
 *
 * This gate is deterministic and local: no model call, no network, no key. It checks five things
 * that can be verified from the text, the thread and the approval state of the cited knowledge, and
 * it fails closed — a missing draft or a thrown check is "below bar", never "pass".
 *
 *   C  complete     text exists, is not a placeholder, and ends like a message
 *   S  sourced      every price/rate claim and every cited source is approved knowledge
 *   T  tone         house voice: no shouting, no exclamation marks, no hype promises
 *   R  repeats      no duplicated sentence, and no sentence copied back from the guest
 *   N  next step    at most one question, and the reply closes on an ask or a statement
 *
 * The gate never blocks a human: a below-bar draft can still be approved, but the button says so and
 * the reviewer has to confirm, and the decision records the gate state.
 */

export const DRAFT_GATE_VERSION = "g0";

export type GateCheckId = "C" | "S" | "T" | "R" | "N";

export type GateCheck = {
  id: GateCheckId;
  label: string;
  pass: boolean;
  why: string;
};

export type DraftGate = {
  version: typeof DRAFT_GATE_VERSION;
  state: "pass" | "below-bar" | "no-draft" | "error";
  score: number;
  max: number;
  passes: boolean;
  belowBar: boolean;
  checks: GateCheck[];
  /** One line for the button and the receipt. Never "checked by a model". */
  summary: string;
  /** First failing check, in C-S-T-R-N order; null when everything passed. */
  blockedBy: GateCheckId | null;
};

export type GateInput = {
  draftText: string | null | undefined;
  thread: { direction: string; body: string }[];
  /** Sources cited by the draft, with the approval status the desk already loaded. */
  sources?: { id: string; status?: string | null }[];
};

const PLACEHOLDER = /\b(todo|tbd|fixme|xxx)\b|\[[a-z ]{2,20}\]|\{\{|\}\}/i;
/** Currency amounts, per-head rates and "IDR 850k"/"$40" style figures. */
const PRICE =
  /(?:\b(?:idr|rp|usd|aud|eur|sgd|gbp)\b\.?\s?\d[\d.,]*)|(?:\d[\d.,]*\s?(?:k|jt|juta|million)\b)|(?:[$€£]\s?\d)/i;
const HYPE =
  /\b(guarantee[ds]?|best in bali|cheapest|unbeatable|100%|world[- ]class|luxury experience of a lifetime|once in a lifetime)\b/i;
const SHOUT = /\b[A-Z]{4,}\b/;
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function complete(text: string): GateCheck {
  const body = text.trim();
  if (!body) {
    return { id: "C", label: "Complete", pass: false, why: "There is no text to approve." };
  }
  if (PLACEHOLDER.test(body)) {
    return {
      id: "C",
      label: "Complete",
      pass: false,
      why: "The draft still contains a placeholder, so it is not a reply.",
    };
  }
  if (!/[.!?]["')\]]?$/.test(body)) {
    return {
      id: "C",
      label: "Complete",
      pass: false,
      why: "The draft does not end like a message; it may be cut off.",
    };
  }
  return {
    id: "C",
    label: "Complete",
    pass: true,
    why: `${sentences(body).length} sentence${sentences(body).length === 1 ? "" : "s"}, no placeholder, closed.`,
  };
}

function sourced(text: string, sources: { id: string; status?: string | null }[]): GateCheck {
  const unapproved = sources.filter((source) => source.status !== "approved");
  if (unapproved.length > 0) {
    return {
      id: "S",
      label: "Sourced",
      pass: false,
      why: `The draft cites ${unapproved.length} source${unapproved.length === 1 ? "" : "s"} that ${unapproved.length === 1 ? "is" : "are"} not approved.`,
    };
  }
  const claimsPrice = PRICE.test(text);
  if (claimsPrice && sources.length === 0) {
    return {
      id: "S",
      label: "Sourced",
      pass: false,
      why: "The draft states a price or a rate and cites no approved source.",
    };
  }
  if (claimsPrice) {
    return {
      id: "S",
      label: "Sourced",
      pass: true,
      why: `Price claim backed by ${sources.length} approved source${sources.length === 1 ? "" : "s"}.`,
    };
  }
  return {
    id: "S",
    label: "Sourced",
    pass: true,
    why: "No price or rate is stated, and no unapproved source is cited.",
  };
}

function tone(text: string): GateCheck {
  if (/!/.test(text)) {
    return { id: "T", label: "Tone", pass: false, why: "Exclamation marks are off voice." };
  }
  const shout = text.match(SHOUT)?.[0];
  if (shout) {
    return { id: "T", label: "Tone", pass: false, why: `"${shout}" is shouting.` };
  }
  const hype = text.match(HYPE)?.[0];
  if (hype) {
    return { id: "T", label: "Tone", pass: false, why: `"${hype}" is a promise the house voice does not make.` };
  }
  if (EMOJI.test(text)) {
    return { id: "T", label: "Tone", pass: false, why: "The draft contains an emoji." };
  }
  return { id: "T", label: "Tone", pass: true, why: "Warm and direct: no hype, no shouting, no emoji." };
}

function repeats(text: string, thread: { direction: string; body: string }[]): GateCheck {
  const parts = sentences(text).map(normalise).filter((part) => part.length >= 20);
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part)) {
      return {
        id: "R",
        label: "Repeats",
        pass: false,
        why: "The draft says the same sentence twice.",
      };
    }
    seen.add(part);
  }
  const guest = thread
    .filter((message) => message.direction === "inbound")
    .flatMap((message) => sentences(message.body))
    .map(normalise)
    .filter((part) => part.length >= 25);
  const copied = guest.find((part) => normalise(text).includes(part));
  if (copied) {
    return {
      id: "R",
      label: "Repeats",
      pass: false,
      why: `The draft repeats the guest's own words: "${copied.slice(0, 60)}".`,
    };
  }
  return { id: "R", label: "Repeats", pass: true, why: "No duplicated sentence and nothing repeated back." };
}

function nextStep(text: string): GateCheck {
  const body = text.trim();
  const asks = (body.match(/\?/g) ?? []).length;
  if (asks > 1) {
    return {
      id: "N",
      label: "Next step",
      pass: false,
      why: `The draft asks ${asks} questions; one ask per reply.`,
    };
  }
  const last = sentences(body).at(-1) ?? body;
  if (!/[.!?]["')\]]?$/.test(last)) {
    return { id: "N", label: "Next step", pass: false, why: "The reply does not close on an ask or a statement." };
  }
  if (asks === 0) {
    return { id: "N", label: "Next step", pass: true, why: "Closes on a statement, no open question." };
  }
  return { id: "N", label: "Next step", pass: true, why: "Exactly one question, at the close." };
}

function finish(state: DraftGate["state"], checks: GateCheck[]): DraftGate {
  const score = checks.filter((check) => check.pass).length;
  const max = 5;
  const passes = state === "pass" && score === max;
  const blocked = checks.find((check) => !check.pass) ?? null;
  const belowBar = !passes;
  const summary =
    state === "no-draft"
      ? "no draft to check"
      : state === "error"
        ? `gate could not run · treated as below bar (${score}/${max})`
        : passes
          ? `gate ${score}/${max}`
          : `below bar ${score}/${max} · ${blocked?.label ?? "unchecked"}`;
  return {
    version: DRAFT_GATE_VERSION,
    state,
    score,
    max,
    passes,
    belowBar,
    checks,
    summary,
    blockedBy: belowBar ? (blocked?.id ?? null) : null,
  };
}

/** Pure, deterministic, fail-closed. Any throw becomes `error` → below bar. */
export function gateDraft(input: GateInput): DraftGate {
  const text = (input.draftText ?? "").trim();
  if (!text) {
    const checks: GateCheck[] = [
      { id: "C", label: "Complete", pass: false, why: "There is no text to approve." },
      { id: "S", label: "Sourced", pass: false, why: "Not checked: there is no draft." },
      { id: "T", label: "Tone", pass: false, why: "Not checked: there is no draft." },
      { id: "R", label: "Repeats", pass: false, why: "Not checked: there is no draft." },
      { id: "N", label: "Next step", pass: false, why: "Not checked: there is no draft." },
    ];
    return finish("no-draft", checks);
  }
  try {
    const checks = [
      complete(text),
      sourced(text, input.sources ?? []),
      tone(text),
      repeats(text, input.thread ?? []),
      nextStep(text),
    ];
    return finish(checks.every((check) => check.pass) ? "pass" : "below-bar", checks);
  } catch (error) {
    const why = error instanceof Error ? error.message : "the gate failed";
    return finish("error", [
      { id: "C", label: "Complete", pass: false, why: `Gate error, treated as below bar: ${why}` },
      { id: "S", label: "Sourced", pass: false, why: "Not checked." },
      { id: "T", label: "Tone", pass: false, why: "Not checked." },
      { id: "R", label: "Repeats", pass: false, why: "Not checked." },
      { id: "N", label: "Next step", pass: false, why: "Not checked." },
    ]);
  }
}

/** The audit action recorded when a below-bar draft is approved anyway. */
export function gateAuditAction(gate: DraftGate): string {
  const failed = gate.checks.filter((check) => !check.pass).map((check) => check.id);
  return `draft-gate:below-bar:${gate.score}/${gate.max}:${failed.join("") || "none"}`;
}
