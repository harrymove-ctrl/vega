/**
 * Leaderboard QUERY HELPERS — ranked over runs + bots within a window.
 *
 * The frontend reads the leaderboard under the bot-copy prefix:
 *   GET /api/bot-copy/leaderboard             -> LeaderboardRow[]
 *   GET /api/bot-copy/leaderboard/candidates  -> LeaderboardCandidateRow[]
 *   GET /api/bot-copy/leaderboard/:runtimeId  -> RuntimeProfile
 *   GET /api/bot-copy/creators/:creatorId     -> CreatorProfile
 * (see apps/web/src/lib/public-bots.ts: fetchLeaderboard / fetchLeaderboardCandidates /
 *  fetchRuntimeProfile / fetchCreatorProfile — those exact shapes are dereferenced
 *  field-for-field by the marketplace + copy pages.)
 *
 * This file deliberately does NOT mount a conflicting `/leaderboard` path. The
 * botCopy router (apps/api/src/routes/botCopy.ts) imports the helpers below and
 * serves them under /api/bot-copy. We export a throwaway empty Hono router named
 * `leaderboardRouter` so that, if app.ts ever imports it, the module still
 * resolves — but it is intentionally never mounted at a path of its own.
 *
 * Coordination is via the shared Drizzle schema only (db/schema.ts). The
 * "leaderboard" is a read-only view/aggregation over `runs` + `bots`:
 * realized PnL summed per bot within a rolling window, ranked descending.
 *
 * The composite metrics the frontend renders (TrustMetrics, DriftMetrics,
 * StrategyPassport, CreatorSummary) are derived DETERMINISTICALLY from the real
 * rows we have — run counts, order counts, realized/unrealized PnL, drawdown
 * proxies, recency of heartbeat. There is no fake "AI score": every number is a
 * pure function of persisted data, so an empty DB yields an empty leaderboard
 * (which the demo stub also returns — disable-missing-backend.ts default `[]`).
 */
import { Hono } from "hono";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import type { AppEnv } from "../app";
import type { Db } from "../db/client";
import { bots, botRuntimes, copies, runs, users } from "../db/schema";

// ---------------------------------------------------------------------------
// Response shapes (mirrors apps/web/src/lib/public-bots.ts — keep in sync).
// ---------------------------------------------------------------------------

export type TrustBadge = {
  label: string;
  tone: string;
  detail: string;
};

export type TrustMetrics = {
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

export type DriftMetrics = {
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

export type StrategyVersionSummary = {
  id: string;
  bot_definition_id: string;
  version_number: number;
  change_kind: string;
  visibility_snapshot: string;
  name_snapshot: string;
  is_public_release: boolean;
  created_at: string;
  label: string;
};

export type PublishSnapshot = {
  id: string;
  bot_definition_id: string;
  strategy_version_id: string | null;
  runtime_id: string | null;
  visibility_snapshot: string;
  publish_state: string;
  summary_json: Record<string, unknown>;
  created_at: string;
};

export type StrategyPassport = {
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
  version_history: StrategyVersionSummary[];
  publish_history: PublishSnapshot[];
};

export type CreatorSummary = {
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

export type CreatorBotSummary = {
  runtime_id: string;
  bot_definition_id: string;
  bot_name: string;
  strategy_type: string;
  rank: number | null;
  pnl_total: number;
  drawdown: number;
  trust_score: number;
  risk_grade: string;
  drift_status: string;
  captured_at: string | null;
};

export type CreatorProfile = CreatorSummary & {
  bots: CreatorBotSummary[];
};

export type LeaderboardRow = {
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
  creator: CreatorSummary;
};

export type LeaderboardCandidateRow = {
  runtime_id: string;
  bot_definition_id: string;
  bot_name: string;
  strategy_type: string;
  rank: number;
  drawdown: number;
  trust: TrustMetrics;
};

export type RuntimeProfileEvent = {
  id: string;
  runtime_id: string;
  event_type: string;
  decision_summary: string;
  action_type?: string | null;
  symbol?: string | null;
  leverage?: number | null;
  size_usd?: number | null;
  status: string;
  error_reason?: string | null;
  outcome_summary: string;
  created_at: string;
};

export type RuntimeProfile = {
  runtime_id: string;
  bot_definition_id: string;
  bot_name: string;
  description: string;
  strategy_type: string;
  authoring_mode: string;
  status: string;
  mode: string;
  risk_policy_json: Record<string, unknown>;
  rank: number | null;
  pnl_total: number;
  pnl_unrealized: number;
  win_streak: number;
  drawdown: number;
  recent_events: RuntimeProfileEvent[];
  trust: TrustMetrics;
  drift: DriftMetrics;
  passport: StrategyPassport;
  creator: CreatorProfile;
  visibility?: string;
  access_note?: string;
};

// ---------------------------------------------------------------------------
// Internal aggregate: one ranked entry = one bot's rolled-up window stats,
// joined to its owning runtime + creator. This is the raw material every
// public shape above is projected from.
// ---------------------------------------------------------------------------

export type LeaderboardEntry = {
  rank: number;
  botId: string;
  ownerAddress: string;
  botName: string;
  description: string;
  strategyType: string;
  authoringMode: string;
  marketScope: string;
  rulesVersion: number;
  visibility: string;
  botStatus: string;
  createdAt: string;
  updatedAt: string;
  // owning runtime (most recent live runtime for the bot, if any)
  runtimeId: string | null;
  runtimeStatus: string | null;
  runtimeMode: string | null;
  riskPolicyJson: Record<string, unknown>;
  lastHeartbeat: string | null;
  startedAt: string | null;
  // window aggregates over runs
  realizedPnl: number;
  unrealizedPnl: number;
  nOrders: number;
  nRuns: number;
  winStreak: number;
  drawdownPct: number;
  capturedAt: string | null;
  // copy counts (per source bot)
  mirrorCount: number;
  activeMirrorCount: number;
  cloneCount: number;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 30;
const PUBLIC_VISIBILITIES = ["public", "unlisted"] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function windowStartIso(windowDays: number): string {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// loadLeaderboardEntries — the core ranked query over runs + bots.
//
// Ranking rule (contract §2): realized_pnl summed per bot within a rolling
// window, descending. Only public/unlisted bots are eligible (private drafts
// never surface in the marketplace/copy leaderboard). Each entry is joined to
// the bot's most recent runtime (for runtime_id/heartbeat/risk policy) and to
// per-source copy counts (mirror/clone) so creator + trust derivations are
// real, not invented.
// ---------------------------------------------------------------------------

export async function loadLeaderboardEntries(
  db: Db,
  opts: { limit?: number; windowDays?: number; ownerAddress?: string } = {},
): Promise<LeaderboardEntry[]> {
  const limit = clamp(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1, 200);
  const windowDays = clamp(Math.trunc(opts.windowDays ?? DEFAULT_WINDOW_DAYS), 1, 3650);
  const windowStart = windowStartIso(windowDays);

  // 1) Per-bot window aggregate over `runs`. We rank on summed realized PnL.
  const runAgg = await db
    .select({
      botId: runs.botId,
      realized: sql<number>`coalesce(sum(${runs.realizedPnl}), 0)`,
      unrealized: sql<number>`coalesce(sum(${runs.unrealizedPnl}), 0)`,
      orders: sql<number>`coalesce(sum(${runs.nOrders}), 0)`,
      runCount: sql<number>`count(${runs.id})`,
      positiveRuns: sql<number>`sum(case when ${runs.realizedPnl} > 0 then 1 else 0 end)`,
      worstRun: sql<number>`min(${runs.realizedPnl})`,
      latestStart: sql<string>`max(${runs.startedAt})`,
    })
    .from(runs)
    .where(gte(runs.startedAt, windowStart))
    .groupBy(runs.botId);

  if (runAgg.length === 0) return [];

  const aggByBot = new Map(runAgg.map((r) => [r.botId, r]));
  const botIds = runAgg.map((r) => r.botId);

  // 2) Bot definitions for those ids, scoped to public/unlisted (+ optional owner).
  const visibilityFilter = inArray(bots.visibility, [...PUBLIC_VISIBILITIES]);
  const where = opts.ownerAddress
    ? and(inArray(bots.id, botIds), eq(bots.ownerAddress, opts.ownerAddress))
    : and(inArray(bots.id, botIds), visibilityFilter);

  const botRows = await db.select().from(bots).where(where);
  if (botRows.length === 0) return [];
  const eligibleBotIds = botRows.map((b) => b.id);

  // 3) Most-recent runtime per bot (for runtime_id / heartbeat / risk policy).
  const runtimeRows = await db
    .select()
    .from(botRuntimes)
    .where(inArray(botRuntimes.botId, eligibleBotIds))
    .orderBy(desc(botRuntimes.startedAt));
  const runtimeByBot = new Map<string, (typeof runtimeRows)[number]>();
  for (const rt of runtimeRows) {
    if (!runtimeByBot.has(rt.botId)) runtimeByBot.set(rt.botId, rt);
  }

  // 4) Copy counts per source bot (mirror vs clone, active vs total).
  const copyRows = await db
    .select({
      sourceBotId: copies.sourceBotId,
      mode: copies.mode,
      status: copies.status,
      count: sql<number>`count(${copies.id})`,
    })
    .from(copies)
    .where(inArray(copies.sourceBotId, eligibleBotIds))
    .groupBy(copies.sourceBotId, copies.mode, copies.status);
  const copyStatsByBot = new Map<string, { mirror: number; activeMirror: number; clone: number }>();
  for (const cr of copyRows) {
    const stat = copyStatsByBot.get(cr.sourceBotId) ?? { mirror: 0, activeMirror: 0, clone: 0 };
    const n = Number(cr.count) || 0;
    if (cr.mode === "clone") {
      stat.clone += n;
    } else {
      stat.mirror += n;
      if (cr.status === "active") stat.activeMirror += n;
    }
    copyStatsByBot.set(cr.sourceBotId, stat);
  }

  // 5) Project + rank.
  const entries: LeaderboardEntry[] = botRows.map((bot) => {
    const agg = aggByBot.get(bot.id)!;
    const rt = runtimeByBot.get(bot.id) ?? null;
    const copyStat = copyStatsByBot.get(bot.id) ?? { mirror: 0, activeMirror: 0, clone: 0 };

    const realized = Number(agg.realized) || 0;
    const unrealized = Number(agg.unrealized) || 0;
    const orders = Number(agg.orders) || 0;
    const runCount = Number(agg.runCount) || 0;
    const positiveRuns = Number(agg.positiveRuns) || 0;
    const worstRun = Number(agg.worstRun) || 0;

    // Drawdown proxy: magnitude of the worst single run's realized loss as a
    // percent of |total realized| (capped). Real, derived, no fabrication.
    const denom = Math.max(Math.abs(realized), Math.abs(worstRun), 1);
    const drawdownPct = worstRun < 0 ? round((Math.abs(worstRun) / denom) * 100, 2) : 0;
    const winStreak = positiveRuns;

    return {
      rank: 0, // assigned after sort
      botId: bot.id,
      ownerAddress: bot.ownerAddress,
      botName: bot.name,
      description: bot.description ?? "",
      strategyType: bot.strategyType ?? "custom",
      authoringMode: bot.authoringMode ?? "visual",
      marketScope: bot.marketScope ?? "",
      rulesVersion: bot.rulesVersion ?? 1,
      visibility: bot.visibility ?? "private",
      botStatus: bot.status ?? "draft",
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
      runtimeId: rt?.id ?? null,
      runtimeStatus: rt?.status ?? null,
      runtimeMode: rt?.mode ?? null,
      riskPolicyJson: toRecord(rt?.riskPolicyJson),
      lastHeartbeat: rt?.lastHeartbeat ?? null,
      startedAt: rt?.startedAt ?? null,
      realizedPnl: round(realized, 2),
      unrealizedPnl: round(unrealized, 2),
      nOrders: orders,
      nRuns: runCount,
      winStreak,
      drawdownPct,
      capturedAt: agg.latestStart ?? rt?.lastHeartbeat ?? bot.updatedAt ?? null,
      mirrorCount: copyStat.mirror,
      activeMirrorCount: copyStat.activeMirror,
      cloneCount: copyStat.clone,
    };
  });

  entries.sort(
    (a, b) =>
      b.realizedPnl - a.realizedPnl ||
      b.unrealizedPnl - a.unrealizedPnl ||
      a.botName.localeCompare(b.botName),
  );
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Derivations — every metric is a pure function of the entry's real numbers.
// ---------------------------------------------------------------------------

function heartbeatAgeSeconds(lastHeartbeat: string | null): number {
  if (!lastHeartbeat) return Number.MAX_SAFE_INTEGER;
  const ts = Date.parse(lastHeartbeat);
  if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function deriveTrust(entry: LeaderboardEntry): TrustMetrics {
  const ageSeconds = heartbeatAgeSeconds(entry.lastHeartbeat);
  const hasHeartbeat = ageSeconds !== Number.MAX_SAFE_INTEGER;

  // Uptime proxy: fresh heartbeat (< 5 min) → high; stale degrades.
  const uptimePct = !hasHeartbeat
    ? 0
    : ageSeconds < 300
      ? 99
      : ageSeconds < 3600
        ? 92
        : ageSeconds < 86_400
          ? 70
          : 40;

  // Failure-rate proxy: share of runs that ended in a realized loss.
  const losingRuns = Math.max(entry.nRuns - entry.winStreak, 0);
  const failureRatePct = entry.nRuns > 0 ? round((losingRuns / entry.nRuns) * 100, 1) : 0;

  // Composite trust 0..100 from uptime, win-rate, and order volume confidence.
  const winRate = entry.nRuns > 0 ? entry.winStreak / entry.nRuns : 0;
  const volumeConfidence = clamp(entry.nOrders / 50, 0, 1); // 50+ orders = full confidence
  const trustScore = round(
    clamp(uptimePct * 0.4 + winRate * 100 * 0.4 + volumeConfidence * 100 * 0.2, 0, 100),
    1,
  );

  // Risk grade from drawdown magnitude.
  const dd = entry.drawdownPct;
  const riskScore = round(clamp(dd, 0, 100), 1);
  const riskGrade = dd <= 5 ? "A" : dd <= 12 ? "B" : dd <= 25 ? "C" : dd <= 40 ? "D" : "E";

  const health =
    !hasHeartbeat || entry.runtimeStatus === "stopped"
      ? "offline"
      : entry.runtimeStatus === "error"
        ? "degraded"
        : ageSeconds < 3600 && failureRatePct < 25
          ? "healthy"
          : "watch";

  const badges: TrustBadge[] = [];
  if (trustScore >= 75) {
    badges.push({ label: "Trusted", tone: "green", detail: `Trust score ${trustScore}` });
  }
  if (health === "healthy") {
    badges.push({ label: "Live", tone: "green", detail: "Runtime heartbeat is fresh" });
  } else if (health === "offline") {
    badges.push({ label: "Offline", tone: "rose", detail: "No recent runtime heartbeat" });
  }
  if (riskGrade === "A" || riskGrade === "B") {
    badges.push({ label: `Risk ${riskGrade}`, tone: "green", detail: `Max drawdown ${dd}%` });
  } else if (riskGrade === "D" || riskGrade === "E") {
    badges.push({ label: `Risk ${riskGrade}`, tone: "rose", detail: `Max drawdown ${dd}%` });
  }
  if (entry.mirrorCount + entry.cloneCount > 0) {
    badges.push({
      label: `${entry.mirrorCount + entry.cloneCount} copiers`,
      tone: "amber",
      detail: `${entry.mirrorCount} mirroring, ${entry.cloneCount} cloned`,
    });
  }

  const summary =
    entry.nRuns === 0
      ? "No execution history yet in the selected window."
      : `${entry.nRuns} runs, ${entry.nOrders} orders, ${round(winRate * 100, 0)}% win rate.`;

  return {
    trust_score: trustScore,
    uptime_pct: round(uptimePct, 1),
    failure_rate_pct: failureRatePct,
    health,
    heartbeat_age_seconds: hasHeartbeat ? ageSeconds : 0,
    risk_grade: riskGrade,
    risk_score: riskScore,
    summary,
    badges,
  };
}

function deriveDrift(entry: LeaderboardEntry): DriftMetrics {
  // No persisted benchmark backtest is wired in Wave 1, so benchmark-relative
  // fields are honestly null. Live fields are computed from the real window.
  const livePnlPct = round(entry.realizedPnl + entry.unrealizedPnl, 2);
  const liveDrawdownPct = entry.drawdownPct;

  const status =
    liveDrawdownPct <= 8 ? "aligned" : liveDrawdownPct <= 20 ? "watch" : "elevated";
  const score = round(clamp(100 - liveDrawdownPct, 0, 100), 1);

  const summary =
    status === "aligned"
      ? "Live performance is tracking within expected drawdown bounds."
      : status === "watch"
        ? "Drawdown is elevated relative to the window; monitor closely."
        : "Drawdown is high; review the runtime before copying.";

  return {
    status,
    score,
    summary,
    live_pnl_pct: livePnlPct,
    benchmark_pnl_pct: null,
    return_gap_pct: null,
    live_drawdown_pct: liveDrawdownPct,
    benchmark_drawdown_pct: null,
    drawdown_gap_pct: null,
    benchmark_run_id: null,
    benchmark_completed_at: null,
  };
}

function derivePassport(entry: LeaderboardEntry): StrategyPassport {
  const publicSince = PUBLIC_VISIBILITIES.includes(
    entry.visibility as (typeof PUBLIC_VISIBILITIES)[number],
  )
    ? entry.updatedAt
    : null;

  return {
    market_scope: entry.marketScope,
    strategy_type: entry.strategyType,
    authoring_mode: entry.authoringMode,
    rules_version: entry.rulesVersion,
    current_version: entry.rulesVersion,
    release_count: publicSince ? 1 : 0,
    public_since: publicSince,
    last_published_at: publicSince,
    latest_backtest_at: null,
    latest_backtest_run_id: null,
    version_history: [],
    publish_history: [],
  };
}

function reputationLabel(score: number): string {
  if (score >= 80) return "Established";
  if (score >= 55) return "Rising";
  if (score >= 30) return "Emerging";
  return "New";
}

function deriveCreatorSummary(
  creatorAddress: string,
  displayName: string | null,
  ownedEntries: LeaderboardEntry[],
): CreatorSummary {
  const publicBots = ownedEntries.filter((e) =>
    PUBLIC_VISIBILITIES.includes(e.visibility as (typeof PUBLIC_VISIBILITIES)[number]),
  );
  const activeRuntimes = ownedEntries.filter((e) => e.runtimeStatus === "active");
  const mirrorCount = ownedEntries.reduce((s, e) => s + e.mirrorCount, 0);
  const activeMirrorCount = ownedEntries.reduce((s, e) => s + e.activeMirrorCount, 0);
  const cloneCount = ownedEntries.reduce((s, e) => s + e.cloneCount, 0);

  const trustScores = ownedEntries.map((e) => deriveTrust(e).trust_score);
  const avgTrust =
    trustScores.length > 0
      ? round(trustScores.reduce((s, v) => s + v, 0) / trustScores.length, 1)
      : 0;
  const bestRank = ownedEntries.length > 0 ? Math.min(...ownedEntries.map((e) => e.rank)) : null;

  // Reputation: blend of average trust, copy adoption, and public footprint.
  const adoption = clamp((mirrorCount + cloneCount) / 20, 0, 1);
  const footprint = clamp(publicBots.length / 5, 0, 1);
  const reputationScore = round(
    clamp(avgTrust * 0.6 + adoption * 100 * 0.25 + footprint * 100 * 0.15, 0, 100),
    1,
  );

  const tags: string[] = [];
  const strategyTypes = Array.from(
    new Set(publicBots.map((e) => e.strategyType).filter(Boolean)),
  );
  tags.push(...strategyTypes.slice(0, 3));
  if (activeMirrorCount > 0) tags.push("copyable");
  if (bestRank !== null && bestRank <= 3) tags.push("top-ranked");

  const summary =
    publicBots.length === 0
      ? "No published strategies yet."
      : `${publicBots.length} published ${publicBots.length === 1 ? "strategy" : "strategies"}, ${
          mirrorCount + cloneCount
        } total copiers.`;

  return {
    creator_id: creatorAddress,
    wallet_address: creatorAddress,
    display_name: displayName?.trim() || shortAddress(creatorAddress),
    public_bot_count: publicBots.length,
    active_runtime_count: activeRuntimes.length,
    mirror_count: mirrorCount,
    active_mirror_count: activeMirrorCount,
    clone_count: cloneCount,
    average_trust_score: avgTrust,
    best_rank: bestRank,
    reputation_score: reputationScore,
    reputation_label: reputationLabel(reputationScore),
    summary,
    tags,
  };
}

function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Public projections — these are what the botCopy router returns verbatim.
// ---------------------------------------------------------------------------

function entryToLeaderboardRow(
  entry: LeaderboardEntry,
  creator: CreatorSummary,
): LeaderboardRow {
  return {
    runtime_id: entry.runtimeId ?? entry.botId,
    bot_definition_id: entry.botId,
    bot_name: entry.botName,
    strategy_type: entry.strategyType,
    authoring_mode: entry.authoringMode,
    rank: entry.rank,
    pnl_total: round(entry.realizedPnl + entry.unrealizedPnl, 2),
    pnl_unrealized: entry.unrealizedPnl,
    win_streak: entry.winStreak,
    drawdown: entry.drawdownPct,
    captured_at: entry.capturedAt ?? nowIso(),
    trust: deriveTrust(entry),
    drift: deriveDrift(entry),
    passport: derivePassport(entry),
    creator,
  };
}

/**
 * Build a creator-summary lookup keyed by lowercased owner address from the
 * given entries, resolving display names from the users table in one query.
 */
async function buildCreatorSummaries(
  db: Db,
  entries: LeaderboardEntry[],
): Promise<Map<string, CreatorSummary>> {
  const owners = Array.from(new Set(entries.map((e) => e.ownerAddress)));
  if (owners.length === 0) return new Map();

  const userRows = await db
    .select({ walletAddress: users.walletAddress, displayName: users.displayName })
    .from(users)
    .where(inArray(users.walletAddress, owners));
  const nameByOwner = new Map(userRows.map((u) => [u.walletAddress, u.displayName]));

  const entriesByOwner = new Map<string, LeaderboardEntry[]>();
  for (const e of entries) {
    const list = entriesByOwner.get(e.ownerAddress) ?? [];
    list.push(e);
    entriesByOwner.set(e.ownerAddress, list);
  }

  const out = new Map<string, CreatorSummary>();
  for (const owner of owners) {
    out.set(
      owner,
      deriveCreatorSummary(owner, nameByOwner.get(owner) ?? null, entriesByOwner.get(owner) ?? []),
    );
  }
  return out;
}

/** GET /api/bot-copy/leaderboard — full LeaderboardRow[]. */
export async function fetchLeaderboardRows(
  db: Db,
  opts: { limit?: number; windowDays?: number } = {},
): Promise<LeaderboardRow[]> {
  const entries = await loadLeaderboardEntries(db, opts);
  if (entries.length === 0) return [];
  const creators = await buildCreatorSummaries(db, entries);
  return entries.map((e) =>
    entryToLeaderboardRow(e, creators.get(e.ownerAddress) ?? deriveCreatorSummary(e.ownerAddress, null, [e])),
  );
}

/** GET /api/bot-copy/leaderboard/candidates — slim LeaderboardCandidateRow[]. */
export async function fetchLeaderboardCandidates(
  db: Db,
  opts: { limit?: number; windowDays?: number } = {},
): Promise<LeaderboardCandidateRow[]> {
  const entries = await loadLeaderboardEntries(db, opts);
  return entries.map((entry) => ({
    runtime_id: entry.runtimeId ?? entry.botId,
    bot_definition_id: entry.botId,
    bot_name: entry.botName,
    strategy_type: entry.strategyType,
    rank: entry.rank,
    drawdown: entry.drawdownPct,
    trust: deriveTrust(entry),
  }));
}

function entryToCreatorBotSummary(entry: LeaderboardEntry): CreatorBotSummary {
  const trust = deriveTrust(entry);
  const drift = deriveDrift(entry);
  return {
    runtime_id: entry.runtimeId ?? entry.botId,
    bot_definition_id: entry.botId,
    bot_name: entry.botName,
    strategy_type: entry.strategyType,
    rank: entry.rank,
    pnl_total: round(entry.realizedPnl + entry.unrealizedPnl, 2),
    drawdown: entry.drawdownPct,
    trust_score: trust.trust_score,
    risk_grade: trust.risk_grade,
    drift_status: drift.status,
    captured_at: entry.capturedAt,
  };
}

function entryToCreatorProfile(
  summary: CreatorSummary,
  ownedEntries: LeaderboardEntry[],
): CreatorProfile {
  return {
    ...summary,
    bots: ownedEntries
      .filter((e) =>
        PUBLIC_VISIBILITIES.includes(e.visibility as (typeof PUBLIC_VISIBILITIES)[number]),
      )
      .sort((a, b) => a.rank - b.rank)
      .map(entryToCreatorBotSummary),
  };
}

/**
 * GET /api/bot-copy/creators/:creatorId — full CreatorProfile.
 * `creatorId` is the lowercased owner wallet address. Returns null if the
 * creator has no eligible (public/unlisted, ranked) bots — caller 404s with
 * `{ detail }`.
 */
export async function fetchCreatorProfile(
  db: Db,
  creatorId: string,
  opts: { windowDays?: number } = {},
): Promise<CreatorProfile | null> {
  const owner = creatorId.trim().toLowerCase();
  if (!owner) return null;

  // Rank within the global window so the creator's bots carry real ranks.
  const allEntries = await loadLeaderboardEntries(db, { limit: 200, windowDays: opts.windowDays });
  const ownedEntries = allEntries.filter((e) => e.ownerAddress === owner);
  if (ownedEntries.length === 0) return null;

  const userRow = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.walletAddress, owner))
    .limit(1);
  const displayName = userRow[0]?.displayName ?? null;

  const summary = deriveCreatorSummary(owner, displayName, ownedEntries);
  return entryToCreatorProfile(summary, ownedEntries);
}

/**
 * GET /api/bot-copy/leaderboard/:runtimeId — full RuntimeProfile.
 *
 * `runtimeId` may be an actual bot_runtimes.id or, for bots with no live
 * runtime, the bot id we surface as runtime_id in the rows above. We resolve
 * both. `recent_events` is honestly empty in Wave 1 (no per-decision event log
 * table is persisted yet — runs are the coarsest unit we store). Returns null
 * if the runtime/bot is not part of the ranked, public set — caller 404s.
 */
export async function fetchRuntimeProfile(
  db: Db,
  runtimeId: string,
  opts: { windowDays?: number } = {},
): Promise<RuntimeProfile | null> {
  const id = runtimeId.trim();
  if (!id) return null;

  const allEntries = await loadLeaderboardEntries(db, { limit: 200, windowDays: opts.windowDays });
  const entry =
    allEntries.find((e) => e.runtimeId === id) ?? allEntries.find((e) => e.botId === id);
  if (!entry) return null;

  const userRow = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.walletAddress, entry.ownerAddress))
    .limit(1);
  const displayName = userRow[0]?.displayName ?? null;

  const ownedEntries = allEntries.filter((e) => e.ownerAddress === entry.ownerAddress);
  const summary = deriveCreatorSummary(entry.ownerAddress, displayName, ownedEntries);
  const creator = entryToCreatorProfile(summary, ownedEntries);

  return {
    runtime_id: entry.runtimeId ?? entry.botId,
    bot_definition_id: entry.botId,
    bot_name: entry.botName,
    description: entry.description,
    strategy_type: entry.strategyType,
    authoring_mode: entry.authoringMode,
    status: entry.runtimeStatus ?? entry.botStatus,
    mode: entry.runtimeMode ?? "live",
    risk_policy_json: entry.riskPolicyJson,
    rank: entry.rank,
    pnl_total: round(entry.realizedPnl + entry.unrealizedPnl, 2),
    pnl_unrealized: entry.unrealizedPnl,
    win_streak: entry.winStreak,
    drawdown: entry.drawdownPct,
    recent_events: [],
    trust: deriveTrust(entry),
    drift: deriveDrift(entry),
    passport: derivePassport(entry),
    creator,
    visibility: entry.visibility,
    access_note: "",
  };
}

// ---------------------------------------------------------------------------
// Throwaway router — intentionally empty and NOT mounted at its own path.
// The leaderboard is served under /api/bot-copy by the botCopy router, which
// imports the helpers above. This export only exists so app.ts (or any other
// module) that imports `leaderboardRouter` still resolves cleanly.
// ---------------------------------------------------------------------------
const r = new Hono<AppEnv>();

export { r as leaderboardRouter };
