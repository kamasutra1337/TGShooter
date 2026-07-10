import * as THREE from "three";
import { EYE } from "../../shared/sim";

// Visual stand-in for another networked player. Driven purely by server
// snapshots — position/orientation are smoothed toward the latest authoritative
// state so remote players glide instead of teleporting between 20Hz updates.

export class RemoteAvatar {
  readonly root = new THREE.Group();
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private alive = true;

  constructor(color: number) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }),
    );
    body.position.y = 0.9;
    body.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffe0b0, roughness: 0.4 }),
    );
    head.position.y = 1.75;
    head.castShadow = true;

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.08, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x37e0a6 }),
    );
    visor.position.set(0, 1.78, 0.26);

    this.root.add(body, head, visor);
  }

  // Server sends EYE-height y; convert to feet for the model root.
  setTarget(eyeX: number, eyeY: number, eyeZ: number, yaw: number, alive: boolean): void {
    this.target.set(eyeX, eyeY - EYE, eyeZ);
    this.targetYaw = yaw;
    this.alive = alive;
    // first update snaps into place
    if (this.root.position.lengthSq() === 0) this.root.position.copy(this.target);
  }

  update(dt: number): void {
    this.root.visible = this.alive;
    if (!this.alive) return;
    const a = 1 - Math.exp(-dt * 14); // exponential smoothing
    this.root.position.lerp(this.target, a);
    // shortest-arc yaw lerp
    let dy = this.targetYaw - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * a;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
