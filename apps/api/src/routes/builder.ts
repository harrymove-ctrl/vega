/**
 * /api/builder — visual builder support endpoints.
 *
 *   GET  /api/builder/templates          -> BuilderTemplate[]   (seeded catalog)
 *   POST /api/builder/validate           -> { errors[], warnings[] }
 *   POST /api/builder/simulate           -> { valid, triggered, evaluated_conditions,
 *                                             planned_actions, market_context }
 *   POST /api/builder/ai-chat/jobs       -> { id }
 *   GET  /api/builder/ai-chat/jobs/:id   -> { id, status, errorDetail }
 *
 * Shapes are pinned to what the frontend dereferences:
 *   - templates: builder-graph-studio.tsx `BuilderCatalogTemplate`
 *       (merged into BUILDER_STARTER_TEMPLATES by `id`, reads `name`,
 *        `description`, `authoring_mode`, `risk_profile`).
 *   - validate: disable-missing-backend.ts `/builder/validate` -> { errors, warnings }.
 *   - simulate: bot-validation-panel.tsx `SimulationResult`.
 *   - ai-chat: builder-graph-studio.tsx `BuilderAiJobCreateResponse` / `...StatusResponse`.
 *
 * These endpoints are pure compute over the posted draft — no DB row, no
 * owner scope, so no auth gate (nothing is written). The AI tab is an honest
 * placeholder: tool-calling against Anthropic lands in P1-E.
 */
import { Hono } from "hono";

import type { AppEnv } from "../app";

const r = new Hono<AppEnv>();

/**
 * Seeded template catalog. IDs MUST match BUILDER_STARTER_TEMPLATES in
 * apps/web/src/components/builder/builder-flow-utils.ts so the frontend's
 * `catalogTemplates.find(c => c.id === template.id ...)` merge resolves and
 * the (optional) backend copy overrides name/description/risk_profile.
 */
type BuilderTemplate = {
  id: string;
  name: string;
  description: string;
  authoring_mode: string;
  risk_profile: string;
};

const BUILDER_TEMPLATES: BuilderTemplate[] = [
  {
    id: "momentum-breakout-v1",
    name: "Multi-Market Trend Scalper",
    description:
      "Trades fast long continuation across selected markets once lower and higher timeframe trend agree.",
    authoring_mode: "visual",
    risk_profile: "active",
  },
  {
    id: "mean-revert-v1",
    name: "Exhaustion Fade Short",
    description:
      "Sells sharp intraday extensions after upper-band stretch, overheated RSI, and liquidity confirmation line up.",
    authoring_mode: "visual",
    risk_profile: "balanced",
  },
  {
    id: "support-exit-v1",
    name: "Trend Pullback Reclaim",
    description:
      "Buys dip-and-reclaim setups inside an existing uptrend so the bot can keep cycling with the market.",
    authoring_mode: "visual",
    risk_profile: "balanced",
  },
  {
    id: "twap-trend-v1",
    name: "Breakdown Momentum Short",
    description:
      "Presses fresh downside breaks when intraday weakness lines up with the broader trend.",
    authoring_mode: "visual",
    risk_profile: "active",
  },
  {
    id: "maker-reclaim-v1",
    name: "Oversold Bounce Catcher",
    description:
      "Buys fast washouts after lower-band expansion and washed-out RSI create a short-term rebound setup.",
    authoring_mode: "visual",
    risk_profile: "active",
  },
];

r.get("/templates", (c) => {
  return c.json(BUILDER_TEMPLATES);
});

// ---------------------------------------------------------------------------
// Draft shape helpers (shared by /validate and /simulate)
// ---------------------------------------------------------------------------

type DraftCondition = Record<string, unknown> & { type?: unknown; symbol?: unknown };
type DraftAction = Record<string, unknown> & { type?: unknown; symbol?: unknown };

type RulesJson = {
  conditions?: unknown;
  actions?: unknown;
  routes?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Flatten conditions + actions out of a draft. The visual builder serializes
 * two interchangeable shapes (builder-flow-utils.ts): a flat
 * `{ conditions[], actions[] }` draft, or a multi-route draft
 * `{ routes: [{ conditions[], actions[] }] }`. Count both.
 */
function collectConditionsActions(rules: RulesJson): {
  conditions: DraftCondition[];
  actions: DraftAction[];
} {
  const conditions: DraftCondition[] = [];
  const actions: DraftAction[] = [];

  for (const condition of asArray(rules.conditions)) {
    conditions.push(asRecord(condition) as DraftCondition);
  }
  for (const action of asArray(rules.actions)) {
    actions.push(asRecord(action) as DraftAction);
  }
  for (const route of asArray(rules.routes)) {
    const routeRecord = asRecord(route);
    for (const condition of asArray(routeRecord.conditions)) {
      conditions.push(asRecord(condition) as DraftCondition);
    }
    for (const action of asArray(routeRecord.actions)) {
      actions.push(asRecord(action) as DraftAction);
    }
  }

  return { conditions, actions };
}

function extractRules(body: Record<string, unknown>): RulesJson {
  // Callers may post `{ rules_json: {...} }` (bot-validation-panel) or the
  // raw draft directly. Accept either.
  const rules = asRecord(body.rules_json);
  if (Object.keys(rules).length > 0) return rules as RulesJson;
  return body as RulesJson;
}

// ---------------------------------------------------------------------------
// POST /validate — schema-shape validation of the draft.
// Returns { errors, warnings } (disable-missing-backend.ts /builder/validate).
// ---------------------------------------------------------------------------
r.post("/validate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = asRecord(await c.req.json());
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const rules = extractRules(body);
  const { conditions, actions } = collectConditionsActions(rules);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (conditions.length === 0) {
    errors.push("Add at least one condition block so the bot knows when to act.");
  }
  if (actions.length === 0) {
    errors.push("Add at least one action block so the bot has something to execute.");
  }

  conditions.forEach((condition, index) => {
    if (typeof condition.type !== "string" || condition.type.trim() === "") {
      errors.push(`Condition ${index + 1} is missing a block type.`);
    }
    const symbol = condition.symbol;
    if (symbol !== undefined && (typeof symbol !== "string" || symbol.trim() === "")) {
      warnings.push(`Condition ${index + 1} has no market selected.`);
    }
  });

  actions.forEach((action, index) => {
    if (typeof action.type !== "string" || action.type.trim() === "") {
      errors.push(`Action ${index + 1} is missing a block type.`);
    }
    const sizeUsd = action.size_usd;
    if (typeof sizeUsd === "number" && sizeUsd <= 0 && action.type !== "cancel_all_orders") {
      warnings.push(`Action ${index + 1} has a non-positive order size.`);
    }
  });

  return c.json({ errors, warnings });
});

// ---------------------------------------------------------------------------
// POST /simulate — deterministic local dry-run summary.
// Returns SimulationResult (bot-validation-panel.tsx):
//   { valid, triggered, evaluated_conditions, planned_actions, market_context }
// Deterministic: "triggered" iff there is at least one well-formed condition
// AND one well-formed action. No randomness, no external market reads.
// ---------------------------------------------------------------------------
r.post("/simulate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = asRecord(await c.req.json());
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const rules = extractRules(body);
  const { conditions, actions } = collectConditionsActions(rules);

  const wellFormedConditions = conditions.filter(
    (condition) => typeof condition.type === "string" && condition.type.trim() !== "",
  );
  const wellFormedActions = actions.filter(
    (action) => typeof action.type === "string" && action.type.trim() !== "",
  );

  const valid = wellFormedConditions.length > 0 && wellFormedActions.length > 0;
  const triggered = valid;

  // Surface the markets the draft references so the panel can show context.
  const symbols = Array.from(
    new Set(
      [...conditions, ...actions]
        .map((block) => block.symbol)
        .filter((symbol): symbol is string => typeof symbol === "string" && symbol.trim() !== ""),
    ),
  );

  return c.json({
    valid,
    triggered,
    evaluated_conditions: wellFormedConditions.length,
    planned_actions: triggered ? wellFormedActions.length : 0,
    market_context: {
      engine: "deterministic-local",
      symbols,
      condition_count: conditions.length,
      action_count: actions.length,
    },
  });
});

// ---------------------------------------------------------------------------
// AI chat — honest placeholder. Real Anthropic tool-calling loop is P1-E.
// POST creates a job id; GET reports it as `failed` with a helpful errorDetail
// (NOT a fake success — see builder-graph-studio.tsx poll handler which reads
// payload.status === "failed" and payload.errorDetail).
// ---------------------------------------------------------------------------
r.post("/ai-chat/jobs", async (c) => {
  // Drain the body so the request completes cleanly; we don't use it yet.
  try {
    await c.req.json();
  } catch {
    // empty / non-JSON body is fine — the job is a placeholder.
  }
  const id = crypto.randomUUID();
  return c.json({ id });
});

r.get("/ai-chat/jobs/:id", (c) => {
  const id = c.req.param("id");
  return c.json({
    id,
    status: "failed",
    errorDetail: "AI tool-calling lands in P1-E; use the Visual tab",
  });
});

export { r as builderRouter };
