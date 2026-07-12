import {
  TICK_DT,
  TICK_HZ,
  SNAPSHOT_HZ,
  SEATS,
  TEAM_SIZE,
  DUEL_TARGET,
  RAKE,
  type Mode,
  type InputMsg,
  type ServerMsg,
  type PlayerSnap,
} from "../../shared/protocol";
import {
  makePlayer,
  respawn,
  stepMovement,
  stepWeapon,
  doFire,
  hitscan,
  feetOf,
  dirFromAngles,
  type SimInput,
  type SimPlayer,
} from "../../shared/sim";
import { spawnFor, rayArena, groundHeight, mapById, type GameMap } from "../../shared/arena";
import { weaponOf, type WeaponId } from "../../shared/weapons";
import { ServerBot } from "./ServerBot";
import { Address } from "@ton/core";
import type { EscrowService } from "./ton/EscrowService";
import type { Leaderboard } from "./Leaderboard";

export interface Conn {
  id: string;
  send(msg: ServerMsg): void;
}

interface Part {
  player: SimPlayer;
  name: string;
  team: number; // 0 or 1
  wallet?: string; // TON address for on-chain payout
  conn: Conn | null; // null = bot
  bot: ServerBot | null;
  input: SimInput;
  respawnT: number; // >0 while waiting to respawn (duel)
  history: { t: number; x: number; y: number; z: number }[]; // feet, for lag comp
  nades: number; // grenades left this life
  nadeCd: number; // throw cooldown
}

interface Grenade {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  owner: Part;
  team: number;
}

const NADES_PER_LIFE = 2;
const NADE_THROW_SPEED = 15;
const NADE_UP = 4.5;
const NADE_FUSE = 1.5;
const NADE_COOLDOWN = 0.7;
const NADE_RADIUS = 5.5;
const NADE_MAX_DMG = 95;
const NADE_GRAVITY = 22;

const emptyInput = (): SimInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  fire: false,
  jump: false,
  reload: false,
  sprint: false,
  crouch: false,
  ads: false,
  throwNade: false,
});

// Fixed lag-compensation window for human shooters (~one interp buffer).
// Production should use per-client measured RTT; this is a documented constant.
const LAGCOMP_MS = 100;
const HISTORY_MS = 1200;

export class Room {
  readonly id: string;
  readonly mode: Mode;
  readonly stake: number;
  readonly seats: number;
  readonly pot: number;
  readonly chainMatchId: bigint; // on-chain escrow match id
  readonly matchWeapon: WeaponId; // everyone in this match uses the same weapon
  readonly map: GameMap; // the arena everyone plays on

  private parts: Part[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapTimer: ReturnType<typeof setInterval> | null = null;
  private tickN = 0;
  private elapsedMs = 0;
  private ended = false;
  private grenades: Grenade[] = [];
  private nadeSeq = 0;
  private onClose: () => void;
  private escrow: EscrowService;
  private leaderboard: Leaderboard;

  constructor(
    id: string,
    mode: Mode,
    stake: number,
    chainMatchId: bigint,
    escrow: EscrowService,
    leaderboard: Leaderboard,
    onClose: () => void,
    matchWeapon: WeaponId = "rifle",
    mapId = 0,
  ) {
    this.id = id;
    this.mode = mode;
    this.stake = stake;
    this.seats = SEATS[mode];
    this.pot = +(stake * this.seats).toFixed(3);
    this.chainMatchId = chainMatchId;
    this.matchWeapon = matchWeapon;
    this.map = mapById(mapId);
    this.escrow = escrow;
    this.leaderboard = leaderboard;
    this.onClose = onClose;
  }

  get humanCount(): number {
    return this.parts.filter((p) => p.conn).length;
  }
  get full(): boolean {
    return this.parts.length >= this.seats;
  }

  // Human seats and their wallets — used by the funding coordinator to know who
  // must deposit and to message them while we wait for on-chain confirmation.
  get humans(): { id: string; conn: Conn; wallet?: string }[] {
    return this.parts
      .filter((p) => p.conn)
      .map((p) => ({ id: p.player.id, conn: p.conn!, wallet: p.wallet }));
  }

  // Send a message to every connected human (pre-match, before tick loop runs).
  sendAll(msg: ServerMsg): void {
    this.broadcast(msg);
  }

  private teamFor(seat: number): number {
    return seat < this.seats / 2 ? 0 : 1;
  }

  addHuman(conn: Conn, name: string, wallet?: string, weapon?: WeaponId): void {
    void weapon; // everyone in a match uses the same weapon (fair fights)
    const seat = this.parts.length;
    this.parts.push({
      player: makePlayer(conn.id, spawnFor(this.map, this.mode, seat), this.matchWeapon),
      name,
      team: this.teamFor(seat),
      wallet,
      conn,
      bot: null,
      input: emptyInput(),
      respawnT: 0,
      history: [],
      nades: NADES_PER_LIFE,
      nadeCd: 0,
    });
  }

  private addBot(): void {
    const seat = this.parts.length;
    const team = this.teamFor(seat);
    const botNames = ["Raider", "Viper", "Ghost", "Bravo", "Kilo", "Wolf", "Echo", "Fox", "Nova", "Zulu"];
    // Bots use the SAME weapon as the match — no sniper-vs-shotgun mismatches.
    this.parts.push({
      player: makePlayer("bot-" + seat, spawnFor(this.map, this.mode, seat), this.matchWeapon),
      name: botNames[seat % botNames.length],
      team,
      conn: null,
      bot: new ServerBot(),
      input: emptyInput(),
      respawnT: 0,
      history: [],
      nades: NADES_PER_LIFE,
      nadeCd: 0,
    });
  }

  fillWithBots(): void {
    while (this.parts.length < this.seats) this.addBot();
  }

  start(): void {
    this.fillWithBots();
    const roster = this.parts.map((p) => ({
      id: p.player.id,
      name: p.name,
      bot: !p.conn,
      team: p.team,
      weapon: p.player.weaponId,
    }));
    for (const p of this.parts) {
      p.conn?.send({
        t: "start",
        mode: this.mode,
        youId: p.player.id,
        pot: this.pot,
        stake: this.stake,
        mapId: this.map.id,
        players: roster,
      });
    }
    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.snapTimer = setInterval(() => this.broadcastSnap(), 1000 / SNAPSHOT_HZ);
  }

  chat(id: string, text: string): void {
    const p = this.parts.find((x) => x.player.id === id && x.conn);
    if (!p) return;
    const clean = text.slice(0, 140).trim();
    if (!clean) return;
    this.broadcast({ t: "chatMsg", name: p.name, text: clean, team: p.team });
  }

  setInput(id: string, msg: InputMsg): void {
    const p = this.parts.find((x) => x.player.id === id);
    if (!p) return;
    p.input = {
      moveX: clamp(msg.moveX, -1, 1),
      moveY: clamp(msg.moveY, -1, 1),
      yaw: msg.yaw,
      pitch: msg.pitch,
      fire: msg.fire,
      jump: msg.jump,
      reload: msg.reload,
      sprint: !!msg.sprint,
      crouch: !!msg.crouch,
      ads: !!msg.ads,
      // OR-in so a throw isn't lost if two inputs arrive between ticks; the tick
      // consumes it.
      throwNade: p.input.throwNade || !!msg.throwNade,
    };
    (p as Part & { ackSeq?: number }).ackSeq = msg.seq;
  }

  removeHuman(id: string): void {
    const p = this.parts.find((x) => x.player.id === id);
    if (!p) return;
    p.conn = null;
    p.player.alive = false; // treat as eliminated
    if (this.mode === "duel") this.finish(1 - p.team); // opponent takes it
    else this.checkWin();
  }

  private enemiesOf(p: Part): SimPlayer[] {
    return this.parts.filter((x) => x.team !== p.team).map((x) => x.player);
  }

  private tick(): void {
    if (this.ended) return;
    const dt = TICK_DT;
    this.tickN++;
    this.elapsedMs += dt * 1000;

    // 1) decide inputs (bots think), 2) move + weapon, 3) fire resolution
    for (const p of this.parts) {
      if (p.bot) p.input = p.bot.think(p.player, this.enemiesOf(p), dt);

      // respawn countdown (duel only)
      if (!p.player.alive && p.respawnT > 0) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          const seat = this.parts.indexOf(p);
          respawn(p.player, spawnFor(this.map, this.mode, seat));
          p.nades = NADES_PER_LIFE;
        }
      }

      stepMovement(p.player, p.input, dt, this.map.colliders, this.map.half);
      stepWeapon(p.player, p.input, dt);
    }

    // record history AFTER movement
    for (const p of this.parts) {
      const f = feetOf(p.player);
      p.history.push({ t: this.elapsedMs, x: f.x, y: f.y, z: f.z });
      const cutoff = this.elapsedMs - HISTORY_MS;
      while (p.history.length > 2 && p.history[0].t < cutoff) p.history.shift();
    }

    // fire resolution with lag compensation
    for (const shooter of this.parts) {
      if (!shooter.input.fire) continue;
      const shot = doFire(shooter.player, Math.random);
      if (!shot) continue;

      const spec = weaponOf(shooter.player.weaponId);
      const compMs = shooter.conn ? LAGCOMP_MS : 0;
      // Only enemies are hittable — no friendly fire, teammates don't block.
      const targets = this.parts
        .filter((p) => p.team !== shooter.team)
        .map((p) => ({
          id: p.player.id,
          feet: this.rewind(p, this.elapsedMs - compMs),
          alive: p.player.alive,
        }));

      // Resolve every pellet. Aggregate damage per victim so a shotgun blast
      // reads as one hit marker, and pick the centre pellet's endpoint for the
      // tracer/impact FX.
      const perVictim = new Map<string, { dmg: number; headshot: boolean }>();
      let impact: { x: number; y: number; z: number } | null = null;
      for (let i = 0; i < shot.dirs.length; i++) {
        const dir = shot.dirs[i];
        const hit = hitscan(shot.origin, dir, targets, shooter.player.id, spec, this.map.colliders);
        if (i === 0) impact = hit ? hit.point : this.wallEnd(shot.origin, dir);
        if (!hit) continue;
        const acc = perVictim.get(hit.targetId) ?? { dmg: 0, headshot: false };
        acc.dmg += hit.damage;
        acc.headshot = acc.headshot || hit.headshot;
        perVictim.set(hit.targetId, acc);
      }
      if (!impact) impact = this.wallEnd(shot.origin, shot.dirs[0]);

      this.broadcast({
        t: "shot",
        by: shooter.player.id,
        ox: shot.origin.x,
        oy: shot.origin.y,
        oz: shot.origin.z,
        hx: impact.x,
        hy: impact.y,
        hz: impact.z,
      });

      for (const [targetId, acc] of perVictim) {
        const victim = this.parts.find((p) => p.player.id === targetId)!;
        const killed = this.applyDamage(shooter, victim, acc.dmg);
        this.broadcast({
          t: "hit",
          by: shooter.player.id,
          target: victim.player.id,
          headshot: acc.headshot,
          damage: acc.dmg,
          killed,
        });
      }
    }

    this.stepGrenades(dt);
  }

  // Grenade throws + in-flight integration + detonation (radius damage).
  private stepGrenades(dt: number): void {
    // throws
    for (const p of this.parts) {
      if (p.nadeCd > 0) p.nadeCd -= dt;
      if (!p.input.throwNade) continue;
      p.input.throwNade = false; // consume the edge
      if (!p.player.alive || p.nades <= 0 || p.nadeCd > 0) continue;
      p.nades--;
      p.nadeCd = NADE_COOLDOWN;
      const d = dirFromAngles(p.player.yaw, p.player.pitch);
      const g: Grenade = {
        id: ++this.nadeSeq,
        x: p.player.pos.x + d.x * 0.6,
        y: p.player.pos.y + d.y * 0.6,
        z: p.player.pos.z + d.z * 0.6,
        vx: d.x * NADE_THROW_SPEED,
        vy: d.y * NADE_THROW_SPEED + NADE_UP,
        vz: d.z * NADE_THROW_SPEED,
        fuse: NADE_FUSE,
        owner: p,
        team: p.team,
      };
      this.grenades.push(g);
      this.broadcast({
        t: "nade",
        id: g.id,
        ox: g.x,
        oy: g.y,
        oz: g.z,
        vx: g.vx,
        vy: g.vy,
        vz: g.vz,
        fuse: g.fuse,
      });
    }

    // integrate + detonate
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.vy -= NADE_GRAVITY * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      // floor bounce (lose energy)
      const floor = groundHeight(g.x, g.z, this.map.colliders) + 0.15;
      if (g.y < floor) {
        g.y = floor;
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.6;
        g.vz *= 0.6;
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.detonate(g);
        this.grenades.splice(i, 1);
      }
    }
  }

  private detonate(g: Grenade): void {
    this.broadcast({ t: "boom", id: g.id, x: g.x, y: g.y, z: g.z });
    for (const victim of this.parts) {
      if (!victim.player.alive || victim.team === g.team) continue; // no friendly fire
      const f = feetOf(victim.player);
      const cx = f.x;
      const cy = f.y + 0.9; // torso
      const cz = f.z;
      const dist = Math.hypot(cx - g.x, cy - g.y, cz - g.z);
      if (dist > NADE_RADIUS) continue;
      // line-of-sight: walls block the blast
      const dx = cx - g.x;
      const dy = cy - g.y;
      const dz = cz - g.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const wall = rayArena(g.x, g.y, g.z, dx / len, dy / len, dz / len, this.map.colliders);
      if (Number.isFinite(wall) && wall < dist - 0.5) continue; // blocked
      const dmg = NADE_MAX_DMG * (1 - dist / NADE_RADIUS);
      if (dmg <= 0) continue;
      const killed = this.applyDamage(g.owner, victim, dmg);
      this.broadcast({
        t: "hit",
        by: g.owner.player.id,
        target: victim.player.id,
        headshot: false,
        damage: dmg,
        killed,
      });
    }
  }

  // Endpoint of a ray at the first wall/box it hits (or 60u if it hits nothing).
  private wallEnd(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) {
    const wallDist = rayArena(o.x, o.y, o.z, d.x, d.y, d.z, this.map.colliders);
    const dist = Number.isFinite(wallDist) ? wallDist : 60;
    return { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist };
  }

  private applyDamage(shooter: Part, victim: Part, dmg: number): boolean {
    if (!victim.player.alive) return false;
    victim.player.health -= dmg;
    if (victim.player.health > 0) return false;

    victim.player.health = 0;
    victim.player.alive = false;
    shooter.player.score++;

    if (this.mode === "duel") {
      victim.respawnT = 1.6;
      if (shooter.player.score >= DUEL_TARGET) this.finish(shooter.team);
    } else {
      // team elimination: one life, no respawn — win when a team is wiped
      this.checkWin();
    }
    return true;
  }

  private checkWin(): void {
    if (this.ended || this.mode !== "elimination") return;
    const a0 = this.parts.some((p) => p.team === 0 && p.player.alive);
    const a1 = this.parts.some((p) => p.team === 1 && p.player.alive);
    if (!a0 && !a1) this.finish(null);
    else if (!a0) this.finish(1);
    else if (!a1) this.finish(0);
  }

  private finish(winnerTeam: number | null): void {
    if (this.ended) return;
    this.ended = true;
    const share = TEAM_SIZE[this.mode]; // players per team → split the pot
    const payout = +((this.pot * (1 - RAKE)) / share).toFixed(3);
    const winnerId =
      winnerTeam == null
        ? null
        : (this.parts.find((p) => p.team === winnerTeam)?.player.id ?? null);

    const humanWinners: Part[] = [];
    for (const p of this.parts) {
      const youWon = winnerTeam != null && p.team === winnerTeam;
      if (youWon && p.conn && p.wallet) humanWinners.push(p);
      p.conn?.send({
        t: "end",
        winnerId,
        youWon,
        pot: this.pot,
        payout: youWon ? payout : 0,
      });

      // Weekly leaderboard: net TON = payout − stake for winners, −stake else.
      if (p.conn) {
        const tonDelta = youWon ? +(payout - this.stake).toFixed(3) : -this.stake;
        const id = p.wallet ?? `name:${p.name}`;
        this.leaderboard.record(id, p.name, tonDelta, youWon, p.player.score);
      }
    }

    // On-chain settlement only makes sense for a single winner (duel). Team
    // splits need a multi-payout contract (future work), so skip there.
    if (this.mode === "duel" && humanWinners.length === 1) {
      this.settleOnChain(humanWinners[0].wallet!);
    }
    this.dispose();
  }

  private settleOnChain(walletStr: string): void {
    let addr: Address;
    try {
      addr = Address.parse(walletStr);
    } catch {
      console.warn(`[room ${this.id}] bad winner wallet, skipping settle`);
      return;
    }
    this.escrow.settle(this.chainMatchId, addr).catch((e) => {
      console.error(`[room ${this.id}] on-chain settle failed:`, e);
    });
  }

  private rewind(p: Part, atMs: number): { x: number; y: number; z: number } {
    const h = p.history;
    if (h.length === 0) return feetOf(p.player);
    // find the two samples bracketing atMs and lerp
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= atMs) {
        const a = h[i];
        const b = h[Math.min(i + 1, h.length - 1)];
        if (b.t === a.t) return { x: a.x, y: a.y, z: a.z };
        const f = (atMs - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
        };
      }
    }
    return { x: h[0].x, y: h[0].y, z: h[0].z };
  }

  private players(): SimPlayer[] {
    return this.parts.map((p) => p.player);
  }

  private broadcastSnap(): void {
    if (this.ended) return;
    const players: PlayerSnap[] = this.parts.map((p) => ({
      id: p.player.id,
      x: p.player.pos.x,
      y: p.player.pos.y,
      z: p.player.pos.z,
      yaw: p.player.yaw,
      pitch: p.player.pitch,
      health: p.player.health,
      alive: p.player.alive,
      score: p.player.score,
      ammo: p.player.ammo,
      reserve: p.player.reserve,
      team: p.team,
    }));
    for (const p of this.parts) {
      p.conn?.send({
        t: "snap",
        tick: this.tickN,
        ackSeq: (p as Part & { ackSeq?: number }).ackSeq ?? 0,
        players,
      });
    }
  }

  private broadcast(msg: ServerMsg): void {
    for (const p of this.parts) p.conn?.send(msg);
  }

  private dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.snapTimer) clearInterval(this.snapTimer);
    this.tickTimer = null;
    this.snapTimer = null;
    this.onClose();
  }

  forceClose(): void {
    this.ended = true;
    this.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
