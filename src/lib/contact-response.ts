/**
 * Contact response desk timers (Started / Waiting / avg replies).
 * Purpose: compute SLA strip from mychef_inbox.messages only — no DDL.
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/contact-response-desk.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-design-system.md
 */

export type DeskMessage = {
  direction: string;
  created_at: Date | string;
};

export type WaitingTone = "calm" | "warn" | "urgent" | "idle";

export type ContactResponseMetrics = {
  startedAt: Date | null;
  startedLabel: string;
  waitingLabel: string;
  waitingAbsolute: string;
  waitingTone: WaitingTone;
  waitingOnGuest: boolean;
  yourAvgReplyLabel: string;
  guestAvgReplyLabel: string;
  averagesHint: string | null;
  lastActivityAt: Date | null;
  lastActivityLabel: string;
};

const KL = "Asia/Kuala_Lumpur";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatKl(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KL,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < HOUR) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return `${minutes}m`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms % HOUR) / 60000);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function replyAverages(messages: DeskMessage[]): {
  staff: number | null;
  guest: number | null;
} {
  const ordered = [...messages]
    .map((message) => ({
      direction: message.direction,
      at: asDate(message.created_at),
    }))
    .filter((message): message is { direction: string; at: Date } => Boolean(message.at))
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const staff: number[] = [];
  const guest: number[] = [];
  let pendingInbound: Date | null = null;
  let pendingOutbound: Date | null = null;

  for (const message of ordered) {
    const inbound = message.direction === "inbound";
    if (inbound) {
      if (pendingOutbound) {
        guest.push(message.at.getTime() - pendingOutbound.getTime());
        pendingOutbound = null;
      }
      if (!pendingInbound) pendingInbound = message.at;
    } else {
      if (pendingInbound) {
        staff.push(message.at.getTime() - pendingInbound.getTime());
        pendingInbound = null;
      }
      pendingOutbound = message.at;
    }
  }

  return { staff: mean(staff), guest: mean(guest) };
}

export function computeContactResponseMetrics(
  messages: DeskMessage[],
  lastMessageAt?: Date | string | null,
  now = new Date(),
): ContactResponseMetrics {
  const ordered = [...messages]
    .map((message) => ({
      direction: message.direction,
      at: asDate(message.created_at),
    }))
    .filter((message): message is { direction: string; at: Date } => Boolean(message.at))
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const startedAt = ordered[0]?.at ?? null;
  const last = ordered[ordered.length - 1] ?? null;
  const lastActivityAt = asDate(lastMessageAt) ?? last?.at ?? null;
  const averages = replyAverages(messages);

  let waitingLabel = "—";
  let waitingAbsolute = "—";
  let waitingTone: WaitingTone = "idle";
  let waitingOnGuest = false;

  if (last) {
    const elapsed = now.getTime() - last.at.getTime();
    waitingAbsolute = formatKl(last.at);
    if (last.direction === "inbound") {
      waitingLabel = formatRelativeDuration(elapsed);
      waitingOnGuest = false;
      if (elapsed > DAY) waitingTone = "urgent";
      else if (elapsed >= 4 * HOUR) waitingTone = "warn";
      else waitingTone = "calm";
    } else {
      waitingOnGuest = true;
      waitingLabel = `Waiting on guest · ${formatRelativeDuration(elapsed)}`;
      waitingTone = "idle";
    }
  }

  const averagesHint =
    averages.staff == null && averages.guest == null ? "Not enough turns yet." : null;

  return {
    startedAt,
    startedLabel: startedAt ? formatKl(startedAt) : "—",
    waitingLabel,
    waitingAbsolute,
    waitingTone,
    waitingOnGuest,
    yourAvgReplyLabel: averages.staff != null ? formatRelativeDuration(averages.staff) : "—",
    guestAvgReplyLabel: averages.guest != null ? formatRelativeDuration(averages.guest) : "—",
    averagesHint,
    lastActivityAt,
    lastActivityLabel: lastActivityAt ? formatKl(lastActivityAt) : "—",
  };
}

/**
 * MC-181: the thread's whole clock is one line above the messages, so the response strip stops
 * eating the column. The five metrics keep living in Context > Client; this is the summary the
 * reviewer needs while reading. Pure, so the wording is testable without a DOM.
 */
function clockStamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KL,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function threadClockLabel(metrics: ContactResponseMetrics): string {
  if (!metrics.lastActivityAt && metrics.waitingLabel === "—") return "No messages yet";
  const waiting = metrics.waitingOnGuest
    ? metrics.waitingLabel
    : `Waiting ${metrics.waitingLabel}`;
  const last = metrics.lastActivityAt
    ? clockStamp(metrics.lastActivityAt)
    : metrics.lastActivityLabel;
  return `${waiting} · last ${last}`;
}
