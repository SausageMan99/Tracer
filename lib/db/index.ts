// ── Database access helpers ───────────────────────────────────────────────────
// We re-export the sql tag from @vercel/postgres directly so the import stays
// identical in consumer files. The library only throws on ACTUAL query
// execution, not on import, so `export const dynamic = "force-dynamic"` in
// each route handler is sufficient to prevent build-time errors.

export { sql } from "@vercel/postgres";

export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const { sql } = await import("@vercel/postgres");
  const result = await sql`SELECT tier FROM users WHERE id = ${userId}`;
  return (result.rows[0]?.tier as "free" | "pro") ?? "free";
}

export async function setUserTier(userId: string, tier: "free" | "pro"): Promise<void> {
  const { sql } = await import("@vercel/postgres");
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}
