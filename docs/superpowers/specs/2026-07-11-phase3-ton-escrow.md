# Phase 3 — TON On-Chain Escrow

**Date:** 2026-07-11
**Status:** Contract + server settlement implemented and sandbox-verified. Live
wiring (deploy + real wallet) is the remaining step and needs the user's keys.

## Goal

Make the wager real: players stake TON into a contract, and the pot is paid to
the winner the authoritative server reports — with funds that can never move on
a client's say-so.

## What was built

### Escrow contract — `contracts/contracts/match_escrow.tact`

One deployed contract serves many matches, keyed by `matchId`.

- `Deposit{matchId, stake, seats}` — first deposit creates the match (records
  organizer, stake, seats); each deposit requires `value ≥ stake`, that the room
  isn't full, and that the match isn't settled; records the player (for refunds)
  and grows the pot.
- `Settle{matchId, winner}` — **owner (oracle) only**; one-shot; pays the winner
  `pot * (1 - rakeBps/10000)`.
- `CancelMatch{matchId}` — **owner only**; one-shot; refunds every recorded
  player their stake (bounded loop over seats).
- `Withdraw{amount}` — owner withdraws accumulated rake.
- Getters: `matchData(matchId)`, `rake()`, `owner()`.

`owner` = the authoritative server's oracle wallet. `rakeBps` set at init
(capped at 20%).

### Server settlement — `server/src/ton/`

- `escrowMessages.ts` builds `Settle`/`Cancel`/`Deposit` bodies using the codecs
  generated from the contract, so the server's messages always match the ABI.
- `EscrowService` (transport-agnostic, takes any `@ton/core` `Sender`) settles /
  cancels as the oracle. Disabled (logs intent) until `ESCROW_ADDRESS` +
  `TON_ENDPOINT` + `ORACLE_MNEMONIC` are set; `liveSender.ts` builds the real
  oracle `Sender` from a `WalletContractV4` (via dynamically-imported `@ton/ton`
  so it isn't a hard dep of the offline build).
- `Room` carries an on-chain `matchId`; on finish it fires `EscrowService.settle`
  in the background (clients already got the authoritative result). Players'
  wallet addresses arrive in the `join` message and are validated server-side.

The generated wrapper is copied into the server (`npm run gen:copy`) so it uses
the server's single `@ton/core` — avoiding cross-package `Address` mismatches.

## Verification

- **Contract suite** (`contracts`, `@ton/sandbox` + jest, 6 cases): pot
  accounting; settle pays winner pot×0.95; non-oracle settle rejected; double
  settle rejected; underpaid deposit rejected; cancel refunds all players.
- **Server settlement** (`server npm run test:escrow`, sandbox): two players
  deposit; `EscrowService` (given an oracle-address sender) settles; winner
  gains ~1.9 TON and the match is marked settled; a non-oracle sender is
  rejected. This exercises the exact message-building + contract path used in
  production — only the transport differs.
- Client builds; multiplayer integration test still green.

## Design notes / honest boundaries

- **Deposit orchestration** (lobby reserves a `matchId`, both clients deposit to
  the contract before the room starts) is specified but the client still uses the
  mock wallet — swapping in `@tonconnect/ui` + a real `sendTransaction(Deposit)`
  is the remaining client work. Manifest scaffold: `public/tonconnect-manifest.json`.
- **Live network** (testnet/mainnet) can't be exercised offline; it needs a
  deployed contract and the oracle mnemonic. The sandbox proves everything up to
  the transport.
- The oracle key is a trust anchor: it decides winners. That's acceptable because
  the winner is already computed by the authoritative server (Phase 2); the key
  just relays that verdict on-chain. A future hardening is multi-sig / fraud
  proofs.
- **Audit before mainnet.** Non-negotiable before real funds.

## Next

- Client: `@tonconnect/ui` connect + real deposit transaction; lobby matchId
  reservation so deposits and the server room share an id.
- Deploy + testnet run with the user's keys.
- Then Phase 4: Jetton token, NFT skins, marketplace, matchmaking/leaderboards.
