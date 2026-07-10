import * as THREE from "three";
import type { Player } from "./Player";
import type { Bot } from "./Bot";
import { buildAk47 } from "./models/Ak47";

// Hitscan AK-47 with a first-person viewmodel. Fires from camera center (accurate
// aim) with recoil-driven spread; tracers + muzzle flash originate at the gun
// barrel; the viewmodel kicks on fire and dips on reload.

export interface FireResult {
  hitBot: Bot | null;
  headshot: boolean;
  point: THREE.Vector3 | null;
}

const VM_BASE = new THREE.Vector3(0.2, -0.2, -0.5);

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

  // viewmodel
  private viewmodel: THREE.Group | null = null;
  private muzzle: THREE.Object3D | null = null;
  private vmKick = 0;
  private flashMesh: THREE.Mesh | null = null;
  private flashTimer = 0;

  private tracerMat = new THREE.MeshBasicMaterial({
    color: 0xfff1a0,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private tracers: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  private flash: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.flash = new THREE.PointLight(0xffd27a, 0, 14, 2);
    scene.add(this.flash);
  }

  // Attach the AK to the camera as a first-person viewmodel. The camera must be
  // added to the scene graph for its children to render.
  attachViewmodel(camera: THREE.Camera): void {
    const { group, muzzle } = buildAk47();
    group.position.copy(VM_BASE);
    group.rotation.set(0.02, 0.06, 0);
    camera.add(group);
    this.viewmodel = group;
    this.muzzle = muzzle;

    // muzzle flash quad, child of the barrel tip
    const flashGeo = new THREE.PlaneGeometry(0.32, 0.32);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.flashMesh.visible = false;
    muzzle.add(this.flashMesh);
  }

  muzzleWorld(): THREE.Vector3 {
    if (this.muzzle) return this.muzzle.getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3();
  }

  get isReloading(): boolean {
    return this.reloading > 0;
  }

  reload(): void {
    if (this.reloading > 0 || this.ammo === this.magSize || this.reserve <= 0)
      return;
    this.reloading = this.reloadTime;
  }

  // Cosmetic fire kick: viewmodel recoil + muzzle flash. Used by both offline
  // (from tryFire) and online (local fire cadence).
  kick(): void {
    this.vmKick = Math.min(this.vmKick + 0.9, 1.4);
    const mw = this.muzzleWorld();
    this.flash.position.copy(mw);
    this.flash.intensity = 7;
    if (this.flashMesh) {
      this.flashMesh.visible = true;
      this.flashMesh.scale.setScalar(0.7 + Math.random() * 0.6);
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      this.flashTimer = 0.05;
    }
  }

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
    const recover = Math.min(this.recoil, dt * 3.5);
    this.recoil -= recover;

    if (this.flash.intensity > 0)
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 60);
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0 && this.flashMesh) this.flashMesh.visible = false;
    }

    // viewmodel animation: recoil ease-back + reload dip
    if (this.viewmodel) {
      this.vmKick += (0 - this.vmKick) * Math.min(1, dt * 12);
      const reloadPhase =
        this.reloading > 0
          ? Math.sin(Math.PI * (1 - this.reloading / this.reloadTime))
          : 0;
      this.viewmodel.position.set(
        VM_BASE.x,
        VM_BASE.y - reloadPhase * 0.16 - this.vmKick * 0.01,
        VM_BASE.z + this.vmKick * 0.06,
      );
      this.viewmodel.rotation.set(
        0.02 + this.vmKick * 0.18,
        0.06,
        reloadPhase * 0.5,
      );
    }

    // tracers fade
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        (tr.life / tr.max) * 0.95,
      );
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
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

    const origin = player.camera.position.clone();
    const dir = player.forwardVector();
    const spread = 0.008 + this.recoil * 0.03;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    this.raycaster.set(origin, dir);
    this.raycaster.far = 200;

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

    this.kick();
    this.spawnTracer(this.muzzleWorld(), endPoint);
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

  // Networked: draw a tracer from server-reported shot events.
  showTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    this.spawnTracer(from, to);
  }

  // Remote muzzle flash (point light only — not our gun).
  flashAt(origin: THREE.Vector3): void {
    this.flash.position.copy(origin);
    this.flash.intensity = 6;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6, 1, true);
    const mesh = new THREE.Mesh(geo, this.tracerMat.clone());
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.09, max: 0.09 });
  }
}
