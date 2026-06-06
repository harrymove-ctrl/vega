/**
 * /api/marketplace — public discovery surface + creator-scoped publishing.
 *
 * Reads marketplace_listings JOINed to bots (the authored strategy) and rolls
 * up leaderboard-style stats from runs / bot_runtimes / copies. All response
 * shapes are dereferenced verbatim by the frontend; they MUST match the types
 * in apps/web/src/lib/public-bots.ts and the demo stub in
 * apps/web/src/lib/disable-missing-backend.ts:
 *
 *   GET  /overview      -> { discover, featured, creators }      (MarketplaceOverview)
 *   GET  /discover      -> MarketplaceDiscoveryRow[]
 *   GET  /featured      -> FeaturedShelf[]
 *   GET  /creators      -> CreatorHighlight[]
 *   GET  /creators/:id  -> MarketplaceCreatorProfile
 *   GET  /publishing/:botId   -> PublishingSettings   (owner-scoped read, wallet_address query)
 *   PATCH /publishing/:botId  -> PublishingSettings   (write, requireAuth)
 *
 * Only `publish_state === 'published'` + `visibility === 'public'` listings are
 * surfaced publicly. The creator_id is the (lowercased) wallet_address.
 */
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";

import type { AppEnv } from "../app";
import { getDb, schema } from "../db/client";
import type { Db } from "../db/client";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Stat derivation helpers
// ---------------------------------------------------------------------------

type BotRow = typeof schema.bots.$inferSelect;
type ListingRow = typeof schema.marketplaceListings.$inferSelect;
type RuntimeRow = typeof schema.botRuntimes.$inferSelect;
type RunRow = typeof schema.runs.$inferSelect;
type CopyRow = typeof schema.copies.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

type TrustBadge = { label: string; tone: string; detail: string };

type TrustMetrics = {
  trust_score: number;
  uptime_pct: number;
  failure_rate_pct: number;
  health: string;
  heartbeat_age_seconds: number;
  risk_grade: string;
  risk_score: number;
  summary: string;
  badges: TrustBadge[];
};

type DriftMetrics = {
  status: string;
  score: number;
  summary: string;
  live_pnl_pct: number | null;
  benchmark_pnl_pct: number | null;
  return_gap_pct: number | null;
  live_drawdown_pct: number;
  benchmark_drawdown_pct: number | null;
  drawdown_gap_pct: number | null;
  benchmark_run_id: string | null;
  benchmark_completed_at: string | null;
};

type StrategyPassport = {
  market_scope: string;
  strategy_type: string;
  authoring_mode: string;
  rules_version: number;
  current_version: number;
  release_count: number;
  public_since: string | null;
  last_published_at: string | null;
  latest_backtest_at: string | null;
  latest_backtest_run_id: string | null;
  version_history: unknown[];
  publish_history: unknown[];
};

type CreatorSummary = {
  creator_id: string;
  wallet_address: string;
  display_name: string;
  public_bot_count: number;
  active_runtime_count: number;
  mirror_count: number;
  active_mirror_count: number;
  clone_count: number;
  average_trust_score: number;
  best_rank: number | null;
  reputation_score: number;
  reputation_label: string;
  summary: string;
  tags: string[];
};

type MarketplaceCopyStats = {
  mirror_count: number;
  active_mirror_count: number;
  clone_count: number;
};

type MarketplacePublishingSummary = {
  visibility: string;
  access_mode: string;
  publish_state: string;
  hero_headline: string;
  access_note: string;
  featured_collection_title: string | null;
  featured_rank: number;
  is_featured: boolean;
  invite_count: number;
};

type MarketplaceCreatorSummary = CreatorSummary & {
  headline: string;
  bio: string;
  slug: string;
  follower_count: number;
  featured_bot_count: number;
  marketplace_reach_score: number;
};

type MarketplaceDiscoveryRow = {
  runtime_id: string;
  bot_definition_id: string;
  bot_name: string;
  strategy_type: string;
  authoring_mode: string;
  rank: number;
  pnl_total: number;
  pnl_unrealized: number;
  win_streak: number;
  drawdown: number;
  captured_at: string;
  trust: TrustMetrics;
  drift: DriftMetrics;
  passport: StrategyPassport;
  creator: MarketplaceCreatorSummary;
  copy_stats: MarketplaceCopyStats;
  publishing: MarketplacePublishingSummary;
};

/** Numeric coercion that tolerates string JSON values. */
function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Aggregate realized + unrealized PnL and order count across a bot's runs. */
function aggregateRuns(rows: RunRow[]): {
  pnl_total: number;
  pnl_unrealized: number;
  pnl_realized: number;
  n_orders: number;
  last_at: string | null;
} {
  let realized = 0;
  let unrealized = 0;
  let nOrders = 0;
  let lastAt: string | null = null;
  for (const run of rows) {
    realized += num(run.realizedPnl);
    unrealized += num(run.unrealizedPnl);
    nOrders += num(run.nOrders);
    const at = run.stoppedAt ?? run.startedAt ?? run.createdAt ?? null;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }
  return {
    pnl_total: round2(realized + unrealized),
    pnl_unrealized: round2(unrealized),
    pnl_realized: round2(realized),
    n_orders: nOrders,
    last_at: lastAt,
  };
}

/**
 * Derive trust metrics from a listing's persisted `stats` blob when present,
 * otherwise synthesize a neutral, honest baseline from runtime health. Never
 * fabricates a high score — an un-run bot reports a low/neutral trust_score.
 */
function deriveTrust(
  listing: ListingRow,
  runtime: RuntimeRow | undefined,
  agg: { n_orders: number; pnl_total: number },
): TrustMetrics {
  const stats = asRecord(listing.stats);
  const persisted = asRecord(stats.trust);
  if (Object.keys(persisted).length > 0) {
    return {
      trust_score: num(persisted.trust_score),
      uptime_pct: num(persisted.uptime_pct),
      failure_rate_pct: num(persisted.failure_rate_pct),
      health: typeof persisted.health === "string" ? persisted.health : "unknown",
      heartbeat_age_seconds: num(persisted.heartbeat_age_seconds),
      risk_grade: typeof persisted.risk_grade === "string" ? persisted.risk_grade : "unrated",
      risk_score: num(persisted.risk_score),
      summary: typeof persisted.summary === "string" ? persisted.summary : "",
      badges: Array.isArray(persisted.badges) ? (persisted.badges as TrustBadge[]) : [],
    };
  }

  const active = runtime?.status === "active";
  const heartbeat = runtime?.lastHeartbeat ?? null;
  const heartbeatAge = heartbeat
    ? Math.max(0, Math.round((Date.now() - Date.parse(heartbeat)) / 1000))
    : 0;
  // Honest baseline: no run history -> low trust; active runtime with orders
  // earns a modest score. This is metadata-only, not a fabricated track record.
  const baseScore = agg.n_orders > 0 ? 55 : 30;
  const trustScore = active ? baseScore + 10 : baseScore;
  return {
    trust_score: trustScore,
    uptime_pct: active ? 100 : 0,
    failure_rate_pct: 0,
    health: active ? "healthy" : "idle",
    heartbeat_age_seconds: heartbeatAge,
    risk_grade: "unrated",
    risk_score: 0,
    summary: active
      ? "Active runtime, limited public track record."
      : "No active runtime yet.",
    badges: [],
  };
}

function deriveDrift(agg: { pnl_total: number }): DriftMetrics {
  return {
    status: "unknown",
    score: 0,
    summary: "Benchmark drift not yet computed.",
    live_pnl_pct: null,
    benchmark_pnl_pct: null,
    return_gap_pct: null,
    live_drawdown_pct: 0,
    benchmark_drawdown_pct: null,
    drawdown_gap_pct: null,
    benchmark_run_id: null,
    benchmark_completed_at: null,
  };
}

function buildPassport(bot: BotRow, listing: ListingRow): StrategyPassport {
  return {
    market_scope: bot.marketScope ?? "",
    strategy_type: bot.strategyType ?? "custom",
    authoring_mode: bot.authoringMode ?? "visual",
    rules_version: num(bot.rulesVersion, 1),
    current_version: num(bot.rulesVersion, 1),
    release_count: listing.publishState === "published" ? 1 : 0,
    public_since: listing.publishedAt ?? null,
    last_published_at: listing.publishedAt ?? null,
    latest_backtest_at: null,
    latest_backtest_run_id: null,
    version_history: [],
    publish_history: [],
  };
}

function copyStats(copies: CopyRow[]): MarketplaceCopyStats {
  let mirror = 0;
  let activeMirror = 0;
  let clone = 0;
  for (const c of copies) {
    if (c.mode === "clone") {
      clone += 1;
    } else {
      mirror += 1;
      if (c.status === "active") activeMirror += 1;
    }
  }
  return { mirror_count: mirror, active_mirror_count: activeMirror, clone_count: clone };
}

function publishingSummary(listing: ListingRow): MarketplacePublishingSummary {
  const invite = listing.inviteJson;
  const inviteCount = Array.isArray(invite) ? invite.length : 0;
  return {
    visibility: listing.visibility,
    access_mode: listing.accessMode,
    publish_state: listing.publishState,
    hero_headline: listing.headline ?? "",
    access_note: listing.accessNote ?? "",
    featured_collection_title: listing.collectionKey ?? null,
    featured_rank: num(listing.featuredRank),
    is_featured: Boolean(listing.featured),
    invite_count: inviteCount,
  };
}

function reputationLabel(score: number): string {
  if (score >= 80) return "Elite";
  if (score >= 60) return "Established";
  if (score >= 40) return "Rising";
  if (score > 0) return "New";
  return "Unranked";
}

// ---------------------------------------------------------------------------
// Bulk loaders — load every published listing + dependencies in one pass.
// ---------------------------------------------------------------------------

type LoadedRow = {
  listing: ListingRow;
  bot: BotRow;
  runtime: RuntimeRow | undefined;
  runs: RunRow[];
  copies: CopyRow[];
  agg: ReturnType<typeof aggregateRuns>;
};

/**
 * Load published, public listings joined to their bot, then attach runtime /
 * runs / copies. Returns rows sorted by pnl_total desc with a 1-based `rank`.
 */
async function loadPublishedRows(db: Db, creatorId?: string): Promise<LoadedRow[]> {
  const conds = [
    eq(schema.marketplaceListings.publishState, "published"),
    eq(schema.marketplaceListings.visibility, "public"),
  ];
  if (creatorId) {
    conds.push(eq(schema.marketplaceListings.creatorAddress, creatorId));
  }
  const listings = await db
    .select()
    .from(schema.marketplaceListings)
    .where(and(...conds));

  if (listings.length === 0) return [];

  const botIds = [...new Set(listings.map((l) => l.botId))];
  const [botRows, runtimeRows, runRows, copyRows] = await Promise.all([
    db.select().from(schema.bots).where(inArray(schema.bots.id, botIds)),
    db.select().from(schema.botRuntimes).where(inArray(schema.botRuntimes.botId, botIds)),
    db.select().from(schema.runs).where(inArray(schema.runs.botId, botIds)),
    db.select().from(schema.copies).where(inArray(schema.copies.sourceBotId, botIds)),
  ]);

  const botById = new Map(botRows.map((b) => [b.id, b]));
  // Pick the most recently started runtime per bot.
  const runtimeByBot = new Map<string, RuntimeRow>();
  for (const rt of runtimeRows) {
    const existing = runtimeByBot.get(rt.botId);
    if (!existing || (rt.startedAt ?? "") > (existing.startedAt ?? "")) {
      runtimeByBot.set(rt.botId, rt);
    }
  }
  const runsByBot = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const arr = runsByBot.get(run.botId) ?? [];
    arr.push(run);
    runsByBot.set(run.botId, arr);
  }
  const copiesByBot = new Map<string, CopyRow[]>();
  for (const c of copyRows) {
    const arr = copiesByBot.get(c.sourceBotId) ?? [];
    arr.push(c);
    copiesByBot.set(c.sourceBotId, arr);
  }

  const rows: LoadedRow[] = [];
  for (const listing of listings) {
    const bot = botById.get(listing.botId);
    if (!bot) continue; // orphaned listing — skip rather than crash
    const botRuns = runsByBot.get(listing.botId) ?? [];
    rows.push({
      listing,
      bot,
      runtime: runtimeByBot.get(listing.botId),
      runs: botRuns,
      copies: copiesByBot.get(listing.botId) ?? [],
      agg: aggregateRuns(botRuns),
    });
  }

  rows.sort((a, b) => b.agg.pnl_total - a.agg.pnl_total);
  return rows;
}

/** Load display names for a set of creator (wallet) addresses. */
async function loadCreatorUsers(db: Db, addresses: string[]): Promise<Map<string, UserRow>> {
  const unique = [...new Set(addresses)];
  if (unique.length === 0) return new Map();
  const users = await db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.walletAddress, unique));
  return new Map(users.map((u) => [u.walletAddress, u]));
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function creatorSummaryFor(
  address: string,
  user: UserRow | undefined,
  creatorRows: LoadedRow[],
): CreatorSummary {
  let mirror = 0;
  let activeMirror = 0;
  let clone = 0;
  let activeRuntimes = 0;
  let trustSum = 0;
  let bestRank: number | null = null;

  for (const row of creatorRows) {
    const cs = copyStats(row.copies);
    mirror += cs.mirror_count;
    activeMirror += cs.active_mirror_count;
    clone += cs.clone_count;
    if (row.runtime?.status === "active") activeRuntimes += 1;
    trustSum += deriveTrust(row.listing, row.runtime, row.agg).trust_score;
  }

  const publicBotCount = creatorRows.length;
  const averageTrust = publicBotCount > 0 ? round2(trustSum / publicBotCount) : 0;
  // Reputation: blend of reach (public bots + active runtimes), social proof
  // (mirrors), and average trust. Capped at 100, honest about thin profiles.
  const reputationScore = Math.min(
    100,
    Math.round(publicBotCount * 8 + activeRuntimes * 6 + activeMirror * 4 + averageTrust * 0.3),
  );

  return {
    creator_id: address,
    wallet_address: address,
    display_name: user?.displayName?.trim() || shortAddr(address),
    public_bot_count: publicBotCount,
    active_runtime_count: activeRuntimes,
    mirror_count: mirror,
    active_mirror_count: activeMirror,
    clone_count: clone,
    average_trust_score: averageTrust,
    best_rank: bestRank,
    reputation_score: reputationScore,
    reputation_label: reputationLabel(reputationScore),
    summary:
      publicBotCount > 0
        ? `${publicBotCount} published strateg${publicBotCount === 1 ? "y" : "ies"}, ${activeMirror} live mirrors.`
        : "No published strategies yet.",
    tags: [...new Set(creatorRows.map((row) => row.bot.strategyType).filter(Boolean))].slice(0, 4),
  };
}

function marketplaceCreatorSummary(
  base: CreatorSummary,
  listing: ListingRow,
): MarketplaceCreatorSummary {
  return {
    ...base,
    headline: listing.headline ?? "",
    bio: listing.accessNote ?? "",
    slug: base.creator_id,
    follower_count: base.active_mirror_count,
    featured_bot_count: 0,
    marketplace_reach_score: base.reputation_score,
  };
}

function toDiscoveryRow(
  row: LoadedRow,
  rank: number,
  creator: MarketplaceCreatorSummary,
): MarketplaceDiscoveryRow {
  const trust = deriveTrust(row.listing, row.runtime, row.agg);
  return {
    runtime_id: row.runtime?.id ?? row.bot.id,
    bot_definition_id: row.bot.id,
    bot_name: row.bot.name,
    strategy_type: row.bot.strategyType ?? "custom",
    authoring_mode: row.bot.authoringMode ?? "visual",
    rank,
    pnl_total: row.agg.pnl_total,
    pnl_unrealized: row.agg.pnl_unrealized,
    win_streak: num(asRecord(row.runtime?.summary).win_streak),
    drawdown: num(asRecord(row.runtime?.summary).drawdown),
    captured_at: row.agg.last_at ?? row.listing.updatedAt ?? new Date().toISOString(),
    trust,
    drift: deriveDrift(row.agg),
    passport: buildPassport(row.bot, row.listing),
    creator,
    copy_stats: copyStats(row.copies),
    publishing: publishingSummary(row.listing),
  };
}

/** Build discovery rows with per-creator summaries attached. */
function buildDiscoveryRows(
  rows: LoadedRow[],
  users: Map<string, UserRow>,
): MarketplaceDiscoveryRow[] {
  // group by creator for per-creator summary derivation
  const byCreator = new Map<string, LoadedRow[]>();
  for (const row of rows) {
    const addr = row.listing.creatorAddress;
    const arr = byCreator.get(addr) ?? [];
    arr.push(row);
    byCreator.set(addr, arr);
  }
  const summaryCache = new Map<string, CreatorSummary>();
  for (const [addr, creatorRows] of byCreator) {
    summaryCache.set(addr, creatorSummaryFor(addr, users.get(addr), creatorRows));
  }
  return rows.map((row, idx) => {
    const base = summaryCache.get(row.listing.creatorAddress)!;
    return toDiscoveryRow(row, idx + 1, marketplaceCreatorSummary(base, row.listing));
  });
}

// ---------------------------------------------------------------------------
// GET /overview — { discover, featured, creators }
// ---------------------------------------------------------------------------

r.get("/overview", async (c) => {
  const db = getDb(c.env);
  const discoverLimit = num(c.req.query("discover_limit"), 36);
  const featuredLimit = num(c.req.query("featured_limit"), 4);
  const creatorLimit = num(c.req.query("creator_limit"), 6);

  const rows = await loadPublishedRows(db);
  const users = await loadCreatorUsers(db, rows.map((r2) => r2.listing.creatorAddress));
  const discoveryRows = buildDiscoveryRows(rows, users);

  // discover: trimmed projection (MarketplaceOverviewDiscoveryRow)
  const discover = discoveryRows.slice(0, discoverLimit).map((row) => ({
    runtime_id: row.runtime_id,
    bot_definition_id: row.bot_definition_id,
    bot_name: row.bot_name,
    strategy_type: row.strategy_type,
    rank: row.rank,
    pnl_total: row.pnl_total,
    trust: row.trust,
    creator: row.creator,
    copy_stats: row.copy_stats,
    publishing: row.publishing,
  }));

  // featured: group featured listings into shelves keyed by collection_key
  const featured = buildFeaturedShelves(discoveryRows, rows).slice(0, featuredLimit).map((shelf) => ({
    collection_key: shelf.collection_key,
    title: shelf.title,
    subtitle: shelf.subtitle,
    bots: shelf.bots.map((row) => ({
      runtime_id: row.runtime_id,
      bot_definition_id: row.bot_definition_id,
      bot_name: row.bot_name,
      strategy_type: row.strategy_type,
      rank: row.rank,
      pnl_total: row.pnl_total,
      trust: row.trust,
      creator: row.creator,
      copy_stats: row.copy_stats,
      publishing: row.publishing,
    })),
  }));

  const creators = buildCreatorHighlights(discoveryRows).slice(0, creatorLimit);

  return c.json({ discover, featured, creators });
});

// ---------------------------------------------------------------------------
// GET /discover — MarketplaceDiscoveryRow[]
// ---------------------------------------------------------------------------

r.get("/discover", async (c) => {
  const db = getDb(c.env);
  const limit = num(c.req.query("limit"), 24);
  const strategyType = c.req.query("strategy_type");
  const creatorId = c.req.query("creator_id");

  const rows = await loadPublishedRows(db, creatorId ? normalizeAddress(creatorId) : undefined);
  const users = await loadCreatorUsers(db, rows.map((r2) => r2.listing.creatorAddress));
  let discoveryRows = buildDiscoveryRows(rows, users);
  if (strategyType) {
    discoveryRows = discoveryRows.filter((row) => row.strategy_type === strategyType);
  }
  return c.json(discoveryRows.slice(0, limit));
});

// ---------------------------------------------------------------------------
// GET /featured — FeaturedShelf[]
// ---------------------------------------------------------------------------

type FeaturedShelf = {
  collection_key: string;
  title: string;
  subtitle: string;
  bots: MarketplaceDiscoveryRow[];
};

function titleizeCollection(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function buildFeaturedShelves(
  discoveryRows: MarketplaceDiscoveryRow[],
  rows: LoadedRow[],
): FeaturedShelf[] {
  const listingByBot = new Map(rows.map((row) => [row.bot.id, row.listing]));
  const shelves = new Map<string, MarketplaceDiscoveryRow[]>();
  for (const row of discoveryRows) {
    const listing = listingByBot.get(row.bot_definition_id);
    if (!listing || !listing.featured) continue;
    const key = listing.collectionKey ?? "featured";
    const arr = shelves.get(key) ?? [];
    arr.push(row);
    shelves.set(key, arr);
  }
  return [...shelves.entries()].map(([key, bots]) => {
    bots.sort((a, b) => {
      const ra = listingByBot.get(a.bot_definition_id)?.featuredRank ?? 0;
      const rb = listingByBot.get(b.bot_definition_id)?.featuredRank ?? 0;
      return rb - ra;
    });
    return {
      collection_key: key,
      title: key === "featured" ? "Featured strategies" : titleizeCollection(key),
      subtitle: "Curated, creator-published strategies on Vega.",
      bots,
    };
  });
}

r.get("/featured", async (c) => {
  const db = getDb(c.env);
  const limit = num(c.req.query("limit"), 4);
  const rows = await loadPublishedRows(db);
  const users = await loadCreatorUsers(db, rows.map((r2) => r2.listing.creatorAddress));
  const discoveryRows = buildDiscoveryRows(rows, users);
  return c.json(buildFeaturedShelves(discoveryRows, rows).slice(0, limit));
});

// ---------------------------------------------------------------------------
// GET /creators — CreatorHighlight[]
// ---------------------------------------------------------------------------

type CreatorHighlight = MarketplaceCreatorSummary & {
  spotlight_bot: {
    runtime_id: string;
    bot_definition_id: string;
    bot_name: string;
    rank: number;
    trust_score: number;
    copy_stats: MarketplaceCopyStats;
  };
};

function buildCreatorHighlights(discoveryRows: MarketplaceDiscoveryRow[]): CreatorHighlight[] {
  const byCreator = new Map<string, MarketplaceDiscoveryRow[]>();
  for (const row of discoveryRows) {
    const arr = byCreator.get(row.creator.creator_id) ?? [];
    arr.push(row);
    byCreator.set(row.creator.creator_id, arr);
  }
  const highlights: CreatorHighlight[] = [];
  for (const [, creatorRows] of byCreator) {
    // best-ranked bot (lowest rank number) is the spotlight
    const spotlight = creatorRows.reduce((best, row) => (row.rank < best.rank ? row : best));
    const creator = spotlight.creator;
    highlights.push({
      ...creator,
      featured_bot_count: creatorRows.length,
      spotlight_bot: {
        runtime_id: spotlight.runtime_id,
        bot_definition_id: spotlight.bot_definition_id,
        bot_name: spotlight.bot_name,
        rank: spotlight.rank,
        trust_score: spotlight.trust.trust_score,
        copy_stats: spotlight.copy_stats,
      },
    });
  }
  highlights.sort((a, b) => b.marketplace_reach_score - a.marketplace_reach_score);
  return highlights;
}

r.get("/creators", async (c) => {
  const db = getDb(c.env);
  const limit = num(c.req.query("limit"), 6);
  const rows = await loadPublishedRows(db);
  const users = await loadCreatorUsers(db, rows.map((r2) => r2.listing.creatorAddress));
  const discoveryRows = buildDiscoveryRows(rows, users);
  return c.json(buildCreatorHighlights(discoveryRows).slice(0, limit));
});

// ---------------------------------------------------------------------------
// GET /creators/:id — MarketplaceCreatorProfile
// ---------------------------------------------------------------------------

r.get("/creators/:id", async (c) => {
  const db = getDb(c.env);
  const creatorId = normalizeAddress(c.req.param("id"));

  const rows = await loadPublishedRows(db, creatorId);
  const users = await loadCreatorUsers(db, [creatorId]);
  const user = users.get(creatorId);

  if (rows.length === 0 && !user) {
    return c.json({ detail: "Creator not found" }, 404);
  }

  const discoveryRows = buildDiscoveryRows(rows, users);
  const base = creatorSummaryFor(creatorId, user, rows);
  const headlineListing = rows[0]?.listing;
  const summary: MarketplaceCreatorSummary = headlineListing
    ? marketplaceCreatorSummary(base, headlineListing)
    : {
        ...base,
        headline: "",
        bio: "",
        slug: base.creator_id,
        follower_count: base.active_mirror_count,
        featured_bot_count: 0,
        marketplace_reach_score: base.reputation_score,
      };

  return c.json({
    ...summary,
    featured_bot_count: discoveryRows.length,
    social_links_json: {},
    bots: discoveryRows,
  });
});

// ---------------------------------------------------------------------------
// Publishing — owner-scoped read + auth-gated write
// ---------------------------------------------------------------------------

type PublishingSettings = {
  bot_definition_id: string;
  visibility: string;
  access_mode: string;
  publish_state: string;
  hero_headline: string;
  access_note: string;
  invite_wallet_addresses: string[];
  invite_count: number;
  creator_profile: {
    display_name: string;
    headline: string;
    bio: string;
    slug: string;
  };
};

function inviteAddresses(listing: ListingRow | undefined): string[] {
  const invite = listing?.inviteJson;
  return Array.isArray(invite) ? invite.map((a) => String(a)) : [];
}

function buildPublishingSettings(
  botId: string,
  listing: ListingRow | undefined,
  user: UserRow | undefined,
  ownerAddress: string,
): PublishingSettings {
  const invites = inviteAddresses(listing);
  return {
    bot_definition_id: botId,
    visibility: listing?.visibility ?? "private",
    access_mode: listing?.accessMode ?? "open",
    publish_state: listing?.publishState ?? "draft",
    hero_headline: listing?.headline ?? "",
    access_note: listing?.accessNote ?? "",
    invite_wallet_addresses: invites,
    invite_count: invites.length,
    creator_profile: {
      display_name: user?.displayName?.trim() || shortAddr(ownerAddress),
      headline: listing?.headline ?? "",
      bio: listing?.accessNote ?? "",
      slug: ownerAddress,
    },
  };
}

/**
 * GET /publishing/:botId — owner-scoped read. The frontend passes the owner's
 * wallet_address as a query param and the bearer in the headers; we accept the
 * query param for the read but still require the bot to belong to that owner.
 */
r.get("/publishing/:botId", async (c) => {
  const db = getDb(c.env);
  const botId = c.req.param("botId");
  const walletParam = c.req.query("wallet_address");
  if (!walletParam) return c.json({ detail: "wallet_address is required" }, 400);
  const owner = normalizeAddress(walletParam);

  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, botId) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (bot.ownerAddress !== owner) {
    return c.json({ detail: "Not authorized for this bot" }, 403);
  }

  const listing = await db.query.marketplaceListings.findFirst({
    where: eq(schema.marketplaceListings.botId, botId),
  });
  const users = await loadCreatorUsers(db, [owner]);
  return c.json(buildPublishingSettings(botId, listing, users.get(owner), owner));
});

/**
 * PATCH /publishing/:botId — publish/update a bot as a marketplace listing.
 * Auth-gated: the verified caller (NOT a body/query address) must own the bot.
 * Upserts the marketplace_listings row and mirrors visibility onto the bot.
 */
r.patch("/publishing/:botId", requireAuth, async (c) => {
  const db = getDb(c.env);
  const caller = getAddress(c);
  const botId = c.req.param("botId");

  let body: {
    visibility?: string;
    hero_headline?: string;
    access_note?: string;
    invite_wallet_addresses?: string[];
    creator_display_name?: string;
    creator_headline?: string;
    creator_bio?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.id, botId) });
  if (!bot) return c.json({ detail: "Bot not found" }, 404);
  if (bot.ownerAddress !== caller) {
    return c.json({ detail: "Not authorized for this bot" }, 403);
  }

  // Normalize visibility -> (visibility, access_mode, publish_state).
  const requested = (body.visibility ?? "private").toLowerCase();
  let visibility = "private";
  let accessMode = "open";
  let publishState = "draft";
  if (requested === "public") {
    visibility = "public";
    accessMode = "open";
    publishState = "published";
  } else if (requested === "invite_only" || requested === "invite") {
    visibility = "public";
    accessMode = "invite";
    publishState = "published";
  } else if (requested === "unlisted") {
    visibility = "unlisted";
    accessMode = "open";
    publishState = "published";
  } else {
    visibility = "private";
    accessMode = "open";
    publishState = "draft";
  }

  const invites = Array.isArray(body.invite_wallet_addresses)
    ? body.invite_wallet_addresses.map((a) => normalizeAddress(String(a)))
    : [];
  const headline = (body.hero_headline ?? "").trim();
  const accessNote = (body.access_note ?? "").trim();
  const now = new Date().toISOString();
  const publishedAt = publishState === "published" ? now : null;

  const existing = await db.query.marketplaceListings.findFirst({
    where: eq(schema.marketplaceListings.botId, botId),
  });

  if (existing) {
    await db
      .update(schema.marketplaceListings)
      .set({
        headline,
        accessNote,
        visibility,
        accessMode,
        publishState,
        inviteJson: invites,
        publishedAt: publishedAt ?? existing.publishedAt ?? null,
        updatedAt: now,
      })
      .where(eq(schema.marketplaceListings.id, existing.id));
  } else {
    await db.insert(schema.marketplaceListings).values({
      id: crypto.randomUUID(),
      botId,
      creatorAddress: caller,
      headline,
      accessNote,
      visibility,
      accessMode,
      publishState,
      featured: false,
      featuredRank: 0,
      collectionKey: null,
      stats: {},
      inviteJson: invites,
      publishedAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Mirror visibility onto the bot definition + update creator display name.
  await db
    .update(schema.bots)
    .set({ visibility, updatedAt: now })
    .where(eq(schema.bots.id, botId));

  const displayName = body.creator_display_name?.trim();
  if (displayName) {
    await db
      .update(schema.users)
      .set({ displayName })
      .where(eq(schema.users.walletAddress, caller));
  }

  const listing = await db.query.marketplaceListings.findFirst({
    where: eq(schema.marketplaceListings.botId, botId),
  });
  const users = await loadCreatorUsers(db, [caller]);
  return c.json(buildPublishingSettings(botId, listing, users.get(caller), caller));
});

export { r as marketplaceRouter };
