import {
  resolveCollision,
  groundHeight,
  rayArena,
  HALF_SIZE,
  type Vec3,
} from "./arena";

// Deterministic player + weapon simulation. The server runs this authoritatively;
// the client runs the SAME code to predict its own player, so corrections are
// tiny. pos.y is the EYE height (feet + EYE).

export const EYE = 1.6;
export const RADIUS = 0.4;
const MOVE_SPEED = 7.2;
const ACCEL = 60;
const AIR_ACCEL = 12;
const FRICTION = 9;
const GRAVITY = 22;
const JUMP = 8;
const MAX_PITCH = Math.PI / 2 - 0.05;

// weapon
export const MAG_SIZE = 60;
export const START_RESERVE = 180;
const DAMAGE = 26;
const HEADSHOT_MULT = 2.2;
const FIRE_RATE = 9;
const RELOAD_TIME = 3;

// Bullet dispersion (radians). First shot standing still is near-pinpoint; the
// recoil *pattern* (client-side view kick) is the main, controllable inaccuracy.
// Random bloom only grows from sustained fire / movement / being airborne.
const BASE_SPREAD = 0.0005; // essentially pinpoint standing still
const MOVE_SPREAD = 0.012; // small run penalty (mobile players move a lot)
const AIR_SPREAD = 0.02; // modest jump penalty
export const BLOOM_PER_SHOT = 0.0012; // tiny per-shot bloom
export const BLOOM_MAX = 0.007; // low cap
export const BLOOM_RECOVER = 0.07; // fast recovery

export interface SimInput {
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  reload: boolean;
}

export interface SimPlayer {
  id: string;
  pos: Vec3; // eye position
  vel: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  alive: boolean;
  health: number;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadT: number;
  recoil: number;
  score: number;
}

export function makePlayer(id: string, feet: [number, number, number]): SimPlayer {
  return {
    id,
    pos: { x: feet[0], y: feet[1] + EYE, z: feet[2] },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: false,
    alive: true,
    health: 100,
    ammo: MAG_SIZE,
    reserve: START_RESERVE,
    cooldown: 0,
    reloadT: 0,
    recoil: 0,
    score: 0,
  };
}

export function respawn(p: SimPlayer, feet: [number, number, number]): void {
  p.pos = { x: feet[0], y: feet[1] + EYE, z: feet[2] };
  p.vel = { x: 0, y: 0, z: 0 };
  p.health = 100;
  p.alive = true;
  p.ammo = MAG_SIZE;
  p.reserve = START_RESERVE;
  p.cooldown = 0;
  p.reloadT = 0;
}

export function stepMovement(p: SimPlayer, input: SimInput, dt: number): void {
  if (!p.alive) return;
  p.yaw = input.yaw;
  p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));

  const sinY = Math.sin(p.yaw);
  const cosY = Math.cos(p.yaw);
  // wish direction (flat), mirrors client Player
  let wx = -sinY * input.moveY + cosY * input.moveX;
  let wz = -cosY * input.moveY - sinY * input.moveX;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }

  const a = p.grounded ? ACCEL : AIR_ACCEL;

  if (p.grounded) {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0) {
      const drop = speed * FRICTION * dt;
      const f = Math.max(speed - drop, 0) / speed;
      p.vel.x *= f;
      p.vel.z *= f;
    }
  }

  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = MOVE_SPEED - cur;
  if (add > 0) {
    const accelSpeed = Math.min(a * dt * MOVE_SPEED, add);
    p.vel.x += wx * accelSpeed;
    p.vel.z += wz * accelSpeed;
  }

  if (input.jump && p.grounded) {
    p.vel.y = JUMP;
    p.grounded = false;
  }

  p.vel.y -= GRAVITY * dt;

  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.pos.y += p.vel.y * dt;

  resolveCollision(p.pos, RADIUS);

  const lim = HALF_SIZE - RADIUS - 0.6;
  p.pos.x = Math.max(-lim, Math.min(lim, p.pos.x));
  p.pos.z = Math.max(-lim, Math.min(lim, p.pos.z));

  const ground = groundHeight(p.pos.x, p.pos.z);
  const feetTarget = ground + EYE;
  if (p.pos.y <= feetTarget) {
    p.pos.y = feetTarget;
    p.vel.y = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }
}

export function stepWeapon(p: SimPlayer, input: SimInput, dt: number): void {
  if (p.cooldown > 0) p.cooldown -= dt;
  if (input.reload) startReload(p);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      const need = MAG_SIZE - p.ammo;
      const take = Math.min(need, p.reserve);
      p.ammo += take;
      p.reserve -= take;
    }
  }
  p.recoil = Math.max(0, p.recoil - dt * BLOOM_RECOVER); // bloom recovers
}

export function startReload(p: SimPlayer): void {
  if (p.reloadT > 0 || p.ammo === MAG_SIZE || p.reserve <= 0) return;
  p.reloadT = RELOAD_TIME;
}

export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// Returns muzzle origin + shot direction if the player can fire this tick, else
// null. Mutates ammo/cooldown/recoil. `rand` is a 0..1 supplier so the server
// can keep spread deterministic per-tick if desired.
export function doFire(
  p: SimPlayer,
  rand: () => number,
): { origin: Vec3; dir: Vec3 } | null {
  if (!p.alive || p.cooldown > 0 || p.reloadT > 0) return null;
  if (p.ammo <= 0) {
    startReload(p);
    return null;
  }
  p.ammo--;
  p.cooldown = 1 / FIRE_RATE;
  p.recoil = Math.min(p.recoil + BLOOM_PER_SHOT, BLOOM_MAX); // bloom grows

  const d = dirFromAngles(p.yaw, p.pitch);
  applySpread(d, spreadFor(p), rand);
  return { origin: { ...p.pos }, dir: d };
}

// Total random dispersion (radians) for a shot: near-zero standing still, more
// while moving/airborne, plus accumulated bloom from sustained fire.
export function spreadValue(moveSpeed: number, airborne: boolean, bloom: number): number {
  const moveP = Math.min(moveSpeed / MOVE_SPEED, 1) * MOVE_SPREAD;
  const airP = airborne ? AIR_SPREAD : 0;
  return BASE_SPREAD + moveP + airP + bloom;
}

export function spreadFor(p: SimPlayer): number {
  return spreadValue(Math.hypot(p.vel.x, p.vel.z), !p.grounded, p.recoil);
}

// Offset a normalized direction within a cone of half-angle `spread`, using a
// uniform disk perpendicular to the direction (a proper cone, not per-axis box).
export function applySpread(d: Vec3, spread: number, rand: () => number): void {
  if (spread <= 1e-6) return;
  const up = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = d.y * up.z - d.z * up.y;
  let ry = d.z * up.x - d.x * up.z;
  let rz = d.x * up.y - d.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * d.z - rz * d.y;
  const uy = rz * d.x - rx * d.z;
  const uz = rx * d.y - ry * d.x;
  const ang = rand() * Math.PI * 2;
  const rad = Math.sqrt(rand()) * spread;
  const ox = Math.cos(ang) * rad;
  const oy = Math.sin(ang) * rad;
  d.x += rx * ox + ux * oy;
  d.y += ry * ox + uy * oy;
  d.z += rz * ox + uz * oy;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  d.x /= l;
  d.y /= l;
  d.z /= l;
}

// Feet position of a player (for building hitboxes at a rewound time).
export function feetOf(p: SimPlayer): Vec3 {
  return { x: p.pos.x, y: p.pos.y - EYE, z: p.pos.z };
}

export interface HitboxState {
  id: string;
  feet: Vec3;
  alive: boolean;
}

export interface HitscanResult {
  targetId: string;
  headshot: boolean;
  dist: number;
  point: Vec3;
  damage: number;
}

// Authoritative hitscan: ray vs each target's head+body spheres, blocked by
// arena walls. `targets` are the (possibly lag-compensated) positions.
export function hitscan(
  origin: Vec3,
  dir: Vec3,
  targets: HitboxState[],
  excludeId: string,
): HitscanResult | null {
  const wallDist = rayArena(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);

  let best: HitscanResult | null = null;
  for (const tgt of targets) {
    if (!tgt.alive || tgt.id === excludeId) continue;
    // head sphere then body sphere
    const headC = { x: tgt.feet.x, y: tgt.feet.y + 1.75, z: tgt.feet.z };
    const bodyC = { x: tgt.feet.x, y: tgt.feet.y + 0.9, z: tgt.feet.z };
    const tHead = raySphere(origin, dir, headC, 0.32);
    const tBody = raySphere(origin, dir, bodyC, 0.55);

    let t = Infinity;
    let headshot = false;
    if (tHead >= 0 && tHead < t) {
      t = tHead;
      headshot = true;
    }
    if (tBody >= 0 && tBody < t) {
      t = tBody;
      headshot = false;
    }
    if (t === Infinity || t >= wallDist) continue; // blocked by wall or miss
    if (!best || t < best.dist) {
      best = {
        targetId: tgt.id,
        headshot,
        dist: t,
        point: {
          x: origin.x + dir.x * t,
          y: origin.y + dir.y * t,
          z: origin.z + dir.z * t,
        },
        damage: DAMAGE * (headshot ? HEADSHOT_MULT : 1),
      };
    }
  }
  return best;
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t;
}

export { DAMAGE, HEADSHOT_MULT, FIRE_RATE, RELOAD_TIME };
