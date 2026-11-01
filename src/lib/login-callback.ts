/**
 * Where an operator lands after signing in.
 *
 * The proxy records the page it refused and /login hands that value back to loginAction, so a deep
 * link — one conversation, a filtered queue, a candidates tab — survives the trip through the login
 * form. Before this, the proxy wrote `callbackUrl` and nothing read it: every sign-in, from any URL,
 * ended at /mychef/inbox, and the recorded value also dropped the query string.
 *
 * Only a same-origin path is accepted. A scheme, a protocol-relative `//host`, a backslash or a
 * control character is refused, so the parameter cannot become an open redirect.
 */

const MAX_LENGTH = 2000;

/** A usable internal path, or null when the value cannot be trusted as one. */
export function safeCallbackTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/")) return null;
  // `//host` and `/\host` are absolute URLs to a browser, not paths on this site.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.includes("\\")) return null;
  // Control characters, newlines included, have no business in a redirect target.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/**
 * The `callbackUrl` the proxy puts on /login: the refused pathname plus its query string.
 *
 * Returns null when there is nothing to preserve, so a plain visit to the site still lands on the
 * console root after sign-in instead of carrying a pointless `/?`.
 */
export function loginCallback(pathname: string, search?: string | null): string | null {
  const path = typeof pathname === "string" && pathname.trim() ? pathname.trim() : "/";
  const query = typeof search === "string" ? search.trim() : "";
  const suffix = query === "" || query === "?" ? "" : query.startsWith("?") ? query : `?${query}`;
  const target = safeCallbackTarget(`${path}${suffix}`);
  return target === null || target === "/" ? null : target;
}
