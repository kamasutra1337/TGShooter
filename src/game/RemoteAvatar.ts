import * as THREE from "three";
import { EYE } from "../../shared/sim";
import { DEFAULT_WEAPON, type WeaponId } from "../../shared/weapons";
import { buildSoldier, animateSoldier, type SoldierHandles } from "./models/Soldier";

// Visual stand-in for another networked player — a modelled soldier in its team's
// colors. Driven by server snapshots: position/orientation are smoothed toward
// the latest authoritative state; a walk cycle plays based on how fast it moves.

export class RemoteAvatar {
  readonly root = new THREE.Group();
  readonly team: number;
  private rig: SoldierHandles;
  private hitMats: THREE.MeshStandardMaterial[];
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private alive = true;
  private prev = new THREE.Vector3();
  private weapon: WeaponId;
  private scopeSprite: THREE.Sprite | null = null;

  constructor(team: number, weapon: WeaponId = DEFAULT_WEAPON) {
    this.team = team;
    this.weapon = weapon;
    this.rig = buildSoldier(team, weapon);
    this.hitMats = this.rig.hitMaterials;
    this.root.add(this.rig.group);
    if (weapon === "sniper") this.addScopeSprite();
  }

  // A floating scope reticle over the head, shown when a sniper is aiming.
  private addScopeSprite(): void {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#ff3b3b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(32, 4);
    ctx.lineTo(32, 20);
    ctx.moveTo(32, 44);
    ctx.lineTo(32, 60);
    ctx.moveTo(4, 32);
    ctx.lineTo(20, 32);
    ctx.moveTo(44, 32);
    ctx.lineTo(60, 32);
    ctx.stroke();
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(32, 32, 3, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.6, 0.6, 0.6);
    sprite.position.set(0, 2.5, 0); // above the head
    sprite.visible = false;
    sprite.renderOrder = 999;
    this.root.add(sprite);
    this.scopeSprite = sprite;
  }

  // Show/hide the "aiming" reticle (only meaningful for snipers).
  setAiming(ads: boolean): void {
    if (this.scopeSprite) this.scopeSprite.visible = ads && this.alive && this.weapon === "sniper";
  }

  // Brief red flash when shot (visual hit feedback).
  flash(): void {
    for (const m of this.hitMats) m.emissive?.setHex(0x661111);
    setTimeout(() => {
      if (this.alive) for (const m of this.hitMats) m.emissive?.setHex(0x000000);
    }, 70);
  }

  get isAlive(): boolean {
    return this.alive;
  }

  headWorld(): THREE.Vector3 {
    return new THREE.Vector3(
      this.root.position.x,
      this.root.position.y + 1.98,
      this.root.position.z,
    );
  }

  setTarget(eyeX: number, eyeY: number, eyeZ: number, yaw: number, alive: boolean): void {
    this.target.set(eyeX, eyeY - EYE, eyeZ);
    // soldier front is +z; server yaw is the aim direction → rotate +π so the
    // model faces where the player is aiming
    this.targetYaw = yaw + Math.PI;
    this.alive = alive;
    if (this.root.position.lengthSq() === 0) this.root.position.copy(this.target);
  }

  update(dt: number): void {
    this.root.visible = this.alive;
    if (!this.alive) return;
    this.prev.copy(this.root.position);
    const a = 1 - Math.exp(-dt * 14);
    this.root.position.lerp(this.target, a);
    let dy = this.targetYaw - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * a;

    const speed = dt > 0 ? this.prev.distanceTo(this.root.position) / dt : 0;
    animateSoldier(this.rig, speed, dt);
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
