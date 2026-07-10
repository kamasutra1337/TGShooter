# Phase 2 — Authoritative Multiplayer

**Date:** 2026-07-11
**Status:** Implemented and verified.

## Goal

Make the server the source of truth for online matches so real TON wagers become
safe to add in Phase 3. A client must be unable to fabricate a kill, a position,
or a win. Keep the game fully playable (bot-fill, offline practice) throughout.

## Design

### Shared deterministic core (`shared/`)

One implementation of geometry + physics + hitscan, imported by both client and
server, so prediction and authority agree.

- `protocol.ts` — wire messages (join/input → welcome/start/snap/hit/shot/end)
  and constants: `TICK_HZ=30`, `SNAPSHOT_HZ=20`, seats, duel target.
- `arena.ts` — the box list (single source of truth the client renders and the
  server collides against), circle-vs-AABB resolution, ground height, ray-vs-AABB.
- `sim.ts` — player movement step, weapon (ammo/cooldown/reload/recoil), and
  authoritative hitscan (ray vs head+body spheres, blocked by walls).

### Server (`server/`)

- `index.ts` — `ws` endpoint; assigns ids, routes join/input.
- `Matchmaker.ts` — groups by `(mode, stake)`; starts a room when seats fill with
  humans, or after a 4s timeout fills remaining seats with bots.
- `Room.ts` — the authority. Fixed 30Hz tick: gather inputs (bots think), step
  movement + weapon, resolve fire with **lag compensation** (rewind targets to
  `now − 100ms` for human shooters via a per-player feet-position history), apply
  damage, run duel/elimination win logic, compute the pot payout (`pot × 0.95`).
  Broadcasts 20Hz snapshots + hit/shot/end events.
- `ServerBot.ts` — bot brain that emits the *same* `SimInput` a human client
  sends, so bots run through the identical authoritative pipeline (no shortcuts).

### Client (`src/`)

- `net/NetworkClient.ts` — connect (resolves on welcome), join, stream input,
  dispatch server messages to handlers.
- `Game.ts` — an online loop alongside the offline one. Local player is
  **predicted** with the same `Player` physics for responsiveness and
  **reconciled** to the server (snap when divergence > 2 units or on respawn).
  `RemoteAvatar` renders other players, interpolated between snapshots. HUD
  (health/ammo/score) is driven by authoritative snapshot data; tracers/hits come
  from server `shot`/`hit` events.
- `main.ts` — **PLAY ONLINE** (server match, the wager path; mock escrow deposit
  up front, refund on connect failure) and **Practice** (offline vs bots).

### Simplifications (documented, for later hardening)

- Lag compensation uses a fixed 100ms window; production should measure per-client
  RTT.
- Aim is client-authoritative (position + hits are server-authoritative), so
  aimbots are out of scope here; movement/teleport/hit-spoof cheats are blocked.
- Reconciliation is snap-on-divergence, not full input replay — adequate because
  client and server share the exact movement code.

## Verification

- `shared` + `server` + client all typecheck; client builds.
- **Server integration test** (`server/npm test`): boots the real server, connects
  two WS clients that aim and fire, asserts a single agreed winner, payout = 1.9
  TON (pot 2 × 0.95), snapshots flowing, and ≥5 authoritative hits. Passes.
- **Browser online test** (headless Chrome via CDP): clicked PLAY ONLINE, a duel
  filled with a bot, the match started, the client rendered the remote avatar from
  snapshots, HUD ammo 30/90 came from the server, menu hidden, zero errors.
- **Offline practice** re-verified after the shared-arena refactor: renders and
  runs.

## Next — Phase 3 (TON on-chain)

Replace the mock in `platform/ton.ts` with TonConnect, and add a match-escrow
contract (FunC/Tact): each seat deposits `stake` for a `matchId`; `Room` submits a
signed result; the contract releases `pot × (1 − rake)` to the winner. Audit
before mainnet. Nothing in the game loop needs to change — the seam is already in
place.
