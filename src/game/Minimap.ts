// Top-down radar. Rotates so the player's aim is always "up". Teammates always
// show; enemies only within radar range (so it aids awareness without wallhacks).

export interface Blip {
  x: number;
  z: number;
  team: number;
  alive: boolean;
}

const RANGE = 46; // world metres mapped to the radar edge
const ENEMY_RANGE = 40; // enemies only appear within this distance

export class Minimap {
  private ctx: CanvasRenderingContext2D | null;
  private r: number;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    this.r = canvas.width / 2;
  }

  draw(selfX: number, selfZ: number, yaw: number, myTeam: number, blips: Blip[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = this.r;
    ctx.clearRect(0, 0, r * 2, r * 2);

    // backdrop
    ctx.fillStyle = "rgba(8,12,20,0.55)";
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "up" = where the player faces. Server yaw 0 faces -z; rotate world so that
    // direction points up on the radar.
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);

    for (const b of blips) {
      const dx = b.x - selfX;
      const dz = b.z - selfZ;
      const dist = Math.hypot(dx, dz);
      const enemy = b.team !== myTeam;
      if (!b.alive) continue;
      if (enemy && dist > ENEMY_RANGE) continue;
      if (dist > RANGE) continue;
      // rotate (dx,dz) by -yaw; forward (-z) → up (−y on canvas)
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const px = r + (rx / RANGE) * (r - 6);
      const py = r + (rz / RANGE) * (r - 6);
      ctx.fillStyle = enemy ? "#ff5a5a" : "#4aa8ff";
      ctx.beginPath();
      ctx.arc(px, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // self marker (arrow pointing up)
    ctx.fillStyle = "#37e0a6";
    ctx.beginPath();
    ctx.moveTo(r, r - 6);
    ctx.lineTo(r - 4, r + 5);
    ctx.lineTo(r + 4, r + 5);
    ctx.closePath();
    ctx.fill();
  }

  clear(): void {
    this.ctx?.clearRect(0, 0, this.r * 2, this.r * 2);
  }
}
