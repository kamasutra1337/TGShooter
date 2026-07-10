import * as THREE from "three";
import { Arena } from "./Arena";
import { Player } from "./Player";
import { Weapon } from "./Weapon";
import { Bot } from "./Bot";
import { HUD } from "./HUD";
import { Input } from "./Input";
import { Telegram } from "../platform/telegram";
import { Ton, type MatchStake } from "../platform/ton";

export type Mode = "duel" | "elimination";

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
  private input: Input;
  private bots: Bot[] = [];
  private clock = new THREE.Clock();
  private match: MatchState | null = null;
  private respawnQueue: { bot: Bot; t: number }[] = [];
  private onEnd: (win: boolean, payout: number) => void = () => {};

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

    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.Fog(0x0b0e14, 30, 80);

    this.player = new Player(window.innerWidth / window.innerHeight);
    this.weapon = new Weapon(this.scene);
    this.input = new Input(canvas);

    this.setupLights();
    this.arena.build(this.scene);
    this.input.attach();

    window.addEventListener("resize", () => this.onResize());
  }

  get usingTouch(): boolean {
    return this.input.usingTouch;
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0x9fbfff, 0x2a3140, 1.15);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x404a5e, 0.35));

    const sun = new THREE.DirectionalLight(0xfff0d8, 1.35);
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
    const seats = cfg.mode === "duel" ? 2 : 5;
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

    const enemyCount = cfg.mode === "duel" ? 1 : seats - 1;
    const palette = [0xff5a6a, 0xffa23a, 0x9b6cff, 0x3ad0ff, 0xff6ac0];
    // Duel: opponent faces off in front of the player. Elimination: spread out.
    const duelSpawn = new THREE.Vector3(0, 0, -12);
    for (let i = 0; i < enemyCount; i++) {
      const bot = new Bot(palette[i % palette.length]);
      this.scene.add(bot.root);
      const spawn =
        cfg.mode === "duel"
          ? duelSpawn
          : this.arena.spawns[(i + 1) % this.arena.spawns.length];
      bot.spawn(spawn);
      this.bots.push(bot);
    }

    // Reset player
    this.player.reset(new THREE.Vector3(0, 1.6, 20), 0);
    this.weapon.ammo = this.weapon.magSize;
    this.weapon.reserve = 90;

    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    this.hud.setScore(0);
    this.hud.setPot(pot, cfg.mode === "duel" ? "1v1" : "BATTLE");

    this.clock.getDelta(); // flush
  }

  stopMatch(): void {
    if (this.match) this.match.running = false;
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
    const m = this.match;

    if (m && m.running && this.player.alive) {
      this.player.update(dt, this.input.state, this.arena);

      // fire
      if (this.input.state.firing) {
        const res = this.weapon.tryFire(this.player, this.bots, this.arena.solids);
        if (res) {
          Telegram.haptic("light");
          if (res.hitBot) {
            const dmg = this.weapon.damage * (res.headshot ? this.weapon.headshotMult : 1);
            const died = res.hitBot.damage(dmg);
            this.hud.hitMarker(res.headshot);
            if (died) this.onBotDied(res.hitBot);
          }
        }
      }
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
        if (!this.player.alive) this.onPlayerDied();
      }

      // respawns (duel only)
      for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
        this.respawnQueue[i].t -= dt;
        if (this.respawnQueue[i].t <= 0) {
          const idx = (Math.random() * this.arena.spawns.length) | 0;
          this.respawnQueue[i].bot.spawn(this.arena.spawns[idx]);
          this.respawnQueue.splice(i, 1);
        }
      }

      this.hud.setHealth(this.player.health);
      this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    } else {
      this.weapon.update(dt, this.arena.solids);
    }

    this.hud.update(dt);
    this.input.endFrame();
    this.renderer.render(this.scene, this.player.camera);
  }

  private onBotDied(bot: Bot): void {
    const m = this.match;
    if (!m) return;
    m.playerFrags++;
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
      this.hud.setScore(m.seats - 1 - remaining); // eliminations
      if (remaining === 0) {
        void this.finish(true);
        return;
      }
    }
  }

  private onPlayerDied(): void {
    const m = this.match;
    if (!m) return;
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
}
