// Verifies weapon-based matchmaking: two players who queue with DIFFERENT
// weapons are never put in the same match (no sniper-vs-shotgun), and the bots
// that fill each room use that room's weapon.
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import type { ServerMsg, MatchStartMsg } from "../../shared/protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8096;
const URL = `ws://localhost:${PORT}`;
const LB = join(__dirname, ".tmp-loadout-lb.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function player(name: string, weapon: string): Promise<MatchStartMsg> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.on("message", (raw) => {
      const m: ServerMsg = JSON.parse(raw.toString());
      if (m.t === "welcome")
        ws.send(JSON.stringify({ t: "join", mode: "duel", stake: 1, name, weapon }));
      else if (m.t === "start") resolve(m);
    });
  });
}

async function main() {
  rmSync(LB, { force: true });
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), LEADERBOARD_FILE: LB },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 40; i++) {
    const ok = await new Promise<boolean>((res) => {
      const ws = new WebSocket(URL);
      ws.on("open", () => (ws.close(), res(true)));
      ws.on("error", () => res(false));
    });
    if (ok) break;
    await sleep(150);
  }

  // Two players queue at the SAME (mode, stake) but different weapons.
  const [aStart, bStart] = await Promise.all([
    player("Sniperman", "sniper"),
    player("Shottie", "shotgun"),
  ]);

  await sleep(150);
  server.kill("SIGKILL");

  const problems: string[] = [];

  // A must not be matched with B (different weapons → different rooms).
  const aNames = aStart.players.map((p) => p.name);
  const bNames = bStart.players.map((p) => p.name);
  if (aNames.includes("Shottie")) problems.push("sniper player was matched with the shotgun player");
  if (bNames.includes("Sniperman")) problems.push("shotgun player was matched with the sniper player");

  // Everyone in A's match (incl. bots) uses sniper; in B's, shotgun.
  if (!aStart.players.every((p) => p.weapon === "sniper"))
    problems.push(`A's match should be all sniper, got ${aStart.players.map((p) => p.weapon).join(",")}`);
  if (!bStart.players.every((p) => p.weapon === "shotgun"))
    problems.push(`B's match should be all shotgun, got ${bStart.players.map((p) => p.weapon).join(",")}`);

  // Each was bot-filled (opponent is a bot with the same weapon).
  if (!aStart.players.some((p) => p.bot && p.weapon === "sniper"))
    problems.push("A's room should have a sniper bot");
  if (!bStart.players.some((p) => p.bot && p.weapon === "shotgun"))
    problems.push("B's room should have a shotgun bot");

  if (problems.length) {
    console.error("\n❌ FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log("\n✅ PASS — weapon matchmaking: different weapons → separate rooms; bots match the room weapon");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
