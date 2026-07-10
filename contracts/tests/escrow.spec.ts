import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { MatchEscrow } from "../build/match_escrow_MatchEscrow";
import "@ton/test-utils";

// Runs the real compiled contract in a local TVM sandbox (no network). Proves
// the money-safety invariants that make real TON wagers safe: pot accounting,
// oracle-only settlement, winner payout minus rake, one-shot settlement, and
// full refunds on cancel.

describe("MatchEscrow", () => {
  let blockchain: Blockchain;
  let oracle: SandboxContract<TreasuryContract>;
  let alice: SandboxContract<TreasuryContract>;
  let bob: SandboxContract<TreasuryContract>;
  let escrow: SandboxContract<MatchEscrow>;

  const deposit = (
    who: SandboxContract<TreasuryContract>,
    matchId: bigint,
    stake: string,
    seats: bigint,
    value = "1.1",
  ) =>
    escrow.send(
      who.getSender(),
      { value: toNano(value) },
      { $$type: "Deposit", matchId, stake: toNano(stake), seats },
    );

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    oracle = await blockchain.treasury("oracle");
    alice = await blockchain.treasury("alice");
    bob = await blockchain.treasury("bob");

    escrow = blockchain.openContract(
      await MatchEscrow.fromInit(oracle.address, 500n), // 5% rake
    );
    const dep = await escrow.send(
      oracle.getSender(),
      { value: toNano("0.5") },
      { $$type: "Deploy", queryId: 0n },
    );
    expect(dep.transactions).toHaveTransaction({
      to: escrow.address,
      deploy: true,
      success: true,
    });
  });

  it("accumulates the pot from deposits", async () => {
    await deposit(alice, 1n, "1", 2n);
    await deposit(bob, 1n, "1", 2n);
    const m = await escrow.getMatchData(1n);
    expect(m!.pot).toBe(toNano("2"));
    expect(m!.count).toBe(2n);
    expect(m!.settled).toBe(false);
  });

  it("pays the winner pot minus rake on settle", async () => {
    await deposit(alice, 2n, "1", 2n);
    await deposit(bob, 2n, "1", 2n);

    const before = await alice.getBalance();
    const res = await escrow.send(
      oracle.getSender(),
      { value: toNano("0.05") },
      { $$type: "Settle", matchId: 2n, winner: alice.address },
    );
    expect(res.transactions).toHaveTransaction({
      from: escrow.address,
      to: alice.address,
      success: true,
    });
    const gained = (await alice.getBalance()) - before;
    // pot 2 * (1 - 0.05) = 1.9, minus small forwarding gas
    expect(gained).toBeGreaterThan(toNano("1.88"));
    expect(gained).toBeLessThanOrEqual(toNano("1.9"));
    expect((await escrow.getMatchData(2n))!.settled).toBe(true);
  });

  it("rejects settle from a non-oracle", async () => {
    await deposit(alice, 3n, "1", 2n);
    const res = await escrow.send(
      bob.getSender(),
      { value: toNano("0.05") },
      { $$type: "Settle", matchId: 3n, winner: bob.address },
    );
    expect(res.transactions).toHaveTransaction({
      from: bob.address,
      to: escrow.address,
      success: false,
    });
    expect((await escrow.getMatchData(3n))!.settled).toBe(false);
  });

  it("rejects a second settle on the same match", async () => {
    await deposit(alice, 4n, "1", 2n);
    await deposit(bob, 4n, "1", 2n);
    await escrow.send(
      oracle.getSender(),
      { value: toNano("0.05") },
      { $$type: "Settle", matchId: 4n, winner: alice.address },
    );
    const res = await escrow.send(
      oracle.getSender(),
      { value: toNano("0.05") },
      { $$type: "Settle", matchId: 4n, winner: bob.address },
    );
    expect(res.transactions).toHaveTransaction({
      from: oracle.address,
      to: escrow.address,
      success: false,
    });
  });

  it("rejects a deposit below the stake", async () => {
    await deposit(alice, 5n, "1", 2n);
    const res = await deposit(bob, 5n, "1", 2n, "0.5"); // underpays
    expect(res.transactions).toHaveTransaction({
      from: bob.address,
      to: escrow.address,
      success: false,
    });
    expect((await escrow.getMatchData(5n))!.count).toBe(1n);
  });

  it("refunds every player on cancel", async () => {
    await deposit(alice, 6n, "1", 3n);
    await deposit(bob, 6n, "1", 3n);

    const aBefore = await alice.getBalance();
    const bBefore = await bob.getBalance();
    const res = await escrow.send(
      oracle.getSender(),
      { value: toNano("0.15") },
      { $$type: "CancelMatch", matchId: 6n },
    );
    expect(res.transactions).toHaveTransaction({
      from: escrow.address,
      to: alice.address,
      success: true,
    });
    expect(res.transactions).toHaveTransaction({
      from: escrow.address,
      to: bob.address,
      success: true,
    });
    expect((await alice.getBalance()) - aBefore).toBeGreaterThan(toNano("0.98"));
    expect((await bob.getBalance()) - bBefore).toBeGreaterThan(toNano("0.98"));
    expect((await escrow.getMatchData(6n))!.settled).toBe(true);
  });
});
