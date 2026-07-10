import { Address, Cell, toNano, type Sender } from "@ton/core";
import { buildSettleBody, buildCancelBody } from "./escrowMessages";

// Settles / cancels matches on the MatchEscrow contract as the oracle (owner).
//
// Transport-agnostic: it takes any @ton/core `Sender`. In production that's the
// oracle wallet's sender (see makeLiveSender); in tests it's a sandbox treasury
// sender. The SAME code path is exercised either way, so the sandbox settle test
// proves the production settle path.
//
// Disabled (no-op, logs intent) until an escrow address + sender are configured,
// so the game server runs fine without on-chain credentials during development.

const GAS = toNano("0.05");

export class EscrowService {
  private sender: Sender | null;
  private escrow: Address | null;

  constructor(sender: Sender | null, escrow: Address | null) {
    this.sender = sender;
    this.escrow = escrow;
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

  private async send(body: Cell): Promise<void> {
    await this.sender!.send({
      to: this.escrow!,
      value: GAS,
      body,
      bounce: true,
    });
  }
}
