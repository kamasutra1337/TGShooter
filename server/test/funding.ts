// Unit test for the funding coordinator's control flow, with a fake escrow +
// fake room + injected clock/sleep so it runs instantly and deterministically
// (no network, no real timers). Proves the three outcomes:
//   1) all seats funded  → match starts, no cancel
//   2) deadline passes    → cancel (refund) + fundFailed + room closed
//   3) a player aborts    → cancel (refund) + fundFailed + room closed
import { Address } from "@ton/core";
import type { ServerMsg } from "../../shared/protocol";
import { FundingSession, type FundableRoom, type FundingDeps } from "../src/Funding";
import type { EscrowPort } from "../src/ton/EscrowService";

class FakeRoom implements FundableRoom {
  chainMatchId = 123n;
  stake = 1;
  seats = 2;
  humans = [{ id: "a" }, { id: "b" }];
  sent: ServerMsg[] = [];
  started = false;
  closed = false;
  sendAll(m: ServerMsg) {
    this.sent.push(m);
  }
  start() {
    this.started = true;
  }
  forceClose() {
    this.closed = true;
  }
}

class FakeEscrow implements EscrowPort {
  enabled = true;
  settled: bigint[] = [];
  cancelled: bigint[] = [];
  constructor(private counts: number[]) {}
  async settle(matchId: bigint) {
    this.settled.push(matchId);
  }
  async cancel(matchId: bigint) {
    this.cancelled.push(matchId);
  }
  async matchCount(): Promise<number> {
    return this.counts.length > 1 ? this.counts.shift()! : this.counts[0];
  }
}

const problems: string[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) problems.push(msg);
}

// A clock we advance manually; sleep() jumps it forward by the poll interval.
function makeDeps(escrow: EscrowPort, opts: Partial<FundingDeps> = {}): FundingDeps {
  let clock = 0;
  return {
    escrow,
    escrowAddress: "kQD_escrow",
    pollMs: 1000,
    timeoutMs: 5000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    ...opts,
  };
}

async function main() {
  // 1) Happy path: 0, 0, then 2 (full) → started, never cancelled.
  {
    const room = new FakeRoom();
    const escrow = new FakeEscrow([0, 0, 2]);
    const out = await new FundingSession(room, makeDeps(escrow)).run();
    check(out === "started", `happy: expected started, got ${out}`);
    check(room.started, "happy: room.start() should be called");
    check(!room.closed, "happy: room should not be force-closed");
    check(escrow.cancelled.length === 0, "happy: cancel must not be called");
    check(
      room.sent.some((m) => m.t === "fund"),
      "happy: a fund message should be sent",
    );
    check(
      room.sent.some((m) => m.t === "fundStatus"),
      "happy: fundStatus should be sent",
    );
  }

  // 2) Timeout: count never reaches seats → cancel + fundFailed + closed.
  {
    const room = new FakeRoom();
    const escrow = new FakeEscrow([1]); // one deposits, other never does
    const out = await new FundingSession(room, makeDeps(escrow)).run();
    check(out === "cancelled", `timeout: expected cancelled, got ${out}`);
    check(!room.started, "timeout: room must not start");
    check(room.closed, "timeout: room should be force-closed");
    check(escrow.cancelled.length === 1, "timeout: cancel (refund) must be called once");
    check(
      room.sent.some((m) => m.t === "fundFailed"),
      "timeout: fundFailed should be sent",
    );
  }

  // 3) Abort before funding completes → cancel + fundFailed + closed.
  {
    const room = new FakeRoom();
    const escrow = new FakeEscrow([0]);
    const session = new FundingSession(room, makeDeps(escrow));
    session.abort("a player left before funding completed");
    const out = await session.run();
    check(out === "cancelled", `abort: expected cancelled, got ${out}`);
    check(!room.started, "abort: room must not start");
    check(room.closed, "abort: room should be force-closed");
    check(escrow.cancelled.length === 1, "abort: cancel (refund) must be called once");
  }

  // Sanity: Address import used (keeps the escrow settle signature honest).
  void Address;

  if (problems.length) {
    console.error("\n❌ FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log(
    "\n✅ PASS — funding coordinator: full→start, timeout→refund+close, abort→refund+close",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
