// Wire protocol shared by client and server. Deterministic constants live here
// so both sides simulate identically.
import type { WeaponId } from "./weapons";

export const TICK_HZ = 30; // authoritative simulation rate
export const SNAPSHOT_HZ = 20; // state broadcast rate
export const TICK_DT = 1 / TICK_HZ;

export type Mode = "duel" | "elimination";

export const SEATS: Record<Mode, number> = { duel: 2, elimination: 10 };
export const TEAM_SIZE: Record<Mode, number> = { duel: 1, elimination: 5 };
export const DUEL_TARGET = 5; // frags to win a duel

// ---- client → server ----
export interface JoinMsg {
  t: "join";
  mode: Mode;
  stake: number;
  name: string;
  wallet?: string; // player's TON address (for on-chain payout), if connected
  weapon?: WeaponId; // chosen loadout (defaults to rifle)
  map?: number; // chosen map id; omit for "random"
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
  sprint: boolean; // faster move, worse accuracy
  crouch: boolean; // slower move, tighter spread, lower profile
  ads: boolean; // aim-down-sights: tighter spread (zoom is client-side)
  throwNade: boolean; // edge-triggered grenade throw
}

export interface CreateRoomMsg {
  t: "createRoom";
  mode: Mode;
  stake: number;
  name: string;
  wallet?: string;
  weapon?: WeaponId;
  map?: number; // host's chosen map; omit for random
}

export interface JoinRoomMsg {
  t: "joinRoom";
  code: string;
  name: string;
  wallet?: string;
  weapon?: WeaponId;
}

export interface ReadyMsg {
  t: "ready";
  ready: boolean;
}

export interface StartRoomMsg {
  t: "startRoom";
}

export interface LeaveRoomMsg {
  t: "leaveRoom";
}

export interface ChatMsg {
  t: "chat";
  text: string;
}

// Client → server: "I've broadcast my deposit transaction." A hint to poll the
// contract sooner; the server still verifies funding on-chain and never trusts
// this message to move money.
export interface DepositedMsg {
  t: "deposited";
}

export type ClientMsg =
  | JoinMsg
  | InputMsg
  | CreateRoomMsg
  | JoinRoomMsg
  | ReadyMsg
  | StartRoomMsg
  | LeaveRoomMsg
  | ChatMsg
  | DepositedMsg;

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
  mapId: number; // which arena to build
  players: { id: string; name: string; bot: boolean; team: number; weapon: WeaponId }[];
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
  team: number;
  ads: boolean; // aiming down sights (for the "enemy is aiming" indicator)
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

// Server → client: a grenade was thrown. Clients render + integrate the arc
// deterministically (same gravity) until the boom event lands.
export interface NadeThrowMsg {
  t: "nade";
  id: number;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number; // seconds until detonation
}

// Server → client: a grenade detonated at a point (FX + sound).
export interface NadeBoomMsg {
  t: "boom";
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface RoomJoinedMsg {
  t: "roomJoined";
  code: string;
  youId: string;
  host: boolean;
  mode: Mode;
  stake: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  ready: boolean;
  host: boolean;
}

export interface RoomStateMsg {
  t: "roomState";
  code: string;
  players: RoomPlayer[];
  canStart: boolean;
  weapon: WeaponId; // everyone plays the host's weapon
  mapId: number; // the map the room will play
}

export interface RoomErrorMsg {
  t: "roomError";
  reason: string;
}

export interface ChatEventMsg {
  t: "chatMsg";
  name: string;
  text: string;
  team: number;
}

// Server → client: a staked match has formed; every player must deposit their
// stake into the escrow contract for this matchId before the match starts.
export interface FundMatchMsg {
  t: "fund";
  matchId: string; // on-chain uint64 as a decimal string
  escrow: string; // escrow contract address (friendly form)
  stake: number; // TON each player must deposit
  seats: number; // players expected to fund
  deadlineMs: number; // epoch ms; unfunded seats are cancelled + refunded after
}

// Server → client: funding progress while we wait for everyone to deposit.
export interface FundStatusMsg {
  t: "fundStatus";
  funded: number; // deposits confirmed on-chain so far
  seats: number;
}

// Server → client: funding did not complete (timeout / player dropped); any
// deposits already made are refunded on-chain by the oracle.
export interface FundFailedMsg {
  t: "fundFailed";
  reason: string;
}

export type ServerMsg =
  | WelcomeMsg
  | MatchStartMsg
  | SnapshotMsg
  | HitEventMsg
  | ShotEventMsg
  | MatchEndMsg
  | RoomJoinedMsg
  | RoomStateMsg
  | RoomErrorMsg
  | ChatEventMsg
  | FundMatchMsg
  | FundStatusMsg
  | FundFailedMsg
  | NadeThrowMsg
  | NadeBoomMsg;

export const RAKE = 0.05;
