import * as THREE from "three";
import { buildAk47, type AkHandles } from "./Ak47";
import type { WeaponId } from "../../../shared/weapons";

// First-person viewmodels for the arsenal, built from primitives in gun-local
// space (forward = -z, origin near the receiver). Each returns the group + a
// `muzzle` marker at the barrel tip for flashes/tracers. The rifle reuses the
// existing detailed AK; the others are distinct silhouettes in the same style.

export type GunHandles = AkHandles;

const mkMat = () => ({
  metal: new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.45, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.5, metalness: 0.5 }),
  poly: new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.7, metalness: 0.1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.65 }),
  mag: new THREE.MeshStandardMaterial({ color: 0x2a2f24, roughness: 0.6, metalness: 0.2 }),
});

function adder(group: THREE.Group) {
  return (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
}

function finish(group: THREE.Group, muzzleZ: number): GunHandles {
  for (const c of group.children) (c as THREE.Mesh).castShadow = false;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, muzzleZ);
  group.add(muzzle);
  return { group, muzzle };
}

// Compact SMG: short polymer body, straight box mag, stubby barrel.
function buildSmg(): GunHandles {
  const g = new THREE.Group();
  const add = adder(g);
  const { metal, dark, poly } = mkMat();
  add(new THREE.BoxGeometry(0.055, 0.1, 0.24), poly, 0, 0, -0.02); // receiver
  add(new THREE.BoxGeometry(0.05, 0.035, 0.2), dark, 0, 0.06, -0.02); // top rail
  add(new THREE.BoxGeometry(0.045, 0.08, 0.14), poly, 0, -0.005, 0.18); // folding stock stub
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 12), dark, 0, 0.01, -0.28, Math.PI / 2); // barrel
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 12), metal, 0, 0.01, -0.4, Math.PI / 2); // muzzle
  add(new THREE.BoxGeometry(0.02, 0.04, 0.02), metal, 0, 0.055, -0.3); // front sight
  add(new THREE.BoxGeometry(0.045, 0.11, 0.055), dark, 0, -0.1, 0.05, 0.3); // grip
  add(new THREE.BoxGeometry(0.045, 0.16, 0.05), poly, 0, -0.14, -0.08); // straight box mag
  add(new THREE.BoxGeometry(0.04, 0.03, 0.02), metal, 0.035, 0.02, 0.0); // charging handle
  // red-dot optic on a short rail
  add(new THREE.BoxGeometry(0.05, 0.02, 0.14), metal, 0, 0.06, -0.02);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.06), dark, 0, 0.095, -0.04);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.007, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3030 }),
  );
  dot.position.set(0, 0.095, 0.0);
  g.add(dot);
  return finish(g, -0.46);
}

// Bolt-action sniper: long barrel, big scope, thumbhole stock.
function buildSniper(): GunHandles {
  const g = new THREE.Group();
  const add = adder(g);
  const { metal, dark, poly } = mkMat();
  add(new THREE.BoxGeometry(0.05, 0.09, 0.36), poly, 0, 0, 0.0); // long receiver
  add(new THREE.BoxGeometry(0.05, 0.1, 0.24), poly, 0, -0.02, 0.24); // cheekpiece stock
  add(new THREE.CylinderGeometry(0.013, 0.013, 0.6, 12), dark, 0, 0.01, -0.5, Math.PI / 2); // long barrel
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 12), metal, 0, 0.01, -0.82, Math.PI / 2); // muzzle brake
  // big scope
  add(new THREE.BoxGeometry(0.03, 0.05, 0.02), metal, 0, 0.09, 0.04);
  add(new THREE.BoxGeometry(0.03, 0.05, 0.02), metal, 0, 0.09, -0.14);
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 16), dark, 0, 0.13, -0.05, Math.PI / 2); // tube
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16), dark, 0, 0.13, -0.2, Math.PI / 2); // objective bell
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16),
    new THREE.MeshBasicMaterial({ color: 0x1b3350 }),
  );
  lens.position.set(0, 0.13, 0.09);
  lens.rotation.x = Math.PI / 2;
  g.add(lens);
  add(new THREE.BoxGeometry(0.045, 0.12, 0.055), dark, 0, -0.1, 0.12, 0.3); // grip
  add(new THREE.BoxGeometry(0.04, 0.02, 0.02), metal, 0.04, 0.03, 0.08); // bolt handle
  return finish(g, -0.88);
}

// Pump shotgun: thick barrel, tube mag under it, wooden furniture.
function buildShotgun(): GunHandles {
  const g = new THREE.Group();
  const add = adder(g);
  const { metal, dark, wood } = mkMat();
  add(new THREE.BoxGeometry(0.06, 0.1, 0.3), metal, 0, 0, -0.02); // receiver
  add(new THREE.BoxGeometry(0.05, 0.09, 0.24), wood, 0, -0.01, 0.2); // wooden stock
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.44, 14), dark, 0, 0.02, -0.42, Math.PI / 2); // thick barrel
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 12), metal, 0, -0.02, -0.4, Math.PI / 2); // mag tube under
  add(new THREE.BoxGeometry(0.05, 0.05, 0.12), wood, 0, -0.03, -0.34); // pump foregrip
  add(new THREE.BoxGeometry(0.02, 0.04, 0.02), metal, 0, 0.07, -0.6); // bead sight
  add(new THREE.BoxGeometry(0.045, 0.12, 0.06), dark, 0, -0.1, 0.04, 0.3); // grip
  return finish(g, -0.66);
}

export function buildViewmodel(id: WeaponId): GunHandles {
  switch (id) {
    case "smg":
      return buildSmg();
    case "sniper":
      return buildSniper();
    case "shotgun":
      return buildShotgun();
    case "rifle":
    default:
      return buildAk47();
  }
}
