/**
 * Vega backend schema — Drizzle ORM (SQLite / Cloudflare D1).
 *
 * Mirrors the data model in
 *   plans/20260606-vega-fullflow-audit/p1d-backend-contract-and-plan.md §2
 * adapted from Postgres → SQLite:
 *   - JSONB columns become `text({ mode: "json" })` (stored as TEXT, parsed on read).
 *   - booleans become `integer({ mode: "boolean" })` (0/1).
 *   - timestamps are ISO-8601 strings in TEXT (what every frontend type expects:
 *     `created_at: string`, `updated_at: string`, etc.).
 *
 * Column names are snake_case to match the JSON the frontend dereferences
 * (e.g. owner_address, rules_json, market_scope). Router agents should select
 * these columns directly into the response shapes from apps/web/src/lib/*.
 */
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ---------------------------------------------------------------------------
// users — wallet-address identity (lowercased 0x address is the PK)
// ---------------------------------------------------------------------------
export const users = sqliteTable("users", {
  walletAddress: text("wallet_address").primaryKey(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull().default(nowSql),
  lastSeen: text("last_seen").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// bots (a.k.a. strategies / bot_definitions) — the authored strategy
// ---------------------------------------------------------------------------
export const bots = sqliteTable("bots", {
  id: text("id").primaryKey(), // app-generated (crypto.randomUUID())
  ownerAddress: text("owner_address")
    .notNull()
    .references(() => users.walletAddress),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // visibility: 'private' | 'unlisted' | 'public'
  visibility: text("visibility").notNull().default("private"),
  // authoring_mode: 'visual' | 'code' | 'ai'
  authoringMode: text("authoring_mode").notNull().default("visual"),
  // strategy_type: free-form classifier surfaced in fleet/marketplace rows
  strategyType: text("strategy_type").notNull().default("custom"),
  // market_scope: e.g. 'perps:BTC-USD' / 'multi' / 'spot:*'
  marketScope: text("market_scope").notNull().default(""),
  // rules_json: the full strategy graph / DSL the builder produces
  rulesJson: text("rules_json", { mode: "json" }),
  rulesVersion: integer("rules_version").notNull().default(1),
  // status: 'draft' | 'deployed' | 'paused' | 'stopped' | 'error'
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// bot_runtimes — a deployed instance of a bot ('wallet-in-loop')
// ---------------------------------------------------------------------------
export const botRuntimes = sqliteTable("bot_runtimes", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id),
  ownerAddress: text("owner_address")
    .notNull()
    .references(() => users.walletAddress),
  // status: 'active' | 'paused' | 'stopped' | 'error'
  status: text("status").notNull().default("active"),
  // runtime_kind: 'wallet-in-loop' (default), reserved for future modes
  runtimeKind: text("runtime_kind").notNull().default("wallet-in-loop"),
  // mode mirrors RuntimeSummary.mode in fleet-observability.ts
  mode: text("mode").notNull().default("live"),
  // risk_policy_json: runtime controls/policy posted at deploy time
  riskPolicyJson: text("risk_policy_json", { mode: "json" }),
  startedAt: text("started_at").notNull().default(nowSql),
  stoppedAt: text("stopped_at"),
  lastHeartbeat: text("last_heartbeat"),
  // summary: rolled-up health/metrics/performance snapshot (RuntimeOverview-ish)
  summary: text("summary", { mode: "json" }),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// runs — a single execution window reported by StrategyRuntime
// ---------------------------------------------------------------------------
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id),
  runtimeId: text("runtime_id").references(() => botRuntimes.id),
  ownerAddress: text("owner_address")
    .notNull()
    .references(() => users.walletAddress),
  startedAt: text("started_at").notNull().default(nowSql),
  stoppedAt: text("stopped_at"),
  realizedPnl: real("realized_pnl").notNull().default(0),
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
  nOrders: integer("n_orders").notNull().default(0),
  // summary: full PnL/positions snapshot the leaderboard + overviews read from
  summary: text("summary", { mode: "json" }),
  createdAt: text("created_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// marketplace_listings — a published bot card (marketplace/leaderboard)
// ---------------------------------------------------------------------------
export const marketplaceListings = sqliteTable("marketplace_listings", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id),
  creatorAddress: text("creator_address")
    .notNull()
    .references(() => users.walletAddress),
  headline: text("headline").notNull().default(""),
  accessNote: text("access_note").notNull().default(""),
  // visibility / access_mode / publish_state drive MarketplacePublishingSummary
  visibility: text("visibility").notNull().default("public"),
  accessMode: text("access_mode").notNull().default("open"),
  publishState: text("publish_state").notNull().default("draft"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  featuredRank: integer("featured_rank").notNull().default(0),
  collectionKey: text("collection_key"),
  // stats: trust/drift/copy_stats blob surfaced on listing rows
  stats: text("stats", { mode: "json" }),
  // invite_wallet_addresses for access_mode === 'invite'
  inviteJson: text("invite_json", { mode: "json" }),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// copies — copy-trading relationship metadata (NO fund flow)
// ---------------------------------------------------------------------------
export const copies = sqliteTable("copies", {
  id: text("id").primaryKey(),
  sourceBotId: text("source_bot_id")
    .notNull()
    .references(() => bots.id),
  sourceRuntimeId: text("source_runtime_id").references(() => botRuntimes.id),
  copierAddress: text("copier_address")
    .notNull()
    .references(() => users.walletAddress),
  // mode: 'mirror' | 'clone'
  mode: text("mode").notNull().default("mirror"),
  // status: 'active' | 'paused' | 'stopped'
  status: text("status").notNull().default("active"),
  scaleBps: integer("scale_bps").notNull().default(10000),
  maxNotionalUsd: real("max_notional_usd"),
  // settings: per-relationship overrides surfaced in copy dashboard
  settings: text("settings", { mode: "json" }),
  confirmedAt: text("confirmed_at").notNull().default(nowSql),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// portfolios — copy baskets (legs/members metadata only)
// ---------------------------------------------------------------------------
export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(),
  ownerAddress: text("owner_address")
    .notNull()
    .references(() => users.walletAddress),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // status: 'active' | 'paused' | 'draft'
  status: text("status").notNull().default("draft"),
  rebalanceMode: text("rebalance_mode").notNull().default("drift"),
  rebalanceIntervalMinutes: integer("rebalance_interval_minutes")
    .notNull()
    .default(60),
  driftThresholdPct: real("drift_threshold_pct").notNull().default(6),
  targetNotionalUsd: real("target_notional_usd").notNull().default(0),
  currentNotionalUsd: real("current_notional_usd").notNull().default(0),
  killSwitchReason: text("kill_switch_reason"),
  lastRebalancedAt: text("last_rebalanced_at"),
  // legs: PortfolioBasketMember[] (members + weights)
  legs: text("legs", { mode: "json" }),
  // risk_policy: PortfolioRiskPolicy
  riskPolicy: text("risk_policy", { mode: "json" }),
  // rebalance_history: PortfolioRebalanceEvent[]
  rebalanceHistory: text("rebalance_history", { mode: "json" }),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// telegram_links — Telegram connection per wallet (TelegramConnectionStatus)
// ---------------------------------------------------------------------------
export const telegramLinks = sqliteTable("telegram_links", {
  walletAddress: text("wallet_address")
    .primaryKey()
    .references(() => users.walletAddress),
  chatId: text("chat_id"),
  telegramUsername: text("telegram_username"),
  telegramFirstName: text("telegram_first_name"),
  chatLabel: text("chat_label"),
  connected: integer("connected", { mode: "boolean" }).notNull().default(false),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  // notification_prefs: TelegramNotificationPrefs
  notificationPrefs: text("notification_prefs", { mode: "json" }),
  // deeplink/link state surfaced before a chat is bound
  linkToken: text("link_token"),
  linkExpiresAt: text("link_expires_at"),
  connectedAt: text("connected_at"),
  lastInteractionAt: text("last_interaction_at"),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// backtest_runs — queued/compute backtests over SoDEX klines
// ---------------------------------------------------------------------------
export const backtestRuns = sqliteTable("backtest_runs", {
  id: text("id").primaryKey(),
  ownerAddress: text("owner_address")
    .notNull()
    .references(() => users.walletAddress),
  botId: text("bot_id").references(() => bots.id),
  botNameSnapshot: text("bot_name_snapshot").notNull().default(""),
  marketScopeSnapshot: text("market_scope_snapshot"),
  strategyTypeSnapshot: text("strategy_type_snapshot"),
  interval: text("interval").notNull().default("1h"),
  startTime: integer("start_time"),
  endTime: integer("end_time"),
  initialCapitalUsd: real("initial_capital_usd").notNull().default(0),
  executionModel: text("execution_model").notNull().default("standard"),
  // params: BacktestRunRequestPayload (assumptions, range, etc.)
  params: text("params", { mode: "json" }),
  // rules_snapshot_json: the bot rules captured at run time
  rulesSnapshotJson: text("rules_snapshot_json", { mode: "json" }),
  // status: 'queued' | 'running' | 'completed' | 'failed'
  status: text("status").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  // result: BacktestResult (equity_curve, trades, summary, …)
  result: text("result", { mode: "json" }),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql),
  completedAt: text("completed_at"),
});

// ---------------------------------------------------------------------------
// auth_nonces — short-lived signed-challenge nonces (issued by /api/auth/nonce)
// ---------------------------------------------------------------------------
export const authNonces = sqliteTable("auth_nonces", {
  address: text("address").primaryKey(), // lowercased 0x address
  nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(), // epoch ms
  createdAt: text("created_at").notNull().default(nowSql),
});

// ---------------------------------------------------------------------------
// auth_sessions — OPTIONAL server-side session record. Session tokens are
// self-contained HMAC tokens, so this table is for revocation/audit only and
// is not required on the verify path.
// ---------------------------------------------------------------------------
export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  address: text("address")
    .notNull()
    .references(() => users.walletAddress),
  issuedAt: integer("issued_at").notNull(), // epoch ms
  expiresAt: integer("expires_at").notNull(), // epoch ms
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(nowSql),
});

export const schema = {
  users,
  bots,
  botRuntimes,
  runs,
  marketplaceListings,
  copies,
  portfolios,
  telegramLinks,
  backtestRuns,
  authNonces,
  authSessions,
};
