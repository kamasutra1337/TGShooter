// Proves the weapon system's authoritative numbers via the shared sim directly:
// per-weapon mag sizes, fire cadence, headshot/body damage, sniper one-shot
// headshots, shotgun multi-pellet spread, and distance falloff. Deterministic
// (seeded RNG), no network.
import {
  makePlayer,
  doFire,
  hitscan,
  dirFromAngles,
  type SimPlayer,
  type HitboxState,
} from "../../shared/sim";
import { WEAPONS, weaponOf, falloffMult, type WeaponId } from "../../shared/weapons";

// Small deterministic PRNG so pellet spread is reproducible across runs.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const problems: string[] = [];
const check = (c: boolean, m: string) => {
  if (!c) problems.push(m);
};

// Aim a shooter straight down -z (yaw 0, pitch 0) and place a target that far
// away, with its body OR head centred on the eye line so a straight ray lands.
function shooterAt(weapon: WeaponId): SimPlayer {
  const p = makePlayer("shooter", [0, 0, 0], weapon); // eye y = 1.6
  p.yaw = 0;
  p.pitch = 0;
  p.grounded = true; // standing still (movement step would set this) → min spread
  return p;
}

// Target whose chosen part sits on the shooter's eye line at distance `dist`.
function targetAt(dist: number, part: "head" | "body"): HitboxState {
  // eye y = 1.6; head centre = feet.y + 1.75, body centre = feet.y + 0.9.
  const feetY = part === "head" ? 1.6 - 1.75 : 1.6 - 0.9;
  return { id: "target", feet: { x: 0, y: feetY, z: -dist }, alive: true };
}

// Fire once and return aggregated damage + whether any pellet was a headshot.
function fireOnce(p: SimPlayer, target: HitboxState, rand: () => number) {
  const spec = weaponOf(p.weaponId);
  const shot = doFire(p, rand);
  if (!shot) return null;
  let dmg = 0;
  let head = false;
  let hits = 0;
  for (const dir of shot.dirs) {
    const h = hitscan(shot.origin, dir, [target], p.id, spec, []); // no walls: pure ballistics
    if (h) {
      dmg += h.damage;
      head = head || h.headshot;
      hits++;
    }
  }
  return { dmg, head, hits, pellets: shot.dirs.length };
}

async function main() {
  const rand = rng(12345);

  // 1) Mag sizes come from the spec.
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const p = makePlayer("x", [0, 0, 0], id);
    check(p.ammo === WEAPONS[id].magSize, `${id}: mag should be ${WEAPONS[id].magSize}, got ${p.ammo}`);
  }

  // 2) Rifle body vs head damage at close range (no falloff).
  {
    const p = shooterAt("rifle");
    const body = fireOnce(p, targetAt(3, "body"), rand)!;
    check(Math.abs(body.dmg - 26) < 0.5, `rifle body should be 26, got ${body.dmg}`);
    p.cooldown = 0; // ignore cadence for this check
    const head = fireOnce(shooterAt("rifle"), targetAt(3, "head"), rand)!;
    check(head.head && Math.abs(head.dmg - 26 * 2.2) < 0.6, `rifle head should be ~57, got ${head.dmg}`);
  }

  // 3) Sniper one-shots on a headshot (damage > 100 HP).
  {
    const hit = fireOnce(shooterAt("sniper"), targetAt(20, "head"), rand)!;
    check(hit.head && hit.dmg > 100, `sniper headshot should exceed 100 HP, got ${hit.dmg}`);
    const body = fireOnce(shooterAt("sniper"), targetAt(20, "body"), rand)!;
    check(body.dmg > 80 && body.dmg <= 82.1, `sniper body should be ~82, got ${body.dmg}`);
  }

  // 4) Shotgun throws 8 pellets and most land point-blank (big aggregate dmg).
  {
    const res = fireOnce(shooterAt("shotgun"), targetAt(3, "body"), rand)!;
    check(res.pellets === 8, `shotgun should fire 8 pellets, got ${res.pellets}`);
    check(res.hits >= 6, `shotgun point-blank should land ≥6 pellets, got ${res.hits}`);
    check(res.dmg >= 60, `shotgun point-blank dmg should be high, got ${res.dmg}`);
    // …and fall off hard at range: far fewer pellets connect / much less dmg.
    const far = fireOnce(shooterAt("shotgun"), targetAt(30, "body"), rng(777));
    check(!far || far.dmg < res.dmg * 0.6, `shotgun should fall off at range (far=${far?.dmg})`);
  }

  // 5) Rifle distance falloff: full damage close, reduced past falloffEnd.
  {
    const near = fireOnce(shooterAt("rifle"), targetAt(10, "body"), rand)!;
    const far = fireOnce(shooterAt("rifle"), targetAt(52, "body"), rand)!;
    check(Math.abs(near.dmg - 26) < 0.5, `rifle @10m should be full 26, got ${near.dmg}`);
    check(far.dmg < 24, `rifle @52m should be reduced by falloff, got ${far.dmg}`);
    // falloff pure-function sanity
    check(falloffMult(WEAPONS.rifle, 10) === 1, "falloff @10m should be 1");
    check(falloffMult(WEAPONS.rifle, 60) === 0.7, "falloff @60m should be floor 0.7");
  }

  // 6) Fire cadence: a second doFire on the same tick is blocked by cooldown.
  {
    const p = shooterAt("smg");
    const first = doFire(p, rand);
    const second = doFire(p, rand); // cooldown not yet elapsed
    check(!!first && !second, "cooldown should block a same-tick second shot");
    check(Math.abs(p.cooldown - 1 / WEAPONS.smg.fireRate) < 1e-6, "smg cooldown = 1/fireRate");
  }

  void dirFromAngles;
  if (problems.length) {
    console.error("\n❌ FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log(
    "\n✅ PASS — weapons: mags, rifle body/head, sniper one-shot, shotgun 8-pellet spread + falloff, cadence",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
