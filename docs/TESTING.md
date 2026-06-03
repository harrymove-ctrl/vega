# Testing real signed orders with 1400 vUSDC

The smoke-test wallet (`0x3Fb7c18EBBBa1A9b54692C2655F9Df0317f68e95`,
accountID 56664) holds 1400 vUSDC inside the SoDEX engine. Native
SOSO gas on L1 is zero — that's fine, every recipe below stays on
the off-chain Spot sequencer (no L1 broadcast required).

All commands run from `apps/web/` after copying the testnet key into
`.env.local`:

```bash
cd apps/web
node --env-file=.env.local scripts/sodex-l1-readiness.mjs
# → reports current state. balance 0 SOSO is OK for the recipes below.
```

---

## Recipe 1 — Tiny limit BUY (~10 vUSDC notional)

The simplest possible signed write. Places one limit BUY at 50% of
best bid on `vBTC_vUSDC` so the order rests on the book and never
fills, then cancel it.

```bash
node --env-file=.env.local scripts/sodex-place-testnet-order.mjs
# → "✓ SIGNED REAL TXN ACCEPTED  orderID 12502xxxxx"

# inspect on the engine:
curl -sS https://testnet-gw.sodex.dev/api/v1/spot/accounts/0x3Fb7c18EBBBa1A9b54692C2655F9Df0317f68e95/orders \
  | python3 -m json.tool

# release the margin:
node --env-file=.env.local scripts/sodex-cancel-testnet-order.mjs \
  --order <orderID-from-above> --symbol vBTC_vUSDC
```

What you prove: EIP-712 sign + v-byte normalize + 0x01 wire prefix +
`X-Api-Sign/Nonce/Chain` headers all work end-to-end. ~10 vUSDC
margin frozen, fully refunded on cancel.

---

## Recipe 2 — Cancel everything that's currently open

Loop over the open-orders endpoint and cancel each. Useful when
several drafts left orders behind.

```bash
ADDR=0x3Fb7c18EBBBa1A9b54692C2655F9Df0317f68e95
curl -sS "https://testnet-gw.sodex.dev/api/v1/spot/accounts/$ADDR/orders" \
  | python3 -c "
import sys, json
for o in json.load(sys.stdin)['data']['orders']:
    print(o['orderID'], o['symbol'])
" | while read OID SYM; do
  node --env-file=.env.local scripts/sodex-cancel-testnet-order.mjs --order $OID --symbol $SYM
done
```

What you prove: idempotent cancel flow, fresh nonce + clOrdID per
action, batch cleanup works.

---

## Recipe 3 — Different symbol (vMAG7ssi, the SoSoValue × SoDEX synergy)

`vMAG7ssi_vUSDC` is the Magnificent-7 SSI index from SoSoValue,
tradable as a SoDEX pair. Place a tiny limit there to prove the
script handles different precisions / market microstructures.

```bash
node --env-file=.env.local scripts/sodex-place-testnet-order.mjs \
  --symbol vMAG7ssi_vUSDC
```

What you prove: planner reads `minQuantity`, `tickSize`, `minNotional`
from the live `/markets/symbols` payload — same code path adapts to
any spot pair without hard-coded numbers.

---

## Recipe 4 — From the browser via wagmi

Open the dashboard at `pnpm dev` → `http://localhost:3000/dashboard/`,
import the same private key into MetaMask, switch network to
**ValueChain Testnet** (chain id 138565,
RPC `https://testnet-rpc.valuechain.xyz`), then in the
**"EIP-712 signed-order smoke test"** panel:

1. Click **Connect wallet** → choose MetaMask.
2. Click **Run signed-order smoke test** → MetaMask popup for
   `eth_signTypedData_v4`. Approve.
3. Server returns `code: 0` and the orderID; the panel shows the
   accepted result.
4. Click **Cancel order** → second popup. Approve.
5. Watch the **My SoDEX orders** panel below refresh in real time
   (TanStack Query, 8s interval).

What you prove: the exact same signing pipeline that works from
Node also works through a browser wallet's `signTypedData` —
including the v-byte normalize and 0x01 wire prefix wired into
`toWireSignature`.

---

## Recipe 5 — Daily faucet top-up (engine credit, not L1)

You started with 1200 vUSDC and the faucet has been bumping it; each
call adds 100 vUSDC inside the SoDEX engine. The endpoint is
backend-private but accepts an unsigned `{address}` body and produces
a real L1 receipt (the operator broadcasts, not you).

```bash
node --env-file=.env.local scripts/sodex-faucet-claim.mjs
# first call:  {"code":0,"data":"0x..."}  → engine balance goes up by 100
# second call: {"code":1,"msg":"Already claimed"} HTTP 403
```

What you prove: the faucet path observed in the SoDEX JS bundle works
without UI, the operator's L1 tx hash is verifiable on
`test-scan.valuechain.xyz`, and the SoDEX engine credits are independent
of L1 native balance.

---

## Sanity checks before each session

```bash
node scripts/sodex-payload-hash-parity.mjs
# → all three reference hashes must match. If they don't, the canonical
#   encoder or v-byte logic drifted vs. the Go SDK and signing will be
#   rejected server-side. Stop and re-sync sodex-trade.ts before
#   placing any orders.
```

That parity test is the single gating check between "code compiles"
and "real server will accept our signature."
