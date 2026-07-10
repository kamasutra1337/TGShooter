// Integration test: boot the real server, connect two WS clients, have them aim
// at each other and fire, and assert the authoritative server drives the whole
// match to a winner + payout. This is the anti-cheat foundation, so we verify it
// end-to-end over a real socket rather than unit-testing pieces.
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import type { ServerMsg, MatchStartMsg, InputMsg } from "../../shared/protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LB_FILE = join(__dirname, ".tmp-leaderboard.json");
const PORT = 8099;
const URL = `ws://localhost:${PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(...a: unknown[]) {
  console.log("[test]", ...a);
}

async function main() {
  rmSync(LB_FILE, { force: true }); // fresh leaderboard for the run

  // 1) boot server
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), LEADERBOARD_FILE: LB_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  await waitFor(() => tryConnect(URL), 8000);
  log("server up");

  // 2) two clients
  const stats = { A: mkStats(), B: mkStats() };
  const endMsgs: Record<string, ServerMsg & { t: "end" }> = {};

  function client(tag: "A" | "B") {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(URL);
      let youId = "";
      let seat = 0;
      let seq = 0;
      let inputTimer: ReturnType<typeof setInterval> | null = null;

      ws.on("message", (raw) => {
        const msg: ServerMsg = JSON.parse(raw.toString());
        const s = stats[tag];
        if (msg.t === "welcome") {
          ws.send(JSON.stringify({ t: "join", mode: "duel", stake: 1, name: tag }));
        } else if (msg.t === "start") {
          const start = msg as MatchStartMsg;
          youId = start.youId;
          seat = start.players.findIndex((p) => p.id === youId);
          log(`${tag} match start, seat ${seat}, pot ${start.pot}`);
          // seat 0 faces -z (yaw 0), seat 1 faces +z (yaw PI)
          const yaw = seat === 0 ? 0 : Math.PI;
          inputTimer = setInterval(() => {
            const input: InputMsg = {
              t: "input",
              seq: ++seq,
              moveX: 0,
              moveY: 0,
              yaw,
              pitch: 0,
              fire: true,
              jump: false,
              reload: false,
            };
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(input));
          }, 33);
        } else if (msg.t === "snap") {
          s.snaps++;
        } else if (msg.t === "hit") {
          if (msg.by === youId) s.hitsDealt++;
        } else if (msg.t === "shot") {
          s.shots++;
        } else if (msg.t === "end") {
          endMsgs[tag] = msg;
          log(`${tag} END winnerId=${msg.winnerId} youWon=${msg.youWon} payout=${msg.payout}`);
          if (inputTimer) clearInterval(inputTimer);
          ws.close();
          resolve();
        }
      });
      ws.on("error", (e) => {
        log(`${tag} ws error`, e.message);
        resolve();
      });
    });
  }

  const done = Promise.all([client("A"), client("B")]);
  const timeout = sleep(30000).then(() => "timeout");
  const winner = await Promise.race([done.then(() => "done"), timeout]);

  await sleep(700); // let the leaderboard flush

  // Verify the weekly leaderboard recorded this match over HTTP.
  let board: { week: string; entries: { name: string; ton: number; wins: number }[] } = {
    week: "",
    entries: [],
  };
  try {
    const res = await fetch(`http://localhost:${PORT}/leaderboard`);
    board = (await res.json()) as typeof board;
    log(`leaderboard week=${board.week} entries=${board.entries.length}`);
  } catch (e) {
    log("leaderboard fetch failed", (e as Error).message);
  }

  server.kill("SIGKILL");

  // 3) assertions
  const problems: string[] = [];
  if (winner === "timeout") problems.push("match did not end within 30s");
  if (!endMsgs.A || !endMsgs.B) problems.push("both clients must receive an end message");
  const winners = [endMsgs.A?.youWon, endMsgs.B?.youWon].filter(Boolean).length;
  if (winners !== 1) problems.push(`exactly one winner expected, got ${winners}`);
  if (endMsgs.A && endMsgs.A.winnerId !== endMsgs.B?.winnerId)
    problems.push("both clients must agree on winnerId");
  const w = endMsgs.A?.youWon ? endMsgs.A : endMsgs.B;
  if (w && w.payout <= 0) problems.push("winner payout must be > 0");
  if (w && Math.abs(w.payout - 2 * 0.95) > 1e-6)
    problems.push(`payout should be pot*0.95=1.9, got ${w.payout}`);
  const totalSnaps = stats.A.snaps + stats.B.snaps;
  if (totalSnaps < 10) problems.push(`expected snapshots to flow, got ${totalSnaps}`);
  const totalHits = stats.A.hitsDealt + stats.B.hitsDealt;
  if (totalHits < 5) problems.push(`expected authoritative hits, got ${totalHits}`);
  if (board.entries.length < 2)
    problems.push(`leaderboard should have both players, got ${board.entries.length}`);
  const boardWinner = board.entries.find((e) => e.wins > 0);
  if (!boardWinner || boardWinner.ton <= 0)
    problems.push("leaderboard winner should have positive TON");

  log("stats", JSON.stringify(stats));
  if (problems.length) {
    console.error("\n❌ FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log(
    `\n✅ PASS — authoritative duel resolved: winner=${w?.winnerId}, payout=${w?.payout} TON, ` +
      `snapshots=${totalSnaps}, hits=${totalHits}`,
  );
  process.exit(0);
}

function mkStats() {
  return { snaps: 0, shots: 0, hitsDealt: 0 };
}

async function tryConnect(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      ws.close();
      resolve(true);
    });
    ws.on("error", () => resolve(false));
  });
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(200);
  }
  throw new Error("server did not start in time");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
