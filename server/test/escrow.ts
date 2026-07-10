// Proves the SERVER's settlement path against the REAL compiled contract in a
// local TVM sandbox (no network).
//
// EscrowService is given a Sender that delivers its message as an internal
// message FROM the oracle address — exactly what the production oracle wallet
// (WalletContractV4.sender) does on-chain. So a green run means EscrowService
// builds the correct message and the contract settles correctly; only the
// transport (real wallet vs sandbox) differs.
import { Blockchain } from "@ton/sandbox";
import {
  toNano,
  beginCell,
  Address,
  type Cell,
  type Message,
  type Sender,
  type SenderArguments,
} from "@ton/core";
import { MatchEscrow } from "../src/ton/MatchEscrow.gen";
import { EscrowService } from "../src/ton/EscrowService";

// Build a full internal message with an explicit src so the sandbox delivers it
// as if the oracle wallet had sent it (sender() == owner inside the contract).
function internalFrom(
  src: Address,
  dest: Address,
  value: bigint,
  body: Cell | null | undefined,
  bounce: boolean,
): Message {
  return {
    info: {
      type: "internal",
      ihrDisabled: true,
      bounce,
      bounced: false,
      src,
      dest,
      value: { coins: value },
      ihrFee: 0n,
      forwardFee: 0n,
      createdLt: 0n,
      createdAt: 0,
    },
    body: body ?? beginCell().endCell(),
  };
}

function makeSender(bc: Blockchain, from: Address): Sender {
  return {
    address: from,
    async send(args: SenderArguments) {
      await bc.sendMessage(
        internalFrom(from, args.to as Address, args.value, args.body, args.bounce ?? true),
      );
    },
  };
}

async function main() {
  const bc = await Blockchain.create();
  const oracle = await bc.treasury("oracle");
  const alice = await bc.treasury("alice");
  const bob = await bc.treasury("bob");

  const escrow = bc.openContract(await MatchEscrow.fromInit(oracle.address, 500n));
  await escrow.send(
    oracle.getSender(),
    { value: toNano("0.5") },
    { $$type: "Deploy", queryId: 0n },
  );

  const MID = 42n;
  for (const p of [alice, bob]) {
    await escrow.send(
      p.getSender(),
      { value: toNano("1.1") },
      { $$type: "Deposit", matchId: MID, stake: toNano("1"), seats: 2n },
    );
  }
  const afterDeposits = await escrow.getMatchData(MID);
  console.log(
    `[escrow-test] after deposits: pot=${Number(afterDeposits!.pot) / 1e9} count=${afterDeposits!.count}`,
  );

  // Oracle wallet, modelled: EscrowService's message arrives as an internal
  // message from the oracle address (owner), which is what the real wallet does.
  const svc = new EscrowService(makeSender(bc, oracle.address), escrow.address);
  if (!svc.enabled) throw new Error("service should be enabled");

  const before = await alice.getBalance();
  await svc.settle(MID, alice.address); // winner = alice
  const gained = (await alice.getBalance()) - before;
  const settled = (await escrow.getMatchData(MID))!.settled;

  const ok = settled && gained > toNano("1.88") && gained <= toNano("1.9");
  console.log(
    `[escrow-test] settled=${settled} winnerGained=${Number(gained) / 1e9} TON (≈1.9)`,
  );
  if (!ok) {
    console.error("❌ FAIL: EscrowService did not pay the winner correctly");
    process.exit(1);
  }

  // And a non-oracle sender must NOT be able to settle.
  const MID3 = 44n;
  for (const p of [alice, bob]) {
    await escrow.send(
      p.getSender(),
      { value: toNano("1.1") },
      { $$type: "Deposit", matchId: MID3, stake: toNano("1"), seats: 2n },
    );
  }
  // impostor = a non-owner address trying to settle
  await new EscrowService(makeSender(bc, bob.address), escrow.address).settle(
    MID3,
    bob.address,
  );
  const impostorSettled = (await escrow.getMatchData(MID3))!.settled;
  if (impostorSettled) {
    console.error("❌ FAIL: a non-oracle sender settled a match");
    process.exit(1);
  }

  console.log(
    "✅ PASS — EscrowService.settle drives the real contract (winner paid ~1.9 TON); " +
      "non-oracle settle rejected",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
