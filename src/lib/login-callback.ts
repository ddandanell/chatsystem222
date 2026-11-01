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
 *
 * The login page itself is also refused. `/login?callbackUrl=/login` is same-origin and harmless
 * alone, but after a successful sign-in it sends the browser back to /login, where the
 * already-signed-in bounce sends it to /login again — a redirect loop that ends in
 * ERR_TOO_MANY_REDIRECTS on the one page an operator needs when something is wrong.
 */

const MAX_LENGTH = 2000;

/** The pathname of a target, without query or fragment. */
function pathnameOf(target: string): string {
  const end = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

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
  // A target that is the login page would bounce the operator straight back here.
  const pathname = pathnameOf(raw).toLowerCase();
  if (pathname === "/login" || pathname.startsWith("/login/")) return null;
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
