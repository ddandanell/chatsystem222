/**
 * Guest language for the reviewer. Detection is local and instant.
 * The reply stays in the guest's language. why and why-not stay in English.
 * Do not auto-send. Do not invent an English translation.
 */

export type GuestLanguageCode = "en" | "id" | "other";

export type GuestLanguage = {
  code: GuestLanguageCode;
  label: string;
};

const INDONESIAN = new Set([
  "saya",
  "anda",
  "kamu",
  "kami",
  "kita",
  "yang",
  "untuk",
  "dengan",
  "tidak",
  "bisa",
  "mau",
  "harga",
  "selamat",
  "terima",
  "kasih",
  "apakah",
  "besok",
  "makan",
  "pesan",
  "tolong",
  "mohon",
  "orang",
  "malam",
  "siang",
  "pagi",
  "berapa",
  "boleh",
  "sudah",
  "belum",
  "akan",
  "dari",
  "pada",
  "ini",
  "itu",
  "bapak",
  "ibu",
  "jam",
  "acara",
]);

const ENGLISH = new Set([
  "the",
  "and",
  "for",
  "with",
  "please",
  "would",
  "could",
  "thank",
  "you",
  "dinner",
  "party",
  "can",
  "what",
  "when",
  "where",
  "have",
  "this",
  "that",
  "your",
  "our",
  "from",
  "about",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function detectGuestLanguage(text: string): GuestLanguage {
  const tokens = words(text);
  if (tokens.length === 0) return { code: "en", label: "English" };
  let indonesian = 0;
  let english = 0;
  for (const token of tokens) {
    if (INDONESIAN.has(token)) indonesian += 1;
    if (ENGLISH.has(token)) english += 1;
  }
  if (indonesian >= 2 && indonesian > english) return { code: "id", label: "Indonesian" };
  if (indonesian >= 1 && english === 0 && tokens.length <= 12) {
    return { code: "id", label: "Indonesian" };
  }
  if (english > indonesian) return { code: "en", label: "English" };
  if (indonesian === 0 && english === 0 && tokens.length >= 8) {
    return { code: "other", label: "another language" };
  }
  return { code: "en", label: "English" };
}

export function latestGuestLanguage(
  messages: { direction: string; body: string }[],
): GuestLanguage {
  const inbound = [...messages].reverse().find((message) => message.direction === "inbound");
  return detectGuestLanguage(inbound?.body ?? "");
}

/** Instruction for the drafter. why and why-not stay English so the reviewer can read them. */
export function replyLanguageLine(language: GuestLanguage): string {
  if (language.code === "id") {
    return "Guest language: Indonesian. Write the reply in Indonesian. Keep why and why_not in English for the reviewer.";
  }
  if (language.code === "other") {
    return "Guest language: not English. Write the reply in the same language as the guest's latest message. Keep why and why_not in English for the reviewer.";
  }
  return "Guest language: English. Write the reply in English.";
}

/** One line above the thread. English threads stay quiet. */
export function reviewerLanguageLine(language: GuestLanguage): string | null {
  if (language.code === "en") return null;
  if (language.code === "id") {
    return "Guest language: Indonesian. You are reading their words. The reply stays in Indonesian.";
  }
  return "Guest language is not English. You are reading their words. The reply stays in that language.";
}
