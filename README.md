# TG Shooter — Web3 FPS for Telegram Mini Apps (TON)

A mobile-first first-person shooter for Telegram Mini Apps with a **wager-based**
PvP economy on TON. Players stake TON into a match pot; the winner takes the pot.

> **Status: playable, polished vertical slice.** **PLAY ONLINE** runs a real
> match on an authoritative Node server (the wager path — server owns movement,
> hit registration, and the result); **Practice** runs offline vs bots; **Create
> room** lets friends play by a 4-digit code. Renders at 60 FPS in the browser
> and inside Telegram. Wagering is behind a mock wallet + a sandbox-tested escrow
> contract; real TON needs the live-wiring step (Phase 3). See Roadmap.

**Feel & content:** soldier models with team skins + walk animation, first-person
AK-47 with an optic, procedural audio (shots/hits/reload/kills), bullet-impact FX
+ muzzle smoke, tracers, floating damage numbers, kill feed, nicknames (blue
teammates / red enemies), 5v5 team battle with death-spectator, weekly
leaderboard, in-game settings (crosshair style + color, sound), and a loading
intro.

## Run it

Two processes: the static client and the game server.

```bash
# 1) client
npm install
npm run dev            # http://localhost:5173

# 2) authoritative server (separate terminal)
cd server
npm install
npm run dev            # ws://localhost:8090
```

Then open the client, pick a mode + stake, and hit **PLAY ONLINE**. A duel fills
with a bot after a few seconds if no human opponent joins; elimination fills the
room to 5 with bots. **Practice** needs no server.

Production build: `npm run build && npm run preview`. Point the client at a
deployed server with `VITE_SERVER_URL=wss://your-host` at build time.

Tests:
- `cd server && npm test` — authoritative multiplayer match (2 clients → winner).
- `cd server && npm run test:escrow` — server settles the winner on the real contract (sandbox).
- `cd contracts && npm install && npm run build && npm test` — escrow contract suite.

## Controls

**Desktop:** click to lock the mouse · `WASD` move · mouse aim · left-click fire ·
`R` reload · `Space` jump.
**Mobile / Telegram:** left stick move · right half of the screen to look ·
on-screen fire / jump / reload buttons.

## Game modes

| Mode | Seats | Pot | Win condition |
|------|-------|-----|---------------|
| **1 vs 1 Duel** | 2 | `stake × 2` | First to 5 eliminations |
| **5 vs 5 Team Battle** | 10 | `stake × 10` | Wipe the enemy team (one life; spectate teammates on death) |

Stake per player is chosen in the lobby (0.5 / 1 / 2 / 5 TON). The pot is shown
in the lobby and on the in-match HUD banner.

## Architecture

Plain **TypeScript + Three.js + Vite** on the client, **Node + ws** on the
server, and a **shared deterministic core** both run — so what you see equals
what the server simulates. No heavy engine, boots in a second, tight memory
control (well under 500 MB), none of Unity WebGL's Telegram reload-loop issues.

```
contracts/             TON smart contracts (Tact)
  contracts/match_escrow.tact  deposit / oracle-settle / cancel-refund / rake
  tests/escrow.spec.ts         @ton/sandbox suite (money-safety invariants)

shared/                deterministic core — identical in browser and Node
  protocol.ts          wire messages + tick/snapshot constants
  arena.ts             box geometry (single source of truth) + collision + ray-vs-AABB
  sim.ts               movement, weapon, authoritative hitscan (ray-vs-capsule)

server/                authoritative game server (anti-cheat foundation)
  src/index.ts         WebSocket endpoint
  src/Matchmaker.ts    queue by (mode, stake) → rooms; bot-fill on timeout
  src/Room.ts          fixed-tick sim, lag-compensated hit reg, 20Hz snapshots, pot/win
  src/ServerBot.ts     bot brain — emits the same input a human would
  src/Leaderboard.ts   weekly (ISO-week) board — net TON won, wins, kills; JSON-persisted
  src/ton/EscrowService.ts  settles the winner on-chain as the oracle (owner)
  src/ton/escrowMessages.ts build Deposit/Settle/Cancel bodies from the contract ABI
  test/integration.ts  boots server, fights two clients, asserts a winner + payout
  test/escrow.ts       settles a match on the real contract in a sandbox

src/                   client
  main.ts              lobby · wallet · online/practice launch · result screen
  net/NetworkClient.ts WS transport: connect, join, stream input, receive snapshots
  game/
    Game.ts            renderer/scene; offline match loop + online server-driven loop
    Player.ts          FPS controller (Source-style); client prediction + reconcile
    RemoteAvatar.ts    other players, interpolated from server snapshots
    Weapon.ts          hitscan visuals (tracers, muzzle flash); offline hit logic
    Bot.ts             offline practice AI
    Arena.ts           renders the shared box list; delegates collision to shared
    Input.ts           unified keyboard+mouse (pointer lock) / twin-stick touch
    HUD.ts             health, ammo, score, pot, hitmarker (DOM, change-gated)
  platform/
    telegram.ts        Telegram Mini App SDK wrapper (haptics, user, expand)
    ton.ts             wallet + match-escrow interface (MOCK — the money seam)
```

**Anti-cheat boundary.** Online, the client only sends input and renders
snapshots; the server owns positions, hit registration (lag-compensated), and
the result. A client cannot fabricate a kill or a win.

**Money seam — `platform/ton.ts` + `server/src/Room.ts`.** The mock wallet/escrow
is client-side; the authoritative result the escrow will trust is produced by
`Room`. Phase 3 wires TonConnect + an audited escrow contract: each seat deposits
to the contract, the server submits a signed result, the contract pays the
winner. Funds never move on client say-so.

## Roadmap

The wager loop is the whole point, so the build order is dictated by **safety**:
you cannot let real TON touch a game the client can cheat.

1. **✅ Phase 1 — Core FPS (this slice).** Controller, shooting feel, arena,
   bots, HUD, both match modes, mock wallet/escrow. Playable offline.
2. **✅ Phase 2 — Authoritative multiplayer.** Node + WebSocket server owns game
   state, hit registration (lag-compensated), and results at 30Hz sim / 20Hz
   snapshots. Clients predict + render. Bot-fill so solo players never wait.
   This is the anti-cheat foundation — *required before real money*.
3. **◑ Phase 3 — TON on-chain (contract + settlement done, live wiring pending).**
   `contracts/` holds the Tact **match-escrow** contract (deposit / oracle-only
   settle / cancel-with-refunds / rake), proven by a 6-case sandbox suite. The
   server's `EscrowService` settles the winner on-chain, proven against the real
   compiled contract in the sandbox. **Remaining (needs your keys):** deploy the
   contract, set `ESCROW_ADDRESS`/`ORACLE_MNEMONIC` on the server + `VITE_ESCROW_ADDRESS`
   on the client, and swap the mock wallet for `@tonconnect/ui`
   (`public/tonconnect-manifest.json` is ready). Audit before mainnet.
4. **Phase 4 — Meta & economy (started).** ✅ Weekly leaderboard (ISO-week, ranked
   by net TON won, tie-broken by wins then kills; served at `GET /leaderboard`,
   shown in the lobby). Next: Jetton game token, NFT weapon/character skins,
   inventory, marketplace, matchmaking/rooms.
5. **Phase 5 — Content & polish.** More maps, weapons, sounds, VFX, progression.

## Live Telegram Mini App

- **Bot:** [@ShootTonbot](https://t.me/ShootTonbot) — open it and tap the **🎮 Play**
  menu button.
- **Host:** `https://kamasutra1337.github.io/TGShooter/` (GitHub Pages, gh-pages branch).
- **Redeploy** after changes: `bash scripts/deploy-pages.sh`.
- Practice (vs bots) works instantly inside Telegram. Online duels / 5v5 / rooms
  need a public **wss://** game server (deploy `server/` to a cloud host and set
  `VITE_SERVER_URL` before building) — not yet wired for the Mini App.

## Deploy as a Telegram Mini App (how it was set up)

1. `npm run build` → static files in `dist/`.
2. Host `dist/` on any HTTPS static host (Vercel, Netlify, Cloudflare Pages).
   `base: "./"` keeps asset paths relative so any subpath works.
3. In **@BotFather**: create a bot → **Bot Settings → Menu Button / Web App** →
   point it at your HTTPS URL. `index.html` already loads
   `telegram-web-app.js`, so the SDK is available in-app.
4. Updates are seamless: redeploy `dist/` — players get the new build on next
   open, no reinstall.
