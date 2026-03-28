import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "@vercel/postgres";

async function main() {
  const schemaPath = join(process.cwd(), "lib", "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const statements = schema
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Executing ${statements.length} statements...`);

  for (const statement of statements) {
    console.log(`  → ${statement.slice(0, 60)}...`);
    await sql.query(statement);
  }

  console.log("Database schema initialized successfully.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
