import {
  buildRoutesFromGraph,
  BOT_MARKET_UNIVERSE_SYMBOL,
  type BuilderGraphData,
  type BuilderAiRoute,
} from "@/components/builder/builder-flow-utils";
import { buildMarketSnapshot } from "./market-snapshot";
import { buildSpotPosition } from "./account-snapshot";
import { evaluateRoute, routeIntervals } from "./evaluate-route";
import { mapActionToOrder } from "./map-action";
import type { ExecutionStrategy } from "./execution-strategy";
import type { ExecutionLogEntry, RuntimeState } from "./types";

export interface StrategyRuntimeOptions {
  graph: BuilderGraphData;
  /** Concrete market this agent trades (resolves the builder universe sentinel). */
  symbol: string;
  strategy: ExecutionStrategy;
  /**
   * Connected wallet address. When set, each tick synthesizes the account's
   * spot position for `symbol` so position_* conditions can evaluate. Omit for
   * a market-only (entry) strategy or when no wallet is connected.
   */
  address?: string;
  /** How often to snapshot + evaluate (ms). Default 15s. */
  pollIntervalMs?: number;
  /** Minimum seconds between two fires of the SAME route (storm guard). Default 60. */
  reArmSeconds?: number;
  /** Candles per interval to pull for indicators. Default 200. */
  klineLimit?: number;
  onLog?: (entry: ExecutionLogEntry) => void;
  onStateChange?: (state: RuntimeState) => void;
}

const SAFE = /[^A-Za-z0-9_-]/g;

/** Replace the builder universe sentinel in a route with the concrete symbol. */
function resolveRouteSymbols(route: BuilderAiRoute, symbol: string): BuilderAiRoute {
  const swap = <T extends { symbol?: string }>(o: T): T =>
    o.symbol === BOT_MARKET_UNIVERSE_SYMBOL ? { ...o, symbol } : o;
  return {
    name: route.name,
    conditions: route.conditions.map(swap),
    actions: route.actions.map(swap),
  };
}

/**
 * Drives a builder graph as a live agent: every tick it snapshots the market,
 * evaluates each route's triggers, and on a fire asks the {@link ExecutionStrategy}
 * to place the route's orders. Pure evaluation + a thin stateful loop; the only
 * real-world effect flows through the injected strategy.
 */
export class StrategyRuntime {
  private state: RuntimeState = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private readonly routes: BuilderAiRoute[];
  private readonly intervals: string[];
  private readonly lastFiredAt = new Map<number, number>();
  private readonly warnedUnsupported = new Set<number>();
  readonly log: ExecutionLogEntry[] = [];

  constructor(private readonly opts: StrategyRuntimeOptions) {
    const raw = buildRoutesFromGraph(opts.graph.nodes, opts.graph.edges);
    this.routes = raw.map((r) => resolveRouteSymbols(r, opts.symbol));
    const ivs = new Set<string>();
    this.routes.forEach((r) => routeIntervals(r).forEach((i) => ivs.add(i)));
    this.intervals = Array.from(ivs);
  }

  getState(): RuntimeState {
    return this.state;
  }
  getRouteCount(): number {
    return this.routes.length;
  }

  private emit(entry: Omit<ExecutionLogEntry, "at">) {
    const full: ExecutionLogEntry = { at: Date.now(), ...entry };
    this.log.push(full);
    this.opts.onLog?.(full);
  }

  private setState(state: RuntimeState) {
    this.state = state;
    this.opts.onStateChange?.(state);
  }

  start() {
    if (this.state === "running") return;
    if (this.routes.length === 0) {
      this.emit({ level: "error", message: "No complete routes in this graph (need entry→condition→action)." });
      this.setState("error");
      return;
    }
    this.setState("running");
    this.emit({
      level: "info",
      message: `Runtime started on ${this.opts.symbol} via ${this.opts.strategy.label}${this.opts.strategy.live ? "" : " (dry run)"}`,
      data: { routes: this.routes.length, intervals: this.intervals },
    });
    this.scheduleTick(0);
  }

  pause() {
    if (this.state !== "running") return;
    this.clearTimer();
    this.setState("paused");
    this.emit({ level: "info", message: "Runtime paused" });
  }

  stop() {
    this.clearTimer();
    this.setState("stopped");
    this.emit({ level: "info", message: "Runtime stopped" });
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleTick(delay: number) {
    this.clearTimer();
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** Run exactly one evaluation pass. Public so a smoke test can drive it once. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const snap = await buildMarketSnapshot(this.opts.symbol, {
        intervals: this.intervals,
        klineLimit: this.opts.klineLimit ?? 200,
      });

      // Synthesize the account's spot position once per tick (if a wallet is
      // connected) so position_* conditions can evaluate.
      const position = this.opts.address
        ? await buildSpotPosition(this.opts.symbol, this.opts.address, snap.lastPrice)
        : undefined;

      const reArmMs = (this.opts.reArmSeconds ?? 60) * 1000;
      for (let i = 0; i < this.routes.length; i++) {
        const route = this.routes[i];
        const firedAt = this.lastFiredAt.get(i) ?? null;
        const since = firedAt === null ? null : (Date.now() - firedAt) / 1000;

        const result = evaluateRoute(route, snap, { secondsSinceLastFire: since, position });

        if (result.hasUnsupported && !this.warnedUnsupported.has(i)) {
          this.warnedUnsupported.add(i);
          const types = result.conditions.filter((c) => !c.supported).map((c) => c.type);
          this.emit({
            level: "warn",
            message: `Route ${i + 1} blocked: unsupported condition(s) ${types.join(", ")} — will not fire.`,
          });
        }

        if (!result.fired) continue;
        if (firedAt !== null && Date.now() - firedAt < reArmMs) continue; // storm guard

        this.lastFiredAt.set(i, Date.now());
        await this.fireRoute(i, route, snap);
      }
    } catch (err) {
      this.emit({ level: "error", message: `Tick failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      this.ticking = false;
      if (this.state === "running") this.scheduleTick(this.opts.pollIntervalMs ?? 15000);
    }
  }

  private async fireRoute(index: number, route: BuilderAiRoute, snap: Awaited<ReturnType<typeof buildMarketSnapshot>>) {
    this.emit({ level: "info", message: `Route ${index + 1} triggered`, data: { name: route.name } });
    for (let a = 0; a < route.actions.length; a++) {
      const action = route.actions[a];
      const clOrdID = `vega-bot-${index}-${a}-${Date.now()}`.replace(SAFE, "").slice(0, 64);
      const plan = mapActionToOrder(action, snap, clOrdID);
      if (plan.kind === "unsupported") {
        this.emit({ level: "warn", message: `Action skipped: ${plan.reason}`, data: { type: plan.type } });
        continue;
      }
      try {
        const res = await this.opts.strategy.placeOrder(plan.item);
        this.emit({
          level: "order",
          message: `${this.opts.strategy.live ? "Order placed" : "Order (dry run)"}: ${plan.summary}`,
          data: { clOrdID, orderID: res.orderID, notional: plan.notional, symbol: this.opts.symbol },
        });
      } catch (err) {
        this.emit({
          level: "error",
          message: `Order failed: ${err instanceof Error ? err.message : String(err)}`,
          data: { clOrdID, summary: plan.summary },
        });
      }
    }
  }
}
