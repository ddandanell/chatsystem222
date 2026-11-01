/**
 * Copy shared by the recovery endpoint and the sheet that shows the result.
 *
 * Kept apart from password-reset.ts on purpose: that module imports node:crypto and must never be
 * pulled into a client bundle, but the confirmation an operator reads has to be the same string on
 * both sides or the two drift.
 */

/** Shown for every request, whoever made it, whether or not the account exists. */
export const NEUTRAL_FORGOT_MESSAGE =
  "If that address is registered, a reset link is on its way. It expires in 15 minutes.";

/** Only shown when the server has no mail transport configured. Global, so it reveals nothing. */
export const UNCONFIGURED_RECOVERY_MESSAGE =
  "Recovery email is not configured yet — contact the owner.";

export const RESET_MINUTES = 15;
