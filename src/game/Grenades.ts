import * as THREE from "three";
import type { Effects } from "./Effects";
import type { NadeThrowMsg, NadeBoomMsg } from "../../shared/protocol";
import { Sound } from "./Audio";

// Client-side grenade visuals. The server is authoritative for damage; this just
// renders each thrown grenade arcing (same gravity as the server) until the
// server's boom event lands, then plays the explosion FX. If a boom is missed,
// the grenade self-cleans after its fuse.

const GRAVITY = 22;
const FLOOR = 0.15;

interface LiveNade {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number; // seconds before self-clean
}

const NADE_GEO = new THREE.SphereGeometry(0.11, 10, 8);
const NADE_MAT = new THREE.MeshStandardMaterial({ color: 0x2f3a22, roughness: 0.6, metalness: 0.3 });

export class Grenades {
  private live = new Map<number, LiveNade>();

  constructor(
    private scene: THREE.Scene,
    private effects: Effects,
  ) {}

  throw(m: NadeThrowMsg): void {
    const mesh = new THREE.Mesh(NADE_GEO, NADE_MAT);
    mesh.position.set(m.ox, m.oy, m.oz);
    this.scene.add(mesh);
    this.live.set(m.id, {
      mesh,
      x: m.ox,
      y: m.oy,
      z: m.oz,
      vx: m.vx,
      vy: m.vy,
      vz: m.vz,
      life: m.fuse + 0.5,
    });
    Sound.throwNade();
  }

  boom(m: NadeBoomMsg): void {
    const g = this.live.get(m.id);
    if (g) {
      this.scene.remove(g.mesh);
      this.live.delete(m.id);
    }
    this.effects.explosion(new THREE.Vector3(m.x, m.y, m.z));
    Sound.explosion();
  }

  update(dt: number): void {
    for (const [id, g] of this.live) {
      g.vy -= GRAVITY * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < FLOOR) {
        g.y = FLOOR;
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.6;
        g.vz *= 0.6;
      }
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += dt * 6;
      g.mesh.rotation.y += dt * 4;
      g.life -= dt;
      if (g.life <= 0) {
        this.scene.remove(g.mesh);
        this.live.delete(id);
      }
    }
  }

  clear(): void {
    for (const g of this.live.values()) this.scene.remove(g.mesh);
    this.live.clear();
  }
}
