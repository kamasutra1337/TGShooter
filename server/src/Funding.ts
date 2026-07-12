import type { ServerMsg } from "../../shared/protocol";
import type { EscrowPort } from "./ton/EscrowService";

// Coordinates the on-chain funding phase of a staked match. Between "room full
// of humans" and "match starts", every player must deposit their stake into the
// escrow contract. We poll the contract for the deposit count and:
//   • start the match once all seats are funded, or
//   • cancel (oracle refunds every depositor) if the deadline passes or a
//     player leaves before funding completes.
//
// The client can never move money — it only signs its own Deposit. This
// coordinator only READS the count and asks the oracle to settle/cancel.

// Minimal view of a Room this coordinator needs — keeps it unit-testable.
export interface FundableRoom {
  readonly chainMatchId: bigint;
  readonly stake: number;
  readonly seats: number;
  readonly humans: { id: string }[];
  sendAll(msg: ServerMsg): void;
  start(): void;
  forceClose(): void;
}

export interface FundingDeps {
  escrow: EscrowPort;
  escrowAddress: string; // friendly form clients deposit to
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type FundingOutcome = "started" | "cancelled";

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FundingSession {
  private aborted = false;
  private abortReason = "";
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly room: FundableRoom,
    private readonly deps: FundingDeps,
  ) {
    this.pollMs = deps.pollMs ?? 3000;
    this.timeoutMs = deps.timeoutMs ?? 90_000;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? realSleep;
  }

  // A player left before funding completed → abort + refund.
  abort(reason = "a player left before funding completed"): void {
    this.aborted = true;
    this.abortReason = reason;
  }

  // A client reported it broadcast its deposit — poll again promptly.
  noteDeposit(): void {
    /* the loop already polls on pollMs; this is a no-op hook kept for the
       protocol's `deposited` hint and future fast-path polling. */
  }

  async run(): Promise<FundingOutcome> {
    const mid = this.room.chainMatchId;
    const deadline = this.now() + this.timeoutMs;

    this.room.sendAll({
      t: "fund",
      matchId: mid.toString(),
      escrow: this.deps.escrowAddress,
      stake: this.room.stake,
      seats: this.room.seats,
      deadlineMs: deadline,
    });

    while (!this.aborted) {
      const count = await this.deps.escrow.matchCount(mid);
      this.room.sendAll({ t: "fundStatus", funded: count, seats: this.room.seats });

      if (count >= this.room.seats) {
        this.room.start();
        return "started";
      }
      if (this.now() >= deadline) break;
      await this.sleep(this.pollMs);
    }

    // Timed out or aborted: refund every depositor and tear the room down.
    await this.deps.escrow.cancel(mid);
    this.room.sendAll({
      t: "fundFailed",
      reason: this.aborted
        ? this.abortReason
        : "funding timed out — any deposits were refunded",
    });
    this.room.forceClose();
    return "cancelled";
  }
}

export class FundingCoordinator {
  constructor(private readonly deps: FundingDeps) {}

  // Create a session for a full room. The caller drives it: `session.run()`
  // resolves "started" (match began) or "cancelled" (refunded + room closed),
  // so the caller can clean up its routing tables afterwards.
  create(room: FundableRoom): FundingSession {
    return new FundingSession(room, this.deps);
  }
}
