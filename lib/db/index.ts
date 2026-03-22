import { sql } from "@vercel/postgres";

export { sql };

export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const result = await sql`SELECT tier FROM users WHERE id = ${userId}`;
  return (result.rows[0]?.tier as "free" | "pro") ?? "free";
}

export async function setUserTier(userId: string, tier: "free" | "pro"): Promise<void> {
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}
