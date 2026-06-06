/**
 * Drizzle client factory for the D1 binding.
 *
 * Usage in a route handler:
 *   import { getDb } from "../db/client";
 *   const db = getDb(c.env);
 *   const rows = await db.select().from(schema.bots);
 */
import { drizzle } from "drizzle-orm/d1";

import { schema } from "./schema";
import type { Env } from "../index";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

export { schema };
