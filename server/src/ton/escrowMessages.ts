import { beginCell, Cell, Address } from "@ton/core";
// Wrapper is copied into the server (npm run gen:copy) so its `@ton/core`
// resolves to the server's copy — a single Address implementation, no
// cross-package instanceof mismatches.
import { storeSettle, storeCancelMatch, storeDeposit } from "./MatchEscrow.gen";

// Builds the exact message bodies the deployed MatchEscrow contract expects,
// using the codecs generated from the contract itself — so what the server
// sends is guaranteed to match the on-chain ABI. These are the same encodings
// the sandbox test drives, so a green test proves these are correct.

export function buildSettleBody(matchId: bigint, winner: Address): Cell {
  return beginCell()
    .store(storeSettle({ $$type: "Settle", matchId, winner }))
    .endCell();
}

export function buildCancelBody(matchId: bigint): Cell {
  return beginCell()
    .store(storeCancelMatch({ $$type: "CancelMatch", matchId }))
    .endCell();
}

export function buildDepositBody(
  matchId: bigint,
  stake: bigint,
  seats: bigint,
): Cell {
  return beginCell()
    .store(storeDeposit({ $$type: "Deposit", matchId, stake, seats }))
    .endCell();
}
