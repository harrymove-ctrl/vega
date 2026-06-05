import {
  placeBatchNewOrder,
  cancelBatchOrder,
  type BatchNewOrderItem,
  type BatchCancelOrderItem,
} from "@/lib/sodex-trade";
import { fetchAccountState } from "@/lib/sodex-public";

export interface OrderResult {
  accepted: boolean;
  orderID: number | null;
  raw: unknown;
}

/**
 * How the runtime turns an order intent into a real (or simulated) SoDEX write.
 *
 * This is the seam the plan's §1 decision hangs on. Option A ships
 * {@link WalletInLoopStrategy}; a future Option B (delegated/server key) is a
 * drop-in implementation of this same interface — the runtime never changes.
 */
export interface ExecutionStrategy {
  /** Human label for the execution log. */
  readonly label: string;
  /** Whether this strategy actually hits the network (false = dry run). */
  readonly live: boolean;
  placeOrder(item: BatchNewOrderItem): Promise<OrderResult>;
  cancelOrder(item: BatchCancelOrderItem): Promise<OrderResult>;
}

/**
 * Option A — wallet-in-loop. Each order resolves the account's `aid` fresh
 * (never trust stale state for a write, matching test-order-panel) and calls
 * the EIP-712 sign+POST path, which prompts the connected wallet.
 */
export class WalletInLoopStrategy implements ExecutionStrategy {
  readonly label = "wallet-in-loop";
  readonly live = true;

  constructor(private readonly address: `0x${string}`) {}

  private async resolveAccountId(): Promise<number> {
    const state = await fetchAccountState(this.address);
    const aid = state.data?.aid;
    if (state.code !== 0 || !aid) {
      throw new Error(
        "No SoDEX account for this wallet. Connect once at testnet.sodex.com and claim the faucet.",
      );
    }
    return aid;
  }

  async placeOrder(item: BatchNewOrderItem): Promise<OrderResult> {
    const accountID = await this.resolveAccountId();
    const res = await placeBatchNewOrder({ accountID, orders: [item] }, { account: this.address });
    const data = Array.isArray(res.data) ? res.data[0] : null;
    const orderID = Number((data as { orderID?: number } | null)?.orderID ?? 0) || null;
    return { accepted: true, orderID, raw: res };
  }

  async cancelOrder(item: BatchCancelOrderItem): Promise<OrderResult> {
    const accountID = await this.resolveAccountId();
    const res = await cancelBatchOrder({ accountID, cancels: [item] }, { account: this.address });
    return { accepted: true, orderID: null, raw: res };
  }
}

/**
 * Demo / NEXT_PUBLIC_DEMO_MODE strategy: evaluates and logs intents but never
 * signs or sends. Keeps the static demo deploy provably side-effect-free.
 */
export class DryRunStrategy implements ExecutionStrategy {
  readonly label = "dry-run";
  readonly live = false;

  async placeOrder(item: BatchNewOrderItem): Promise<OrderResult> {
    return { accepted: true, orderID: null, raw: { dryRun: true, item } };
  }
  async cancelOrder(item: BatchCancelOrderItem): Promise<OrderResult> {
    return { accepted: true, orderID: null, raw: { dryRun: true, item } };
  }
}

/**
 * Option B placeholder. Intentionally throws — wiring a delegated/server key is
 * out of scope for Phase 1 (see plan §1). Present so the type surface is stable.
 */
export class DelegatedKeyStrategy implements ExecutionStrategy {
  readonly label = "delegated-key";
  readonly live = true;
  async placeOrder(): Promise<OrderResult> {
    throw new Error("DelegatedKeyStrategy not wired (plan §1, Option B). Use WalletInLoopStrategy.");
  }
  async cancelOrder(): Promise<OrderResult> {
    throw new Error("DelegatedKeyStrategy not wired (plan §1, Option B). Use WalletInLoopStrategy.");
  }
}
