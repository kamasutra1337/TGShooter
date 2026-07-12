import { Room, type Conn } from "./Room";
import type { InputMsg, Mode } from "../../shared/protocol";
import { DEFAULT_WEAPON, type WeaponId } from "../../shared/weapons";
import { MAPS } from "../../shared/arena";

// Random map per match, or a fixed one via MAP_ID (for deterministic tests).
function pickMapId(): number {
  const env = process.env.MAP_ID;
  if (env != null && env !== "") return Math.max(0, Math.min(MAPS.length - 1, Number(env)));
  return Math.floor(Math.random() * MAPS.length);
}
import type { EscrowService } from "./ton/EscrowService";
import type { FundingCoordinator, FundingSession } from "./Funding";
import type { Leaderboard } from "./Leaderboard";

// Groups queued players into rooms by (mode, stake).
//
//  • Free matches (stake = 0, or no escrow configured): a room starts as soon as
//    it has enough humans, or after a short wait bots fill the empty seats so a
//    solo player never waits forever.
//  • Staked matches (stake > 0 with escrow live): NO bots — real TON is on the
//    line, so we wait for a full room of humans, then run the on-chain funding
//    phase; the match only starts once every player has deposited.
const FILL_TIMEOUT_MS = 4000;

export class Matchmaker {
  private pending = new Map<string, Room>(); // key `${mode}:${stake}` → filling room
  private roomOf = new Map<string, Room>(); // connId → room (routing)
  private fillTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private funders = new Map<string, FundingSession>(); // connId → active funding
  private seq = 0;
  private chainSeq: bigint;
  private escrow: EscrowService;
  private funding: FundingCoordinator | null;
  private leaderboard: Leaderboard;

  constructor(
    escrow: EscrowService,
    leaderboard: Leaderboard,
    funding: FundingCoordinator | null = null,
  ) {
    this.escrow = escrow;
    this.leaderboard = leaderboard;
    this.funding = funding;
    // Seed the on-chain match id from wall-clock so ids stay unique across
    // server restarts (a fresh counter would reuse ids the contract has seen).
    this.chainSeq = BigInt(Date.now());
  }

  private staked(stake: number): boolean {
    return stake > 0 && this.funding != null && this.escrow.enabled;
  }

  join(
    conn: Conn,
    mode: Mode,
    stake: number,
    name: string,
    wallet?: string,
    weapon?: WeaponId,
  ): void {
    const staked = this.staked(stake);
    // A staked seat needs a wallet to deposit from; refuse and let the client
    // prompt a connect rather than silently trapping the player in funding.
    if (staked && !wallet) {
      conn.send({ t: "fundFailed", reason: "connect a TON wallet to play for a stake" });
      return;
    }

    // Match by weapon too: you only ever face the same weapon you queued with
    // (no sniper-vs-shotgun). Bots in this room use it as well.
    const wpn = weapon ?? DEFAULT_WEAPON;
    const key = `${mode}:${stake}:${wpn}`;
    let room = this.pending.get(key);
    if (!room) {
      const chainMatchId = ++this.chainSeq;
      room = new Room("room-" + ++this.seq, mode, stake, chainMatchId, this.escrow, this.leaderboard, () => {
        for (const [id, r] of this.roomOf) if (r === room) this.roomOf.delete(id);
      }, wpn, pickMapId());
      this.pending.set(key, room);
      // Only free matches fall back to bots; staked matches wait for humans.
      if (!staked) {
        this.fillTimers.set(key, setTimeout(() => this.startRoom(key), FILL_TIMEOUT_MS));
      }
    }

    room.addHuman(conn, name, wallet, weapon);
    this.roomOf.set(conn.id, room);

    if (room.full) {
      if (staked) this.beginFunding(key);
      else this.startRoom(key);
    }
  }

  private startRoom(key: string): void {
    const room = this.pending.get(key);
    if (!room) return;
    this.pending.delete(key);
    const timer = this.fillTimers.get(key);
    if (timer) clearTimeout(timer);
    this.fillTimers.delete(key);
    room.start();
  }

  // Full room of humans + a live escrow → collect deposits, then start.
  private beginFunding(key: string): void {
    const room = this.pending.get(key);
    if (!room || !this.funding) return;
    this.pending.delete(key);
    const timer = this.fillTimers.get(key);
    if (timer) clearTimeout(timer);
    this.fillTimers.delete(key);

    const session = this.funding.create(room);
    const ids = room.humans.map((h) => h.id);
    for (const id of ids) this.funders.set(id, session);
    void session.run().finally(() => {
      for (const id of ids) if (this.funders.get(id) === session) this.funders.delete(id);
    });
  }

  routeInput(id: string, msg: InputMsg): void {
    this.roomOf.get(id)?.setInput(id, msg);
  }

  chat(id: string, text: string): void {
    this.roomOf.get(id)?.chat(id, text);
  }

  // Client hint that it broadcast its deposit — poll the contract promptly.
  deposited(id: string): void {
    this.funders.get(id)?.noteDeposit();
  }

  leave(id: string): void {
    // Leaving mid-funding aborts the whole match (everyone gets refunded).
    const session = this.funders.get(id);
    if (session) {
      this.funders.delete(id);
      session.abort();
      return;
    }
    const room = this.roomOf.get(id);
    if (!room) return;
    room.removeHuman(id);
    this.roomOf.delete(id);
  }
}
