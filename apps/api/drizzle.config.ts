import { defineConfig } from "drizzle-kit";

// Schema-only config: `drizzle-kit generate` reads src/db/schema.ts and emits
// SQLite migrations into ./drizzle. Applying them to D1 is done with wrangler
// (`db:migrate:local` / `db:migrate:remote`), so no D1 id/credentials are
// needed here — generate works offline without the database existing yet.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
