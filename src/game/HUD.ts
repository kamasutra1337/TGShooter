// DOM-driven HUD. Kept out of the render loop's hot path — we only touch the
// DOM when a value actually changes.

export class HUD {
  private root = document.getElementById("hud")!;
  private healthFill = document.getElementById("health-fill")!;
  private healthNum = document.getElementById("health-num")!;
  private ammoMag = document.getElementById("ammo-mag")!;
  private ammoReserve = document.getElementById("ammo-reserve")!;
  private weaponName = document.getElementById("weapon-name")!;
  private reloadBar = document.getElementById("reload-bar")!;
  private reloadFill = document.getElementById("reload-fill")!;
  private scoreEl = document.getElementById("score")!;
  private hitmarker = document.getElementById("hitmarker")!;
  private damageFlash = document.getElementById("damage-flash")!;
  private potBanner = document.getElementById("pot-banner")!;
  private spectate = document.getElementById("spectate")!;
  private killfeed = document.getElementById("killfeed")!;
  private teamStatus = document.getElementById("team-status")!;
  private teamMine = document.getElementById("team-mine")!;
  private teamFoe = document.getElementById("team-foe")!;
  private countdownEl = document.getElementById("countdown")!;
  private chatFeed = document.getElementById("chat-feed")!;
  private matchTimer = document.getElementById("match-timer")!;
  private scoreboard = document.getElementById("scoreboard")!;
  private dmgDir = document.getElementById("dmg-dir")!;

  private lastHealth = -1;
  private lastMag = -1;
  private lastReserve = -1;
  private lastScore = -1;
  private hitTimer = 0;

  show(): void {
    this.root.classList.remove("hidden");
    this.killfeed.innerHTML = "";
    this.chatFeed.innerHTML = "";
    this.teamStatus.classList.add("hidden");
    this.countdownEl.classList.add("hidden");
    this.setSpectate(null);
  }
  hide(): void {
    this.root.classList.add("hidden");
  }

  // In-match chat line (fades). cls: "me" | "blue" | "red" | "".
  chatMessage(name: string, text: string, cls: string): void {
    const el = document.createElement("div");
    el.className = "chat-line";
    el.innerHTML = `<span class="cl-name ${cls}">${esc(name)}</span>${esc(text)}`;
    this.chatFeed.appendChild(el);
    while (this.chatFeed.children.length > 6) this.chatFeed.firstChild?.remove();
    setTimeout(() => el.remove(), 8000);
  }

  killFeed(killer: string, victim: string, mine: boolean, weapon?: string): void {
    const icon = weapon ? (KF_ICON[weapon] ?? "✕") : "✕";
    const el = document.createElement("div");
    el.className = "kf" + (mine ? " mine" : "");
    el.innerHTML = `<span class="kf-k">${esc(killer)}</span><span class="kf-x">${icon}</span><span class="kf-v">${esc(victim)}</span>`;
    this.killfeed.prepend(el);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild?.remove();
    setTimeout(() => el.remove(), 4500);
  }

  setTeamStatus(mine: number | null, foe = 0): void {
    if (mine == null) {
      this.teamStatus.classList.add("hidden");
      return;
    }
    this.teamMine.textContent = String(mine);
    this.teamFoe.textContent = String(foe);
    this.teamStatus.classList.remove("hidden");
  }

  private countdownTimer: ReturnType<typeof setTimeout> | null = null;

  roundIntro(): void {
    if (this.countdownTimer) clearTimeout(this.countdownTimer); // no overlap
    const seq = ["3", "2", "1", "FIGHT!"];
    let i = 0;
    const step = () => {
      if (i >= seq.length) {
        this.countdownEl.classList.add("hidden");
        this.countdownTimer = null;
        return;
      }
      this.countdownEl.textContent = seq[i];
      this.countdownEl.classList.remove("hidden");
      i++;
      this.countdownTimer = setTimeout(step, i === seq.length ? 650 : 550);
    };
    step();
  }

  setPot(pot: number, label: string): void {
    if (pot > 0) {
      this.potBanner.textContent = `${label} · POT ${pot} TON`;
      this.potBanner.classList.remove("hidden");
    } else {
      this.potBanner.classList.add("hidden");
    }
  }

  setSpectate(name: string | null): void {
    if (name) {
      this.spectate.innerHTML = `☠ ELIMINATED — SPECTATING <b>${name}</b>`;
      this.spectate.classList.remove("hidden");
    } else {
      this.spectate.classList.add("hidden");
    }
  }

  setHealth(h: number): void {
    if (h === this.lastHealth) return;
    this.lastHealth = h;
    this.healthFill.style.width = `${Math.max(0, h)}%`;
    this.healthNum.textContent = String(Math.max(0, Math.round(h)));
  }

  setAmmo(mag: number, reserve: number): void {
    if (mag !== this.lastMag) {
      this.lastMag = mag;
      this.ammoMag.textContent = String(mag);
      this.ammoMag.classList.toggle("low", mag <= 10);
    }
    if (reserve !== this.lastReserve) {
      this.lastReserve = reserve;
      this.ammoReserve.textContent = String(reserve);
    }
  }

  setWeapon(name: string): void {
    if (this.weaponName) this.weaponName.textContent = name;
  }

  setReload(progress: number): void {
    if (progress > 0) {
      this.reloadBar.classList.remove("hidden");
      this.reloadFill.style.width = `${Math.round(progress * 100)}%`;
    } else {
      this.reloadBar.classList.add("hidden");
    }
  }

  setTimer(seconds: number): void {
    const s = Math.max(0, Math.floor(seconds));
    this.matchTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // rows: [{ name, kills, team, alive, you }]
  showScoreboard(
    rows: { name: string; kills: number; team: number; alive: boolean; you: boolean }[],
    teamMode: boolean,
  ): void {
    const line = (r: (typeof rows)[number]) =>
      `<div class="sb-row ${r.you ? "you" : ""} ${r.team === 0 ? "t0" : "t1"}${r.alive ? "" : " dead"}">` +
      `<span class="sb-name">${esc(r.name)}</span><span class="sb-k">${r.kills}</span></div>`;
    const sorted = [...rows].sort((a, b) => a.team - b.team || b.kills - a.kills);
    this.scoreboard.innerHTML =
      `<div class="sb-title">${teamMode ? "TEAM SCOREBOARD" : "SCOREBOARD"}</div>` +
      sorted.map(line).join("");
    this.scoreboard.classList.remove("hidden");
  }
  hideScoreboard(): void {
    this.scoreboard.classList.add("hidden");
  }

  // Show a chevron pointing toward where damage came from (angle in radians,
  // 0 = in front, +clockwise). Fades out.
  damageDirection(angle: number): void {
    const el = document.createElement("div");
    el.className = "dmg-arrow";
    el.textContent = "▲";
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad) translateY(-120px)`;
    this.dmgDir.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  setScore(s: number): void {
    if (s === this.lastScore) return;
    this.lastScore = s;
    this.scoreEl.textContent = String(s);
  }

  // Floating damage number at screen px,py (rises + fades via CSS).
  damageNumber(px: number, py: number, amount: number, headshot: boolean): void {
    const el = document.createElement("div");
    el.className = "dmg" + (headshot ? " hs" : "");
    el.textContent = (headshot ? "★" : "") + String(Math.round(amount));
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  hitMarker(headshot: boolean): void {
    this.hitmarker.textContent = headshot ? "✖" : "✕";
    (this.hitmarker as HTMLElement).style.color = headshot
      ? "#ffd166"
      : "#ffffff";
    this.hitmarker.classList.remove("hidden");
    this.hitTimer = 0.12;
  }

  damageFlashPulse(): void {
    this.damageFlash.style.opacity = "1";
    setTimeout(() => (this.damageFlash.style.opacity = "0"), 90);
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.add("hidden");
    }
  }
}

const KF_ICON: Record<string, string> = {
  rifle: "🔫",
  smg: "💥",
  sniper: "🎯",
  shotgun: "🩸",
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
