/**
 * Hono app wiring: CORS, healthcheck, and every resource router mounted under
 * its /api prefix. Router modules live in ./routes/<name>.ts and export a
 * `<name>Router` Hono instance. Later agents overwrite each stub's body but
 * MUST keep the export name and the /api mount point intact.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./index";
import type { AuthVariables } from "./auth";

import { authRouter } from "./routes/auth";
import { botsRouter } from "./routes/bots";
import { builderRouter } from "./routes/builder";
import { copilotRouter } from "./routes/copilot";
import { marketplaceRouter } from "./routes/marketplace";
import { botCopyRouter } from "./routes/botCopy";
import { portfoliosRouter } from "./routes/portfolios";
import { backtestsRouter } from "./routes/backtests";
import { telegramRouter } from "./routes/telegram";
import { readinessRouter } from "./routes/readiness";
import { runsRouter } from "./routes/runs";

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

export const app = new Hono<AppEnv>();

// Permissive CORS: reflect the request Origin and allow the Authorization
// header so the static frontend (different origin) can send bearer sessions.
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Type"],
    credentials: true,
    maxAge: 86400,
  }),
);

app.get("/healthz", (c) => c.json({ ok: true, service: "vega-api" }));

// Resource routers — each mounted at its /api prefix.
app.route("/api/auth", authRouter);
app.route("/api/bots", botsRouter);
app.route("/api/builder", builderRouter);
app.route("/api/copilot", copilotRouter);
app.route("/api/marketplace", marketplaceRouter);
app.route("/api/bot-copy", botCopyRouter);
app.route("/api/portfolios", portfoliosRouter);
app.route("/api/backtests", backtestsRouter);
app.route("/api/telegram", telegramRouter);
app.route("/api/sodex", readinessRouter);
app.route("/api/runs", runsRouter);

app.notFound((c) => c.json({ detail: "Not found" }, 404));
