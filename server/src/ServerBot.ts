import type { SimInput, SimPlayer } from "../../shared/sim";

// Server-side bot brain. Produces the SAME SimInput a human client would send,
// so bots run through the identical authoritative movement + hitscan pipeline —
// no special-casing, no way for a bot to "cheat" the sim.

export class ServerBot {
  private shootTimer = 1.2 + Math.random();
  private wander = { x: 0, z: 0 };
  private aimNoise = 0;

  constructor() {
    this.pickWander();
  }

  private pickWander(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 12;
    this.wander = { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  think(self: SimPlayer, players: SimPlayer[], dt: number): SimInput {
    const input: SimInput = {
      moveX: 0,
      moveY: 0,
      yaw: self.yaw,
      pitch: self.pitch,
      fire: false,
      jump: false,
      reload: false,
    };
    if (!self.alive) return input;

    // nearest alive enemy
    let target: SimPlayer | null = null;
    let bestD = Infinity;
    for (const p of players) {
      if (p === self || !p.alive) continue;
      const d = Math.hypot(p.pos.x - self.pos.x, p.pos.z - self.pos.z);
      if (d < bestD) {
        bestD = d;
        target = p;
      }
    }

    if (!target || bestD > 34) {
      // wander
      const dx = this.wander.x - self.pos.x;
      const dz = this.wander.z - self.pos.z;
      const l = Math.hypot(dx, dz);
      if (l < 1.5) this.pickWander();
      input.yaw = Math.atan2(-dx, -dz);
      input.moveY = 1;
      return input;
    }

    // aim at target (matches dirFromAngles convention)
    const dx = target.pos.x - self.pos.x;
    const dz = target.pos.z - self.pos.z;
    const dy = target.pos.y - self.pos.y; // eye-to-eye
    const h = Math.hypot(dx, dz);
    const len = Math.hypot(dx, dy, dz) || 1;

    // drift aim noise for human-ish inaccuracy
    this.aimNoise += (Math.random() - 0.5) * 0.06;
    this.aimNoise *= 0.9;

    input.yaw = Math.atan2(-dx, -dz) + this.aimNoise;
    input.pitch = Math.asin(Math.max(-1, Math.min(1, -dy / len))) + this.aimNoise * 0.3;

    // movement: approach if far, strafe if close
    if (bestD > 9) {
      input.moveY = 1;
    } else {
      input.moveX = Math.sin(performance.now() / 500 + self.pos.x) > 0 ? 1 : -1;
      input.moveY = bestD < 5 ? -0.5 : 0.2;
    }

    // fire on a timer when in range and roughly facing
    this.shootTimer -= dt;
    if (bestD < 28 && h > 0.5 && this.shootTimer <= 0) {
      this.shootTimer = 0.9 + Math.random() * 0.7;
      input.fire = true;
    }

    if (self.ammo === 0) input.reload = true;
    return input;
  }
}
