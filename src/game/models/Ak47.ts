import * as THREE from "three";

// First-person AK-47 viewmodel from primitives. Built in gun-local space with
// forward = -z (matching the camera), origin near the receiver. `muzzle` marks
// the barrel tip in world space for flashes + tracer origins.

export interface AkHandles {
  group: THREE.Group;
  muzzle: THREE.Object3D;
}

export function buildAk47(): AkHandles {
  const group = new THREE.Group();

  const metal = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.5, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.65 });
  const mag = new THREE.MeshStandardMaterial({ color: 0x2a2f24, roughness: 0.6, metalness: 0.2 });

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  // receiver body
  add(new THREE.BoxGeometry(0.06, 0.1, 0.34), metal, 0, 0, -0.05);
  // dust cover (top)
  add(new THREE.BoxGeometry(0.055, 0.04, 0.3), dark, 0, 0.06, -0.05);
  // rear wood stock
  add(new THREE.BoxGeometry(0.05, 0.09, 0.26), wood, 0, -0.01, 0.2);
  // lower wood handguard
  add(new THREE.BoxGeometry(0.055, 0.07, 0.22), wood, 0, -0.02, -0.32);
  // upper handguard
  add(new THREE.BoxGeometry(0.05, 0.04, 0.2), wood, 0, 0.04, -0.31);
  // gas block
  add(new THREE.BoxGeometry(0.04, 0.05, 0.05), metal, 0, 0.03, -0.46);

  // barrel
  const barrel = new THREE.CylinderGeometry(0.016, 0.016, 0.34, 12);
  add(barrel, dark, 0, 0.0, -0.6, Math.PI / 2, 0, 0);
  // muzzle device
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 12), metal, 0, 0, -0.78, Math.PI / 2, 0, 0);

  // front sight post
  add(new THREE.BoxGeometry(0.02, 0.06, 0.02), metal, 0, 0.06, -0.5);
  // rear sight
  add(new THREE.BoxGeometry(0.03, 0.03, 0.03), metal, 0, 0.06, -0.22);

  // ---- optical scope on the top rail ----
  add(new THREE.BoxGeometry(0.05, 0.02, 0.2), metal, 0, 0.085, -0.08); // rail
  add(new THREE.BoxGeometry(0.022, 0.05, 0.022), metal, 0, 0.11, -0.02); // rear mount
  add(new THREE.BoxGeometry(0.022, 0.05, 0.022), metal, 0, 0.11, -0.15); // front mount
  add(new THREE.CylinderGeometry(0.033, 0.033, 0.17, 16), dark, 0, 0.14, -0.08, Math.PI / 2); // tube
  add(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 16), dark, 0, 0.14, -0.17, Math.PI / 2); // objective bell
  add(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 16), dark, 0, 0.14, 0.0, Math.PI / 2); // eyepiece
  // lens glow + red dot (faces the shooter, +z)
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16),
    new THREE.MeshBasicMaterial({ color: 0x2a4a6a }),
  );
  lens.position.set(0, 0.14, 0.012);
  lens.rotation.x = Math.PI / 2;
  group.add(lens);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.006, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2b2b }),
  );
  dot.position.set(0, 0.14, 0.017);
  group.add(dot);

  // pistol grip (angled)
  add(new THREE.BoxGeometry(0.045, 0.13, 0.06), dark, 0, -0.1, 0.06, 0.35, 0, 0);

  // banana magazine (curved — three angled segments)
  add(new THREE.BoxGeometry(0.05, 0.12, 0.07), mag, 0, -0.11, -0.13, 0.2, 0, 0);
  add(new THREE.BoxGeometry(0.05, 0.1, 0.06), mag, 0, -0.2, -0.09, 0.5, 0, 0);
  add(new THREE.BoxGeometry(0.05, 0.08, 0.05), mag, 0, -0.27, -0.03, 0.8, 0, 0);

  // charging handle
  add(new THREE.BoxGeometry(0.03, 0.02, 0.02), metal, 0.04, 0.03, -0.02);

  for (const c of group.children) (c as THREE.Mesh).castShadow = false; // viewmodel: no shadows

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.84);
  group.add(muzzle);

  return { group, muzzle };
}
