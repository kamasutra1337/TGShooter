import * as THREE from "three";

// Procedural soldier in uniform + full gear, built from primitives (no external
// assets). Feet at y=0, ~1.9 m tall. Used by both offline bots and networked
// avatars. The head mesh is tagged `userData.part = "head"` and everything else
// "body" so the offline hitscan can score headshots. `hitMaterials` are returned
// on the group for a quick damage flash.

export interface SoldierHandles {
  group: THREE.Group;
  hitMaterials: THREE.MeshStandardMaterial[];
  head: THREE.Mesh;
}

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

// `accent` tints a team patch + visor so enemies read at distance.
export function buildSoldier(accent = 0xff5a6a): SoldierHandles {
  const group = new THREE.Group();

  const uniform = new THREE.MeshStandardMaterial({ color: 0x4a5232, roughness: 0.9 });
  const uniformDark = new THREE.MeshStandardMaterial({ color: 0x3a4026, roughness: 0.9 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x2f3327, roughness: 0.7, metalness: 0.1 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x23251c, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xcaa079, roughness: 0.7 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x363a2b, roughness: 0.75 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
  const hitMaterials = [uniform, vest, uniformDark];

  // legs
  for (const s of [-1, 1]) {
    group.add(box(0.2, 0.55, 0.24, uniform, s * 0.13, 0.5, 0, "body"));
    group.add(box(0.22, 0.16, 0.32, gear, s * 0.13, 0.09, 0.03, "body")); // boot
    group.add(box(0.21, 0.2, 0.25, uniformDark, s * 0.13, 0.8, 0, "body")); // knee pad area
  }

  // hips
  group.add(box(0.5, 0.26, 0.28, uniformDark, 0, 0.92, 0, "body"));
  // belt with pouches
  group.add(box(0.54, 0.1, 0.32, gear, 0, 1.02, 0, "body"));
  for (const s of [-1, 0, 1]) group.add(box(0.14, 0.16, 0.1, gear, s * 0.16, 1.0, 0.19, "body"));

  // torso (uniform) + plate carrier vest
  group.add(box(0.54, 0.55, 0.32, uniform, 0, 1.35, 0, "body"));
  const carrier = box(0.5, 0.5, 0.38, vest, 0, 1.36, 0.01, "body");
  group.add(carrier);
  // chest pouches (mag pouches)
  for (const s of [-1, 1]) {
    group.add(box(0.15, 0.2, 0.09, gear, s * 0.13, 1.3, 0.2, "body"));
  }
  group.add(box(0.1, 0.12, 0.08, gear, 0, 1.5, 0.2, "body")); // admin pouch
  // team patch on shoulder
  group.add(box(0.16, 0.08, 0.16, accentMat, 0.2, 1.55, 0, "body"));

  // backpack
  group.add(box(0.4, 0.5, 0.2, gear, 0, 1.35, -0.24, "body"));
  group.add(box(0.18, 0.28, 0.12, uniformDark, 0, 1.35, -0.36, "body")); // roll

  // shoulders + arms (slightly forward, as if holding a rifle)
  for (const s of [-1, 1]) {
    group.add(box(0.2, 0.42, 0.22, uniform, s * 0.36, 1.35, 0.02, "body")); // upper arm
    const fore = box(0.17, 0.34, 0.18, uniformDark, s * 0.34, 1.08, 0.16, "body"); // forearm forward
    fore.rotation.x = -0.7;
    group.add(fore);
    group.add(box(0.12, 0.12, 0.12, gear, s * 0.3, 0.95, 0.32, "body")); // glove
  }

  // neck + head
  group.add(box(0.16, 0.12, 0.16, skin, 0, 1.66, 0, "body"));
  const head = box(0.26, 0.28, 0.26, skin, 0, 1.82, 0, "head");
  group.add(head);

  // helmet (dome + brim) + NVG mount + visor
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
    helmetMat,
  );
  dome.position.set(0, 1.9, 0);
  dome.castShadow = true;
  dome.userData.part = "head";
  group.add(dome);
  group.add(box(0.3, 0.06, 0.3, helmetMat, 0, 1.86, 0, "head")); // rim
  group.add(box(0.08, 0.06, 0.06, gear, 0, 1.96, 0.14, "head")); // NVG mount
  // glowing visor stripe (team readability)
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.05, 0.03),
    new THREE.MeshBasicMaterial({ color: accent }),
  );
  visor.position.set(0, 1.84, 0.14);
  group.add(visor);

  // slung rifle hint on the back
  const rifle = box(0.06, 0.06, 0.6, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }), 0.15, 1.3, -0.18, "body");
  rifle.rotation.x = 0.5;
  group.add(rifle);

  return { group, hitMaterials, head };
}
