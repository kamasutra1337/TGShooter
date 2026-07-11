// Private-room flow test over real WebSockets: host creates a room (gets a
// 4-digit code), a friend joins by code and readies up, the host starts, and
// both receive the MatchStart. Verifies code gen, lobby membership, ready gating
// and hand-off to a game Room.
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import type { ServerMsg } from "../../shared/protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8097;
const URL = `ws://localhost:${PORT}`;
const LB = join(__dirname, ".tmp-rooms-lb.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(LB, { force: true });
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), LEADERBOARD_FILE: LB },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitPort();

  let code = "";
  const got = { aStart: false, bStart: false, aHost: false, aPlayers: 0, bPlayers: 0 };

  // ---- host (A) ----
  const a = new WebSocket(URL);
  let aStarted = false;
  a.on("message", (raw) => {
    const m: ServerMsg = JSON.parse(raw.toString());
    if (m.t === "welcome") a.send(JSON.stringify({ t: "createRoom", mode: "duel", stake: 1, name: "Host" }));
    else if (m.t === "roomJoined") {
      code = m.code;
      got.aHost = m.host;
    } else if (m.t === "roomState") {
      got.aPlayers = m.players.length;
      // wait for the friend to join + ready before starting
      if (m.players.length >= 2 && m.canStart && !aStarted) {
        aStarted = true;
        a.send(JSON.stringify({ t: "startRoom" }));
      }
    } else if (m.t === "start") got.aStart = true;
  });

  // wait for the code, then join with B
  for (let i = 0; i < 40 && !code; i++) await sleep(100);
  if (!code) fail("host never received a room code");
  if (!/^\d{4}$/.test(code)) fail(`code should be 4 digits, got "${code}"`);

  const b = new WebSocket(URL);
  b.on("message", (raw) => {
    const m: ServerMsg = JSON.parse(raw.toString());
    if (m.t === "welcome") b.send(JSON.stringify({ t: "joinRoom", code, name: "Friend" }));
    else if (m.t === "roomJoined") b.send(JSON.stringify({ t: "ready", ready: true }));
    else if (m.t === "roomState") got.bPlayers = m.players.length;
    else if (m.t === "start") got.bStart = true;
  });

  // wait for both to start
  for (let i = 0; i < 60 && !(got.aStart && got.bStart); i++) await sleep(100);

  await sleep(150);
  server.kill("SIGKILL");

  const problems: string[] = [];
  if (!got.aHost) problems.push("host should be flagged as host");
  if (got.aPlayers < 2) problems.push(`host should see 2 players, saw ${got.aPlayers}`);
  if (got.bPlayers < 2) problems.push(`friend should see 2 players, saw ${got.bPlayers}`);
  if (!got.aStart) problems.push("host did not receive MatchStart");
  if (!got.bStart) problems.push("friend did not receive MatchStart");

  if (problems.length) {
    console.error("\n❌ FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log(`\n✅ PASS — private room ${code}: host + friend joined, readied, started; both got MatchStart`);
  process.exit(0);
}

function fail(msg: string): never {
  console.error("❌ FAIL:", msg);
  process.exit(1);
}

async function waitPort(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise<boolean>((res) => {
      const ws = new WebSocket(URL);
      ws.on("open", () => {
        ws.close();
        res(true);
      });
      ws.on("error", () => res(false));
    });
    if (ok) return;
    await sleep(150);
  }
  fail("server did not start");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
