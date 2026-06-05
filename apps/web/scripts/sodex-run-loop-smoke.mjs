/**
 * Wallet-free smoke test for the strategy runtime's DATA + DECISION path.
 *
 * The runtime (src/lib/runtime/*) snapshots a market from the public SoDEX
 * reads, then a pure evaluator decides whether a route fires. This script
 * exercises that same data path against live testnet — without a wallet, so it
 * places NO orders — and reproduces the core fire/no-fire decision for a
 * "price_above + sma_above" route to prove the inputs the runtime relies on are
 * live and well-formed.
 *
 * The indicator math here mirrors src/lib/runtime/indicators.ts; the real order
 * placement path is covered separately by sodex-place-testnet-order.mjs.
 *
 * Usage from apps/web/:
 *   node scripts/sodex-run-loop-smoke.mjs
 *   node scripts/sodex-run-loop-smoke.mjs --symbol TESTBTC_vUSDC --interval 5m --period 20
 */

const SPOT = process.env.NEXT_PUBLIC_SODEX_API_BASE ?? "https://testnet-gw.sodex.dev/api/v1/spot";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SYMBOL = arg("symbol", "vMAG7ssi_vUSDC");
const INTERVAL = arg("interval", "5m");
const PERIOD = Number(arg("period", "20"));

async function get(path, query) {
  const url = new URL(`${SPOT}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SoDEX ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// mirror of indicators.ts::sma
function sma(values, period) {
  if (period <= 0 || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

async function main() {
  console.log(`▸ Run-loop smoke — ${SYMBOL} @ ${INTERVAL}, sma(${PERIOD})  [${SPOT}]\n`);

  const [tickers, symbols, klines, ob] = await Promise.all([
    get("/markets/tickers"),
    get("/markets/symbols"),
    get(`/markets/${SYMBOL}/klines`, { interval: INTERVAL, limit: 200 }),
    get(`/markets/${SYMBOL}/orderbook`, { limit: 5 }),
  ]);

  const ticker = tickers.data.find((t) => t.symbol === SYMBOL);
  const meta = symbols.data.find((s) => s.name === SYMBOL);
  if (!ticker) throw new Error(`No ticker for ${SYMBOL}`);
  if (!meta) throw new Error(`No symbol meta for ${SYMBOL}`);

  const candles = klines.data ?? [];
  const closes = candles.map((c) => Number(c.c));
  const last = Number(ticker.lastPx);
  const bestBid = ob.data?.bids?.[0]?.[0] ? Number(ob.data.bids[0][0]) : null;
  const bestAsk = ob.data?.asks?.[0]?.[0] ? Number(ob.data.asks[0][0]) : null;

  // Snapshot integrity assertions (what the runtime depends on).
  const checks = [
    ["ticker.lastPx is a positive number", last > 0],
    ["symbol meta has id + tickSize + stepSize", Boolean(meta.id) && Boolean(meta.tickSize) && Boolean(meta.stepSize)],
    [`klines returned >= ${PERIOD} bars`, closes.length >= PERIOD],
    ["closes are all finite numbers", closes.every((n) => Number.isFinite(n))],
    ["orderbook has a best bid or ask", bestBid != null || bestAsk != null],
  ];

  let allOk = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "✓" : "✗"} ${label}`);
    if (!pass) allOk = false;
  }
  if (!allOk) {
    console.error("\n✗ Snapshot integrity failed — runtime inputs are not well-formed.");
    process.exit(1);
  }

  // Reproduce the runtime decision for: price_above(last*0 ⇒ always) + sma_above.
  const movingAvg = sma(closes, PERIOD);
  const smaAboveFires = movingAvg != null && last > movingAvg;
  console.log(`\n  market: last=${last}  sma(${PERIOD})=${movingAvg?.toFixed(6)}  bestBid=${bestBid}  bestAsk=${bestAsk}`);
  console.log(`  route { sma_above } → ${smaAboveFires ? "WOULD FIRE" : "would not fire"}`);
  console.log(
    `\n✓ Data path live and well-formed. The runtime would${smaAboveFires ? "" : " NOT"} place an order` +
      ` for an sma_above route right now (no order placed — this is wallet-free).`,
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
