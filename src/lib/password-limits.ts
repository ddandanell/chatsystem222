/**
 * Password length limits, safe to import from a client component.
 *
 * Kept apart from password-reset.ts so the reset form can state the floor without pulling
 * node:crypto into the browser bundle.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;
