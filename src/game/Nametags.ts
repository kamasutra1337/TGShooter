import * as THREE from "three";

// DOM nickname labels floated above players' heads. Projected each frame from a
// head world position; hidden when behind the camera or off-screen. One reused
// element per id.

export interface Tag {
  id: string;
  name: string;
  head: THREE.Vector3; // world position above the head
}

export class Nametags {
  private root: HTMLDivElement;
  private labels = new Map<string, HTMLDivElement>();

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "nametags";
    document.getElementById("app")?.appendChild(this.root);
  }

  update(camera: THREE.Camera, tags: Tag[]): void {
    const seen = new Set<string>();
    for (const tag of tags) {
      seen.add(tag.id);
      const ndc = tag.head.clone().project(camera);
      let el = this.labels.get(tag.id);
      if (ndc.z > 1 || ndc.x < -1.1 || ndc.x > 1.1) {
        if (el) el.style.display = "none";
        continue;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "nametag";
        this.root.appendChild(el);
        this.labels.set(tag.id, el);
      }
      if (el.textContent !== tag.name) el.textContent = tag.name;
      el.style.display = "block";
      el.style.left = `${(ndc.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-ndc.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) el.style.display = "none";
  }

  hideAll(): void {
    for (const el of this.labels.values()) el.style.display = "none";
  }
}
