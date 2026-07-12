// Weapon arsenal — shared by client and server so gunplay is identical on both.
// Each match a player picks ONE weapon; its spec drives damage, fire rate, mag,
// spread, pellet count and distance falloff. The server is authoritative; the
// client uses the same numbers for prediction + viewmodel feel.

export type WeaponId = "rifle" | "smg" | "sniper" | "shotgun";
export const WEAPON_IDS: WeaponId[] = ["rifle", "smg", "sniper", "shotgun"];
export const DEFAULT_WEAPON: WeaponId = "rifle";

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  blurb: string; // one-line pitch for the loadout card
  // combat
  damage: number; // per bullet/pellet, to the body
  headMult: number; // headshot multiplier
  fireRate: number; // trigger pulls per second
  pellets: number; // rays per trigger pull (shotgun > 1)
  magSize: number;
  reserve: number;
  reloadTime: number; // seconds
  auto: boolean; // hold-to-fire (true) vs semi-auto tap (false)
  // dispersion (radians)
  baseSpread: number; // standing still, first shot
  moveSpread: number; // added at full run
  airSpread: number; // added while airborne
  pelletSpread: number; // per-pellet cone width (shotgun)
  bloomPerShot: number; // random bloom growth per shot
  bloomMax: number;
  bloomRecover: number;
  // distance damage falloff: full <= start, floor >= end
  falloffStart: number; // metres
  falloffEnd: number;
  falloffMin: number; // multiplier floor (0..1)
  // client cosmetics / recoil pattern
  recoilUp: number; // base view-kick per shot
  recoilSide: number;
  tracer: number; // tracer/muzzle color (hex)
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  // Baseline all-rounder — the original AK feel.
  rifle: {
    id: "rifle",
    name: "Assault Rifle",
    blurb: "Balanced full-auto. Reliable at any range.",
    damage: 26,
    headMult: 2.2,
    fireRate: 9,
    pellets: 1,
    magSize: 30,
    reserve: 120,
    reloadTime: 2.4,
    auto: true,
    baseSpread: 0.0004,
    moveSpread: 0.007,
    airSpread: 0.016,
    pelletSpread: 0,
    bloomPerShot: 0.0006,
    bloomMax: 0.0035,
    bloomRecover: 0.11,
    falloffStart: 28,
    falloffEnd: 55,
    falloffMin: 0.7,
    recoilUp: 0.0042,
    recoilSide: 0.0013,
    tracer: 0xfff1a0,
  },
  // High rate of fire, low per-shot damage, weak past mid range.
  smg: {
    id: "smg",
    name: "SMG",
    blurb: "Shreds up close. Spray-and-pray at range.",
    damage: 16,
    headMult: 1.8,
    fireRate: 15,
    pellets: 1,
    magSize: 35,
    reserve: 175,
    reloadTime: 1.9,
    auto: true,
    baseSpread: 0.0012,
    moveSpread: 0.008,
    airSpread: 0.02,
    pelletSpread: 0,
    bloomPerShot: 0.001,
    bloomMax: 0.006,
    bloomRecover: 0.12,
    falloffStart: 14,
    falloffEnd: 34,
    falloffMin: 0.45,
    recoilUp: 0.0034,
    recoilSide: 0.0016,
    tracer: 0x8affc0,
  },
  // Slow, pinpoint, one-shot headshots. Big penalty for moving/spraying.
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "One-shot headshots. Punishing if you miss.",
    damage: 82,
    headMult: 2.5,
    fireRate: 1.1,
    pellets: 1,
    magSize: 5,
    reserve: 20,
    reloadTime: 3.3,
    auto: false,
    baseSpread: 0.0002,
    moveSpread: 0.05, // hip-firing on the move is hopeless
    airSpread: 0.06,
    pelletSpread: 0,
    bloomPerShot: 0.004,
    bloomMax: 0.05,
    bloomRecover: 0.5,
    falloffStart: 200,
    falloffEnd: 200,
    falloffMin: 1,
    recoilUp: 0.02,
    recoilSide: 0.003,
    tracer: 0xffffff,
  },
  // Multi-pellet blast, brutal at point blank, near-useless past mid range.
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    blurb: "Devastating point-blank. Falls off fast.",
    damage: 12,
    headMult: 1.5,
    fireRate: 1.3,
    pellets: 8,
    magSize: 6,
    reserve: 30,
    reloadTime: 2.6,
    auto: false,
    baseSpread: 0.02,
    moveSpread: 0.02,
    airSpread: 0.03,
    pelletSpread: 0.055,
    bloomPerShot: 0.004,
    bloomMax: 0.03,
    bloomRecover: 0.2,
    falloffStart: 6,
    falloffEnd: 18,
    falloffMin: 0.15,
    recoilUp: 0.014,
    recoilSide: 0.004,
    tracer: 0xff9a3d,
  },
};

export function weaponOf(id: string | undefined): WeaponSpec {
  return WEAPONS[(id as WeaponId) ?? DEFAULT_WEAPON] ?? WEAPONS[DEFAULT_WEAPON];
}

// Distance damage multiplier: 1 up to falloffStart, lerping to falloffMin at
// falloffEnd, then flat.
export function falloffMult(spec: WeaponSpec, dist: number): number {
  if (dist <= spec.falloffStart) return 1;
  if (dist >= spec.falloffEnd) return spec.falloffMin;
  const t = (dist - spec.falloffStart) / (spec.falloffEnd - spec.falloffStart);
  return 1 + (spec.falloffMin - 1) * t;
}
