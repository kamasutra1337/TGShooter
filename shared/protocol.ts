// Wire protocol shared by client and server. Deterministic constants live here
// so both sides simulate identically.

export const TICK_HZ = 30; // authoritative simulation rate
export const SNAPSHOT_HZ = 20; // state broadcast rate
export const TICK_DT = 1 / TICK_HZ;

export type Mode = "duel" | "elimination";

export const SEATS: Record<Mode, number> = { duel: 2, elimination: 5 };
export const DUEL_TARGET = 5; // frags to win a duel

// ---- client → server ----
export interface JoinMsg {
  t: "join";
  mode: Mode;
  stake: number;
  name: string;
}

export interface InputMsg {
  t: "input";
  seq: number; // client input sequence (for reconciliation)
  moveX: number; // -1..1 strafe
  moveY: number; // -1..1 forward
  yaw: number; // absolute aim yaw (client-authoritative aim)
  pitch: number; // absolute aim pitch
  fire: boolean;
  jump: boolean;
  reload: boolean;
}

export type ClientMsg = JoinMsg | InputMsg;

// ---- server → client ----
export interface WelcomeMsg {
  t: "welcome";
  id: string;
}

export interface MatchStartMsg {
  t: "start";
  mode: Mode;
  youId: string;
  pot: number;
  stake: number;
  players: { id: string; name: string; bot: boolean }[];
}

export interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
  score: number;
  ammo: number;
  reserve: number;
}

export interface SnapshotMsg {
  t: "snap";
  tick: number;
  ackSeq: number; // last input seq the server processed for this client
  players: PlayerSnap[];
}

export interface HitEventMsg {
  t: "hit";
  by: string; // shooter id
  target: string;
  headshot: boolean;
  damage: number;
  killed: boolean;
}

export interface ShotEventMsg {
  t: "shot";
  by: string;
  ox: number;
  oy: number;
  oz: number; // muzzle origin
  hx: number;
  hy: number;
  hz: number; // impact point
}

export interface MatchEndMsg {
  t: "end";
  winnerId: string | null;
  youWon: boolean;
  pot: number;
  payout: number; // pot * (1 - rake), 0 if you lost
}

export type ServerMsg =
  | WelcomeMsg
  | MatchStartMsg
  | SnapshotMsg
  | HitEventMsg
  | ShotEventMsg
  | MatchEndMsg;

export const RAKE = 0.05;
