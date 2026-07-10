import * as THREE from "three";
import type { Player } from "./Player";
import type { Bot } from "./Bot";

// Hitscan rifle. Fires from camera center with a small recoil-driven spread,
// raycasts against bots (priority) and world solids, spawns a tracer + muzzle
// flash, and applies recoil kick to the player's view.

export interface FireResult {
  hitBot: Bot | null;
  headshot: boolean;
  point: THREE.Vector3 | null;
}

export class Weapon {
  magSize = 30;
  ammo = 30;
  reserve = 90;
  damage = 26;
  headshotMult = 2.2;
  fireRate = 9; // rounds/sec
  reloadTime = 1.9;

  private cooldown = 0;
  private reloading = 0;
  private recoil = 0;
  private raycaster = new THREE.Raycaster();
  private scene: THREE.Scene;
  private tracerMat = new THREE.LineBasicMaterial({
    color: 0xfff2a8,
    transparent: true,
    opacity: 0.9,
  });
  private tracers: { line: THREE.Line; life: number }[] = [];
  private flash: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.flash = new THREE.PointLight(0xffd27a, 0, 12, 2);
    scene.add(this.flash);
  }

  get isReloading(): boolean {
    return this.reloading > 0;
  }

  reload(): void {
    if (this.reloading > 0 || this.ammo === this.magSize || this.reserve <= 0)
      return;
    this.reloading = this.reloadTime;
  }

  // recoil bleeds off; returns view-kick to apply this frame
  update(dt: number, solids: THREE.Object3D[]): { pitchKick: number } {
    void solids;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
    // recoil recovery
    const recover = Math.min(this.recoil, dt * 3.5);
    this.recoil -= recover;

    // flash decay
    if (this.flash.intensity > 0)
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 40);

    // tracers fade
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(
        0,
        tr.life * 6,
      );
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    return { pitchKick: -recover * 0.25 };
  }

  tryFire(player: Player, bots: Bot[], solids: THREE.Object3D[]): FireResult | null {
    if (this.cooldown > 0 || this.reloading > 0) return null;
    if (this.ammo <= 0) {
      this.reload();
      return null;
    }
    this.ammo--;
    this.cooldown = 1 / this.fireRate;
    this.recoil = Math.min(this.recoil + 0.12, 0.6);

    // Fire from camera with spread growing with recoil
    const origin = player.camera.position.clone();
    const dir = player.forwardVector();
    const spread = 0.008 + this.recoil * 0.03;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    this.raycaster.set(origin, dir);
    this.raycaster.far = 200;

    // Collect candidate meshes: bot hitboxes + world solids
    const botMeshes: THREE.Object3D[] = [];
    for (const b of bots) if (b.alive) botMeshes.push(b.root);

    const worldHit = this.raycaster.intersectObjects(solids, false)[0];
    const botHits = this.raycaster.intersectObjects(botMeshes, true);

    let result: FireResult = { hitBot: null, headshot: false, point: null };
    let endPoint = origin.clone().addScaledVector(dir, 60);

    const firstBot = botHits[0];
    const worldDist = worldHit ? worldHit.distance : Infinity;
    if (firstBot && firstBot.distance < worldDist) {
      const bot = this.findBot(firstBot.object, bots);
      const headshot = firstBot.object.userData.part === "head";
      if (bot) {
        result = { hitBot: bot, headshot, point: firstBot.point.clone() };
        endPoint = firstBot.point.clone();
      }
    } else if (worldHit) {
      endPoint = worldHit.point.clone();
      result.point = worldHit.point.clone();
    }

    this.spawnTracer(origin, endPoint);
    this.muzzleFlash(origin, dir);
    return result;
  }

  private findBot(obj: THREE.Object3D, bots: Bot[]): Bot | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const found = bots.find((b) => b.root === o);
      if (found) return found;
      o = o.parent;
    }
    return null;
  }

  // Public hooks for networked mode: draw a tracer / muzzle flash from
  // server-reported shot events (accurate impact points).
  showTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    this.spawnTracer(from, to);
  }
  flashAt(origin: THREE.Vector3): void {
    this.flash.position.copy(origin);
    this.flash.intensity = 6;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  private muzzleFlash(origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.flash.position.copy(origin).addScaledVector(dir, 0.6);
    this.flash.intensity = 6;
  }
}
