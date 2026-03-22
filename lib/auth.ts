import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import PostgresAdapter from "@auth/pg-adapter";
import { createPool } from "@vercel/postgres";
import type { Pool } from "@vercel/postgres";

// ── Database pool (lazy — only connects when a request hits an auth route) ────

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

// ── NextAuth config ───────────────────────────────────────────────────────────

export const authConfig: NextAuthConfig = {
  adapter: PostgresAdapter(getPool() as unknown as import("pg").Pool),

  session: {
    strategy: "jwt",
  },

  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),

    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  callbacks: {
    jwt({ token, user }): JWT {
      if (user?.id) {
        return { ...token, id: user.id };
      }
      return token;
    },

    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.id as string,
        },
      };
    },
  },

  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify-request",
    error: "/auth/error",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
