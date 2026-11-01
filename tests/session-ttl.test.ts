/**
 * SEC-001: an operator session lasts 12 hours from sign-in, absolutely, and never renews itself.
 *
 * Why this exists: `session: { strategy: "jwt" }` alone inherits Auth.js's 30-day JWT lifetime and
 * its rolling refresh (the cookie is re-issued once the token is older than `session.updateAge`,
 * 24 h by default). A browser left open therefore kept a 30-day bearer alive indefinitely, and a
 * copied cookie with it. `maxAge` bounds the cookie but the refresh moves that bound forward too,
 * so the cap has to be a stamp on the token rather than a lifetime on the cookie.
 *
 * These tests cover the boundary (11:59:59 alive, 12:00:00 refused), that the stamp is not
 * rewritten by a later refresh, and that `src/auth.ts` actually wires it — a helper nobody calls
 * would pass every behavioural test here and change nothing in production.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SESSION_MAX_AGE_SECONDS,
  applySessionWindow,
  sessionWindowExpired,
} from "@/lib/session-ttl";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const HOUR = 60 * 60;
const SIGNED_IN_AT = 1_800_000_000; // fixed so the boundary is exact

test("the cap is 12 hours, not 30 days", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 12 * HOUR);
  assert.equal(SESSION_MAX_AGE_SECONDS, 43_200);
  assert.notEqual(SESSION_MAX_AGE_SECONDS, 30 * 24 * HOUR);
});

test("the first issue stamps the sign-in time and stays alive", () => {
  const stamped = applySessionWindow({ sub: "user-1" }, SIGNED_IN_AT);
  assert.ok(stamped);
  assert.equal(stamped.authAt, SIGNED_IN_AT);
  assert.equal(stamped.sub, "user-1");
});

test("a refresh does not move the stamp, so it does not buy time", () => {
  const first = applySessionWindow({ sub: "user-1" }, SIGNED_IN_AT);
  assert.ok(first);
  // Auth.js refreshes roughly once a day; simulate many refreshes and check the stamp holds.
  let token = first;
  for (const offset of [HOUR, 6 * HOUR, 11 * HOUR]) {
    const next = applySessionWindow(token, SIGNED_IN_AT + offset);
    assert.ok(next, `alive at ${offset / HOUR}h`);
    assert.equal(next.authAt, SIGNED_IN_AT, "stamp must not be rewritten");
    token = next;
  }
});

test("11h59m59s is alive; exactly 12h is refused", () => {
  const token = { sub: "user-1", authAt: SIGNED_IN_AT };
  assert.equal(sessionWindowExpired(token, SIGNED_IN_AT + 12 * HOUR - 1), false);
  assert.equal(sessionWindowExpired(token, SIGNED_IN_AT + 12 * HOUR), true);
  assert.equal(sessionWindowExpired(token, SIGNED_IN_AT + 12 * HOUR + 1), true);
  assert.equal(applySessionWindow(token, SIGNED_IN_AT + 12 * HOUR), null);
});

test("a 30-day token from the old build is cut at 12 hours, not honoured", () => {
  // Tokens issued before this change carry no stamp; they are stamped on their next request and
  // then live 12 hours, so no pre-existing session survives more than 12h past this deploy.
  const legacy = { sub: "user-1", iat: SIGNED_IN_AT, exp: SIGNED_IN_AT + 30 * 24 * HOUR };
  const stamped = applySessionWindow(legacy, SIGNED_IN_AT);
  assert.ok(stamped);
  assert.equal(stamped.authAt, SIGNED_IN_AT);
  assert.equal(sessionWindowExpired(stamped, SIGNED_IN_AT + 12 * HOUR), true);
});

test("a missing or malformed stamp is stamped now, never trusted as an extension", () => {
  for (const authAt of [undefined, null, "", "soon", 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const token = applySessionWindow({ sub: "user-1", authAt }, SIGNED_IN_AT);
    assert.ok(token, String(authAt));
    assert.equal(token.authAt, SIGNED_IN_AT, String(authAt));
  }
});

test("a stamp in the future cannot extend the session", () => {
  const future = { sub: "user-1", authAt: SIGNED_IN_AT + 365 * 24 * HOUR };
  const token = applySessionWindow(future, SIGNED_IN_AT);
  assert.ok(token);
  assert.equal(token.authAt, SIGNED_IN_AT);
});

test("src/auth.ts caps the session and refuses an expired token", () => {
  const source = read("src/auth.ts");
  assert.match(source, /session:\s*\{\s*strategy:\s*"jwt",\s*maxAge:\s*SESSION_MAX_AGE_SECONDS\s*\}/);
  assert.match(source, /applySessionWindow\(token,\s*Math\.floor\(Date\.now\(\) \/ 1000\)\)/);
  assert.match(source, /if \(!windowed\) return null;/);
  assert.doesNotMatch(source, /maxAge:\s*30 \* 24/, "no 30-day session");
});
