import * as THREE from "three";
import {
  BOXES,
  SPAWNS,
  HALF_SIZE,
  resolveCollision as sharedResolve,
  groundHeight as sharedGround,
} from "../../shared/arena";

// Renders the arena from the SHARED box list, so the geometry you see is exactly
// what the server collides + hitscans against. Collision math is delegated to
// the shared module — one implementation, client and server.

export class Arena {
  readonly group = new THREE.Group();
  readonly solids: THREE.Object3D[] = []; // raycast targets for the offline weapon
  readonly halfSize = HALF_SIZE;
  readonly spawns: THREE.Vector3[] = SPAWNS.map(
    ([x, y, z]) => new THREE.Vector3(x, y, z),
  );

  build(scene: THREE.Scene): void {
    scene.add(this.group);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfSize * 2, 1, this.halfSize * 2),
      new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.95 }),
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.solids.push(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.8 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x556074, roughness: 0.7 });
    const platMat = new THREE.MeshStandardMaterial({ color: 0x46506a, roughness: 0.75 });

    BOXES.forEach(([x, y, z, w, h, d], i) => {
      // first 4 = perimeter walls, last 2 = platforms, rest = cover crates
      const mat = i < 4 ? wallMat : i >= BOXES.length - 2 ? platMat : crateMat;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.solids.push(mesh);
    });

    // Cheap neon accent strips (emissive, no extra lights)
    const neon = new THREE.MeshBasicMaterial({ color: 0x37e0a6 });
    for (const zx of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(this.halfSize * 2 - 2, 0.15, 0.15),
        neon,
      );
      strip.position.set(0, 0.08, zx * (this.halfSize - 0.6));
      this.group.add(strip);
    }
  }

  // Delegate physics to the shared, server-identical implementation.
  resolveCollision(pos: THREE.Vector3, radius: number): void {
    sharedResolve(pos, radius);
  }

  groundHeight(x: number, z: number): number {
    return sharedGround(x, z);
  }
}
