import { Address, Cell, toNano, type Sender } from "@ton/core";
import type { TonClient } from "@ton/ton";
import { buildSettleBody, buildCancelBody } from "./escrowMessages";
import { MatchEscrow } from "./MatchEscrow.gen";

// Settles / cancels matches on the MatchEscrow contract as the oracle (owner)
// and reads match funding state. Transport-agnostic writes: it takes any
// @ton/core `Sender` (production oracle wallet, or a sandbox treasury in tests),
// so the settle test exercises the production path. Reads go through a TonClient
// when one is provided.
//
// Disabled (no-op writes) until an escrow address + sender are configured, so
// the game server runs fine without on-chain credentials during development.

const GAS = toNano("0.05");

// Narrow port the funding coordinator depends on — lets tests inject a fake.
export interface EscrowPort {
  readonly enabled: boolean;
  settle(matchId: bigint, winner: Address): Promise<void>;
  cancel(matchId: bigint): Promise<void>;
  matchCount(matchId: bigint): Promise<number>;
}

export class EscrowService implements EscrowPort {
  private sender: Sender | null;
  private escrow: Address | null;
  private client: TonClient | null;

  constructor(sender: Sender | null, escrow: Address | null, client: TonClient | null = null) {
    this.sender = sender;
    this.escrow = escrow;
    this.client = client;
  }

  get enabled(): boolean {
    return this.sender != null && this.escrow != null;
  }

  async settle(matchId: bigint, winner: Address): Promise<void> {
    if (!this.enabled) {
      console.log(`[escrow] (disabled) would settle match ${matchId} → ${winner}`);
      return;
    }
    await this.send(buildSettleBody(matchId, winner));
    console.log(`[escrow] settled match ${matchId} → ${winner}`);
  }

  async cancel(matchId: bigint): Promise<void> {
    if (!this.enabled) {
      console.log(`[escrow] (disabled) would cancel match ${matchId}`);
      return;
    }
    await this.send(buildCancelBody(matchId));
    console.log(`[escrow] cancelled match ${matchId}`);
  }

  // How many players have deposited for this match (0 if unknown / not funded).
  async matchCount(matchId: bigint): Promise<number> {
    if (!this.client || !this.escrow) return 0;
    try {
      const c = this.client.open(MatchEscrow.fromAddress(this.escrow));
      const data = await c.getMatchData(matchId);
      return data ? Number(data.count) : 0;
    } catch {
      return 0; // RPC hiccup — caller re-polls
    }
  }

  private async send(body: Cell): Promise<void> {
    await this.sender!.send({
      to: this.escrow!,
      value: GAS,
      body,
      bounce: true,
    });
  }
}
