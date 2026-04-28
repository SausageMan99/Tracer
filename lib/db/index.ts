// ── Database access helpers ───────────────────────────────────────────────────
// We re-export the sql tag from @vercel/postgres directly so the import stays
// identical in consumer files. The library only throws on ACTUAL query
// execution, not on import, so `export const dynamic = "force-dynamic"` in
// each route handler is sufficient to prevent build-time errors.

export { sql } from "@vercel/postgres";
