import * as THREE from "three";
import type { Player } from "./Player";
import type { Bot } from "./Bot";
import { buildViewmodel } from "./models/Guns";
import { applySpread, spreadValue } from "../../shared/sim";
import {
  WEAPONS,
  weaponOf,
  falloffMult,
  DEFAULT_WEAPON,
  type WeaponId,
  type WeaponSpec,
} from "../../shared/weapons";

// Hitscan weapon with a swappable first-person viewmodel. All stats come from
// the chosen WeaponSpec (shared with the server) so offline practice feels the
// same as an online match. Multi-pellet weapons (shotgun) fire N rays per shot.

export interface FireResult {
  hitBot: Bot | null;
  headshot: boolean;
  point: THREE.Vector3 | null;
  damage: number; // aggregate damage this trigger pull (pellets + falloff)
}

const VM_BASE = new THREE.Vector3(0.2, -0.2, -0.5);

export class Weapon {
  private spec: WeaponSpec = WEAPONS[DEFAULT_WEAPON];

  // Live stats mirrored from the spec (read by Game/HUD).
  magSize = this.spec.magSize;
  ammo = this.spec.magSize;
  reserve = this.spec.reserve;
  damage = this.spec.damage;
  headshotMult = this.spec.headMult;
  fireRate = this.spec.fireRate;
  reloadTime = this.spec.reloadTime;

  private cooldown = 0;
  private reloading = 0;
  private bloom = 0; // random-dispersion accumulator (grows per shot, recovers)
  private sprayIndex = 0; // shot index within the current spray (recoil pattern)
  private sinceShot = 99; // seconds since last shot (resets the spray)
  private raycaster = new THREE.Raycaster();
  private scene: THREE.Scene;

  // viewmodel
  private camera: THREE.Camera | null = null;
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

  // Choose the active weapon: sync stats + (re)build the viewmodel.
  configure(id: WeaponId): void {
    this.spec = weaponOf(id);
    this.magSize = this.spec.magSize;
    this.ammo = this.spec.magSize;
    this.reserve = this.spec.reserve;
    this.damage = this.spec.damage;
    this.headshotMult = this.spec.headMult;
    this.fireRate = this.spec.fireRate;
    this.reloadTime = this.spec.reloadTime;
    this.cooldown = 0;
    this.reloading = 0;
    this.bloom = 0;
    this.tracerMat.color.setHex(this.spec.tracer);
    if (this.camera) this.buildVM();
  }

  // Reload progress 0..1 (0 = idle/full, 1 = just finished).
  reloadProgress(): number {
    return this.reloading > 0 ? 1 - this.reloading / this.reloadTime : 0;
  }

  get weaponId(): WeaponId {
    return this.spec.id;
  }

  // Attach the viewmodel to the camera (must be in the scene graph to render).
  attachViewmodel(camera: THREE.Camera): void {
    this.camera = camera;
    this.buildVM();
  }

  private buildVM(): void {
    if (!this.camera) return;
    if (this.viewmodel) {
      this.camera.remove(this.viewmodel);
      this.viewmodel.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const { group, muzzle } = buildViewmodel(this.spec.id);
    group.position.copy(VM_BASE);
    group.rotation.set(0.02, 0.06, 0);
    this.camera.add(group);
    this.viewmodel = group;
    this.muzzle = muzzle;

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

  showViewmodel(v: boolean): void {
    if (this.viewmodel) this.viewmodel.visible = v;
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

  // Cosmetic fire kick: viewmodel recoil + muzzle flash.
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

  update(dt: number, solids: THREE.Object3D[]): void {
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
    this.bloom = Math.max(0, this.bloom - dt * this.spec.bloomRecover);
    this.sinceShot += dt;

    if (this.flash.intensity > 0)
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 60);
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0 && this.flashMesh) this.flashMesh.visible = false;
    }

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
  }

  // Deterministic recoil pattern scaled by the weapon: kick the view up (and
  // gently sideways). The player pulls down to counter; settles between sprays.
  applyRecoil(player: Player): void {
    if (this.sinceShot > 0.35) this.sprayIndex = 0; // new spray
    this.sinceShot = 0;
    const i = this.sprayIndex++;
    const up = this.spec.recoilUp * (1 + Math.min(i, 10) * 0.06);
    const side = Math.sin(i * 0.9) * this.spec.recoilSide * (i > 2 ? 1 : 0.3);
    player.addRecoil(up, side);
    this.bloom = Math.min(this.bloom + this.spec.bloomPerShot, this.spec.bloomMax);
  }

  tryFire(player: Player, bots: Bot[], solids: THREE.Object3D[]): FireResult | null {
    if (this.cooldown > 0 || this.reloading > 0) return null;
    if (this.ammo <= 0) {
      this.reload();
      return null;
    }
    this.ammo--;
    this.cooldown = 1 / this.fireRate;

    const origin = player.camera.position.clone();
    const centre = player.forwardVector();
    applySpread(
      centre,
      spreadValue(this.spec, Math.hypot(player.velocity.x, player.velocity.z), player.airborne, this.bloom),
      Math.random,
    );

    const botMeshes: THREE.Object3D[] = [];
    for (const b of bots) if (b.alive) botMeshes.push(b.root);

    // Aggregate every pellet: total damage to the primary (closest) bot, plus a
    // tracer to the first pellet's endpoint.
    let result: FireResult = { hitBot: null, headshot: false, point: null, damage: 0 };
    let endPoint = origin.clone().addScaledVector(centre, 60);
    let primaryDist = Infinity;

    for (let pellet = 0; pellet < this.spec.pellets; pellet++) {
      const dir = centre.clone();
      if (this.spec.pelletSpread > 0) applySpread(dir, this.spec.pelletSpread, Math.random);

      this.raycaster.set(origin, dir);
      this.raycaster.far = 200;
      const worldHit = this.raycaster.intersectObjects(solids, false)[0];
      const botHits = this.raycaster.intersectObjects(botMeshes, true);
      const worldDist = worldHit ? worldHit.distance : Infinity;
      const firstBot = botHits[0];

      if (firstBot && firstBot.distance < worldDist) {
        const bot = this.findBot(firstBot.object, bots);
        const headshot = firstBot.object.userData.part === "head";
        if (bot) {
          const dmg =
            this.spec.damage * (headshot ? this.spec.headMult : 1) * falloffMult(this.spec, firstBot.distance);
          result.damage += dmg;
          // primary = closest hit, used for hitmarker + damage number placement
          if (firstBot.distance < primaryDist) {
            primaryDist = firstBot.distance;
            result.hitBot = bot;
            result.headshot = headshot;
            result.point = firstBot.point.clone();
          }
          if (pellet === 0) endPoint = firstBot.point.clone();
        }
      } else if (worldHit && pellet === 0) {
        endPoint = worldHit.point.clone();
        result.point = result.point ?? worldHit.point.clone();
      }
    }

    this.kick();
    this.spawnTracer(this.muzzleWorld(), endPoint);
    this.applyRecoil(player);
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

  showTracer(from: THREE.Vector3, to: THREE.Vector3, color?: number): void {
    this.spawnTracer(from, to, color);
  }

  flashAt(origin: THREE.Vector3): void {
    this.flash.position.copy(origin);
    this.flash.intensity = 6;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color?: number): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6, 1, true);
    const mat = this.tracerMat.clone();
    if (color !== undefined) mat.color.setHex(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.09, max: 0.09 });
  }
}
