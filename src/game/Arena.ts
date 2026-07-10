import * as THREE from "three";

// A compact, symmetric arena with cover boxes and a raised platform for
// vertical play. Boxes double as colliders (AABB) and as raycast targets so
// bullets stop on walls. Everything is static → cheap to render, easy to bake.

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export class Arena {
  readonly group = new THREE.Group();
  readonly colliders: Box[] = [];
  readonly solids: THREE.Object3D[] = []; // raycast targets (walls/cover)
  readonly halfSize = 24;
  readonly spawns: THREE.Vector3[] = [];

  build(scene: THREE.Scene): void {
    scene.add(this.group);

    // Floor
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a3140,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfSize * 2, 1, this.halfSize * 2),
      floorMat,
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.solids.push(floor);

    // Perimeter walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3a4152,
      roughness: 0.8,
    });
    const wallH = 6;
    const t = 1;
    const s = this.halfSize;
    this.addBox(0, wallH / 2, -s, s * 2, wallH, t, wallMat);
    this.addBox(0, wallH / 2, s, s * 2, wallH, t, wallMat);
    this.addBox(-s, wallH / 2, 0, t, wallH, s * 2, wallMat);
    this.addBox(s, wallH / 2, 0, t, wallH, s * 2, wallMat);

    // Cover crates (symmetric)
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x556074,
      roughness: 0.7,
    });
    const layout: [number, number, number, number, number][] = [
      // x, z, w, h, d
      [-8, -8, 3, 2.2, 3],
      [8, 8, 3, 2.2, 3],
      [8, -8, 3, 2.2, 3],
      [-8, 8, 3, 2.2, 3],
      [0, 0, 6, 1.4, 6], // central low cover
      [-14, 0, 2, 3, 6],
      [14, 0, 2, 3, 6],
      [-11, -15, 4, 3, 2], // off-center so the duel lane stays open
      [11, 15, 4, 3, 2],
    ];
    for (const [x, z, w, h, d] of layout)
      this.addBox(x, h / 2, z, w, h, d, crateMat);

    // Raised platform with ramp
    const platMat = new THREE.MeshStandardMaterial({
      color: 0x46506a,
      roughness: 0.75,
    });
    this.addBox(-16, 1.5, -16, 8, 3, 8, platMat);
    this.addBox(16, 1.5, 16, 8, 3, 8, platMat);

    // Accent emissive strips (cheap "neon" without extra lights)
    const neon = new THREE.MeshBasicMaterial({ color: 0x37e0a6 });
    for (const zx of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(this.halfSize * 2 - 2, 0.15, 0.15),
        neon,
      );
      strip.position.set(0, 0.08, zx * (s - 0.6));
      this.group.add(strip);
    }

    // Spawn points (corners + platforms)
    this.spawns.push(
      new THREE.Vector3(-16, 3.6, -16),
      new THREE.Vector3(16, 3.6, 16),
      new THREE.Vector3(-18, 1.6, 18),
      new THREE.Vector3(18, 1.6, -18),
      new THREE.Vector3(0, 1.6, -18),
    );
  }

  private addBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.solids.push(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
  }

  // Horizontal circle-vs-AABB resolution; returns corrected xz position.
  resolveCollision(pos: THREE.Vector3, radius: number): void {
    for (const b of this.colliders) {
      if (pos.y > b.max.y + 0.1 || pos.y < b.min.y - 1.5) continue;
      const closestX = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const closestZ = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  // Ground height under a point (top of the tallest box we're standing over,
  // else 0). Keeps the player on crates/platforms.
  groundHeight(x: number, z: number): number {
    let h = 0;
    for (const b of this.colliders) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
        if (b.max.y > h && b.max.y < 4.5) h = b.max.y;
      }
    }
    return h;
  }
}
