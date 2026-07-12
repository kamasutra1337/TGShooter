import {
  resolveCollision,
  groundHeight,
  rayArena,
  HALF_SIZE,
  type Vec3,
} from "./arena";
import {
  WEAPONS,
  weaponOf,
  falloffMult,
  DEFAULT_WEAPON,
  type WeaponId,
  type WeaponSpec,
} from "./weapons";

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

// Weapon behaviour now lives in shared/weapons.ts, keyed by SimPlayer.weaponId.
// A sensible default mag size for any code that needs one before a player exists.
export const MAG_SIZE = WEAPONS[DEFAULT_WEAPON].magSize;

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
  weaponId: WeaponId;
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

export function makePlayer(
  id: string,
  feet: [number, number, number],
  weaponId: WeaponId = DEFAULT_WEAPON,
): SimPlayer {
  const spec = weaponOf(weaponId);
  return {
    id,
    weaponId: spec.id,
    pos: { x: feet[0], y: feet[1] + EYE, z: feet[2] },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: false,
    alive: true,
    health: 100,
    ammo: spec.magSize,
    reserve: spec.reserve,
    cooldown: 0,
    reloadT: 0,
    recoil: 0,
    score: 0,
  };
}

export function respawn(p: SimPlayer, feet: [number, number, number]): void {
  const spec = weaponOf(p.weaponId);
  p.pos = { x: feet[0], y: feet[1] + EYE, z: feet[2] };
  p.vel = { x: 0, y: 0, z: 0 };
  p.health = 100;
  p.alive = true;
  p.ammo = spec.magSize;
  p.reserve = spec.reserve;
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
  const spec = weaponOf(p.weaponId);
  if (p.cooldown > 0) p.cooldown -= dt;
  if (input.reload) startReload(p);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      const need = spec.magSize - p.ammo;
      const take = Math.min(need, p.reserve);
      p.ammo += take;
      p.reserve -= take;
    }
  }
  p.recoil = Math.max(0, p.recoil - dt * spec.bloomRecover); // bloom recovers
}

export function startReload(p: SimPlayer): void {
  const spec = weaponOf(p.weaponId);
  if (p.reloadT > 0 || p.ammo === spec.magSize || p.reserve <= 0) return;
  p.reloadT = spec.reloadTime;
}

export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// Returns muzzle origin + one direction PER PELLET if the player can fire this
// tick (1 for most guns, N for the shotgun), else null. Mutates ammo/cooldown/
// recoil. `rand` is a 0..1 supplier so the server can keep spread deterministic.
export function doFire(
  p: SimPlayer,
  rand: () => number,
): { origin: Vec3; dirs: Vec3[] } | null {
  if (!p.alive || p.cooldown > 0 || p.reloadT > 0) return null;
  if (p.ammo <= 0) {
    startReload(p);
    return null;
  }
  const spec = weaponOf(p.weaponId);
  p.ammo--;
  p.cooldown = 1 / spec.fireRate;
  p.recoil = Math.min(p.recoil + spec.bloomPerShot, spec.bloomMax); // bloom grows

  // Aim wobble (movement/bloom) is applied to the centre line; each pellet then
  // scatters within the weapon's pellet cone around it.
  const centre = dirFromAngles(p.yaw, p.pitch);
  applySpread(centre, spreadFor(p), rand);

  const dirs: Vec3[] = [];
  for (let i = 0; i < spec.pellets; i++) {
    const d = { ...centre };
    if (spec.pelletSpread > 0) applySpread(d, spec.pelletSpread, rand);
    dirs.push(d);
  }
  return { origin: { ...p.pos }, dirs };
}

// Total random dispersion (radians) for a shot: near-zero standing still, more
// while moving/airborne, plus accumulated bloom from sustained fire.
export function spreadValue(
  spec: WeaponSpec,
  moveSpeed: number,
  airborne: boolean,
  bloom: number,
): number {
  const moveP = Math.min(moveSpeed / MOVE_SPEED, 1) * spec.moveSpread;
  const airP = airborne ? spec.airSpread : 0;
  return spec.baseSpread + moveP + airP + bloom;
}

export function spreadFor(p: SimPlayer): number {
  return spreadValue(weaponOf(p.weaponId), Math.hypot(p.vel.x, p.vel.z), !p.grounded, p.recoil);
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
// arena walls. `targets` are the (possibly lag-compensated) positions. Damage
// comes from the shooter's weapon spec, scaled by distance falloff.
export function hitscan(
  origin: Vec3,
  dir: Vec3,
  targets: HitboxState[],
  excludeId: string,
  spec: WeaponSpec,
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
        damage: spec.damage * (headshot ? spec.headMult : 1) * falloffMult(spec, t),
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

