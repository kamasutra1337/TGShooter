import * as THREE from "three";
import type { WeaponId } from "../../../shared/weapons";

// Soldier built from ROUNDED primitives (capsules / cylinders / spheres) rather
// than boxes — human-ish silhouette, not blocky. Feet at y=0, ~1.85 m. Two team
// color schemes, a rifle held in the hands, and a leg rig for the walk cycle.
// The head is tagged `userData.part = "head"` for headshots; `hitMaterials`
// flash on damage.

export interface SoldierHandles {
  group: THREE.Group;
  rig: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  hitMaterials: THREE.MeshStandardMaterial[];
  head: THREE.Mesh;
  walk: number;
}

interface Scheme {
  uniform: number;
  uniformDark: number;
  vest: number;
  helmet: number;
  accent: number;
}

const SCHEMES: Record<number, Scheme> = {
  0: { uniform: 0x4a5232, uniformDark: 0x39421f, vest: 0x2f3327, helmet: 0x363a2b, accent: 0x3aa0ff },
  1: { uniform: 0x8a7a4a, uniformDark: 0x6f6238, vest: 0x5c5230, helmet: 0x5a4f36, accent: 0xff4d4d },
};

const CAP = 4; // capsule cap segments (mobile-friendly)
const RAD = 8; // radial segments

function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  part: "body" | "head" = "body",
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.part = part;
  return m;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, CAP, RAD);
const sphere = (r: number) => new THREE.SphereGeometry(r, RAD + 2, RAD);
const cyl = (rt: number, rb: number, h: number) => new THREE.CylinderGeometry(rt, rb, h, RAD);

export function buildSoldier(team: number, weapon: WeaponId = "rifle"): SoldierHandles {
  const s = SCHEMES[team] ?? SCHEMES[1];
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);

  const mk = (c: number, rough = 0.85, metal = 0) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const uniform = mk(s.uniform, 0.9);
  const uniformDark = mk(s.uniformDark, 0.9);
  const vest = mk(s.vest, 0.7, 0.15);
  const gear = mk(0x23251c, 0.8);
  const skin = mk(0xcaa079, 0.7);
  const helmetMat = mk(s.helmet, 0.7, 0.1);
  const accentMat = new THREE.MeshStandardMaterial({
    color: s.accent,
    roughness: 0.55,
    emissive: s.accent,
    emissiveIntensity: 0.25,
  });
  const hitMaterials = [uniform, vest, uniformDark];

  // ---- legs (hip-pivoted groups for the walk cycle) ----
  const makeLeg = (sx: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.12, 0.82, 0);
    leg.add(mesh(capsule(0.11, 0.42), uniform, 0, -0.3, 0)); // thigh+shin
    leg.add(mesh(sphere(0.12), uniformDark, 0, -0.08, 0.02)); // knee pad
    const boot = mesh(capsule(0.09, 0.12), gear, 0, -0.62, 0.05); // boot
    boot.rotation.x = Math.PI / 2;
    leg.add(boot);
    return leg;
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);
  rig.add(legL, legR);

  // ---- hips + belt ----
  rig.add(mesh(capsule(0.19, 0.12), uniformDark, 0, 0.9, 0));
  const belt = mesh(cyl(0.24, 0.24, 0.1), gear, 0, 1.0, 0);
  rig.add(belt);
  for (const a of [-1, 0, 1]) rig.add(mesh(new THREE.BoxGeometry(0.13, 0.15, 0.09), gear, a * 0.15, 0.99, 0.19));

  // ---- torso (rounded) + plate carrier ----
  rig.add(mesh(capsule(0.21, 0.34), uniform, 0, 1.32, 0));
  const carrier = mesh(new THREE.BoxGeometry(0.42, 0.46, 0.36), vest, 0, 1.34, 0.02);
  carrier.userData.part = "body";
  // round the plate carrier corners visually by overlaying a slightly larger
  // rounded torso already; keep the plate for the "armor" read.
  rig.add(carrier);
  for (const sx of [-1, 1]) rig.add(mesh(new THREE.BoxGeometry(0.14, 0.19, 0.08), gear, sx * 0.12, 1.3, 0.22)); // mag pouches
  rig.add(mesh(new THREE.BoxGeometry(0.09, 0.11, 0.07), gear, 0, 1.48, 0.22)); // admin pouch
  rig.add(mesh(sphere(0.06), accentMat, 0.19, 1.5, 0.02)); // team shoulder marker

  // backpack (rounded)
  rig.add(mesh(capsule(0.16, 0.28), gear, 0, 1.32, -0.24));

  // ---- arms holding the weapon at the ready (both hands ON the gun) ----
  for (const sx of [-1, 1]) {
    rig.add(mesh(sphere(0.12), uniform, sx * 0.29, 1.45, 0.02)); // shoulder
    const upper = mesh(capsule(0.075, 0.2), uniform, sx * 0.27, 1.33, 0.09);
    upper.rotation.x = -0.55;
    rig.add(upper);
  }
  // right forearm reaches the pistol grip, left forearm the foregrip
  const rFore = mesh(capsule(0.065, 0.2), uniformDark, 0.16, 1.17, 0.34);
  rFore.rotation.set(-1.15, 0, -0.15);
  rig.add(rFore);
  const lFore = mesh(capsule(0.065, 0.24), uniformDark, -0.05, 1.18, 0.52);
  lFore.rotation.set(-1.3, 0, 0.28);
  rig.add(lFore);
  rig.add(mesh(sphere(0.058), gear, 0.14, 1.08, 0.46)); // right glove on grip
  rig.add(mesh(sphere(0.058), gear, 0.03, 1.12, 0.66)); // left glove on foregrip

  // held weapon (varies by loadout)
  rig.add(buildHeldRifle(weapon));

  // ---- neck + head ----
  rig.add(mesh(cyl(0.06, 0.07, 0.1), skin, 0, 1.56, 0));
  const head = mesh(sphere(0.135), skin, 0, 1.7, 0, "head");
  rig.add(head);

  // helmet (dome + brim) + visor
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, RAD + 4, RAD, 0, Math.PI * 2, 0, Math.PI * 0.62),
    helmetMat,
  );
  dome.position.set(0, 1.74, 0);
  dome.castShadow = true;
  dome.userData.part = "head";
  rig.add(dome);
  const brim = mesh(cyl(0.17, 0.17, 0.04), helmetMat, 0, 1.72, 0, "head");
  rig.add(brim);
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12, 1, false, -0.5, 1.0),
    new THREE.MeshStandardMaterial({ color: s.accent, emissive: s.accent, emissiveIntensity: 0.6, roughness: 0.4 }),
  );
  visor.rotation.x = Math.PI / 2;
  visor.position.set(0, 1.72, 0.11);
  rig.add(visor);

  return { group, rig, legL, legR, hitMaterials, head, walk: 0 };
}

function buildHeldRifle(weapon: WeaponId): THREE.Group {
  const g = new THREE.Group();
  // Lighter gunmetal so the weapon reads against dark/night maps.
  const metal = new THREE.MeshStandardMaterial({ color: 0x565b66, roughness: 0.42, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.5, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.65 });
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.rotation.x = rx;
    mm.castShadow = true;
    g.add(mm);
  };
  // Shared receiver + stock; barrel/mag/optics vary so enemies read at a glance.
  put(new THREE.BoxGeometry(0.055, 0.085, 0.34), metal, 0.06, 1.17, 0.5); // receiver

  if (weapon === "smg") {
    put(cyl(0.012, 0.012, 0.18), metal, 0.06, 1.18, 0.82, Math.PI / 2); // short barrel
    put(new THREE.BoxGeometry(0.04, 0.14, 0.05), dark, 0.06, 1.02, 0.5); // straight mag
    put(new THREE.BoxGeometry(0.04, 0.07, 0.14), dark, 0.06, 1.15, 0.3); // stock stub
  } else if (weapon === "sniper") {
    put(cyl(0.012, 0.012, 0.5), dark, 0.06, 1.18, 1.02, Math.PI / 2); // long barrel
    put(cyl(0.028, 0.028, 0.2), dark, 0.06, 1.24, 0.62, Math.PI / 2); // big scope
    put(cyl(0.03, 0.045, 0.14), metal, 0.06, 1.06, 0.5, 0.4); // mag
    put(new THREE.BoxGeometry(0.045, 0.08, 0.22), dark, 0.06, 1.15, 0.28); // stock
  } else if (weapon === "shotgun") {
    put(cyl(0.024, 0.024, 0.36), dark, 0.06, 1.19, 0.9, Math.PI / 2); // thick barrel
    put(cyl(0.017, 0.017, 0.34), metal, 0.06, 1.15, 0.89, Math.PI / 2); // mag tube
    put(new THREE.BoxGeometry(0.05, 0.06, 0.1), wood, 0.06, 1.14, 0.74); // pump
    put(new THREE.BoxGeometry(0.045, 0.08, 0.22), wood, 0.06, 1.15, 0.28); // wooden stock
  } else {
    // rifle (AK)
    put(cyl(0.028, 0.028, 0.22), wood, 0.06, 1.15, 0.72, Math.PI / 2); // handguard
    put(cyl(0.014, 0.014, 0.3), metal, 0.06, 1.18, 0.96, Math.PI / 2); // barrel
    put(cyl(0.03, 0.045, 0.16), metal, 0.06, 1.05, 0.5, 0.4); // banana mag
    put(new THREE.BoxGeometry(0.045, 0.08, 0.2), wood, 0.06, 1.15, 0.3); // stock
  }
  return g;
}

// Walk cycle + body bob driven by horizontal speed (m/s). Call each frame.
export function animateSoldier(h: SoldierHandles, speed: number, dt: number): void {
  const moving = speed > 0.4;
  const amp = Math.min(speed / 6, 1);
  h.walk += dt * (6 + speed * 1.2);
  if (moving) {
    const sw = Math.sin(h.walk) * 0.6 * amp;
    h.legL.rotation.x = sw;
    h.legR.rotation.x = -sw;
    h.rig.position.y = Math.abs(Math.sin(h.walk)) * 0.05 * amp;
  } else {
    h.legL.rotation.x *= 0.8;
    h.legR.rotation.x *= 0.8;
    h.rig.position.y *= 0.8;
  }
}
