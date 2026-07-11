import * as THREE from "three";
import { Arena } from "./Arena";
import { Player } from "./Player";
import { Weapon } from "./Weapon";
import { Bot } from "./Bot";
import { HUD } from "./HUD";
import { Input } from "./Input";
import { RemoteAvatar } from "./RemoteAvatar";
import { Nametags, type Tag } from "./Nametags";
import { Effects } from "./Effects";
import { Sound } from "./Audio";
import { Telegram } from "../platform/telegram";
import { Ton, type MatchStake } from "../platform/ton";
import { NetworkClient } from "../net/NetworkClient";
import type { MatchStartMsg, HitEventMsg, ShotEventMsg, SnapshotMsg } from "../../shared/protocol";
import { spawnFor } from "../../shared/arena";
import { SEATS } from "../../shared/protocol";
import { EYE } from "../../shared/sim";

export type Mode = "duel" | "elimination";

interface OnlineState {
  mode: Mode;
  pot: number;
  stake: number;
  youId: string;
  youTeam: number;
  running: boolean;
  ammo: number;
  fireCd: number;
  avatars: Map<string, RemoteAvatar>;
  names: Map<string, string>;
  teams: Map<string, number>;
  spectateId: string | null; // teammate being followed while dead
}

export interface MatchConfig {
  mode: Mode;
  stake: number;
}

interface MatchState {
  mode: Mode;
  seats: number;
  pot: number;
  stake: MatchStake;
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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0x141b2e, 34, 88);

    this.player = new Player(window.innerWidth / window.innerHeight);
    this.weapon = new Weapon(this.scene);
    this.effects = new Effects(this.scene);
    this.input = new Input(canvas);

    // Camera must be in the scene graph so its first-person viewmodel renders.
    this.scene.add(this.player.camera);
    this.weapon.attachViewmodel(this.player.camera);

    this.setupLights();
    this.arena.build(this.scene);
    this.input.attach();

    window.addEventListener("resize", () => this.onResize());
  }

  get usingTouch(): boolean {
    return this.input.usingTouch;
  }

  // Debug hook (used only when the page is opened with ?debug) to exercise firing
  // in headless verification, since pointer-lock isn't available there.
  debugSetFiring(v: boolean): void {
    this.input.state.firing = v;
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

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x3a4150, 1.5);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x556077, 0.5));

    const sun = new THREE.DirectionalLight(0xfff0d8, 1.6);
    sun.position.set(20, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    const d = 32;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  private onResize(): void {
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- match lifecycle ---
  startMatch(cfg: MatchConfig, onEnd: (win: boolean, payout: number) => void): void {
    this.onEnd = onEnd;
    const seats = SEATS[cfg.mode];
    const pot = +(cfg.stake * seats).toFixed(3);
    const stake: MatchStake = {
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

    // Reset player
    this.player.reset(new THREE.Vector3(0, 1.6, 20), 0);
    this.weapon.ammo = this.weapon.magSize;
    this.weapon.reserve = 180;

    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
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

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.online?.running) this.onlineFrame(dt);
    else this.offlineFrame(dt);

    this.effects.update(dt, this.player.camera);
    this.hud.update(dt);
    this.input.endFrame();
    this.renderer.render(this.scene, this.player.camera);
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
          Sound.shot();
          this.effects.muzzleSmoke(this.weapon.muzzleWorld());
          Telegram.haptic("light");
          if (res.point) this.effects.impact(res.point, res.hitBot != null);
          if (res.hitBot) {
            const dmg = this.weapon.damage * (res.headshot ? this.weapon.headshotMult : 1);
            const died = res.hitBot.damage(dmg);
            this.hud.hitMarker(res.headshot);
            Sound.hitEnemy(res.headshot);
            if (res.point) this.showDamage(res.point, dmg, res.headshot);
            if (died) {
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

      const kick = this.weapon.update(dt, this.arena.solids);
      this.player.pitch += kick.pitchKick;

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
    let payout = 0;
    if (win && Ton.getState().connected) {
      payout = await Ton.claimPayout(m.stake);
    } else if (win) {
      payout = +(m.pot * 0.95).toFixed(3); // shown even without wallet
    }
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

    const avatars = new Map<string, RemoteAvatar>();
    const names = new Map<string, string>();
    const teams = new Map<string, number>();
    start.players.forEach((p) => {
      names.set(p.id, p.name);
      teams.set(p.id, p.team);
      if (p.id === youId) return;
      const av = new RemoteAvatar(p.team); // team-colored skin
      this.scene.add(av.root);
      avatars.set(p.id, av);
    });

    this.online = {
      mode,
      pot: start.pot,
      stake,
      youId,
      youTeam,
      running: true,
      ammo: this.weapon.magSize,
      fireCd: 0,
      avatars,
      names,
      teams,
      spectateId: null,
    };

    net.setHandlers({
      onSnapshot: (m) => this.onSnapshot(m),
      onHit: (m) => this.onHit(m),
      onShot: (m) => this.onShot(m),
      onEnd: (m) => void this.onNetEnd(m.youWon, m.payout),
      onClose: () => {
        if (this.online?.running) void this.onNetEnd(false, 0);
      },
    });

    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setAmmo(this.weapon.magSize, 180);
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

    if (this.player.alive) {
      this.weapon.showViewmodel(true);
      this.player.update(dt, this.input.state, this.arena);
      this.footstep(dt);
      this.weapon.update(dt, this.arena.solids);

      // local muzzle-flash cadence (cosmetic; server owns real fire + hits)
      o.fireCd -= dt;
      if (this.input.state.firing && o.fireCd <= 0 && o.ammo > 0) {
        o.fireCd = 1 / this.weapon.fireRate;
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

      this.net?.sendInput({
        moveX: this.input.state.moveX,
        moveY: this.input.state.moveY,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        fire: this.input.state.firing,
        jump: this.input.state.jumpQueued,
        reload: this.input.state.reloadQueued,
      });
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
      if (s.id === o.youId) {
        o.ammo = s.ammo;
        this.hud.setHealth(s.health);
        this.hud.setAmmo(s.ammo, s.reserve);
        this.hud.setScore(s.score);
        const serverEye = new THREE.Vector3(s.x, s.y, s.z);
        const wasAlive = this.player.alive;
        this.player.health = s.health;
        this.player.alive = s.alive;
        if (wasAlive && !s.alive) Sound.die();
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
      this.hud.hitMarker(m.headshot);
      this.showDamage(this.lastShotImpact, m.damage, m.headshot);
      this.effects.impact(this.lastShotImpact, true); // red flesh puff
      Sound.hitEnemy(m.headshot);
      Telegram.haptic("light");
      if (m.killed) {
        Sound.kill();
        this.hud.killFeed("You", o.names.get(m.target) ?? "Enemy", true);
      }
    } else if (m.killed) {
      this.hud.killFeed(
        o.names.get(m.by) ?? "?",
        o.names.get(m.target) ?? "?",
        m.target === o.youId,
      );
    }
    if (m.target === o.youId) {
      this.hud.damageFlashPulse();
      Sound.hurt();
      Telegram.haptic("heavy");
    }
  }

  private onShot(m: ShotEventMsg): void {
    const o = this.online;
    if (!o) return;
    const to = new THREE.Vector3(m.hx, m.hy, m.hz);
    this.effects.impact(to, false);
    if (m.by === o.youId) {
      this.lastShotImpact.copy(to); // for the damage number on the next hit
      this.weapon.showTracer(this.weapon.muzzleWorld(), to);
    } else {
      this.weapon.showTracer(new THREE.Vector3(m.ox, m.oy, m.oz), to);
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
    let pay = payout;
    if (youWon && Ton.getState().connected) {
      pay = await Ton.claimPayout({
        matchId: "online",
        stake: o.stake,
        players: o.mode === "duel" ? 2 : 5,
        pot: o.pot,
      });
    }
    this.cleanupOnline();
    this.hud.hide();
    this.onEnd(youWon, pay);
  }

  private cleanupOnline(): void {
    if (this.online) {
      for (const av of this.online.avatars.values()) av.dispose(this.scene);
      this.online.avatars.clear();
    }
    this.net?.close();
    this.net = null;
    this.online = null;
  }
}

// Vertical gradient sky (dark top → lighter horizon), as a background texture.
function makeSkyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#0a1122");
  g.addColorStop(0.55, "#131a2c");
  g.addColorStop(1, "#232c42");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
