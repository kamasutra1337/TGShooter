// Unified input: desktop (keyboard + pointer-lock mouse) and mobile (twin-stick
// touch). The game reads a single normalized state each frame and never cares
// which device produced it.

export interface InputState {
  moveX: number; // -1..1 strafe
  moveY: number; // -1..1 forward/back (+ = forward)
  lookDX: number; // yaw delta this frame (radians-ish, scaled by sensitivity)
  lookDY: number; // pitch delta this frame
  firing: boolean;
  jumpQueued: boolean;
  reloadQueued: boolean;
  sprint: boolean; // faster move (auto on full-forward touch / Shift)
  crouch: boolean; // toggled
  ads: boolean; // aim-down-sights (hold)
  throwQueued: boolean; // edge: grenade throw
  scoreboard: boolean; // hold to show the scoreboard
}

export class Input {
  state: InputState = {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    firing: false,
    jumpQueued: false,
    reloadQueued: false,
    sprint: false,
    crouch: false,
    ads: false,
    throwQueued: false,
    scoreboard: false,
  };

  sensitivity = 0.0022;
  touchSensitivity = 0.006;
  private readonly baseSens = 0.0022;
  private readonly baseTouchSens = 0.006;

  // Aim multiplier from settings (1 = default).
  setSensitivity(mult: number): void {
    this.sensitivity = this.baseSens * mult;
    this.touchSensitivity = this.baseTouchSens * mult;
  }

  // Force aim-down-sights off (e.g. on death) + reset the toggle button.
  clearAds(): void {
    this.state.ads = false;
    document.getElementById("btn-ads")?.classList.remove("active");
  }

  private keys = new Set<string>();
  private pointerLocked = false;
  private canvas: HTMLCanvasElement;
  private isTouch: boolean;

  // touch stick state
  private moveTouchId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private lookTouchId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private fireTouchId: number | null = null;
  private fireLast = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isTouch =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  get usingTouch(): boolean {
    return this.isTouch;
  }

  attach(): void {
    if (this.isTouch) this.attachTouch();
    else this.attachDesktop();
  }

  // Consume per-frame deltas so they don't accumulate.
  endFrame(): void {
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this.state.jumpQueued = false;
    this.state.reloadQueued = false;
    this.state.throwQueued = false;
    // Touch sprint follows the stick: full-forward push = sprint.
    if (this.isTouch) this.state.sprint = this.state.moveY > 0.85;
  }

  // ---------------- desktop ----------------
  private typing(): boolean {
    const a = document.activeElement;
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
  }

  clearKeys(): void {
    this.keys.clear();
    this.state.moveX = 0;
    this.state.moveY = 0;
  }

  private attachDesktop(): void {
    window.addEventListener("keydown", (e) => {
      if (this.typing()) return; // don't move the player while typing in chat
      this.keys.add(e.code);
      if (e.code === "Space") this.state.jumpQueued = true;
      if (e.code === "KeyR") this.state.reloadQueued = true;
      if (e.code === "KeyG") this.state.throwQueued = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.state.sprint = true;
      if (e.code === "ControlLeft" || e.code === "KeyC") this.state.crouch = true;
      if (e.code === "Tab") {
        this.state.scoreboard = true;
        e.preventDefault();
      }
      this.recomputeKeys();
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.state.sprint = false;
      if (e.code === "ControlLeft" || e.code === "KeyC") this.state.crouch = false;
      if (e.code === "Tab") this.state.scoreboard = false;
      this.recomputeKeys();
    });

    this.canvas.addEventListener("click", () => {
      if (!this.pointerLocked) this.canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.state.lookDX += e.movementX * this.sensitivity;
      this.state.lookDY += e.movementY * this.sensitivity;
    });
    window.addEventListener("mousedown", (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) this.state.firing = true;
      if (e.button === 2) this.state.ads = true; // right mouse = aim
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.state.firing = false;
      if (e.button === 2) this.state.ads = false;
    });
    window.addEventListener("contextmenu", (e) => e.preventDefault()); // free RMB
  }

  private recomputeKeys(): void {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW")) y += 1;
    if (this.keys.has("KeyS")) y -= 1;
    if (this.keys.has("KeyD")) x += 1;
    if (this.keys.has("KeyA")) x -= 1;
    this.state.moveX = x;
    this.state.moveY = y;
  }

  // ---------------- touch ----------------
  private attachTouch(): void {
    const moveStick = document.getElementById("move-stick")!;
    const knob = moveStick.querySelector(".knob") as HTMLElement;
    const lookPad = document.getElementById("look-pad")!;
    const fire = document.getElementById("btn-fire")!;
    const jump = document.getElementById("btn-jump")!;
    const reload = document.getElementById("btn-reload")!;

    const stickRadius = 55;

    moveStick.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      this.moveTouchId = t.identifier;
      const r = moveStick.getBoundingClientRect();
      this.moveOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    });

    const moveUpdate = (e: TouchEvent) => {
      if (this.moveTouchId === null) return;
      const t = this.findTouch(e, this.moveTouchId);
      if (!t) return;
      let dx = t.clientX - this.moveOrigin.x;
      let dy = t.clientY - this.moveOrigin.y;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, stickRadius);
      dx = (dx / len) * clamped;
      dy = (dy / len) * clamped;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.state.moveX = dx / stickRadius;
      this.state.moveY = -dy / stickRadius;
      e.preventDefault();
    };
    const moveEnd = (e: TouchEvent) => {
      if (this.moveTouchId === null) return;
      if (!this.findTouchInList(e.changedTouches, this.moveTouchId)) return;
      this.moveTouchId = null;
      this.state.moveX = 0;
      this.state.moveY = 0;
      knob.style.transform = "translate(0,0)";
    };
    moveStick.addEventListener("touchmove", moveUpdate);
    window.addEventListener("touchmove", moveUpdate, { passive: false });
    window.addEventListener("touchend", moveEnd);
    window.addEventListener("touchcancel", moveEnd);

    lookPad.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      this.lookTouchId = t.identifier;
      this.lookLast = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    });
    const lookUpdate = (e: TouchEvent) => {
      if (this.lookTouchId === null) return;
      const t = this.findTouch(e, this.lookTouchId);
      if (!t) return;
      this.state.lookDX += (t.clientX - this.lookLast.x) * this.touchSensitivity;
      this.state.lookDY += (t.clientY - this.lookLast.y) * this.touchSensitivity;
      this.lookLast = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    };
    const lookEnd = (e: TouchEvent) => {
      if (this.lookTouchId === null) return;
      if (!this.findTouchInList(e.changedTouches, this.lookTouchId)) return;
      this.lookTouchId = null;
    };
    lookPad.addEventListener("touchmove", lookUpdate);
    lookPad.addEventListener("touchend", lookEnd);
    lookPad.addEventListener("touchcancel", lookEnd);

    // Fire button doubles as an aim pad: touch to fire, drag to aim — so the
    // shooting thumb can also steer the shot (no third finger needed).
    fire.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      this.fireTouchId = t.identifier;
      this.fireLast = { x: t.clientX, y: t.clientY };
      this.state.firing = true;
      e.preventDefault();
    });
    const fireMove = (e: TouchEvent) => {
      if (this.fireTouchId === null) return;
      const t = this.findTouch(e, this.fireTouchId);
      if (!t) return;
      this.state.lookDX += (t.clientX - this.fireLast.x) * this.touchSensitivity;
      this.state.lookDY += (t.clientY - this.fireLast.y) * this.touchSensitivity;
      this.fireLast = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    };
    const fireEnd = (e: TouchEvent) => {
      if (this.fireTouchId === null) return;
      if (!this.findTouchInList(e.changedTouches, this.fireTouchId)) return;
      this.fireTouchId = null;
      this.state.firing = false;
    };
    window.addEventListener("touchmove", fireMove, { passive: false });
    window.addEventListener("touchend", fireEnd);
    window.addEventListener("touchcancel", fireEnd);

    jump.addEventListener("touchstart", (e) => {
      this.state.jumpQueued = true;
      e.preventDefault();
    });
    reload.addEventListener("touchstart", (e) => {
      this.state.reloadQueued = true;
      e.preventDefault();
    });

    // crouch: toggle. ads: hold. grenade: tap.
    const crouchBtn = document.getElementById("btn-crouch");
    crouchBtn?.addEventListener("touchstart", (e) => {
      this.state.crouch = !this.state.crouch;
      crouchBtn.classList.toggle("active", this.state.crouch);
      e.preventDefault();
    });
    // ADS is a TAP TOGGLE on touch (no need to hold a third finger while the
    // shooting thumb aims + fires). Tap to zoom in, tap again to zoom out.
    const adsBtn = document.getElementById("btn-ads");
    adsBtn?.addEventListener("touchstart", (e) => {
      this.state.ads = !this.state.ads;
      adsBtn.classList.toggle("active", this.state.ads);
      e.preventDefault();
    });
    const nadeBtn = document.getElementById("btn-nade");
    nadeBtn?.addEventListener("touchstart", (e) => {
      this.state.throwQueued = true;
      e.preventDefault();
    });
    const scoreBtn = document.getElementById("btn-score");
    scoreBtn?.addEventListener("touchstart", (e) => {
      this.state.scoreboard = !this.state.scoreboard; // tap toggles
      scoreBtn.classList.toggle("active", this.state.scoreboard);
      e.preventDefault();
    });
  }

  private findTouch(e: TouchEvent, id: number): Touch | null {
    return this.findTouchInList(e.touches, id);
  }
  private findTouchInList(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i++)
      if (list[i].identifier === id) return list[i];
    return null;
  }
}
