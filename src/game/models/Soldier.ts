import * as THREE from "three";

// Procedural soldier in uniform + full gear, built from primitives (no external
// assets). Feet at y=0, ~1.9 m tall. Two team color schemes. A rifle is held in
// the hands (so enemies visibly carry a weapon). The `rig` + leg groups are
// exposed so `animateSoldier` can add a walk cycle + body bob. The head mesh is
// tagged `userData.part = "head"` for headshots; `hitMaterials` flash on damage.

export interface SoldierHandles {
  group: THREE.Group; // positioned at feet by the caller
  rig: THREE.Group; // inner group (body bob applied here)
  legL: THREE.Group;
  legR: THREE.Group;
  hitMaterials: THREE.MeshStandardMaterial[];
  head: THREE.Mesh;
  walk: number; // animation phase accumulator
}

interface Scheme {
  uniform: number;
  uniformDark: number;
  vest: number;
  helmet: number;
  accent: number;
}

const SCHEMES: Record<number, Scheme> = {
  0: { uniform: 0x4a5232, uniformDark: 0x3a4026, vest: 0x2f3327, helmet: 0x363a2b, accent: 0x3aa0ff },
  1: { uniform: 0x8a7a4a, uniformDark: 0x6f6238, vest: 0x5c5230, helmet: 0x5a4f36, accent: 0xff4d4d },
};

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  part: "body" | "head" = "body",
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.part = part;
  return m;
}

export function buildSoldier(team: number): SoldierHandles {
  const s = SCHEMES[team] ?? SCHEMES[1];
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);

  const uniform = new THREE.MeshStandardMaterial({ color: s.uniform, roughness: 0.9 });
  const uniformDark = new THREE.MeshStandardMaterial({ color: s.uniformDark, roughness: 0.9 });
  const vest = new THREE.MeshStandardMaterial({ color: s.vest, roughness: 0.7, metalness: 0.1 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x23251c, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xcaa079, roughness: 0.7 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: s.helmet, roughness: 0.75 });
  const accentMat = new THREE.MeshStandardMaterial({ color: s.accent, roughness: 0.6, emissive: s.accent, emissiveIntensity: 0.15 });
  const hitMaterials = [uniform, vest, uniformDark];

  // ---- legs as hip-pivoted groups (for the walk cycle) ----
  const makeLeg = (sx: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.13, 0.85, 0); // hip pivot
    leg.add(box(0.2, 0.5, 0.24, uniform, 0, -0.3, 0)); // thigh/shin
    leg.add(box(0.21, 0.2, 0.25, uniformDark, 0, -0.05, 0)); // knee pad
    leg.add(box(0.22, 0.16, 0.32, gear, 0, -0.58, 0.03)); // boot
    return leg;
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);
  rig.add(legL, legR);

  // hips + belt
  rig.add(box(0.5, 0.26, 0.28, uniformDark, 0, 0.92, 0));
  rig.add(box(0.54, 0.1, 0.32, gear, 0, 1.02, 0));
  for (const s2 of [-1, 0, 1]) rig.add(box(0.14, 0.16, 0.1, gear, s2 * 0.16, 1.0, 0.19));

  // torso + plate carrier
  rig.add(box(0.54, 0.55, 0.32, uniform, 0, 1.35, 0));
  rig.add(box(0.5, 0.5, 0.38, vest, 0, 1.36, 0.01));
  for (const sx of [-1, 1]) rig.add(box(0.15, 0.2, 0.09, gear, sx * 0.13, 1.3, 0.2)); // mag pouches
  rig.add(box(0.1, 0.12, 0.08, gear, 0, 1.5, 0.2)); // admin pouch
  rig.add(box(0.16, 0.08, 0.16, accentMat, 0.2, 1.55, 0)); // shoulder team patch

  // backpack
  rig.add(box(0.4, 0.5, 0.2, gear, 0, 1.35, -0.24));
  rig.add(box(0.18, 0.28, 0.12, uniformDark, 0, 1.35, -0.36));

  // arms holding a rifle forward
  for (const sx of [-1, 1]) {
    rig.add(box(0.2, 0.42, 0.22, uniform, sx * 0.36, 1.35, 0.02)); // upper arm
    const fore = box(0.17, 0.34, 0.18, uniformDark, sx * 0.32, 1.12, 0.2);
    fore.rotation.x = -0.9;
    rig.add(fore);
    rig.add(box(0.12, 0.12, 0.12, gear, sx * 0.28, 0.98, 0.36)); // glove
  }

  // ---- held rifle (in hands, pointing forward) ----
  rig.add(buildHeldRifle());

  // neck + head
  rig.add(box(0.16, 0.12, 0.16, skin, 0, 1.66, 0));
  const head = box(0.26, 0.28, 0.26, skin, 0, 1.82, 0, "head");
  rig.add(head);

  // helmet + visor
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
    helmetMat,
  );
  dome.position.set(0, 1.9, 0);
  dome.castShadow = true;
  dome.userData.part = "head";
  rig.add(dome);
  rig.add(box(0.3, 0.06, 0.3, helmetMat, 0, 1.86, 0, "head"));
  rig.add(box(0.08, 0.06, 0.06, gear, 0, 1.96, 0.14, "head"));
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.05, 0.03),
    new THREE.MeshBasicMaterial({ color: s.accent }),
  );
  visor.position.set(0, 1.84, 0.14);
  rig.add(visor);

  return { group, rig, legL, legR, hitMaterials, head, walk: 0 };
}

function buildHeldRifle(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.7 });
  const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    g.add(mesh);
  };
  // held around chest height, extending forward (+z)
  add(0.06, 0.09, 0.4, metal, 0.06, 1.18, 0.5); // receiver
  add(0.05, 0.06, 0.24, wood, 0.06, 1.16, 0.74); // handguard
  add(0.03, 0.03, 0.28, metal, 0.06, 1.19, 0.95); // barrel
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.07), metal);
  mag.position.set(0.06, 1.05, 0.52);
  mag.rotation.x = 0.4;
  g.add(mag);
  add(0.05, 0.09, 0.2, wood, 0.06, 1.16, 0.3); // stock
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
