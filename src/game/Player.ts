import * as THREE from "three";
import type { Arena } from "./Arena";
import type { InputState } from "./Input";

// First-person controller. Source-inspired feel: quick acceleration, air
// control, gravity + jump. Camera IS the player's eye. Collision is resolved
// against the arena's AABB colliders each frame.

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3(0, 1.6, 18);
  velocity = new THREE.Vector3();

  yaw = 0; // player-controlled aim (yaw 0 → facing -z into the arena)
  pitch = 0;

  // Recoil offset added on top of the controlled aim; recovers toward 0. The
  // effective view = (yaw + recoilYaw, pitch + recoilPitch). This is what makes
  // a spray climb and then settle back, CS/Valorant-style.
  recoilPitch = 0;
  recoilYaw = 0;
  private readonly recoilRecover = 7; // per second (snappy settle)

  health = 100;
  alive = true;

  readonly eyeHeight = 1.6;
  readonly radius = 0.4;
  private grounded = false;

  get airborne(): boolean {
    return !this.grounded;
  }

  // Kick the view: `up` radians upward, `side` radians sideways (recoil pattern).
  addRecoil(up: number, side: number): void {
    this.recoilPitch -= up; // negative pitch = looking up
    this.recoilYaw += side;
  }

  private effYaw(): number {
    return this.yaw + this.recoilYaw;
  }
  private effPitch(): number {
    return Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch + this.recoilPitch));
  }
  viewYaw(): number {
    return this.effYaw();
  }
  viewPitch(): number {
    return this.effPitch();
  }

  // tuning
  private readonly moveSpeed = 7.2;
  private readonly accel = 60;
  private readonly airAccel = 12;
  private readonly friction = 9;
  private readonly gravity = 22;
  private readonly jumpSpeed = 8;
  private readonly maxPitch = Math.PI / 2 - 0.05;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(78, aspect, 0.05, 500);
    this.syncCamera();
  }

  reset(spawn: THREE.Vector3, lookYaw: number): void {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = lookYaw;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.health = 100;
    this.alive = true;
    this.syncCamera();
  }

  // Snap the eye to an authoritative position (server reconciliation / respawn).
  // Keeps current aim (yaw/pitch) — aim stays client-controlled.
  teleport(eye: THREE.Vector3): void {
    this.position.copy(eye);
    this.velocity.set(0, 0, 0);
    this.syncCamera();
  }

  damage(amount: number): void {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  forwardVector(): THREE.Vector3 {
    const y = this.effYaw();
    const p = this.effPitch();
    return new THREE.Vector3(
      Math.sin(y) * Math.cos(p),
      Math.sin(p),
      Math.cos(y) * Math.cos(p),
    ).multiplyScalar(-1);
  }

  update(dt: number, input: InputState, arena: Arena): void {
    if (!this.alive) return;

    // Look
    this.yaw -= input.lookDX;
    this.pitch -= input.lookDY;
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));

    // Recoil recovers toward 0 (the view settles after a spray)
    const rec = Math.exp(-dt * this.recoilRecover);
    this.recoilPitch *= rec;
    this.recoilYaw *= rec;

    // Desired wish-direction in world space (flat)
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward (-z when yaw=0 handled by sign), strafe
    const wish = new THREE.Vector3();
    wish.x += -sinY * input.moveY; // forward
    wish.z += -cosY * input.moveY;
    wish.x += cosY * input.moveX; // strafe
    wish.z += -sinY * input.moveX;
    if (wish.lengthSq() > 1) wish.normalize();

    const a = this.grounded ? this.accel : this.airAccel;

    // Apply friction on ground
    if (this.grounded) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 0) {
        const drop = speed * this.friction * dt;
        const factor = Math.max(speed - drop, 0) / speed;
        this.velocity.x *= factor;
        this.velocity.z *= factor;
      }
    }

    // Accelerate toward wish dir (capped)
    const curSpeed = this.velocity.x * wish.x + this.velocity.z * wish.z;
    const addSpeed = this.moveSpeed - curSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(a * dt * this.moveSpeed, addSpeed);
      this.velocity.x += wish.x * accelSpeed;
      this.velocity.z += wish.z * accelSpeed;
    }

    // Jump
    if (input.jumpQueued && this.grounded) {
      this.velocity.y = this.jumpSpeed;
      this.grounded = false;
    }

    // Gravity
    this.velocity.y -= this.gravity * dt;

    // Integrate
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Horizontal collision
    arena.resolveCollision(this.position, this.radius);

    // Keep inside arena bounds
    const lim = arena.halfSize - this.radius - 0.6;
    this.position.x = Math.max(-lim, Math.min(lim, this.position.x));
    this.position.z = Math.max(-lim, Math.min(lim, this.position.z));

    // Ground / floor
    const ground = arena.groundHeight(this.position.x, this.position.z);
    const feetTarget = ground + this.eyeHeight;
    if (this.position.y <= feetTarget) {
      this.position.y = feetTarget;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    this.syncCamera();
  }

  private syncCamera(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.effYaw();
    this.camera.rotation.x = this.effPitch();
  }
}
