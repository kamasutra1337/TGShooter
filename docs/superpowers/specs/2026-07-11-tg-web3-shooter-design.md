# TG Web3 Shooter — Design & Spec

**Date:** 2026-07-11
**Status:** Phase 1 (Core FPS vertical slice) implemented and verified.

## 1. Product

A mobile-first FPS inside Telegram Mini Apps with a **wager-based PvP economy on
TON**. Two modes:

- **1v1 Duel** — two players each stake TON, pot = `stake × 2`, first to 5
  eliminations takes the pot.
- **Elimination Battle** — a room of 5 players each stakes 1 TON (configurable),
  pot = `stake × 5`, last player standing takes the pot.

## 2. Honest scope

"AAA / Valve-level" graphics are not achievable for a solo build inside a
Telegram WebGL browser under a 500 MB memory budget. The realistic, still-strong
target is **the best honest wager FPS in Telegram**: responsive gunplay, an
authoritative server, a couple of maps, and a *real* TON economy. The master
prompt's five subsystems are decomposed into sequential phases; each gets its own
spec → plan → implementation cycle.

## 3. Tech stack & rationale

**TypeScript + Three.js + Vite.**

- Boots in ~1s; no Unity-WebGL reload-loop problems in Telegram's in-app browser.
- Full control over memory and the render loop → realistic to hold 60 FPS well
  under 500 MB.
- Three.js gives us PBR-ish materials, shadows, and raycasting without an engine
  runtime download.
- Rejected: Unity WebGL (heavy, reload-loop issues), PlayCanvas (fine, but more
  opinionated than we need for a slice).

## 4. Architecture (Phase 1)

Client-only, structured so later phases slot in without rewrites.

- `Game` — owns renderer/scene/lights, match lifecycle, the single fixed-ish
  `requestAnimationFrame` loop, and orchestrates all subsystems.
- `Player` — first-person controller. Source-inspired feel: quick ground accel,
  friction, air control, gravity + jump. The camera is the eye.
- `Weapon` — hitscan rifle: recoil-driven spread, ammo/reserve/reload, tracers,
  a decaying muzzle-flash light. Raycasts bots (with head/body parts) and world.
- `Bot` — offline opponent AI: wander → chase-on-sight → shoot on a timer with
  distance-scaled accuracy. Same `root/alive/damage/update` interface that
  networked opponents will later be driven through.
- `Arena` — static map: floor, perimeter walls, symmetric cover crates, raised
  platforms, spawns. Doubles as physics: AABB colliders, circle-vs-AABB
  resolution, and ground-height lookup for standing on crates.
- `Input` — one normalized `InputState` from either desktop (pointer-lock mouse +
  WASD) or mobile (twin-stick touch). The game never branches on device.
- `HUD` — DOM overlay (health, ammo, score, pot, hitmarker), change-gated so we
  only touch the DOM when a value changes.
- `platform/telegram.ts` — Mini App SDK wrapper (ready/expand, haptics, user),
  degrades gracefully outside Telegram.
- `platform/ton.ts` — **the money seam.** Wallet + match-escrow interface,
  mocked today. Real TonConnect + escrow contract will replace only this file.

## 5. Match & economy flow

1. Lobby: pick mode + stake → pot shown.
2. If a wallet is connected, `depositStake` moves the stake into (mock) escrow;
   without a wallet, a free demo match runs so the game is always playable.
3. Match runs; HUD shows live pot.
4. On win, `claimPayout` returns `pot × (1 − rake)`; result screen shows payout.

**Anti-cheat boundary (non-negotiable for real money):** funds may never move on
client say-so. The authoritative server (Phase 2) reports a signed result to the
escrow contract (Phase 3), which releases the pot. Real TON is only enabled after
Phases 2–3 exist and the contract is audited.

## 6. Performance choices

- Pixel ratio capped at 2; antialias only when DPR < 2.
- One shadow-casting directional light (1024²) + hemisphere + ambient; emissive
  strips fake neon without extra lights.
- Fog hides the far cull edge and cuts overdraw.
- Static geometry → bakeable later; tracers/flash pooled and disposed.

## 7. Verification (done)

`tsc --noEmit` + `vite build` pass. Served build returns 200 with assets. Driven
headless via Chrome DevTools Protocol: match starts, the 3D arena renders with
lighting/shadows/depth, the opponent bot is visible at the crosshair, HUD is live
(pot "1v1 · POT 2 TON", ammo 30/90), and bot fire damages the player — with zero
runtime errors. A WebGL-unavailable fallback message was added after testing
surfaced a silent-death failure mode.

## 8. Roadmap (next specs)

- **Phase 2:** authoritative Node + WebSocket server; client → renderer+input;
  hit registration + lag compensation.
- **Phase 3:** TonConnect wallet; match-escrow contract (FunC/Tact); signed
  server results; audit.
- **Phase 4:** Jetton token, NFT skins, inventory, marketplace, matchmaking.
- **Phase 5:** more maps/weapons, sound, VFX, progression.
