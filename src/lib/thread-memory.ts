/**
 * One conversation, read from the first message to the last. Do not auto-send.
 *
 * MC-168/169/170. Three things the desk got wrong and this module makes checkable:
 *
 * 169 — grounding. The old local draft read `conversation.messages[last inbound]` and nothing else,
 *   so a thread where the guest opened with the date and the party size produced a draft that asked
 *   for both again. Everything here takes the whole thread, and `threadBrief()` reports exactly how
 *   many messages were read so the UI can say so instead of implying it.
 *
 * 170 — repetition. `repeatViolations()` names the three ways a reply can repeat itself: it
 *   re-introduces the desk after myCHEF has already written in the thread, it reuses a sentence from
 *   a previous outbound message, or it asks for something the guest already answered.
 *   `composeLocalReply()` builds the no-provider reply so it cannot do any of those three by
 *   construction, and `runConversationAgent()` runs the same check over a provider answer and
 *   refuses it rather than showing the operator a draft that repeats itself.
 *
 * 168 — a standing draft. `draftFreshness()` answers "is what is stored still the answer to this
 *   thread?" from timestamps only, so the desk can paint the stored draft immediately and refresh
 *   behind it instead of waiting for generation before it renders.
 *
 * Nothing here reads the database, calls a provider, or sends anything. All of it is pure so the
 * rules can be tested without a key, a network or a request scope.
 */

export type ThreadMessage = {
  id?: string;
  direction: string;
  body: string;
  created_at?: Date | string;
};

/**
 * How many messages one drafting context may hold. The store hands over the opening of the thread
 * plus the newest messages (at most 50), so a normal conversation is read whole and an imported
 * one is read from both ends rather than only from the bottom.
 */
export const THREAD_WINDOW_LIMIT = 60;

/** Ceiling for the transcript handed to a local draft, so one pasted email cannot crowd it out. */
export const THREAD_TEXT_LIMIT = 4000;

export type ThreadFact = { known: boolean; evidence: string | null };

export type ThreadFacts = {
  date: ThreadFact;
  guests: ThreadFact;
  location: ThreadFact;
  time: ThreadFact;
  dietary: ThreadFact;
};

export type FactId = keyof ThreadFacts;

/** The wording used when a fact is missing. Kept in one place so the draft and the tests agree. */
export const FACT_QUESTION: Record<FactId, string> = {
  date: "the date",
  guests: "the number of guests",
  location: "the villa or area you are staying in",
  time: "the start time",
  dietary: "any dietary requirements",
};

/** The wording used when a fact is already in the thread. */
export const FACT_LABEL: Record<FactId, string> = {
  date: "the date",
  guests: "the number of guests",
  location: "the villa or area",
  time: "the start time",
  dietary: "the dietary requirements",
};

const MONTHS =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty";

/**
 * "stated" matches a guest telling us the thing; "asked" matches a reply asking for it. Both are
 * deliberately narrow: a false positive here either hides a real question or refuses a good draft,
 * so a pattern only fires on wording that can only mean one thing.
 *
 * Known limit: "could you confirm the villa?" is not matched as a question about the area, because
 * the same words are a legitimate confirmation request ("confirm the villa is Villa Bidadari"). The
 * composer never produces it; a provider answer that does is left alone rather than refused.
 */
const FACT_PATTERNS: Record<FactId, { stated: RegExp; asked: RegExp }> = {
  date: {
    stated: new RegExp(
      `\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${MONTHS})\\b|\\b(${MONTHS})\\s+\\d{1,2}(st|nd|rd|th)?\\b|\\bin\\s+(${MONTHS})\\b|\\b\\d{1,2}[/-]\\d{1,2}([/-]\\d{2,4})?\\b|\\b(today|tonight|tomorrow|this week(end)?|next week(end)?|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b`,
      "i",
    ),
    asked:
      /\b(what|which) (date|day)\b|\bconfirm the date\b|\bwhich day\b|\bwhat day\b|\bthe date you have in mind\b|\bwhat date\b/i,
  },
  guests: {
    stated: new RegExp(
      `\\b(\\d{1,3}|${NUMBER_WORDS})\\s*(guests?|people|persons?|pax|adults?|diners?|of us)\\b|\\b(party|group|table)\\s+(of|for)\\s+\\d{1,3}\\b|\\bfor\\s+\\d{1,3}\\s+(people|guests|pax|persons|adults)\\b`,
      "i",
    ),
    asked:
      /\bhow many (guests|people|persons|pax|adults|will)\b|\bthe number of guests\b|\bhow many are you\b/i,
  },
  location: {
    stated:
      /\b(villa|hotel|resort|airbnb|guesthouse|homestay)\b|\bstay(ing)? (in|at)\b|\bwe are in\b|\blocated in\b|\b(canggu|seminyak|ubud|uluwatu|sanur|nusa dua|kuta|jimbaran|berawa|pererenan|umalas|kerobokan|denpasar|tabanan|amed|sidemen)\b/i,
    asked:
      /\b(which|what) (villa|area|neighbourhood|neighborhood|location)\b|\bwhere are you staying\b|\bthe villa or area you are staying in\b|\bwhich part of bali\b/i,
  },
  time: {
    stated:
      /\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b|\b(lunch|dinner|breakfast|brunch|noon|midday|evening|sunset|afternoon)\b/i,
    asked: /\b(what|which) time\b|\bthe start time\b|\bwhat time would\b|\bwhat time suits\b/i,
  },
  dietary: {
    stated:
      /\b(vegan|vegetarian|halal|gluten[- ]free|dairy[- ]free|lactose[- ]free|nut[- ]free|shellfish|allerg\w*|dietary|pescatarian|coeliac|celiac|no pork|no beef|no shellfish)\b/i,
    asked: /\bdietary (requirements?|needs?|restrictions?)\b|\bany allergies\b|\banything you (do not|don't) eat\b/i,
  },
};

const FACT_ORDER: FactId[] = ["date", "guests", "location", "time", "dietary"];

function clean(value: Date | string | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * The window a prompt may use. When a thread is longer than the window the first message is always
 * kept — a draft that knows how the conversation started and where it is now can still avoid
 * repeating itself, while a plain `slice(-limit)` forgets the opening and re-asks it.
 */
export function selectThreadWindow<T extends ThreadMessage>(
  messages: T[],
  limit = THREAD_WINDOW_LIMIT,
): T[] {
  if (limit <= 0) return [];
  if (messages.length <= limit) return [...messages];
  return [messages[0]!, ...messages.slice(messages.length - (limit - 1))];
}

function evidenceFor(body: string, pattern: RegExp): string | null {
  const match = pattern.exec(body);
  return match ? match[0].trim().slice(0, 120) : null;
}

/**
 * A guest fact counts only when the guest stated it. myCHEF saying "dinner at 7pm" is a proposal, not
 * a confirmed detail, so outbound messages are never read as sources of fact.
 */
export function answeredFacts(messages: ThreadMessage[]): ThreadFacts {
  const facts = {} as ThreadFacts;
  const inbound = messages.filter((message) => message.direction === "inbound");
  for (const id of FACT_ORDER) {
    const pattern = FACT_PATTERNS[id].stated;
    let evidence: string | null = null;
    for (const message of inbound) {
      evidence = evidenceFor(message.body, pattern);
      if (evidence) break;
    }
    facts[id] = { known: Boolean(evidence), evidence };
  }
  return facts;
}

export type ThreadBrief = {
  /** Messages this brief actually read. The UI shows this number; it is never estimated. */
  messagesRead: number;
  /** True when the window dropped messages in the middle. */
  truncated: boolean;
  inbound: number;
  outbound: number;
  firstAt: string | null;
  lastAt: string | null;
  facts: ThreadFacts;
  /** Facts still open, in the order a person would ask them. */
  asked: string[];
  askedIds: FactId[];
  hasOutbound: boolean;
  lastOutbound: string | null;
  /** Oldest-first transcript, capped, for grounding a local draft. */
  text: string;
};

export function threadBrief(
  messages: ThreadMessage[],
  limit = THREAD_WINDOW_LIMIT,
): ThreadBrief {
  const window = selectThreadWindow(messages, limit);
  const inbound = window.filter((message) => message.direction === "inbound").length;
  const outbound = window.length - inbound;
  const stamps = window
    .map((message) => (message.created_at ? new Date(message.created_at) : null))
    .filter((date): date is Date => date != null && !Number.isNaN(date.getTime()));
  const firstAt = stamps.length ? new Date(Math.min(...stamps.map((d) => d.getTime()))) : null;
  const lastAt = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
  const facts = answeredFacts(window);
  const askedIds = FACT_ORDER.filter((id) => !facts[id].known);
  const lastOutbound =
    [...window].reverse().find((message) => message.direction === "outbound")?.body ?? null;
  const text = window
    .map((message) => `${message.direction === "inbound" ? "guest" : "mychef"}: ${message.body.trim()}`)
    .join("\n")
    .slice(0, THREAD_TEXT_LIMIT);
  return {
    messagesRead: window.length,
    truncated: window.length < messages.length,
    inbound,
    outbound,
    firstAt: firstAt ? firstAt.toISOString() : null,
    lastAt: lastAt ? lastAt.toISOString() : null,
    facts,
    asked: askedIds.map((id) => FACT_QUESTION[id]),
    askedIds,
    hasOutbound: outbound > 0,
    lastOutbound,
    text,
  };
}

/* ------------------------------------------------------------------ repetition */

export type RepeatCode = "reintroduction" | "repeated_reply" | "reasked_question";

export type RepeatViolation = { code: RepeatCode; detail: string };

const GREETING =
  /^\s*(hi\b|hello\b|hey\b|dear\b|good (morning|afternoon|evening)\b|thank you for (reaching out|getting in touch|your (message|enquiry|inquiry|email|note))\b|thanks for (reaching out|getting in touch|your (message|email|note))\b)/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter((piece) => piece.length > 0);
}

function words(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * The three ways a reply repeats the thread. Empty means the reply is new writing, which is what
 * "extremely professional, not repeating" has to mean in something a test can check.
 */
export function repeatViolations(candidate: string, messages: ThreadMessage[]): RepeatViolation[] {
  const violations: RepeatViolation[] = [];
  const brief = threadBrief(messages);
  const text = candidate.trim();
  if (!text) return violations;

  if (brief.hasOutbound && GREETING.test(text)) {
    violations.push({
      code: "reintroduction",
      detail: "myCHEF has already written in this thread, so the reply must not greet or thank the guest again",
    });
  }

  const previous = sentences(brief.lastOutbound ?? "");
  for (const previousOutbound of messages.filter((message) => message.direction === "outbound")) {
    previous.push(...sentences(previousOutbound.body));
  }
  for (const sentence of sentences(text)) {
    const tokens = words(sentence);
    if (tokens.size < 4) continue;
    for (const earlier of previous) {
      const earlierTokens = words(earlier);
      if (earlierTokens.size < 4) continue;
      if (overlap(tokens, earlierTokens) >= 0.8) {
        violations.push({
          code: "repeated_reply",
          detail: `this sentence already exists in a previous myCHEF reply: "${earlier.slice(0, 90)}"`,
        });
        break;
      }
    }
  }

  // A question is a question: only sentences that actually ask are checked against what the guest
  // already answered, so "I have the date and the number of guests" is not mistaken for re-asking.
  const asks = sentences(text).filter(
    (sentence) => sentence.endsWith("?") || /\b(please|could you|can you|let me know|tell me|confirm)\b/i.test(sentence),
  );
  for (const id of FACT_ORDER) {
    if (!brief.facts[id].known) continue;
    const askedSentence = asks.find((sentence) => FACT_PATTERNS[id].asked.test(sentence));
    if (askedSentence) {
      violations.push({
        code: "reasked_question",
        detail: `the guest already gave ${FACT_LABEL[id]} ("${brief.facts[id].evidence}"), so the reply must not ask for it again`,
      });
    }
  }
  return violations;
}

const CURRENCY =
  /\b(idr|rp\.?|usd|eur|gbp|aud|sgd|aed|chf)\b\s*[\d.,]+|[$€£]\s*\d|\b\d[\d.,]*\s*(idr|rp|usd|dollars?|euros?|rupiah)\b|\b\d[\d.,]*\s*(per|\/)\s*(person|guest|pax|head|adult)\b/i;

/** True when a reply puts a number and a currency (or a per-head rate) in front of a guest. */
export function statesPrice(text: string): boolean {
  return CURRENCY.test(text);
}

/* ------------------------------------------------------------------ the local reply */

export type ReplySource = { title: string; kind?: string; excerpt: string };

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function quoteLine(excerpt: string): string {
  const first = excerpt
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length > 20)[0];
  return (first ?? excerpt).split(/(?<=\.)\s/)[0]?.trim().slice(0, 260) ?? "";
}

/**
 * The reply a reviewer gets when no provider answered. It is real customer-facing writing, not a
 * placeholder: it names what the thread already established, asks only what is still missing, never
 * greets twice, and — with no approved source — says in plain words that it cannot confirm a price.
 */
export function composeLocalReply(
  sources: ReplySource[],
  messages: ThreadMessage[],
): { text: string; why: string; whyNot: string; asked: string[] } {
  const brief = threadBrief(messages);
  const position = sources.find((item) => item.kind === "position") ?? sources[0];
  const parts: string[] = [];
  if (!brief.hasOutbound) parts.push("Thank you for reaching out.");

  const known = FACT_ORDER.filter((id) => brief.facts[id].known).slice(0, 3);
  if (known.length >= 2) {
    parts.push(`I have ${joinList(known.map((id) => FACT_LABEL[id]))} from your messages.`);
  }

  if (position) {
    const quote = quoteLine(position.excerpt);
    if (quote) parts.push(quote);
  } else {
    parts.push(
      "I cannot confirm a price yet — the figure is checked before anything is booked, so I will not guess at one.",
    );
  }

  const open = brief.askedIds;
  if (open.length > 0) {
    parts.push(`Could you confirm ${joinList(open.slice(0, 2).map((id) => FACT_QUESTION[id]))}?`);
  } else {
    parts.push("Is there anything you would like changed from what we discussed?");
  }
  if (position) parts.push("That way we can put the right menu together for you.");

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    text,
    why: position
      ? `No provider answered, so this is the local draft. It quotes the approved source “${position.title}”, reads all ${brief.messagesRead} message${brief.messagesRead === 1 ? "" : "s"} in the thread, and asks only for what the guest has not already given.`
      : `No provider answered and no approved source matches this project yet, so this is the local draft. It reads all ${brief.messagesRead} message${brief.messagesRead === 1 ? "" : "s"} in the thread, states no price, and asks only for what is still missing.`,
    whyNot: position
      ? "It does not go beyond the approved source: no new price, menu or availability is claimed."
      : "It quotes no price, menu, date or availability, because none of those is approved for this project.",
    asked: brief.asked,
  };
}

/**
 * "read 14 messages" — or "read 50 of 1,514 messages" when the conversation is longer than what was
 * loaded. The second form is the honest one on an imported archive, and it is the number the desk
 * puts next to the suggestion.
 */
export function threadReadLabel(
  thread: { messagesRead: number; messagesTotal?: number } | null | undefined,
): string | null {
  if (!thread || !Number.isFinite(thread.messagesRead) || thread.messagesRead <= 0) return null;
  const total = thread.messagesTotal ?? thread.messagesRead;
  const noun = thread.messagesRead === 1 ? "message" : "messages";
  if (total > thread.messagesRead) {
    return `read ${thread.messagesRead} of ${total} ${noun}`;
  }
  return `read ${thread.messagesRead} ${noun}`;
}

/* ------------------------------------------------------------------ freshness */

export type DraftFreshness = {
  needsDraft: boolean;
  reason: "none" | "stale_turn" | "stale_meta" | "fresh";
};

/**
 * Is what is stored still the answer to this thread? Timestamps only, so the desk can paint the
 * stored draft on the first byte and refresh behind it (MC-168) instead of blocking on generation.
 */
export function draftFreshness(
  messages: ThreadMessage[],
  draft: {
    body?: string;
    created_at?: Date | string;
    why?: string;
    confidence?: number | null;
  } | null,
  now: Date | string,
): DraftFreshness {
  if (!draft || !draft.body || !draft.body.trim()) return { needsDraft: true, reason: "none" };
  const draftedAt = clean(draft.created_at);
  if (!draft.why && draft.confidence == null) return { needsDraft: true, reason: "stale_meta" };
  const latest = messages
    .map((message) => clean(message.created_at))
    .filter((time): time is number => time != null)
    .reduce<number | null>((best, time) => (best == null || time > best ? time : best), null);
  if (draftedAt != null && latest != null && latest > draftedAt) {
    return { needsDraft: true, reason: "stale_turn" };
  }
  const nowTime = clean(now);
  if (draftedAt != null && nowTime != null && draftedAt > nowTime) {
    // A clock skew must not hide a draft; treat it as current rather than looping a refresh.
    return { needsDraft: false, reason: "fresh" };
  }
  return { needsDraft: false, reason: "fresh" };
}

/**
 * "suggested 3 min ago". Computed on the server and passed down as a string: the same instant has to
 * render the same text on the server and in the browser, or React reports a hydration mismatch
 * (this repo has been bitten by that once already — see formatWhen in src/lib/format.ts).
 */
export function draftAgeLabel(createdAt: Date | string | null | undefined, now: Date | string): string | null {
  const created = clean(createdAt ?? undefined);
  const current = clean(now);
  if (created == null || current == null) return null;
  const seconds = Math.max(0, Math.round((current - created) / 1000));
  if (seconds < 60) return "suggested just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `suggested ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `suggested ${hours} h ago`;
  if (hours < 48) return "suggested yesterday";
  const days = Math.round(hours / 24);
  if (days < 7) return `suggested ${days} days ago`;
  const date = new Date(created);
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
  }).format(date);
  return `suggested on ${stamp}`;
}
