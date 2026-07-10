import * as THREE from "three";
import { EYE } from "../../shared/sim";
import { buildSoldier } from "./models/Soldier";

// Visual stand-in for another networked player — a modelled soldier. Driven
// purely by server snapshots: position/orientation are smoothed toward the
// latest authoritative state so remote players glide instead of teleporting
// between 20Hz updates.

export class RemoteAvatar {
  readonly root = new THREE.Group();
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private alive = true;

  constructor(color: number) {
    this.root.add(buildSoldier(color).group);
  }

  // Server sends EYE-height y; convert to feet for the model root.
  setTarget(eyeX: number, eyeY: number, eyeZ: number, yaw: number, alive: boolean): void {
    this.target.set(eyeX, eyeY - EYE, eyeZ);
    // soldier front is +z; server yaw is the aim direction → rotate +π so the
    // model faces where the player is aiming
    this.targetYaw = yaw + Math.PI;
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
