import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Arena } from "./Arena";
import { Player } from "./Player";
import { Weapon } from "./Weapon";
import { Bot } from "./Bot";
import { HUD } from "./HUD";
import { Input } from "./Input";
import { RemoteAvatar } from "./RemoteAvatar";
import { Nametags, type Tag } from "./Nametags";
import { Effects } from "./Effects";
import { Grenades } from "./Grenades";
import { Minimap, type Blip } from "./Minimap";
import { Sound } from "./Audio";
import { Telegram } from "../platform/telegram";
// Local match bookkeeping (practice/offline). Online payouts come from the
// server's MatchEnd + the escrow contract on-chain, not from this.
interface StakeInfo {
  matchId: string;
  stake: number;
  players: number;
  pot: number;
}
import { NetworkClient } from "../net/NetworkClient";
import type { MatchStartMsg, HitEventMsg, ShotEventMsg, SnapshotMsg } from "../../shared/protocol";
import { spawnFor } from "../../shared/arena";
import { SEATS } from "../../shared/protocol";
import { EYE } from "../../shared/sim";
import { WEAPONS, DEFAULT_WEAPON, type WeaponId } from "../../shared/weapons";

export type Mode = "duel" | "elimination";

interface OnlineState {
  mode: Mode;
  pot: number;
  stake: number;
  youId: string;
  youTeam: number;
  myName: string;
  running: boolean;
  ammo: number;
  fireCd: number;
  avatars: Map<string, RemoteAvatar>;
  names: Map<string, string>;
  teams: Map<string, number>;
  weapons: Map<string, WeaponId>;
  spectateId: string | null; // teammate being followed while dead
  roster: Map<string, { x: number; z: number; team: number; alive: boolean; kills: number }>;
  startT: number; // performance.now() at match start (for the timer)
}

export interface MatchConfig {
  mode: Mode;
  stake: number;
  weapon?: WeaponId;
}

interface MatchState {
  mode: Mode;
  seats: number;
  pot: number;
  stake: StakeInfo;
  targetFrags: number; // duel: race to this
  playerFrags: number;
  enemyFrags: number; // duel
  running: boolean;
}

const DUEL_TARGET = 5;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private arena = new Arena();
  private player: Player;
  private weapon: Weapon;
  private hud = new HUD();
  private nametags = new Nametags();
  private effects: Effects;
  private grenades: Grenades;
  private minimap: Minimap;
  private baseFov = 78;
  private dmgNumbers = true;
  private blood = true;
  private mstats = { shots: 0, hits: 0, damage: 0, kills: 0, deaths: 0 };

  getMatchStats(): { shots: number; hits: number; damage: number; kills: number; deaths: number; accuracy: number } {
    const s = this.mstats;
    return { ...s, accuracy: s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0 };
  }
  private resetStats(): void {
    this.mstats = { shots: 0, hits: 0, damage: 0, kills: 0, deaths: 0 };
  }

  // Top-scoring player this match (online only). Returns { name, kills, you }.
  getMvp(): { name: string; kills: number; you: boolean } | null {
    const o = this.online;
    if (!o || o.roster.size === 0) return null;
    let best: { id: string; kills: number } | null = null;
    for (const [id, r] of o.roster) if (!best || r.kills > best.kills) best = { id, kills: r.kills };
    if (!best) return null;
    return { name: o.names.get(best.id) ?? "Player", kills: best.kills, you: best.id === o.youId };
  }

  setFov(deg: number): void {
    this.baseFov = deg;
    if (!this.input.state.ads) {
      this.player.camera.fov = deg;
      this.player.camera.updateProjectionMatrix();
    }
  }
  setDmgNumbers(on: boolean): void {
    this.dmgNumbers = on;
  }
  setBlood(on: boolean): void {
    this.blood = on;
  }
  setSensitivity(mult: number): void {
    this.input.setSensitivity(mult);
  }
  private input: Input;
  private bots: Bot[] = [];
  private clock = new THREE.Clock();
  private match: MatchState | null = null;
  private respawnQueue: { bot: Bot; t: number }[] = [];
  private onEnd: (win: boolean, payout: number) => void = () => {};
  private online: OnlineState | null = null;
  private net: NetworkClient | null = null;
  private lastShotImpact = new THREE.Vector3();
  private stepTimer = 0;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private effectsOn = true;

  constructor(canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // MSAA handled by the composer's render target
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic color pipeline — the biggest single lift toward a modern look.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0x141b2e, 34, 92);

    this.player = new Player(window.innerWidth / window.innerHeight);
    this.weapon = new Weapon(this.scene);
    this.effects = new Effects(this.scene);
    this.grenades = new Grenades(this.scene, this.effects);
    this.minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
    this.input = new Input(canvas);

    // Camera must be in the scene graph so its first-person viewmodel renders.
    this.scene.add(this.player.camera);
    this.weapon.attachViewmodel(this.player.camera);

    this.setupLights();
    this.arena.build(this.scene);
    this.input.attach();
    this.setupComposer();

    window.addEventListener("resize", () => this.onResize());
  }

  private setupComposer(): void {
    // Post-processing is optional: if the GPU can't allocate the HDR/MSAA target
    // (e.g. old device, software renderer), fall back to plain rendering rather
    // than failing to start the game.
    try {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = this.renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: dpr > 1.5 ? 2 : 4,
      });
      const composer = new EffectComposer(this.renderer, rt);
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.player.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 0.82);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (e) {
      console.warn("[gfx] post-processing unavailable, using plain render:", e);
      this.composer = null;
      this.effectsOn = false;
    }
  }

  get usingTouch(): boolean {
    return this.input.usingTouch;
  }

  // Graphics quality toggle (Settings). Lite = plain render (no post-processing).
  setGraphics(high: boolean): void {
    this.effectsOn = high;
  }

  // In-match chat (online only).
  sendChat(text: string): void {
    if (this.online?.running) this.net?.sendChat(text);
  }
  isOnline(): boolean {
    return !!this.online?.running;
  }
  clearMovement(): void {
    this.input.clearKeys();
  }

  // Debug hook (used only when the page is opened with ?debug) to exercise firing
  // in headless verification, since pointer-lock isn't available there.
  debugSetFiring(v: boolean): void {
    this.input.state.firing = v;
  }

  debugFaceBotClose(): boolean {
    const bot = this.bots.find((b) => b.alive);
    if (!bot) return false;
    this.player.teleport(new THREE.Vector3(bot.position.x + 1.4, 1.5, bot.position.z + 3.0));
    this.debugAimAtNearestBot();
    return true;
  }

  debugAimAtNearestBot(): boolean {
    const bot = this.bots.find((b) => b.alive);
    if (!bot) return false;
    const dx = bot.position.x - this.player.position.x;
    const dz = bot.position.z - this.player.position.z;
    const dy = bot.position.y + 1.4 - this.player.position.y; // torso
    const len = Math.hypot(dx, dy, dz) || 1;
    this.player.yaw = Math.atan2(-dx, -dz);
    this.player.pitch = -Math.asin(Math.max(-1, Math.min(1, dy / len)));
    return true;
  }

  private hemiLight!: THREE.HemisphereLight;
  private ambientLight!: THREE.AmbientLight;
  private sunLight!: THREE.DirectionalLight;

  // Apply a time-of-day theme (sky, fog, light tints). Called each match.
  applyTheme(t: ArenaTheme): void {
    this.scene.background = makeSkyTexture(t.sky);
    (this.scene.fog as THREE.Fog).color.setHex(t.fog);
    this.hemiLight.color.setHex(t.hemiSky);
    this.hemiLight.groundColor.setHex(t.hemiGround);
    this.hemiLight.intensity = t.hemiInt;
    this.ambientLight.color.setHex(t.ambient);
    this.ambientLight.intensity = t.ambientInt;
    this.sunLight.color.setHex(t.sun);
    this.sunLight.intensity = t.sunInt;
  }

  private setupLights(): void {
    // Ambient sky/ground bounce
    this.hemiLight = new THREE.HemisphereLight(0xaec6ff, 0x2b3040, 1.15);
    this.ambientLight = new THREE.AmbientLight(0x3a4356, 0.3);
    this.scene.add(this.hemiLight);
    this.scene.add(this.ambientLight);

    // Key light (sun) — warm, casts soft shadows
    const sun = new THREE.DirectionalLight(0xfff2df, 2.5);
    this.sunLight = sun;
    sun.position.set(24, 42, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 130;
    const d = 34;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0003;
    sun.shadow.radius = 3; // softer edges
    this.scene.add(sun);

    // Cool fill from the opposite side (no shadow) — lifts the dark side
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.55);
    fill.position.set(-18, 16, -20);
    this.scene.add(fill);

    // Rim/back light — separates silhouettes from the background
    const rim = new THREE.DirectionalLight(0xbcd2ff, 0.7);
    rim.position.set(-8, 20, 26);
    this.scene.add(rim);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  // --- match lifecycle ---
  startMatch(cfg: MatchConfig, onEnd: (win: boolean, payout: number) => void): void {
    this.onEnd = onEnd;
    const seats = SEATS[cfg.mode];
    const pot = +(cfg.stake * seats).toFixed(3);
    const stake: StakeInfo = {
      matchId: "local-" + Math.floor(performance.now()),
      stake: cfg.stake,
      players: seats,
      pot,
    };
    this.match = {
      mode: cfg.mode,
      seats,
      pot,
      stake,
      targetFrags: DUEL_TARGET,
      playerFrags: 0,
      enemyFrags: 0,
      running: true,
    };

    // Clear old bots
    for (const b of this.bots) this.scene.remove(b.root);
    this.bots = [];
    this.respawnQueue = [];

    const enemyCount = cfg.mode === "duel" ? 1 : 5; // practice: 5 enemy bots
    const names = ["Raider", "Viper", "Ghost", "Bravo", "Kilo"];
    // Duel: opponent faces off in front of the player. Elimination: spread out.
    const duelSpawn = new THREE.Vector3(0, 0, -12);
    for (let i = 0; i < enemyCount; i++) {
      const bot = new Bot();
      this.scene.add(bot.root);
      const spawn =
        cfg.mode === "duel"
          ? duelSpawn
          : this.arena.spawns[(i + 1) % this.arena.spawns.length];
      bot.spawn(spawn);
      bot.home.copy(spawn); // fixed respawn point (no spawn drift/spam)
      bot.name = names[i % names.length];
      this.bots.push(bot);
    }

    // Reset player + configure the chosen weapon (sets mag/reserve from spec)
    this.player.reset(new THREE.Vector3(0, 1.6, 20), 0);
    this.weapon.configure(cfg.weapon ?? DEFAULT_WEAPON);
    this.resetStats();
    this.effects.clearDecals();
    this.applyTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);

    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    this.hud.setWeapon(WEAPONS[this.weapon.weaponId].name);
    this.hud.setScore(0);
    this.hud.setPot(pot, cfg.mode === "duel" ? "1v1" : "5v5");
    this.hud.roundIntro();

    this.clock.getDelta(); // flush
  }

  stopMatch(): void {
    if (this.match) this.match.running = false;
    if (this.online) this.cleanupOnline();
    this.hud.hide();
  }

  // --- main loop ---
  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  // Smoothly zoom the FOV when aiming down sights (sniper zooms hardest).
  private updateAdsZoom(dt: number): void {
    const ads = this.input.state.ads && this.player.alive;
    const target = ads ? (this.weapon.weaponId === "sniper" ? 30 : 58) : this.baseFov;
    const cam = this.player.camera;
    const next = cam.fov + (target - cam.fov) * Math.min(1, dt * 12);
    if (Math.abs(next - cam.fov) > 0.02) {
      cam.fov = next;
      cam.updateProjectionMatrix();
    }
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.online?.running) this.onlineFrame(dt);
    else this.offlineFrame(dt);

    this.updateAdsZoom(dt);
    this.hud.setReload(this.weapon.reloadProgress());
    this.effects.update(dt, this.player.camera);
    this.hud.update(dt);
    this.input.endFrame();
    if (this.effectsOn && this.composer) {
      try {
        this.composer.render();
      } catch {
        // Post-processing unsupported on this GPU → fall back permanently.
        this.effectsOn = false;
        this.renderer.render(this.scene, this.player.camera);
      }
    } else {
      this.renderer.render(this.scene, this.player.camera);
    }
  }

  private offlineFrame(dt: number): void {
    const m = this.match;

    if (m && m.running && this.player.alive) {
      this.player.update(dt, this.input.state, this.arena);
      this.footstep(dt);

      // fire
      if (this.input.state.firing) {
        const res = this.weapon.tryFire(this.player, this.bots, this.arena.solids);
        if (res) {
          this.mstats.shots++;
          Sound.shot();
          this.effects.muzzleSmoke(this.weapon.muzzleWorld());
          Telegram.haptic("light");
          if (res.point) {
            this.effects.impact(res.point, res.hitBot != null && this.blood);
            if (!res.hitBot) this.effects.decal(res.point); // scorch mark on the surface
          }
          if (res.hitBot) {
            this.mstats.hits++;
            this.mstats.damage += res.damage;
            const dmg = res.damage; // aggregate (pellets + distance falloff)
            const died = res.hitBot.damage(dmg);
            this.hud.hitMarker(res.headshot);
            Sound.hitEnemy(res.headshot);
            if (res.point) this.showDamage(res.point, dmg, res.headshot);
            if (died) {
              this.mstats.kills++;
              Sound.kill();
              this.onBotDied(res.hitBot);
            }
          }
        }
      }
      if (
        this.input.state.reloadQueued &&
        !this.weapon.isReloading &&
        this.weapon.ammo < this.weapon.magSize &&
        this.weapon.reserve > 0
      )
        Sound.reload();
      if (this.input.state.reloadQueued) this.weapon.reload();

      this.weapon.update(dt, this.arena.solids);

      // bots
      let incoming = 0;
      for (const bot of this.bots) incoming += bot.update(dt, this.player, this.arena);
      if (incoming > 0) {
        this.player.damage(incoming);
        this.hud.damageFlashPulse();
        Telegram.haptic("heavy");
        Sound.hurt();
        if (!this.player.alive) this.onPlayerDied();
      }

      // respawns (duel only) — always back to the bot's fixed home spawn
      for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
        this.respawnQueue[i].t -= dt;
        if (this.respawnQueue[i].t <= 0) {
          const bot = this.respawnQueue[i].bot;
          bot.spawn(bot.home);
          this.respawnQueue.splice(i, 1);
        }
      }

      this.hud.setHealth(this.player.health);
      this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);

      // nicknames above living bots
      const tags: Tag[] = [];
      for (let i = 0; i < this.bots.length; i++) {
        const b = this.bots[i];
        if (!b.alive) continue;
        tags.push({
          id: "bot" + i,
          name: b.name,
          head: new THREE.Vector3(b.position.x, b.position.y + 2.05, b.position.z),
          friendly: false, // offline bots are all enemies
        });
      }
      this.nametags.update(this.player.camera, tags);
    } else {
      this.weapon.update(dt, this.arena.solids);
      this.nametags.hideAll();
    }
  }

  private onBotDied(bot: Bot): void {
    const m = this.match;
    if (!m) return;
    m.playerFrags++;
    this.hud.killFeed("You", bot.name, true);
    Telegram.notify("success");

    if (m.mode === "duel") {
      this.hud.setScore(m.playerFrags);
      if (m.playerFrags >= m.targetFrags) {
        void this.finish(true);
        return;
      }
      this.respawnQueue.push({ bot, t: 1.6 }); // opponent respawns
    } else {
      // elimination: bot is out for good
      const remaining = this.bots.filter((b) => b.alive).length;
      this.hud.setScore(this.bots.length - remaining); // eliminations
      if (remaining === 0) {
        void this.finish(true);
        return;
      }
    }
  }

  private onPlayerDied(): void {
    const m = this.match;
    if (!m) return;
    this.mstats.deaths++;
    Sound.die();
    this.hud.killFeed("Enemy", "You", true);
    Telegram.notify("error");
    if (m.mode === "duel") {
      m.enemyFrags++;
      // In a wager duel, first to target wins. Player death = respawn but
      // opponent banks a frag; opponent reaching target loses you the pot.
      if (m.enemyFrags >= m.targetFrags) {
        void this.finish(false);
        return;
      }
      // respawn player after delay
      setTimeout(() => {
        if (m.running)
          this.player.reset(new THREE.Vector3(0, 1.6, 20), 0);
      }, 1400);
    } else {
      // elimination: one life — you're out, you lose the pot
      void this.finish(false);
    }
  }

  private async finish(win: boolean): Promise<void> {
    const m = this.match;
    if (!m) return;
    m.running = false;
    // Practice/offline match: cosmetic payout only (no real stake at play).
    const payout = win ? +(m.pot * 0.95).toFixed(3) : 0;
    this.hud.hide();
    this.onEnd(win, payout);
  }

  // ---------------- online (authoritative server) ----------------
  startOnline(
    mode: Mode,
    stake: number,
    net: NetworkClient,
    start: MatchStartMsg,
    onEnd: (win: boolean, payout: number) => void,
  ): void {
    this.onEnd = onEnd;
    this.net = net;
    this.match = null;
    this.resetStats();
    this.effects.clearDecals();
    // Theme derived from the player set so everyone in the match sees the same.
    const seed = start.players.reduce(
      (a, p) => a + [...p.id].reduce((x, c) => x + c.charCodeAt(0), 0),
      0,
    );
    this.applyTheme(THEMES[seed % THEMES.length]);

    // clear any offline bots
    for (const b of this.bots) this.scene.remove(b.root);
    this.bots = [];

    const youId = start.youId;
    const seat = Math.max(
      0,
      start.players.findIndex((p) => p.id === youId),
    );
    const youTeam = start.players[seat]?.team ?? 0;
    const feet = spawnFor(mode, seat);
    // team 0 spawns +z facing -z (yaw 0); team 1 spawns -z facing +z (yaw π)
    this.player.reset(
      new THREE.Vector3(feet[0], feet[1] + EYE, feet[2]),
      youTeam === 0 ? 0 : Math.PI,
    );
    this.weapon.configure(start.players[seat]?.weapon ?? DEFAULT_WEAPON);

    const avatars = new Map<string, RemoteAvatar>();
    const names = new Map<string, string>();
    const teams = new Map<string, number>();
    const weapons = new Map<string, WeaponId>();
    start.players.forEach((p) => {
      names.set(p.id, p.name);
      teams.set(p.id, p.team);
      weapons.set(p.id, p.weapon);
      if (p.id === youId) return;
      const av = new RemoteAvatar(p.team, p.weapon); // team-colored skin + their gun
      this.scene.add(av.root);
      avatars.set(p.id, av);
    });

    this.online = {
      mode,
      pot: start.pot,
      stake,
      youId,
      youTeam,
      myName: start.players[seat]?.name ?? "Player",
      running: true,
      ammo: this.weapon.magSize,
      fireCd: 0,
      avatars,
      names,
      teams,
      weapons,
      spectateId: null,
      roster: new Map(),
      startT: performance.now(),
    };

    net.setHandlers({
      onSnapshot: (m) => this.onSnapshot(m),
      onHit: (m) => this.onHit(m),
      onShot: (m) => this.onShot(m),
      onEnd: (m) => void this.onNetEnd(m.youWon, m.payout),
      onChat: (m) => {
        const o = this.online;
        if (!o) return;
        const cls = m.name === o.myName ? "me" : m.team === o.youTeam ? "blue" : "red";
        this.hud.chatMessage(m.name, m.text, cls);
      },
      onNade: (m) => this.grenades.throw(m),
      onBoom: (m) => this.grenades.boom(m),
      onClose: () => {
        if (this.online?.running) void this.onNetEnd(false, 0);
      },
    });

    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    this.hud.setWeapon(WEAPONS[this.weapon.weaponId].name);
    this.hud.setScore(0);
    this.hud.setPot(start.pot, mode === "duel" ? "1v1" : "5v5");
    if (mode === "elimination") {
      const per = start.players.filter((p) => p.team === youTeam).length;
      const foe = start.players.length - per;
      this.hud.setTeamStatus(per, foe);
    }
    this.hud.roundIntro();
    this.clock.getDelta();
  }

  private onlineFrame(dt: number): void {
    const o = this.online!;
    this.grenades.update(dt);
    this.hud.setTimer((performance.now() - o.startT) / 1000);

    // radar
    const blips: Blip[] = [];
    for (const [id, r] of o.roster) {
      if (id === o.youId) continue;
      blips.push({ x: r.x, z: r.z, team: r.team, alive: r.alive });
    }
    this.minimap.draw(this.player.position.x, this.player.position.z, this.player.viewYaw(), o.youTeam, blips);

    // scoreboard (hold)
    if (this.input.state.scoreboard) {
      const rows = [...o.roster.entries()].map(([id, r]) => ({
        name: o.names.get(id) ?? "Player",
        kills: r.kills,
        team: r.team,
        alive: r.alive,
        you: id === o.youId,
      }));
      this.hud.showScoreboard(rows, o.mode === "elimination");
    } else {
      this.hud.hideScoreboard();
    }

    if (this.player.alive) {
      this.weapon.showViewmodel(true);
      this.player.update(dt, this.input.state, this.arena);
      this.footstep(dt);
      this.weapon.update(dt, this.arena.solids);

      // local muzzle-flash cadence (cosmetic; server owns real fire + hits)
      o.fireCd -= dt;
      let fired = false;
      if (this.input.state.firing && o.fireCd <= 0 && o.ammo > 0) {
        o.fireCd = 1 / this.weapon.fireRate;
        fired = true;
        this.weapon.kick();
        this.effects.muzzleSmoke(this.weapon.muzzleWorld());
        Sound.shot();
        Telegram.haptic("light");
      }
      if (
        this.input.state.reloadQueued &&
        o.ammo < this.weapon.magSize
      )
        Sound.reload();

      // Send the effective view (aim + recoil), so the server's shots climb with
      // the recoil pattern too. Sent BEFORE this shot's kick → first shot is true.
      this.net?.sendInput({
        moveX: this.input.state.moveX,
        moveY: this.input.state.moveY,
        yaw: this.player.viewYaw(),
        pitch: this.player.viewPitch(),
        fire: this.input.state.firing,
        jump: this.input.state.jumpQueued,
        reload: this.input.state.reloadQueued,
        sprint: this.input.state.sprint,
        crouch: this.input.state.crouch,
        ads: this.input.state.ads,
        throwNade: this.input.state.throwQueued,
      });

      if (fired) this.weapon.applyRecoil(this.player); // climb the next shot
    } else {
      // dead: keep effects decaying; in team mode, spectate a teammate
      this.weapon.update(dt, this.arena.solids);
      this.weapon.showViewmodel(false);
      if (o.mode === "elimination") this.spectate(o);
    }

    const tags: Tag[] = [];
    for (const [id, av] of o.avatars) {
      av.update(dt);
      if (!av.isAlive) continue;
      tags.push({
        id,
        name: o.names.get(id) ?? "Player",
        head: av.headWorld(),
        friendly: o.teams.get(id) === o.youTeam,
      });
    }
    this.nametags.update(this.player.camera, tags);
  }

  // Follow a living teammate in third person while eliminated.
  private spectate(o: OnlineState): void {
    let target = o.spectateId ? o.avatars.get(o.spectateId) : undefined;
    if (!target || !target.isAlive) {
      o.spectateId = null;
      for (const [id, av] of o.avatars) {
        if (av.isAlive && o.teams.get(id) === o.youTeam) {
          o.spectateId = id;
          target = av;
          break;
        }
      }
    }
    if (target && o.spectateId) {
      const head = target.headWorld();
      const ry = target.root.rotation.y;
      const fx = Math.sin(ry);
      const fz = Math.cos(ry);
      const cam = this.player.camera;
      cam.position.set(head.x - fx * 3.5, head.y + 1.4, head.z - fz * 3.5);
      cam.lookAt(head.x + fx * 4, head.y - 0.3, head.z + fz * 4);
      this.hud.setSpectate(o.names.get(o.spectateId) ?? "teammate");
    } else {
      this.hud.setSpectate(null); // no teammates left — match is ending
    }
  }

  private onSnapshot(m: SnapshotMsg): void {
    const o = this.online;
    if (!o || !o.running) return;
    for (const s of m.players) {
      o.roster.set(s.id, { x: s.x, z: s.z, team: s.team, alive: s.alive, kills: s.score });
    }
    for (const s of m.players) {
      if (s.id === o.youId) {
        o.ammo = s.ammo;
        this.hud.setHealth(s.health);
        this.hud.setAmmo(s.ammo, s.reserve);
        this.hud.setScore(s.score);
        const serverEye = new THREE.Vector3(s.x, s.y, s.z);
        const wasAlive = this.player.alive;
        this.player.health = s.health;
        this.player.alive = s.alive;
        if (wasAlive && !s.alive) {
          Sound.die();
          this.mstats.deaths++;
        }
        if (s.alive) {
          this.hud.setSpectate(null);
          // Reconcile: trust prediction unless it diverges, or on respawn.
          if (!wasAlive || this.player.position.distanceTo(serverEye) > 2)
            this.player.teleport(serverEye);
        } else if (o.mode !== "elimination") {
          // duel: sit at the death spot until respawn (spectator handles team)
          this.player.teleport(serverEye);
        }
      } else {
        let av = o.avatars.get(s.id);
        if (!av) {
          av = new RemoteAvatar(s.team);
          this.scene.add(av.root);
          o.avatars.set(s.id, av);
          o.teams.set(s.id, s.team);
        }
        av.setTarget(s.x, s.y, s.z, s.yaw, s.alive);
      }
    }

    if (o.mode === "elimination") {
      let mine = 0;
      let foe = 0;
      for (const s of m.players) {
        if (!s.alive) continue;
        if (s.team === o.youTeam) mine++;
        else foe++;
      }
      this.hud.setTeamStatus(mine, foe);
    }
  }

  private onHit(m: HitEventMsg): void {
    const o = this.online;
    if (!o) return;
    o.avatars.get(m.target)?.flash(); // red hit flash on the struck soldier
    if (m.by === o.youId) {
      this.mstats.hits++;
      this.mstats.damage += m.damage;
      this.hud.hitMarker(m.headshot);
      this.showDamage(this.lastShotImpact, m.damage, m.headshot);
      this.effects.impact(this.lastShotImpact, this.blood); // red flesh puff (if blood on)
      Sound.hitEnemy(m.headshot);
      Telegram.haptic("light");
      if (m.killed) {
        this.mstats.kills++;
        Sound.kill();
        this.hud.killFeed("You", o.names.get(m.target) ?? "Enemy", true, o.weapons.get(m.by));
      }
    } else if (m.killed) {
      this.hud.killFeed(
        o.names.get(m.by) ?? "?",
        o.names.get(m.target) ?? "?",
        m.target === o.youId,
        o.weapons.get(m.by),
      );
    }
    if (m.target === o.youId) {
      this.hud.damageFlashPulse();
      Sound.hurt();
      Telegram.haptic("heavy");
      // directional damage arrow: where did the attacker fire from?
      const from = o.roster.get(m.by);
      if (from) {
        const dx = from.x - this.player.position.x;
        const dz = from.z - this.player.position.z;
        const worldAngle = Math.atan2(dx, -dz); // 0 = -z (forward)
        this.hud.damageDirection(worldAngle - this.player.viewYaw());
      }
    }
  }

  private onShot(m: ShotEventMsg): void {
    const o = this.online;
    if (!o) return;
    const to = new THREE.Vector3(m.hx, m.hy, m.hz);
    this.effects.impact(to, false);
    // decal only on surfaces (no player within ~1.3m of the impact)
    let nearPlayer = false;
    for (const r of o.roster.values()) {
      if (Math.hypot(r.x - to.x, r.z - to.z) < 1.3) {
        nearPlayer = true;
        break;
      }
    }
    if (!nearPlayer) this.effects.decal(to);
    if (m.by === o.youId) {
      this.mstats.shots++;
      this.lastShotImpact.copy(to); // for the damage number on the next hit
      this.weapon.showTracer(this.weapon.muzzleWorld(), to);
    } else {
      const col = WEAPONS[o.weapons.get(m.by) ?? DEFAULT_WEAPON].tracer;
      this.weapon.showTracer(new THREE.Vector3(m.ox, m.oy, m.oz), to, col);
      this.weapon.flashAt(new THREE.Vector3(m.ox, m.oy, m.oz));
    }
  }

  // Soft footstep cadence while the local player runs.
  private footstep(dt: number): void {
    this.stepTimer -= dt;
    const sp = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (sp > 1.8 && this.stepTimer <= 0) {
      this.stepTimer = 0.42;
      Sound.footstep();
    }
  }

  private showDamage(world: THREE.Vector3, amount: number, headshot: boolean): void {
    if (!this.dmgNumbers) return;
    const ndc = world.clone().project(this.player.camera);
    if (ndc.z > 1) return; // behind the camera
    const px = (ndc.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    this.hud.damageNumber(px, py, amount, headshot);
  }

  private async onNetEnd(youWon: boolean, payout: number): Promise<void> {
    const o = this.online;
    if (!o || !o.running) return;
    o.running = false;
    Telegram.notify(youWon ? "success" : "error");
    // Payout is settled on-chain by the oracle straight to the winner's wallet;
    // the server's MatchEnd already carries the net amount (pot − rake).
    this.cleanupOnline();
    this.hud.hide();
    this.onEnd(youWon, payout);
  }

  private cleanupOnline(): void {
    if (this.online) {
      for (const av of this.online.avatars.values()) av.dispose(this.scene);
      this.online.avatars.clear();
    }
    this.grenades.clear();
    this.minimap.clear();
    this.hud.hideScoreboard();
    this.net?.close();
    this.net = null;
    this.online = null;
  }
}

// Vertical gradient sky (dark top → lighter horizon), as a background texture.
function makeSkyTexture(stops: [string, string, string] = ["#0a1122", "#131a2c", "#232c42"]): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.55, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Time-of-day themes: sky gradient, fog, hemi/ambient/sun tint + intensity.
export interface ArenaTheme {
  sky: [string, string, string];
  fog: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  ambient: number;
  ambientInt: number;
  sun: number;
  sunInt: number;
}
export const THEMES: ArenaTheme[] = [
  // day (default)
  { sky: ["#0a1122", "#131a2c", "#232c42"], fog: 0x141b2e, hemiSky: 0xaec6ff, hemiGround: 0x2b3040, hemiInt: 1.15, ambient: 0x3a4356, ambientInt: 0.3, sun: 0xfff2df, sunInt: 2.5 },
  // dusk (warm)
  { sky: ["#2a1526", "#4a2436", "#8a4a3a"], fog: 0x3a2230, hemiSky: 0xffb27a, hemiGround: 0x2a1a24, hemiInt: 1.0, ambient: 0x4a2e34, ambientInt: 0.32, sun: 0xff9a5a, sunInt: 2.3 },
  // night (cool + dim)
  { sky: ["#05070f", "#0a0e1a", "#101528"], fog: 0x080b16, hemiSky: 0x6a86c0, hemiGround: 0x14161f, hemiInt: 0.85, ambient: 0x232a3a, ambientInt: 0.28, sun: 0xbcd0ff, sunInt: 1.5 },
  // dawn (pink)
  { sky: ["#1a1030", "#3a2450", "#c07a8a"], fog: 0x322036, hemiSky: 0xffc0d0, hemiGround: 0x2a2036, hemiInt: 1.05, ambient: 0x3e3048, ambientInt: 0.32, sun: 0xffd0c0, sunInt: 2.2 },
];
