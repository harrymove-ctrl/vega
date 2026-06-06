/**
 * Cloudflare Worker entrypoint for the Vega API.
 *
 * `Env` is the binding contract from wrangler.jsonc:
 *   - DB          : the D1 binding ("DB")
 *   - AUTH_SECRET : HMAC session secret (set via `wrangler secret put AUTH_SECRET`)
 *
 * Resource-specific secrets (e.g. TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY) are
 * added here by later router agents as they land.
 */
import { app } from "./app";

export interface Env {
  DB: D1Database;
  AUTH_SECRET: string;
  // Reserved for resource routers (set via `wrangler secret put …`):
  TELEGRAM_BOT_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  // Readiness upstream overrides (non-secret config; optional [vars]):
  VALUECHAIN_RPC?: string;
  SODEX_SPOT_BASE?: string;
  SODEX_BUILDER_CODE?: string;
}

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
