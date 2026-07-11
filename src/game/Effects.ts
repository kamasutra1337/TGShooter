import * as THREE from "three";

// Pooled particle bursts for bullet impacts + muzzle smoke. Kept cheap: small
// additive sprites that fly out, fall, and fade. A hard cap prevents runaway
// particle counts.

interface Part {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  grav: number;
  base: number; // base opacity
  smoke: boolean;
}

const MAX_PARTS = 160;
const SPARK_GEO = new THREE.SphereGeometry(1, 6, 5);
const SMOKE_GEO = new THREE.PlaneGeometry(1, 1);

export class Effects {
  private scene: THREE.Scene;
  private parts: Part[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // Bullet impact: dust/sparks on walls, a red puff on flesh.
  impact(point: THREE.Vector3, flesh: boolean): void {
    const n = flesh ? 7 : 5;
    const color = flesh ? 0xc0392b : 0xffd27a;
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_PARTS) break;
      const mesh = new THREE.Mesh(
        SPARK_GEO,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.position.copy(point);
      mesh.scale.setScalar(0.04 + Math.random() * 0.05);
      const sp = 2 + Math.random() * 3.5;
      this.parts.push({
        mesh,
        vx: (Math.random() - 0.5) * sp,
        vy: Math.random() * sp * 0.9,
        vz: (Math.random() - 0.5) * sp,
        life: 0.3 + Math.random() * 0.15,
        max: 0.4,
        grav: 12,
        base: 1,
        smoke: false,
      });
      this.scene.add(mesh);
    }
    // brief impact flash
    if (this.parts.length < MAX_PARTS) {
      const flash = new THREE.Mesh(
        SPARK_GEO,
        new THREE.MeshBasicMaterial({
          color: flesh ? 0xff6a5a : 0xfff2c0,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flash.position.copy(point);
      flash.scale.setScalar(0.18);
      this.parts.push({ mesh: flash, vx: 0, vy: 0, vz: 0, life: 0.09, max: 0.09, grav: 0, base: 0.9, smoke: false });
      this.scene.add(flash);
    }
  }

  // A soft smoke puff drifting up from the muzzle.
  muzzleSmoke(point: THREE.Vector3): void {
    if (this.parts.length >= MAX_PARTS) return;
    const mesh = new THREE.Mesh(
      SMOKE_GEO,
      new THREE.MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    mesh.position.copy(point);
    mesh.scale.setScalar(0.15);
    this.parts.push({
      mesh,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.7 + Math.random() * 0.4,
      vz: (Math.random() - 0.5) * 0.5,
      life: 0.45,
      max: 0.45,
      grav: -1,
      base: 0.28,
      smoke: true,
    });
    this.scene.add(mesh);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.smoke) {
        p.mesh.scale.multiplyScalar(1 + dt * 2.5); // smoke grows
        p.mesh.lookAt(camera.position);
      }
      const t = Math.max(0, p.life / p.max);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t * p.base;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.parts.splice(i, 1);
      }
    }
  }
}
