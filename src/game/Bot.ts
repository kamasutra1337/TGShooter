import * as THREE from "three";
import type { Arena } from "./Arena";
import type { Player } from "./Player";
import { buildSoldier } from "./models/Soldier";

// Enemy bot: a fully-modelled soldier with a tagged head mesh (headshots).
// AI states: wander → chase when it sees the player → shoot on a timer with
// human-ish inaccuracy. Not authoritative — this is the offline stand-in for
// real opponents; the same interface (root, alive, damage, update) is also how
// networked avatars render.

export type BotState = "wander" | "chase";

export class Bot {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  alive = true;
  health = 100;

  private state: BotState = "wander";
  private wanderTarget = new THREE.Vector3();
  private shootTimer = 1.5;
  private velocity = new THREE.Vector3();
  private hitMats: THREE.MeshStandardMaterial[];
  private readonly radius = 0.45;
  private readonly speed = 3.4;

  constructor(color = 0xff5a6a) {
    const soldier = buildSoldier(color);
    this.hitMats = soldier.hitMaterials;
    this.root.add(soldier.group);
  }

  spawn(pos: THREE.Vector3): void {
    this.alive = true;
    this.health = 100;
    this.position.copy(pos);
    this.position.y = 0;
    this.root.position.copy(this.position);
    this.root.visible = true;
    this.state = "wander";
    this.pickWander();
  }

  kill(): void {
    this.alive = false;
    this.root.visible = false;
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    // hit flash across the uniform/vest materials
    for (const m of this.hitMats) m.emissive?.setHex(0x661111);
    setTimeout(() => {
      if (this.alive) for (const m of this.hitMats) m.emissive?.setHex(0x000000);
    }, 70);
    if (this.health <= 0) {
      this.kill();
      return true; // died
    }
    return false;
  }

  private pickWander(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 12;
    this.wanderTarget.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  // Returns a shot at the player this frame (damage) or 0.
  update(dt: number, player: Player, arena: Arena): number {
    if (!this.alive) return 0;

    const toPlayer = new THREE.Vector3().subVectors(
      player.position,
      this.position,
    );
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const canSee = dist < 30 && player.alive;

    this.state = canSee ? "chase" : "wander";

    let dir: THREE.Vector3;
    if (this.state === "chase") {
      dir = toPlayer.clone().normalize();
      // keep some distance — strafe when close
      if (dist < 8) {
        const strafe = new THREE.Vector3(-dir.z, 0, dir.x);
        dir.addScaledVector(strafe, Math.sin(this.shootTimer * 3));
        dir.multiplyScalar(0.4);
      }
    } else {
      const toTarget = new THREE.Vector3().subVectors(
        this.wanderTarget,
        this.position,
      );
      toTarget.y = 0;
      if (toTarget.length() < 1.5) this.pickWander();
      dir = toTarget.normalize();
    }

    this.velocity.x = dir.x * this.speed;
    this.velocity.z = dir.z * this.speed;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    arena.resolveCollision(this.position, this.radius);
    const lim = arena.halfSize - this.radius - 0.6;
    this.position.x = Math.max(-lim, Math.min(lim, this.position.x));
    this.position.z = Math.max(-lim, Math.min(lim, this.position.z));
    this.position.y = arena.groundHeight(this.position.x, this.position.z);

    this.root.position.copy(this.position);
    // face movement / player
    const faceDir = this.state === "chase" ? toPlayer : this.velocity;
    if (faceDir.lengthSq() > 0.001)
      this.root.rotation.y = Math.atan2(faceDir.x, faceDir.z);

    // Shooting
    let dealt = 0;
    if (this.state === "chase" && dist < 26) {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        this.shootTimer = 1.1 + Math.random() * 0.9;
        // hit chance falls off with distance
        const hitChance = Math.max(0.15, 0.75 - dist * 0.02);
        if (Math.random() < hitChance) dealt = 8 + Math.floor(Math.random() * 7);
      }
    }
    return dealt;
  }
}
