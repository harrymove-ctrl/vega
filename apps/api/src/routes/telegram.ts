/**
 * /api/telegram — Telegram connection, notification prefs, and inbound webhook.
 *
 * Contract (plans/20260606-vega-fullflow-audit/p1d-backend-contract-and-plan.md §Telegram):
 *   GET  /api/telegram?wallet_address=  -> TelegramConnectionStatus (telegram.ts:15)
 *   POST  /api/telegram/link            -> generate deeplink + pending row (auth)  -> status
 *   POST/PATCH /api/telegram/preferences-> update notification prefs (auth)        -> status
 *   POST /api/telegram/test             -> send a test message (auth)              -> status
 *   POST /api/telegram/disconnect       -> clear the link (auth)                   -> status
 *   POST /api/telegram/webhook          -> Telegram Bot API inbound (no auth; secret-gated)
 *
 * Reads are owner-scoped by the wallet_address query param. Writes are gated by
 * requireAuth and act on the verified caller (getAddress) — never a body address.
 *
 * Response shapes match apps/web/src/lib/telegram.ts (TelegramConnectionStatus /
 * TelegramNotificationPrefs) and the demo stub in
 * apps/web/src/lib/disable-missing-backend.ts field-for-field. The telegram-page
 * dereferences status.notification_prefs, status.commands.map(...),
 * status.token_configured, status.webhook_ready, etc. unconditionally, so every
 * field is always present.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";

import type { AppEnv } from "../app";
import type { Env } from "../index";
import { getDb, type Db } from "../db/client";
import { telegramLinks, users } from "../db/schema";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

// --- types mirroring apps/web/src/lib/telegram.ts -------------------------

type TelegramCommand = { command: string; description: string };

type TelegramNotificationPrefs = {
  critical_alerts: boolean;
  execution_failures: boolean;
  copy_activity: boolean;
  trade_activity: boolean;
};

type TelegramConnectionStatus = {
  wallet_address: string;
  bot_username: string | null;
  bot_link: string;
  deeplink_url: string | null;
  link_expires_at: string | null;
  connected: boolean;
  telegram_username: string | null;
  telegram_first_name: string | null;
  chat_label: string | null;
  connected_at: string | null;
  last_interaction_at: string | null;
  notifications_enabled: boolean;
  notification_prefs: TelegramNotificationPrefs;
  token_configured: boolean;
  webhook_url_configured: boolean;
  webhook_secret_configured: boolean;
  webhook_ready: boolean;
  commands: TelegramCommand[];
};

/**
 * Telegram-specific env. The Worker `Env` (index.ts) only declares
 * TELEGRAM_BOT_TOKEN; the webhook URL/secret are read defensively here so this
 * router can stay self-contained without editing index.ts.
 */
type TelegramEnv = Env & {
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_URL?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

// --- constants ------------------------------------------------------------

const LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Default delivery rules mirror the demo stub
// (disable-missing-backend.ts: critical/execution on, copy/trade off).
const DEFAULT_PREFS: TelegramNotificationPrefs = {
  critical_alerts: true,
  execution_failures: true,
  copy_activity: false,
  trade_activity: false,
};

// Static bot command menu surfaced on the telegram-page "Commands" strip.
const BOT_COMMANDS: TelegramCommand[] = [
  { command: "start", description: "Link this chat to your Vega wallet" },
  { command: "status", description: "Show your runtime + portfolio snapshot" },
  { command: "alerts", description: "Toggle critical runtime alerts" },
  { command: "pause", description: "Pause notifications without unlinking" },
  { command: "resume", description: "Resume notifications" },
  { command: "unlink", description: "Disconnect this chat from your wallet" },
  { command: "help", description: "List everything the bot can do" },
];

// --- env helpers ----------------------------------------------------------

function telegramEnv(env: Env): TelegramEnv {
  return env as TelegramEnv;
}

function nowIso(): string {
  return new Date().toISOString();
}

function botUsername(env: TelegramEnv): string | null {
  return env.TELEGRAM_BOT_USERNAME ?? null;
}

function botLink(env: TelegramEnv): string {
  const username = botUsername(env);
  return username ? `https://t.me/${username}` : "https://t.me/";
}

// --- prefs coercion -------------------------------------------------------

function coercePrefs(raw: unknown): TelegramNotificationPrefs {
  const p = (raw ?? {}) as Partial<Record<keyof TelegramNotificationPrefs, unknown>>;
  return {
    critical_alerts:
      typeof p.critical_alerts === "boolean" ? p.critical_alerts : DEFAULT_PREFS.critical_alerts,
    execution_failures:
      typeof p.execution_failures === "boolean"
        ? p.execution_failures
        : DEFAULT_PREFS.execution_failures,
    copy_activity:
      typeof p.copy_activity === "boolean" ? p.copy_activity : DEFAULT_PREFS.copy_activity,
    trade_activity:
      typeof p.trade_activity === "boolean" ? p.trade_activity : DEFAULT_PREFS.trade_activity,
  };
}

// --- row -> response shape ------------------------------------------------

type TelegramLinkRow = typeof telegramLinks.$inferSelect;

function buildStatus(
  env: TelegramEnv,
  walletAddress: string,
  row: TelegramLinkRow | null,
): TelegramConnectionStatus {
  const tokenConfigured = Boolean(env.TELEGRAM_BOT_TOKEN);
  const webhookUrlConfigured = Boolean(env.TELEGRAM_WEBHOOK_URL);
  const webhookSecretConfigured = Boolean(env.TELEGRAM_WEBHOOK_SECRET);
  // webhook_ready gates the telegram-page "Backend setup still needed" banner:
  // inbound updates only reach us once both the token and a webhook URL exist.
  const webhookReady = tokenConfigured && webhookUrlConfigured;

  const prefs = coercePrefs(row?.notificationPrefs ?? null);

  // Surface an active deeplink only while it is unexpired; otherwise null so the
  // page renders "No active secure link" / "Expired".
  const linkActive = Boolean(
    row?.linkToken && row?.linkExpiresAt && new Date(row.linkExpiresAt).getTime() > Date.now(),
  );
  const deeplinkUrl =
    linkActive && row?.linkToken
      ? `${botLink(env)}?start=${encodeURIComponent(row.linkToken)}`
      : null;

  return {
    wallet_address: walletAddress,
    bot_username: botUsername(env),
    bot_link: botLink(env),
    deeplink_url: deeplinkUrl,
    link_expires_at: linkActive ? (row?.linkExpiresAt ?? null) : null,
    connected: Boolean(row?.connected),
    telegram_username: row?.telegramUsername ?? null,
    telegram_first_name: row?.telegramFirstName ?? null,
    chat_label: row?.chatLabel ?? null,
    connected_at: row?.connectedAt ?? null,
    last_interaction_at: row?.lastInteractionAt ?? null,
    notifications_enabled: Boolean(row?.notificationsEnabled),
    notification_prefs: prefs,
    token_configured: tokenConfigured,
    webhook_url_configured: webhookUrlConfigured,
    webhook_secret_configured: webhookSecretConfigured,
    webhook_ready: webhookReady,
    commands: BOT_COMMANDS,
  };
}

// --- persistence helpers --------------------------------------------------

async function getLinkRow(db: Db, address: string): Promise<TelegramLinkRow | null> {
  const row = await db.query.telegramLinks.findFirst({
    where: eq(telegramLinks.walletAddress, address),
  });
  return row ?? null;
}

/** Ensure a users row exists so the telegram_links FK is satisfied on first write. */
async function ensureUser(db: Db, address: string): Promise<void> {
  await db
    .insert(users)
    .values({ walletAddress: address })
    .onConflictDoNothing({ target: users.walletAddress });
}

/** Upsert the telegram_links row for `address`, applying `patch`. Returns the fresh row. */
async function upsertLink(
  db: Db,
  address: string,
  patch: Partial<typeof telegramLinks.$inferInsert>,
): Promise<TelegramLinkRow> {
  await ensureUser(db, address);
  const ts = nowIso();
  await db
    .insert(telegramLinks)
    .values({
      walletAddress: address,
      notificationPrefs: DEFAULT_PREFS,
      updatedAt: ts,
      ...patch,
    })
    .onConflictDoUpdate({
      target: telegramLinks.walletAddress,
      set: { ...patch, updatedAt: ts },
    });
  const row = await getLinkRow(db, address);
  // upsert guarantees a row; non-null assertion is safe.
  return row as TelegramLinkRow;
}

// ==========================================================================
// GET /api/telegram?wallet_address=  -> TelegramConnectionStatus
// Owner-scoped read keyed off the query param (no auth required for the read,
// matching the contract: reads take wallet_address, writes require the session).
// ==========================================================================
r.get("/", async (c) => {
  const walletAddressRaw = c.req.query("wallet_address");
  if (!walletAddressRaw) {
    return c.json({ detail: "wallet_address is required" }, 400);
  }
  const address = normalizeAddress(walletAddressRaw);
  const db = getDb(c.env);
  const row = await getLinkRow(db, address);
  return c.json(buildStatus(telegramEnv(c.env), address, row));
});

// ==========================================================================
// POST /api/telegram/link  (auth) -> mint a fresh deeplink + pending link row
// ==========================================================================
r.post("/link", requireAuth, async (c) => {
  const address = getAddress(c);
  const db = getDb(c.env);

  const linkToken = crypto.randomUUID().replace(/-/g, "");
  const linkExpiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

  const existing = await getLinkRow(db, address);
  const row = await upsertLink(db, address, {
    linkToken,
    linkExpiresAt,
    // Preserve existing prefs/connection; only (re)issue the link.
    notificationPrefs: coercePrefs(existing?.notificationPrefs ?? null),
  });

  return c.json(buildStatus(telegramEnv(c.env), address, row));
});

// ==========================================================================
// PATCH/POST /api/telegram/preferences  (auth) -> update prefs -> status
// The frontend lib uses PATCH; the task contract says POST. Support both.
// ==========================================================================
async function handlePreferences(c: Context<AppEnv>) {
  const address = getAddress(c);
  const db = getDb(c.env);

  let body: {
    notifications_enabled?: boolean;
    critical_alerts?: boolean;
    execution_failures?: boolean;
    copy_activity?: boolean;
    trade_activity?: boolean;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const existing = await getLinkRow(db, address);
  const currentPrefs = coercePrefs(existing?.notificationPrefs ?? null);

  // Merge: only fields present in the body override the current value.
  const nextPrefs: TelegramNotificationPrefs = {
    critical_alerts:
      typeof body.critical_alerts === "boolean"
        ? body.critical_alerts
        : currentPrefs.critical_alerts,
    execution_failures:
      typeof body.execution_failures === "boolean"
        ? body.execution_failures
        : currentPrefs.execution_failures,
    copy_activity:
      typeof body.copy_activity === "boolean" ? body.copy_activity : currentPrefs.copy_activity,
    trade_activity:
      typeof body.trade_activity === "boolean"
        ? body.trade_activity
        : currentPrefs.trade_activity,
  };

  const nextNotificationsEnabled =
    typeof body.notifications_enabled === "boolean"
      ? body.notifications_enabled
      : Boolean(existing?.notificationsEnabled);

  const row = await upsertLink(db, address, {
    notificationPrefs: nextPrefs,
    notificationsEnabled: nextNotificationsEnabled,
  });

  return c.json(buildStatus(telegramEnv(c.env), address, row));
}

r.patch("/preferences", requireAuth, (c) => handlePreferences(c));
r.post("/preferences", requireAuth, (c) => handlePreferences(c));

// ==========================================================================
// POST /api/telegram/test  (auth) -> send a real test message if possible
// Only attempts a real Telegram send when the bot token is configured AND the
// chat is connected. Returns the full status on success; on failure returns an
// honest { detail } (never a fake success), which the frontend surfaces.
// ==========================================================================
r.post("/test", requireAuth, async (c) => {
  const address = getAddress(c);
  const env = telegramEnv(c.env);
  const db = getDb(c.env);

  const row = await getLinkRow(db, address);

  if (!env.TELEGRAM_BOT_TOKEN) {
    return c.json(
      { detail: "Telegram is not configured on the backend (set TELEGRAM_BOT_TOKEN)." },
      503,
    );
  }
  if (!row?.connected || !row.chatId) {
    return c.json(
      { detail: "No Telegram chat is linked to this wallet yet. Generate a link and press Start." },
      409,
    );
  }

  // Real send via the Telegram Bot API. nodejs_compat + global fetch is enough.
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: row.chatId,
          text: "Vega test message — your wallet is linked and notifications are working.",
        }),
      },
    );
    if (!resp.ok) {
      let apiDetail = `Telegram API returned ${resp.status}`;
      try {
        const payload = (await resp.json()) as { description?: string };
        if (payload.description) apiDetail = payload.description;
      } catch {
        /* keep status-code detail */
      }
      return c.json({ detail: `Could not send the test message: ${apiDetail}` }, 502);
    }
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : "network error";
    return c.json({ detail: `Could not reach Telegram: ${message}` }, 502);
  }

  // Stamp last interaction and return the refreshed status.
  const updated = await upsertLink(db, address, { lastInteractionAt: nowIso() });
  return c.json(buildStatus(env, address, updated));
});

// ==========================================================================
// POST /api/telegram/disconnect  (auth) -> clear the link -> status
// Keeps the row (so prefs persist) but resets all connection/link state.
// ==========================================================================
r.post("/disconnect", requireAuth, async (c) => {
  const address = getAddress(c);
  const db = getDb(c.env);

  const existing = await getLinkRow(db, address);
  const row = await upsertLink(db, address, {
    chatId: null,
    telegramUsername: null,
    telegramFirstName: null,
    chatLabel: null,
    connected: false,
    connectedAt: null,
    lastInteractionAt: null,
    linkToken: null,
    linkExpiresAt: null,
    // Preserve the user's notification preferences across a disconnect.
    notificationPrefs: coercePrefs(existing?.notificationPrefs ?? null),
  });

  return c.json(buildStatus(telegramEnv(c.env), address, row));
});

// ==========================================================================
// POST /api/telegram/webhook  (NO session auth — gated by webhook secret)
// Accepts Telegram Bot API "Update" objects. On a /start <token> deeplink we
// bind the originating chat to the wallet that minted the token.
// Validates Telegram's X-Telegram-Bot-Api-Secret-Token header when a secret is
// configured. Always returns 200 with { ok } so Telegram does not retry.
// ==========================================================================
r.post("/webhook", async (c) => {
  const env = telegramEnv(c.env);

  // Secret validation: when TELEGRAM_WEBHOOK_SECRET is set, Telegram echoes it
  // back in this header (set when the webhook is registered). Reject mismatches.
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const provided =
      c.req.header("X-Telegram-Bot-Api-Secret-Token") ??
      c.req.header("x-telegram-bot-api-secret-token");
    if (provided !== env.TELEGRAM_WEBHOOK_SECRET) {
      return c.json({ detail: "Invalid webhook secret" }, 401);
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const message = update.message ?? update.edited_message;
  const chat = message?.chat;
  const text = message?.text ?? "";

  // /start <link_token> deeplink binds the chat to the wallet that minted it.
  const startMatch = /^\/start(?:@\w+)?\s+(\S+)/.exec(text.trim());
  if (chat && startMatch) {
    const token = startMatch[1];
    const db = getDb(c.env);
    const pending = await db.query.telegramLinks.findFirst({
      where: eq(telegramLinks.linkToken, token),
    });

    if (
      pending &&
      pending.linkExpiresAt &&
      new Date(pending.linkExpiresAt).getTime() > Date.now()
    ) {
      const from = message?.from;
      const ts = nowIso();
      const displayFirst = from?.first_name ?? chat.first_name ?? null;
      const username = from?.username ?? chat.username ?? null;
      const chatLabel = chat.title ?? (username ? `@${username}` : displayFirst) ?? "Private chat";

      await db
        .update(telegramLinks)
        .set({
          chatId: String(chat.id),
          telegramUsername: username,
          telegramFirstName: displayFirst,
          chatLabel,
          connected: true,
          connectedAt: ts,
          lastInteractionAt: ts,
          notificationsEnabled: true,
          // Burn the deeplink so it cannot be replayed.
          linkToken: null,
          linkExpiresAt: null,
          updatedAt: ts,
        })
        .where(eq(telegramLinks.walletAddress, pending.walletAddress));
    }
    return c.json({ ok: true });
  }

  // Any other inbound message from an already-linked chat: stamp interaction.
  if (chat?.id != null) {
    const db = getDb(c.env);
    const linked = await db.query.telegramLinks.findFirst({
      where: eq(telegramLinks.chatId, String(chat.id)),
    });
    if (linked) {
      await db
        .update(telegramLinks)
        .set({ lastInteractionAt: nowIso(), updatedAt: nowIso() })
        .where(eq(telegramLinks.walletAddress, linked.walletAddress));
    }
  }

  return c.json({ ok: true });
});

// --- minimal Telegram Bot API "Update" subset we read ---------------------

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export { r as telegramRouter };
