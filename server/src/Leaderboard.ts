import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Weekly leaderboard. Scores are bucketed by ISO week, so a new week starts an
// empty board automatically (no cron reset needed). Ranked by net TON won this
// week, tie-broken by wins then kills. Persisted to a JSON file so it survives
// restarts — no external database needed at this scale.

export interface LbEntry {
  id: string; // stable identity (wallet address or name key)
  name: string;
  ton: number; // net TON won this week
  wins: number;
  games: number;
  kills: number;
}

type WeekBucket = Record<string, LbEntry>;

export class Leaderboard {
  private data: Record<string, WeekBucket> = {};
  private path: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        this.data = JSON.parse(readFileSync(this.path, "utf8"));
      }
    } catch {
      this.data = {};
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.data));
      } catch (e) {
        console.error("[leaderboard] save failed:", e);
      }
    }, 500);
  }

  currentWeek(): string {
    return isoWeek(new Date());
  }

  record(
    id: string,
    name: string,
    tonDelta: number,
    win: boolean,
    kills: number,
  ): void {
    const wk = this.currentWeek();
    const bucket = (this.data[wk] ??= {});
    const e = (bucket[id] ??= {
      id,
      name,
      ton: 0,
      wins: 0,
      games: 0,
      kills: 0,
    });
    e.name = name; // keep latest display name
    e.ton = +(e.ton + tonDelta).toFixed(3);
    e.games += 1;
    if (win) e.wins += 1;
    e.kills += kills;
    this.scheduleSave();
  }

  top(n = 20): LbEntry[] {
    const bucket = this.data[this.currentWeek()] ?? {};
    return Object.values(bucket)
      .sort((a, b) => b.ton - a.ton || b.wins - a.wins || b.kills - a.kills)
      .slice(0, n);
  }
}

// ISO-8601 week key, e.g. "2026-W28" (weeks start Monday).
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = date.getTime();
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const yearStartDay = (yearStart.getUTCDay() + 6) % 7;
  yearStart.setUTCDate(yearStart.getUTCDate() - yearStartDay + 3);
  const week = 1 + Math.round((firstThursday - yearStart.getTime()) / 604800000);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
