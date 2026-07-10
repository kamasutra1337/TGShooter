# TG Shooter — Web3 FPS for Telegram Mini Apps (TON)

A mobile-first first-person shooter for Telegram Mini Apps with a **wager-based**
PvP economy on TON. Players stake TON into a match pot; the winner takes the pot.

> **Status: playable vertical slice (offline vs bots).** The core loop — move,
> aim, shoot, win a match, see the pot — is real and runs at 60 FPS in the
> browser and inside Telegram. Networked multiplayer and the on-chain escrow are
> the next phases (see Roadmap). Wagering is behind a mock wallet today; no real
> TON moves yet.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
# or a production build:
npm run build && npm run preview
```

Open in a desktop browser to play with mouse + keyboard, or on a phone for the
touch controls. Inside Telegram it runs as a Mini App (see Deploy).

## Controls

**Desktop:** click to lock the mouse · `WASD` move · mouse aim · left-click fire ·
`R` reload · `Space` jump.
**Mobile / Telegram:** left stick move · right half of the screen to look ·
on-screen fire / jump / reload buttons.

## Game modes

| Mode | Seats | Pot | Win condition |
|------|-------|-----|---------------|
| **1 vs 1 Duel** | 2 | `stake × 2` | First to 5 eliminations |
| **Battle (elimination)** | 5 | `stake × 5` | Last one standing (one life) |

Stake per player is chosen in the lobby (0.5 / 1 / 2 / 5 TON). The pot is shown
in the lobby and on the in-match HUD banner.

## Architecture

Plain **TypeScript + Three.js + Vite** — no heavy engine, boots in a second,
tight control over memory (well under the 500 MB target), and none of Unity
WebGL's reload-loop issues inside the Telegram in-app browser.

```
src/
  main.ts              bootstrap · lobby wiring · wallet · result screen
  game/
    Game.ts            renderer, scene, lights, match lifecycle, main loop
    Player.ts          FPS controller (Source-style accel, gravity, jump)
    Weapon.ts          hitscan rifle, recoil, ammo/reload, tracers, muzzle flash
    Bot.ts             enemy AI (wander → chase → shoot), head/body hitboxes
    Arena.ts           map geometry, AABB colliders, spawns, collision resolution
    Input.ts           unified keyboard+mouse (pointer lock) / twin-stick touch
    HUD.ts             health, ammo, score, pot, hitmarker (DOM, change-gated)
  platform/
    telegram.ts        Telegram Mini App SDK wrapper (haptics, user, expand)
    ton.ts             wallet + match-escrow interface (MOCK — the money seam)
```

**Key boundary — `platform/ton.ts`.** This is the single seam where real money
will flow. It is a mock today so the game is fully playable offline, but its
shape matches the real implementation, so wiring in TonConnect + an escrow smart
contract later touches *only that file*.

## Roadmap

The wager loop is the whole point, so the build order is dictated by **safety**:
you cannot let real TON touch a game the client can cheat.

1. **✅ Phase 1 — Core FPS (this slice).** Controller, shooting feel, arena,
   bots, HUD, both match modes, mock wallet/escrow. Playable offline.
2. **Phase 2 — Authoritative multiplayer.** Node + WebSocket server owns game
   state, hit registration, and lag compensation. Clients become renderers +
   input. This is the anti-cheat foundation — *required before real money*.
3. **Phase 3 — TON on-chain.** Real TonConnect wallet; a match-escrow contract
   (FunC/Tact): each seat deposits `stake` for a `matchId`; the authoritative
   server submits a signed result; the contract releases the pot to the winner
   minus rake. Audited before mainnet.
4. **Phase 4 — Meta & economy.** Jetton game token, NFT weapon/character skins,
   inventory, marketplace, leaderboards, matchmaking/rooms.
5. **Phase 5 — Content & polish.** More maps, weapons, sounds, VFX, progression.

## Deploy as a Telegram Mini App

1. `npm run build` → static files in `dist/`.
2. Host `dist/` on any HTTPS static host (Vercel, Netlify, Cloudflare Pages).
   `base: "./"` keeps asset paths relative so any subpath works.
3. In **@BotFather**: create a bot → **Bot Settings → Menu Button / Web App** →
   point it at your HTTPS URL. `index.html` already loads
   `telegram-web-app.js`, so the SDK is available in-app.
4. Updates are seamless: redeploy `dist/` — players get the new build on next
   open, no reinstall.
