// Single source of truth for arena geometry. Both the client (builds meshes from
// this) and the server (authoritative collision + hitscan) read the SAME box
// lists, so what you see and what the server simulates never drift.
//
// Multiple maps: each map is a list of typed boxes + spawn points. All maps share
// the same perimeter + HALF_SIZE; only the interior cover + spawns differ. The
// server picks a map per match and tells clients its id in MatchStart. Collision
// functions take a map's colliders so concurrent rooms on different maps are safe.
//
// Box = [centerX, centerY, centerZ, width, height, depth]. Pure math only.

export type Box6 = [number, number, number, number, number, number];
export type BoxKind = "wall" | "crate" | "ammo" | "barrier" | "container" | "platform";

export const HALF_SIZE = 24;

export interface MapBox {
  b: Box6;
  kind: BoxKind;
}

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface GameMap {
  id: number;
  name: string;
  half: number; // half arena size (bigger = larger map)
  boxes: MapBox[];
  colliders: AABB[]; // derived
  spawns: [number, number, number][]; // duel
  teamSpawns: [number, number, number][][]; // [team0[], team1[]]
}

function toAABB([x, y, z, w, h, d]: Box6): AABB {
  return { minX: x - w / 2, minY: y - h / 2, minZ: z - d / 2, maxX: x + w / 2, maxY: y + h / 2, maxZ: z + d / 2 };
}

// Perimeter walls scaled to a map's half size.
function wallsFor(half: number): MapBox[] {
  const s = half * 2;
  return [
    { b: [0, 3, -half, s, 6, 1], kind: "wall" },
    { b: [0, 3, half, s, 6, 1], kind: "wall" },
    { b: [-half, 3, 0, 1, 6, s], kind: "wall" },
    { b: [half, 3, 0, 1, 6, s], kind: "wall" },
  ];
}

// Team spawns are always 5 on the +z side (team 0) and 5 on the -z side (team 1).
const TEAM_ROWS: [number, number, number][][] = [
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

// Duel spawn 0 and 1 face each other down the clear central lane on every map.
const DUEL_A: [number, number, number] = [0, 0, 20];
const DUEL_B: [number, number, number] = [0, 0, -20];

function makeMap(
  id: number,
  name: string,
  interior: MapBox[],
  extraDuel: [number, number, number][] = [],
  opts: { half?: number; spawns?: [number, number, number][]; teamSpawns?: [number, number, number][][] } = {},
): GameMap {
  const half = opts.half ?? 24;
  const boxes = [...wallsFor(half), ...interior];
  return {
    id,
    name,
    half,
    boxes,
    colliders: boxes.map((mb) => toAABB(mb.b)),
    spawns: opts.spawns ?? [DUEL_A, DUEL_B, ...extraDuel],
    teamSpawns: opts.teamSpawns ?? TEAM_ROWS,
  };
}

// --- Map 0: DEPOT — the classic. Corner crates, central low ammo cover, side
// containers, back platforms. Symmetric. Keeps the original layout.
const DEPOT = makeMap(
  0,
  "Depot",
  [
    { b: [-8, 1.1, -8, 3, 2.2, 3], kind: "crate" },
    { b: [8, 1.1, 8, 3, 2.2, 3], kind: "crate" },
    { b: [8, 1.1, -8, 3, 2.2, 3], kind: "crate" },
    { b: [-8, 1.1, 8, 3, 2.2, 3], kind: "crate" },
    { b: [0, 0.7, 0, 6, 1.4, 6], kind: "ammo" },
    { b: [-14, 1.5, 0, 2, 3, 6], kind: "container" },
    { b: [14, 1.5, 0, 2, 3, 6], kind: "container" },
    { b: [-11, 1.5, -15, 4, 3, 2], kind: "barrier" },
    { b: [11, 1.5, 15, 4, 3, 2], kind: "barrier" },
    { b: [-16, 1.5, -16, 8, 3, 8], kind: "platform" },
    { b: [16, 1.5, 16, 8, 3, 8], kind: "platform" },
  ],
  [
    [-18, 0, 18],
    [18, 0, -18],
  ],
);

// --- Map 1: FORTRESS — a dominant tall structure owns the centre, so the whole
// fight is about flanking around it. Nothing like Depot's open middle. Corner
// nests + side walls. Mirror-symmetric.
const FORTRESS = makeMap(
  1,
  "Fortress",
  [
    // central keep (tall — blocks all sightlines through the middle)
    { b: [0, 1.5, 0, 9, 3, 9], kind: "platform" },
    // approach cover on the two open faces
    { b: [0, 1.1, -13, 6, 2.2, 2], kind: "crate" },
    { b: [0, 1.1, 13, 6, 2.2, 2], kind: "crate" },
    // side gate walls
    { b: [-13, 1.5, 0, 2, 3, 7], kind: "container" },
    { b: [13, 1.5, 0, 2, 3, 7], kind: "container" },
    // corner nests (tall containers) — high-ground angles onto the keep
    { b: [-17, 1.5, 13, 4, 3, 4], kind: "container" },
    { b: [17, 1.5, -13, 4, 3, 4], kind: "container" },
    { b: [17, 1.5, 13, 4, 3, 4], kind: "barrier" },
    { b: [-17, 1.5, -13, 4, 3, 4], kind: "barrier" },
    // diagonal low bumps near the keep corners
    { b: [-8, 1.1, 8, 2, 2.2, 2], kind: "ammo" },
    { b: [8, 1.1, -8, 2, 2.2, 2], kind: "ammo" },
  ],
);

// --- Map 2: MAZE — parallel rows of tall shipping containers form winding
// corridors: tight, close-quarters, broken sightlines everywhere. The opposite
// of Depot's open floor. Mirror-symmetric; spawn rows kept clear.
const MAZE = makeMap(
  2,
  "Maze",
  [
    // long flank corridors
    { b: [-11, 1.5, -3, 3, 3, 12], kind: "container" },
    { b: [11, 1.5, 3, 3, 3, 12], kind: "container" },
    // inner staggered blocks
    { b: [-4, 1.5, 8, 3, 3, 8], kind: "container" },
    { b: [4, 1.5, -8, 3, 3, 8], kind: "container" },
    { b: [4, 1.5, 9, 3, 3, 6], kind: "container" },
    { b: [-4, 1.5, -9, 3, 3, 6], kind: "container" },
    // outer nooks
    { b: [-13, 1.1, 9, 3, 2.2, 3], kind: "crate" },
    { b: [13, 1.1, -9, 3, 2.2, 3], kind: "crate" },
    { b: [-8, 1.1, -2, 3, 2.2, 3], kind: "crate" },
    { b: [8, 1.1, 2, 3, 2.2, 3], kind: "crate" },
    // central pillar
    { b: [0, 1.5, 0, 3, 3, 5], kind: "barrier" },
  ],
);

// --- Map 3: COMPOUND — a BIG open arena built for 5v5. Twice the footprint of
// the others (half 36 → 72×72), long lanes, a central building cluster, mid-field
// cover, and team spawns pushed far apart. Mirror-symmetric.
const COMPOUND = makeMap(
  3,
  "Compound",
  [
    // central building cluster (a plus)
    { b: [0, 1.5, 0, 12, 3, 4], kind: "container" },
    { b: [0, 1.5, 0, 4, 3, 12], kind: "container" },
    // inner flank structures
    { b: [-15, 1.5, 0, 3, 3, 9], kind: "container" },
    { b: [15, 1.5, 0, 3, 3, 9], kind: "container" },
    // mid-field platforms between spawns and centre
    { b: [0, 1.5, 21, 7, 3, 3], kind: "platform" },
    { b: [0, 1.5, -21, 7, 3, 3], kind: "platform" },
    // diagonal barriers
    { b: [-17, 1.5, 16, 4, 3, 4], kind: "barrier" },
    { b: [17, 1.5, -16, 4, 3, 4], kind: "barrier" },
    { b: [17, 1.5, 16, 4, 3, 4], kind: "barrier" },
    { b: [-17, 1.5, -16, 4, 3, 4], kind: "barrier" },
    // outer lane walls
    { b: [-26, 1.5, 8, 2, 3, 12], kind: "container" },
    { b: [26, 1.5, -8, 2, 3, 12], kind: "container" },
    { b: [26, 1.5, 8, 2, 3, 12], kind: "container" },
    { b: [-26, 1.5, -8, 2, 3, 12], kind: "container" },
    // forward crates near spawns
    { b: [-10, 1.1, 26, 3, 2.2, 3], kind: "crate" },
    { b: [10, 1.1, -26, 3, 2.2, 3], kind: "crate" },
    { b: [10, 1.1, 26, 3, 2.2, 3], kind: "crate" },
    { b: [-10, 1.1, -26, 3, 2.2, 3], kind: "crate" },
    // corner cover
    { b: [-28, 1.1, 28, 3, 2.2, 3], kind: "crate" },
    { b: [28, 1.1, -28, 3, 2.2, 3], kind: "crate" },
  ],
  [],
  {
    half: 36,
    spawns: [
      [0, 0, 32],
      [0, 0, -32],
      [-28, 0, 30],
      [28, 0, -30],
    ],
    teamSpawns: [
      [
        [-16, 0, 31],
        [-8, 0, 32],
        [0, 0, 31],
        [8, 0, 32],
        [16, 0, 31],
      ],
      [
        [-16, 0, -31],
        [-8, 0, -32],
        [0, 0, -31],
        [8, 0, -32],
        [16, 0, -31],
      ],
    ],
  },
);

export const MAPS: GameMap[] = [DEPOT, FORTRESS, MAZE, COMPOUND];

export function mapById(id: number): GameMap {
  return MAPS[id] ?? MAPS[0];
}

// Spawn (feet) for a map + mode + seat index. Shared so client and server agree.
export function spawnFor(map: GameMap, mode: string, seat: number): [number, number, number] {
  if (mode === "duel") return map.spawns[seat % map.spawns.length];
  const team = seat < 5 ? 0 : 1;
  return map.teamSpawns[team][seat % 5];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Horizontal circle-vs-AABB resolution; mutates pos.x/pos.z.
export function resolveCollision(pos: Vec3, radius: number, colliders: AABB[]): void {
  for (const b of colliders) {
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
export function groundHeight(x: number, z: number, colliders: AABB[]): number {
  let h = 0;
  for (const b of colliders) {
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
  colliders: AABB[],
): number {
  let best = Infinity;
  for (const b of colliders) {
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
