import * as THREE from "three";
import {
  HALF_SIZE,
  MAPS,
  mapById,
  resolveCollision as sharedResolve,
  groundHeight as sharedGround,
  rayArena as sharedRay,
  type GameMap,
  type BoxKind,
  type AABB,
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

// Renders one arena (map) from the SHARED, typed box list. Each collider is
// skinned with a realistic prop for looks, plus an INVISIBLE box proxy carrying
// the exact AABB for bullet raycasts — so collision + hit-stop match the server
// precisely. Collision math is delegated to the shared implementation using this
// map's colliders, so client prediction and the server agree.

const CONTAINER_COLORS = [0x9c4a35, 0x35618f, 0xb0892f, 0x4a7a52, 0x7a4a6a];

export class Arena {
  group = new THREE.Group();
  solids: THREE.Object3D[] = []; // raycast targets for the offline weapon
  halfSize = HALF_SIZE; // per-map (set in build)
  spawns: THREE.Vector3[] = [];
  private colliders: AABB[] = MAPS[0].colliders;
  map: GameMap = MAPS[0];

  // Build (or rebuild) the arena for a given map id.
  build(scene: THREE.Scene, mapId = 0): void {
    // tear down any previous map
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.group = new THREE.Group();
    this.solids = [];
    this.spawns = [];

    const map = mapById(mapId);
    this.map = map;
    this.colliders = map.colliders;
    this.halfSize = map.half;
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
      const line = new THREE.Mesh(new THREE.BoxGeometry(this.halfSize * 2 - 4, 0.02, 0.4), hazard);
      line.position.set(0, 0.01, z * (this.halfSize - 4));
      line.receiveShadow = true;
      this.group.add(line);
    }

    // Skin every box: invisible AABB proxy + a realistic prop for its kind.
    let colorIdx = 0;
    map.boxes.forEach((mb) => {
      const [cx, cy, cz, w, h, d] = mb.b;
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.set(cx, cy, cz);
      this.group.add(proxy);
      this.solids.push(proxy);

      const prop = this.propFor(mb.kind, w, h, d, colorIdx);
      if (mb.kind === "container" || mb.kind === "platform") colorIdx++;
      prop.position.set(cx, cy, cz);
      this.group.add(prop);
    });

    this.addDecoration();

    for (const [x, y, z] of map.spawns) this.spawns.push(new THREE.Vector3(x, y, z));
  }

  private propFor(kind: BoxKind, w: number, h: number, d: number, colorIdx: number): THREE.Object3D {
    switch (kind) {
      case "wall":
        return this.wall(w, h, d);
      case "crate":
        return woodenCrate(w, h, d);
      case "ammo":
        return ammoCrate(w, h, d);
      case "barrier":
        return concreteBarrier(w, h, d);
      case "container":
      case "platform":
      default:
        return container(w, h, d, CONTAINER_COLORS[colorIdx % CONTAINER_COLORS.length]);
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
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w > d ? w : w * 1.02, 0.3, w > d ? d * 1.4 : d),
      trim,
    );
    cap.position.y = h / 2 + 0.1;
    g.add(cap);
    return g;
  }

  private addDecoration(): void {
    // Push perimeter dressing out to this map's edge.
    const e = this.halfSize - 2; // just inside the wall
    const barrelSpots: [number, number, number, number][] = [
      [e - 1.5, 0, -(e - 1.5), 0xb23b2e],
      [e - 2.4, 0, -e, 0x2e6bb2],
      [-(e - 1.5), 0, e - 1.5, 0x2e6bb2],
      [-e, 0, e - 2.4, 0xb2892e],
      [e, 0, 6, 0xb23b2e],
      [-e, 0, -6, 0x4a7a3a],
    ];
    for (const [x, y, z, c] of barrelSpots) {
      const b = barrel(c);
      b.position.set(x, y, z);
      b.rotation.y = (x + z) * 0.3;
      this.group.add(b);
    }
    for (const [x, z] of [
      [-(e - 1), -(e - 4)],
      [e - 1, e - 4],
      [e - 1, -(e - 1)],
    ] as const) {
      const s = crateStack();
      s.position.set(x, 0, z);
      s.rotation.y = (x > 0 ? -1 : 1) * 0.4;
      this.group.add(s);
    }
    const bags = sandbagWall(4, 0.9, 0.6);
    bags.position.set(-6, 0.45, this.halfSize - 1.8);
    this.group.add(bags);
    const bags2 = sandbagWall(4, 0.9, 0.6);
    bags2.position.set(8, 0.45, -(this.halfSize - 1.8));
    this.group.add(bags2);
  }

  // Delegate physics to the shared, server-identical implementation using this
  // map's colliders.
  resolveCollision(pos: THREE.Vector3, radius: number): void {
    sharedResolve(pos, radius, this.colliders);
  }

  groundHeight(x: number, z: number): number {
    return sharedGround(x, z, this.colliders);
  }

  rayArena(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    return sharedRay(ox, oy, oz, dx, dy, dz, this.colliders);
  }
}
