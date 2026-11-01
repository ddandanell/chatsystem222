/**
 * Display helpers. Times for operators use Asia/Kuala_Lumpur. Do not auto-send.
 */
export function formatWhenKl(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/**
 * Same instant, same string on the server and in the browser.
 * A locale/timezone-derived string here produced a hydration mismatch on every
 * conversation route (React #418) because the server renders in Asia/Kuala_Lumpur.
 */
export function formatWhen(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatConfidence(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(number)) return String(value);
  if (number >= 0 && number <= 1) return `${Math.round(number * 100)}%`;
  return String(number);
}

export function excerpt(text: string, length = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  return `${flat.slice(0, length - 1).trimEnd()}…`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function roleLabel(role: string): string {
  if (!role) return role;
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

/**
 * Avatar initials that survive a non-BMP first character.
 *
 * The old version in queue-pane.tsx and desk-review.tsx read `part[0]`, one UTF-16 code unit. A
 * contact whose name starts with an emoji therefore produced a lone high surrogate: the HTML
 * carried the raw unit, the RSC payload escaped it, and React reported error #418 on
 * /mychef/inbox ("server rendered text didn't match the client"). Array.from() takes whole code
 * points, so server and browser render the same string. 3 of 120 live needs_reply contacts in the
 * mychef workspace carry an astral character; one starts with one.
 */
export function initials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}
