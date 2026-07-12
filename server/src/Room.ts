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
  type SimInput,
  type SimPlayer,
} from "../../shared/sim";
import { spawnFor, rayArena } from "../../shared/arena";
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
}

const emptyInput = (): SimInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  fire: false,
  jump: false,
  reload: false,
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

  private parts: Part[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapTimer: ReturnType<typeof setInterval> | null = null;
  private tickN = 0;
  private elapsedMs = 0;
  private ended = false;
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
  ) {
    this.id = id;
    this.mode = mode;
    this.stake = stake;
    this.seats = SEATS[mode];
    this.pot = +(stake * this.seats).toFixed(3);
    this.chainMatchId = chainMatchId;
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

  private teamFor(seat: number): number {
    return seat < this.seats / 2 ? 0 : 1;
  }

  addHuman(conn: Conn, name: string, wallet?: string): void {
    const seat = this.parts.length;
    this.parts.push({
      player: makePlayer(conn.id, spawnFor(this.mode, seat)),
      name,
      team: this.teamFor(seat),
      wallet,
      conn,
      bot: null,
      input: emptyInput(),
      respawnT: 0,
      history: [],
    });
  }

  private addBot(): void {
    const seat = this.parts.length;
    const team = this.teamFor(seat);
    const botNames = ["Raider", "Viper", "Ghost", "Bravo", "Kilo", "Wolf", "Echo", "Fox", "Nova", "Zulu"];
    this.parts.push({
      player: makePlayer("bot-" + seat, spawnFor(this.mode, seat)),
      name: botNames[seat % botNames.length],
      team,
      conn: null,
      bot: new ServerBot(),
      input: emptyInput(),
      respawnT: 0,
      history: [],
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
    }));
    for (const p of this.parts) {
      p.conn?.send({
        t: "start",
        mode: this.mode,
        youId: p.player.id,
        pot: this.pot,
        stake: this.stake,
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
          respawn(p.player, spawnFor(this.mode, seat));
        }
      }

      stepMovement(p.player, p.input, dt);
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

      const compMs = shooter.conn ? LAGCOMP_MS : 0;
      // Only enemies are hittable — no friendly fire, teammates don't block.
      const targets = this.parts
        .filter((p) => p.team !== shooter.team)
        .map((p) => ({
          id: p.player.id,
          feet: this.rewind(p, this.elapsedMs - compMs),
          alive: p.player.alive,
        }));

      const hit = hitscan(shot.origin, shot.dir, targets, shooter.player.id);
      // On a miss, stop the tracer at the wall/box it hits (not 60u through it).
      const wallDist = rayArena(
        shot.origin.x,
        shot.origin.y,
        shot.origin.z,
        shot.dir.x,
        shot.dir.y,
        shot.dir.z,
      );
      const missDist = Number.isFinite(wallDist) ? wallDist : 60;
      const impact = hit
        ? hit.point
        : {
            x: shot.origin.x + shot.dir.x * missDist,
            y: shot.origin.y + shot.dir.y * missDist,
            z: shot.origin.z + shot.dir.z * missDist,
          };

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

      if (hit) {
        const victim = this.parts.find((p) => p.player.id === hit.targetId)!;
        const killed = this.applyDamage(shooter, victim, hit.damage);
        this.broadcast({
          t: "hit",
          by: shooter.player.id,
          target: victim.player.id,
          headshot: hit.headshot,
          damage: hit.damage,
          killed,
        });
      }
    }
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
