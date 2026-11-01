/**
 * Auth.js credentials. Neon requires an approved operator. Do not auto-send.
 *
 * SEC-001: the session is 12 hours from sign-in and does not renew itself. `maxAge` bounds the
 * JWT/cookie, and `applySessionWindow` refuses a token whose first-issue stamp is 12 hours old, so
 * the rolling refresh Auth.js performs cannot extend a session indefinitely.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { userIdFromEmail, usesMychefInbox } from "@/db/mode";
import { verifyOperator } from "@/lib/operators";
import { SESSION_MAX_AGE_SECONDS, applySessionWindow } from "@/lib/session-ttl";
import { findOrCreateUser } from "@/lib/workspace-access";

const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        name: { label: "Name", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const name = String(credentials?.name ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!emailPattern.test(email)) return null;
        if (usesMychefInbox()) {
          const operator = await verifyOperator(email, password);
          if (!operator) return null;
          return {
            id: userIdFromEmail(email),
            email: operator.email,
            name: operator.name,
          };
        }
        const user = await findOrCreateUser(email, name || null);
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
        };
      },
    }),
    ...(googleEnabled ? [Google] : []),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        const row = await findOrCreateUser(user.email, user.name ?? null);
        token.sub = row.id;
      } else if (user?.id) {
        token.sub = user.id;
      }
      // Absolute 12-hour cap. Returning null discards the session, so the next request is
      // treated as signed out and the operator signs in again.
      const windowed = applySessionWindow(token, Math.floor(Date.now() / 1000));
      if (!windowed) return null;
      token.authAt = windowed.authAt;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
