// Single source of truth for the arena geometry. Both the client (builds meshes
// from this) and the server (uses it for authoritative collision + hitscan) read
// the SAME box list, so what you see and what the server simulates never drift.
//
// Each box is [centerX, centerY, centerZ, width, height, depth]. Pure math only,
// no THREE — runs identically in the browser and in Node.

export type Box6 = [number, number, number, number, number, number];

export const HALF_SIZE = 24;

export const BOXES: Box6[] = [
  // perimeter walls (h=6, t=1, s=24)
  [0, 3, -24, 48, 6, 1],
  [0, 3, 24, 48, 6, 1],
  [-24, 3, 0, 1, 6, 48],
  [24, 3, 0, 1, 6, 48],
  // cover crates
  [-8, 1.1, -8, 3, 2.2, 3],
  [8, 1.1, 8, 3, 2.2, 3],
  [8, 1.1, -8, 3, 2.2, 3],
  [-8, 1.1, 8, 3, 2.2, 3],
  [0, 0.7, 0, 6, 1.4, 6],
  [-14, 1.5, 0, 2, 3, 6],
  [14, 1.5, 0, 2, 3, 6],
  [-11, 1.5, -15, 4, 3, 2],
  [11, 1.5, 15, 4, 3, 2],
  // raised platforms
  [-16, 1.5, -16, 8, 3, 8],
  [16, 1.5, 16, 8, 3, 8],
];

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const COLLIDERS: AABB[] = BOXES.map(([x, y, z, w, h, d]) => ({
  minX: x - w / 2,
  minY: y - h / 2,
  minZ: z - d / 2,
  maxX: x + w / 2,
  maxY: y + h / 2,
  maxZ: z + d / 2,
}));

// Duel spawn points (feet positions; eye = +eyeHeight).
export const SPAWNS: [number, number, number][] = [
  [0, 0, 20],
  [0, 0, -12],
  [-18, 0, 18],
  [18, 0, -18],
  [0, 0, -18],
];

// Team battle: team 0 spawns on the +z side, team 1 on the -z side (5 each).
export const TEAM_SPAWNS: [number, number, number][][] = [
  [
    [-11, 0, 19],
    [-5.5, 0, 20],
    [0, 0, 19],
    [5.5, 0, 20],
    [11, 0, 19],
  ],
  [
    [-11, 0, -17],
    [-5.5, 0, -18],
    [0, 0, -17],
    [5.5, 0, -18],
    [11, 0, -17],
  ],
];

// Spawn (feet) for a given mode + seat index. Shared so client and server agree.
export function spawnFor(mode: string, seat: number): [number, number, number] {
  if (mode === "duel") return SPAWNS[seat % SPAWNS.length];
  const team = seat < 5 ? 0 : 1;
  return TEAM_SPAWNS[team][seat % 5];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Horizontal circle-vs-AABB resolution; mutates pos.x/pos.z.
export function resolveCollision(pos: Vec3, radius: number): void {
  for (const b of COLLIDERS) {
    if (pos.y > b.maxY + 0.1 || pos.y < b.minY - 1.5) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius && d2 > 1e-6) {
      const dist = Math.sqrt(d2);
      const push = (radius - dist) / dist;
      pos.x += dx * push;
      pos.z += dz * push;
    }
  }
}

// Height of the surface under (x,z): top of the tallest low box we stand over.
export function groundHeight(x: number, z: number): number {
  let h = 0;
  for (const b of COLLIDERS) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      if (b.maxY > h && b.maxY < 4.5) h = b.maxY;
    }
  }
  return h;
}

// Ray vs all arena AABBs → nearest hit distance along dir (or Infinity).
// dir must be normalized. Slab method.
export function rayArena(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  let best = Infinity;
  for (const b of COLLIDERS) {
    const t = raySlab(ox, oy, oz, dx, dy, dz, b);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

function raySlab(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: AABB,
): number {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
