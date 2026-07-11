import * as THREE from "three";
import {
  COLLIDERS,
  SPAWNS,
  HALF_SIZE,
  resolveCollision as sharedResolve,
  groundHeight as sharedGround,
} from "../../shared/arena";
import {
  woodenCrate,
  ammoCrate,
  concreteBarrier,
  container,
  barrel,
  crateStack,
  sandbagWall,
} from "./models/Props";
import { asphalt, concrete } from "./textures";

// Renders the arena from the SHARED collider list. Each collider is skinned with
// a realistic prop for looks, plus an INVISIBLE box proxy that carries the exact
// AABB for bullet raycasts — so collision + hit-stop match the server precisely,
// no matter how detailed the visible prop is. Free-standing decoration (barrels,
// crate stacks) is visual only.

const CONTAINER_COLORS = [0x9c4a35, 0x35618f, 0xb0892f, 0x4a7a52, 0x7a4a6a];

export class Arena {
  readonly group = new THREE.Group();
  readonly solids: THREE.Object3D[] = []; // raycast targets for the offline weapon
  readonly halfSize = HALF_SIZE;
  readonly spawns: THREE.Vector3[] = [];

  build(scene: THREE.Scene): void {
    scene.add(this.group);

    // Floor — textured asphalt with surface relief
    const asph = asphalt(this.halfSize);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfSize * 2, 1, this.halfSize * 2),
      new THREE.MeshStandardMaterial({
        map: asph.map,
        normalMap: asph.normalMap,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.96,
        metalness: 0.05,
      }),
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.solids.push(floor);

    // Painted hazard lines near the ends
    const hazard = new THREE.MeshStandardMaterial({ color: 0xc8a12a, roughness: 0.9 });
    for (const z of [-1, 1]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(this.halfSize * 2 - 4, 0.02, 0.4),
        hazard,
      );
      line.position.set(0, 0.01, z * (this.halfSize - 4));
      line.receiveShadow = true;
      this.group.add(line);
    }

    // Skin every collider: invisible AABB proxy + a realistic prop.
    COLLIDERS.forEach((c, i) => {
      const w = c.maxX - c.minX;
      const h = c.maxY - c.minY;
      const d = c.maxZ - c.minZ;
      const cx = (c.minX + c.maxX) / 2;
      const cy = (c.minY + c.maxY) / 2;
      const cz = (c.minZ + c.maxZ) / 2;

      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.set(cx, cy, cz);
      this.group.add(proxy);
      this.solids.push(proxy); // raycastable (material hidden, object visible)

      const prop = this.propFor(i, w, h, d);
      prop.position.set(cx, cy, cz);
      this.group.add(prop);
    });

    this.addDecoration();

    // Spawn points (feet) — from the shared list, so client + server agree.
    for (const [x, y, z] of SPAWNS) this.spawns.push(new THREE.Vector3(x, y, z));
  }

  private propFor(i: number, w: number, h: number, d: number): THREE.Object3D {
    if (i < 4) return this.wall(w, h, d); // perimeter walls
    if (i >= COLLIDERS.length - 2)
      return container(w, h, d, CONTAINER_COLORS[i % CONTAINER_COLORS.length]); // platforms
    switch (i) {
      case 4:
      case 5:
      case 6:
      case 7:
        return woodenCrate(w, h, d); // corner cover
      case 8:
        return ammoCrate(w, h, d); // central low cover
      case 9:
      case 10:
        return container(w, h, d, CONTAINER_COLORS[i % CONTAINER_COLORS.length]);
      default:
        return concreteBarrier(w, h, d); // 11, 12
    }
  }

  private wall(w: number, h: number, d: number): THREE.Group {
    const g = new THREE.Group();
    const con = concrete(Math.max(1, Math.round(Math.max(w, d) / 6)));
    const mat = new THREE.MeshStandardMaterial({
      map: con.map,
      normalMap: con.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0x8f949c,
      roughness: 0.95,
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // top cap
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w > d ? w : w * 1.02, 0.3, w > d ? d * 1.4 : d),
      trim,
    );
    cap.position.y = h / 2 + 0.1;
    g.add(cap);
    return g;
  }

  private addDecoration(): void {
    // Barrels — clustered against walls/corners (visual only)
    const barrelSpots: [number, number, number, number][] = [
      [20.5, 0, -20.5, 0xb23b2e],
      [19.6, 0, -21, 0x2e6bb2],
      [-20.5, 0, 20.5, 0x2e6bb2],
      [-21, 0, 19.6, 0xb2892e],
      [22, 0, 6, 0xb23b2e],
      [-22, 0, -6, 0x4a7a3a],
    ];
    for (const [x, y, z, c] of barrelSpots) {
      const b = barrel(c);
      b.position.set(x, y, z);
      b.rotation.y = Math.random() * Math.PI;
      this.group.add(b);
    }

    // Crate stacks in the back corners
    for (const [x, z] of [
      [-21, -18],
      [21, 18],
      [21, -21],
    ] as const) {
      const s = crateStack();
      s.position.set(x, 0, z);
      s.rotation.y = (x > 0 ? -1 : 1) * 0.4;
      this.group.add(s);
    }

    // A low sandbag emplacement along one wall
    const bags = sandbagWall(4, 0.9, 0.6);
    bags.position.set(-6, 0.45, 22.2);
    this.group.add(bags);
    const bags2 = sandbagWall(4, 0.9, 0.6);
    bags2.position.set(8, 0.45, -22.2);
    this.group.add(bags2);
  }

  // Delegate physics to the shared, server-identical implementation.
  resolveCollision(pos: THREE.Vector3, radius: number): void {
    sharedResolve(pos, radius);
  }

  groundHeight(x: number, z: number): number {
    return sharedGround(x, z);
  }
}
