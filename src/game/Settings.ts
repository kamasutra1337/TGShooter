// Player settings (crosshair style + color), persisted in localStorage and
// applied to the live crosshair + the settings preview.

export interface GameSettings {
  crosshair: "cross" | "circle";
  color: string;
  sound: boolean;
}

const KEY = "tgshooter.settings";
const DEFAULT: GameSettings = { crosshair: "cross", color: "#37e0a6", sound: true };

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT };
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function applyCrosshair(s: GameSettings): void {
  for (const id of ["crosshair", "crosshair-preview"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.className = "style-" + s.crosshair;
    (el as HTMLElement).style.setProperty("--ch-color", s.color);
  }
}

// A rainbow-ish set of quick presets (the native color input covers the rest).
export const SWATCHES = [
  "#37e0a6",
  "#4aa8ff",
  "#ff4d5e",
  "#ffd166",
  "#b06cff",
  "#ff8a3d",
  "#00e0ff",
  "#ffffff",
];
