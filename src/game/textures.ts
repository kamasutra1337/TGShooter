import * as THREE from "three";

// Procedural surface textures (color + normal) generated on a canvas — no image
// assets. They replace flat colors with real grain + relief so surfaces stop
// looking like flat blocks under the directional light. Cached so each kind is
// built once.

const SIZE = 256;

// Value-noise heightfield in [0,1] with a couple of octaves.
function fbm(): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  for (const [cell, amp] of [
    [8, 0.55],
    [24, 0.3],
    [64, 0.15],
  ] as const) {
    const g = cell + 1;
    const grid = new Float32Array(g * g);
    for (let i = 0; i < g * g; i++) grid[i] = Math.random();
    for (let y = 0; y < SIZE; y++) {
      const fy = (y / SIZE) * cell;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let x = 0; x < SIZE; x++) {
        const fx = (x / SIZE) * cell;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const a = grid[y0 * g + x0];
        const b = grid[y0 * g + x0 + 1];
        const c = grid[(y0 + 1) * g + x0];
        const d = grid[(y0 + 1) * g + x0 + 1];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        h[y * SIZE + x] += (top + (bot - top) * ty) * amp;
      }
    }
  }
  return h;
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, repeat: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  // Color/albedo maps must be sRGB; normal maps stay linear data.
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// Derive a tangent-space normal map from a heightfield (Sobel).
function normalMap(h: Float32Array, strength: number, repeat: number): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * SIZE + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, repeat, false); // normal map: linear
}

// Fill a canvas from the heightfield tinting a base color (fast, via ImageData).
function fillTint(
  ctx: CanvasRenderingContext2D,
  h: Float32Array,
  base: [number, number, number],
  spread: number,
): void {
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const k = (h[i] - 0.5) * spread;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + k));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + k));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + k));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

interface Surf {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

let _asphalt: Surf | null = null;
export function asphalt(repeat = 8): Surf {
  if (_asphalt) return _asphalt;
  const h = fbm();
  const [c, ctx] = canvas();
  fillTint(ctx, h, [34, 38, 46], 44);
  // gravel speckles
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(90,96,108,0.5)" : "rgba(12,14,18,0.6)";
    ctx.fillRect((Math.random() * SIZE) | 0, (Math.random() * SIZE) | 0, 1, 1);
  }
  _asphalt = { map: tex(c, repeat), normalMap: normalMap(h, 2.2, repeat) };
  return _asphalt;
}

let _concrete: Surf | null = null;
export function concrete(repeat = 3): Surf {
  if (_concrete) return _concrete;
  const h = fbm();
  const [c, ctx] = canvas();
  fillTint(ctx, h, [92, 96, 104], 40);
  // faint cracks
  ctx.strokeStyle = "rgba(30,32,38,0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let px = Math.random() * SIZE;
    let py = Math.random() * SIZE;
    ctx.moveTo(px, py);
    for (let s = 0; s < 8; s++) {
      px += (Math.random() - 0.5) * 40;
      py += (Math.random() - 0.5) * 40;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  _concrete = { map: tex(c, repeat), normalMap: normalMap(h, 1.6, repeat) };
  return _concrete;
}

let _wood: THREE.CanvasTexture | null = null;
export function wood(): THREE.CanvasTexture {
  if (_wood) return _wood;
  const [c, ctx] = canvas();
  const planks = 5;
  const pw = SIZE / planks;
  for (let p = 0; p < planks; p++) {
    const base = 108 + (Math.random() - 0.5) * 26;
    ctx.fillStyle = `rgb(${base | 0},${(base * 0.62) | 0},${(base * 0.34) | 0})`;
    ctx.fillRect(p * pw, 0, pw, SIZE);
    // grain
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(60,38,20,${0.05 + Math.random() * 0.12})`;
      ctx.beginPath();
      const gx = p * pw + Math.random() * pw;
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + 4, SIZE / 3, gx - 4, (SIZE * 2) / 3, gx + 2, SIZE);
      ctx.stroke();
    }
    // seam
    ctx.fillStyle = "rgba(30,18,8,0.7)";
    ctx.fillRect(p * pw, 0, 2, SIZE);
  }
  _wood = tex(c, 1);
  return _wood;
}
