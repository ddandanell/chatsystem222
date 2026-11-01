/**
 * What an error screen is allowed to say. MC-141.
 *
 * Printing `error.message` straight into the page has two problems: in production it is usually the
 * generic Next.js sentence (no help to anyone), and when it is not, it can carry a database string,
 * a file path or a stack frame. The operator needs three things instead: that the panel failed, that
 * nothing was sent, and a reference they can quote to engineering.
 *
 * Rules (tested in tests/error-copy.test.ts):
 * - Outside production the raw message is shown, because only developers see dev builds.
 * - In production a message is shown only if it is short, single-line and free of internal markers
 *   (SQL, connection errors, stacks, secret words, minified React codes). Otherwise the fixed
 *   sentence is shown. The digest — an opaque hash Next.js computes — is always safe to show.
 *
 * Pure, so this is a test rather than a convention.
 */

export interface ErrorCopy {
  title: string;
  detail: string;
  /** `Reference <digest>` when Next.js computed one, else null. */
  reference: string | null;
  /** True when the raw message reached the screen. Never true in production. */
  showsRawMessage: boolean;
}

const FALLBACK_DETAIL =
  "This panel failed to load. Nothing was sent to a guest and no decision was recorded. Try again; if it keeps failing, quote the reference below.";

/** Anything that looks like an internal detail rather than a sentence written for a person. */
const INTERNAL =
  /postgres|pg_|ECONN|ETIMEDOUT|scrypt|password|secret|at\s+\S+\s+\(?\S*:\d+:\d+|invalid input syntax|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|mychef_inbox|Minified React error/i;

const MAX_DETAIL = 160;

export function errorCopy(input: {
  message?: string | null;
  digest?: string | null;
  production: boolean;
}): ErrorCopy {
  const digest = input.digest?.trim() ? input.digest.trim() : null;
  const message = input.message?.trim() ?? "";
  const reference = digest ? `Reference ${digest}` : null;

  if (!input.production) {
    return {
      title: "This panel failed to load",
      detail: message || FALLBACK_DETAIL,
      reference,
      showsRawMessage: Boolean(message),
    };
  }

  const safe =
    message.length > 0 &&
    message.length <= MAX_DETAIL &&
    !message.includes("\n") &&
    !INTERNAL.test(message);

  return {
    title: "This panel failed to load",
    detail: safe ? message : FALLBACK_DETAIL,
    reference,
    showsRawMessage: false,
  };
}
