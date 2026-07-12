// Local player meta-progression: XP / level / rank + a rotating daily challenge.
// All persisted in localStorage (no backend). Fed by end-of-match results.

export interface MatchResult {
  kills: number;
  deaths: number;
  won: boolean;
}

export interface Progress {
  xp: number;
  matches: number;
  wins: number;
  kills: number;
}

export interface DailyChallenge {
  date: string; // YYYY-MM-DD it was issued for
  id: "kills" | "wins" | "matches";
  desc: string;
  goal: number;
  progress: number;
  claimed: boolean;
}

const PKEY = "tgshooter.progress";
const CKEY = "tgshooter.challenge";

const RANKS = [
  "Recruit",
  "Private",
  "Corporal",
  "Sergeant",
  "Lieutenant",
  "Captain",
  "Major",
  "Colonel",
  "General",
  "Legend",
];

const CHALLENGES: { id: DailyChallenge["id"]; desc: string; goal: number }[] = [
  { id: "kills", desc: "Get 12 kills today", goal: 12 },
  { id: "wins", desc: "Win 2 matches today", goal: 2 },
  { id: "matches", desc: "Play 3 matches today", goal: 3 },
];

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) return { xp: 0, matches: 0, wins: 0, kills: 0, ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    /* ignore */
  }
  return { xp: 0, matches: 0, wins: 0, kills: 0 };
}

function save(p: Progress): void {
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// Level curve: each level costs a bit more. level 1 at 0 xp.
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(1 + Math.sqrt(xp / 120)));
}
export function xpForLevel(level: number): number {
  return Math.ceil(Math.pow(level - 1, 2) * 120);
}
export function rankName(level: number): string {
  return RANKS[Math.min(level - 1, RANKS.length - 1)];
}

// Apply a finished match: award XP, update the daily challenge, return the
// XP gained + whether the player leveled up.
export function recordMatch(r: MatchResult): { gained: number; level: number; leveledUp: boolean } {
  const p = loadProgress();
  const before = levelForXp(p.xp);
  const gained = r.kills * 20 + (r.won ? 120 : 35);
  p.xp += gained;
  p.matches += 1;
  p.kills += r.kills;
  if (r.won) p.wins += 1;
  save(p);

  // daily challenge progress
  const c = loadChallenge();
  if (!c.claimed) {
    if (c.id === "kills") c.progress += r.kills;
    else if (c.id === "wins") c.progress += r.won ? 1 : 0;
    else if (c.id === "matches") c.progress += 1;
    saveChallenge(c);
  }

  const after = levelForXp(p.xp);
  return { gained, level: after, leveledUp: after > before };
}

// ---- daily challenge ----
function todayKey(): string {
  // Local date as YYYY-MM-DD. new Date() is fine in the browser.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function loadChallenge(): DailyChallenge {
  const today = todayKey();
  try {
    const raw = localStorage.getItem(CKEY);
    if (raw) {
      const c = JSON.parse(raw) as DailyChallenge;
      if (c.date === today) return c;
    }
  } catch {
    /* ignore */
  }
  // issue a fresh challenge for today (rotates by day-of-year)
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const pick = CHALLENGES[doy % CHALLENGES.length];
  const c: DailyChallenge = { date: today, id: pick.id, desc: pick.desc, goal: pick.goal, progress: 0, claimed: false };
  saveChallenge(c);
  return c;
}

function saveChallenge(c: DailyChallenge): void {
  try {
    localStorage.setItem(CKEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

// Claim a completed challenge for bonus XP. Returns bonus (0 if not claimable).
export function claimChallenge(): number {
  const c = loadChallenge();
  if (c.claimed || c.progress < c.goal) return 0;
  c.claimed = true;
  saveChallenge(c);
  const p = loadProgress();
  const bonus = 150;
  p.xp += bonus;
  save(p);
  return bonus;
}
