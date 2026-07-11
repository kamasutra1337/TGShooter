import * as THREE from "three";
import { wood } from "../textures";

// Realistic map props from primitives. Builders return a Group centered at the
// origin, sized to fit (w,h,d) so Arena can "skin" a collider box with a prop
// without changing collision. Plus free-standing decoration (barrels, stacks).

const woodMat = () =>
  new THREE.MeshStandardMaterial({ map: wood(), color: 0xd8d0c4, roughness: 0.82 });
const woodDark = () => new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.85 });
const metalGreen = () => new THREE.MeshStandardMaterial({ color: 0x45503a, roughness: 0.6, metalness: 0.3 });
const concreteMat = () => new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.95 });
const sandMat = () => new THREE.MeshStandardMaterial({ color: 0xb8a274, roughness: 1 });

function meshed(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Wooden crate with plank frame + cross braces on each face.
export function woodenCrate(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const body = woodMat();
  const frame = woodDark();
  g.add(meshed(new THREE.BoxGeometry(w, h, d), body));
  const t = Math.min(w, h, d) * 0.08 + 0.03;
  // corner posts
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.add(meshed(new THREE.BoxGeometry(t, h, t), frame, sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2)));
  // top/bottom rails on front & back
  for (const sz of [-1, 1])
    for (const sy of [-1, 1])
      g.add(meshed(new THREE.BoxGeometry(w, t, t), frame, 0, sy * (h / 2 - t / 2), sz * (d / 2 - t / 2)));
  // diagonal brace on front face
  const diag = meshed(new THREE.BoxGeometry(Math.hypot(w, h) * 0.9, t, t * 0.6), frame, 0, 0, d / 2);
  diag.rotation.z = Math.atan2(h, w);
  g.add(diag);
  return g;
}

// Olive ammo crate (lower, wider) with lid latches.
export function ammoCrate(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.add(meshed(new THREE.BoxGeometry(w, h, d), metalGreen()));
  g.add(meshed(new THREE.BoxGeometry(w * 1.02, h * 0.16, d * 1.02), metalGreen(), 0, h * 0.42, 0)); // lid rim
  const latch = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.5 });
  for (const s of [-1, 1]) g.add(meshed(new THREE.BoxGeometry(w * 0.1, h * 0.25, 0.04), latch, s * w * 0.3, h * 0.3, d / 2));
  return g;
}

// Concrete Jersey barrier (trapezoid profile via stacked boxes).
export function concreteBarrier(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const c = concreteMat();
  g.add(meshed(new THREE.BoxGeometry(w, h * 0.45, d), c, 0, -h * 0.27, 0)); // wide base
  g.add(meshed(new THREE.BoxGeometry(w * 0.7, h * 0.35, d * 0.7), c, 0, 0.02 * h, 0)); // mid
  g.add(meshed(new THREE.BoxGeometry(w * 0.5, h * 0.3, d * 0.5), c, 0, h * 0.32, 0)); // top
  return g;
}

// Sandbag wall: rows of rounded bags, offset like brickwork.
export function sandbagWall(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const bagW = 0.5;
  const bagH = 0.22;
  const rows = Math.max(1, Math.round(h / bagH));
  const cols = Math.max(1, Math.round(w / bagW));
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bagW * 0.5;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + bagW * 0.5 + c * bagW + off;
      if (x > w / 2) continue;
      const bag = meshed(
        new THREE.BoxGeometry(bagW * 0.95, bagH * 0.95, d),
        sandMat(),
        x,
        -h / 2 + bagH * 0.5 + r * bagH,
        (Math.random() - 0.5) * 0.04,
      );
      (bag.geometry as THREE.BoxGeometry).computeVertexNormals();
      g.add(bag);
    }
  }
  return g;
}

// Shipping container with corrugated sides + door end.
export function container(w: number, h: number, d: number, color = 0x9c4a35): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 });
  g.add(meshed(new THREE.BoxGeometry(w, h, d), body));
  // corrugation ribs on the long sides
  const ribs = Math.floor(d / 0.35);
  for (let i = 0; i < ribs; i++) {
    const z = -d / 2 + 0.2 + i * 0.35;
    for (const sx of [-1, 1])
      g.add(meshed(new THREE.BoxGeometry(0.04, h * 0.9, 0.12), body, sx * (w / 2 + 0.01), 0, z));
  }
  // corner castings + door bars on +x end
  for (const sy of [-1, 1])
    for (const sz of [-1, 1])
      g.add(meshed(new THREE.BoxGeometry(0.14, 0.14, 0.14), trim, w / 2 - 0.07, sy * (h / 2 - 0.07), sz * (d / 2 - 0.07)));
  for (const s of [-1, 1]) g.add(meshed(new THREE.BoxGeometry(0.05, h * 0.85, 0.05), trim, w / 2 + 0.02, 0, s * 0.18));
  return g;
}

// Free-standing barrel (decoration; not a collider).
export function barrel(color = 0xb23b2e): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
  const ring = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.5 });
  g.add(meshed(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 16), body, 0, 0.45, 0));
  for (const y of [0.2, 0.45, 0.7]) g.add(meshed(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 16), ring, 0, y, 0));
  g.add(meshed(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 16), ring, 0, 0.9, 0));
  return g;
}

// A small stack of crates (decoration).
export function crateStack(): THREE.Group {
  const g = new THREE.Group();
  const a = woodenCrate(0.8, 0.8, 0.8);
  const b = woodenCrate(0.7, 0.7, 0.7);
  b.position.set(0.1, 0.75, 0.05);
  b.rotation.y = 0.3;
  a.position.y = 0.4;
  g.add(a, b);
  return g;
}
