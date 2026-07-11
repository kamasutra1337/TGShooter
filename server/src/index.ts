import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { Address } from "@ton/core";
import { Matchmaker } from "./Matchmaker";
import { PrivateRooms } from "./PrivateRooms";
import { EscrowService } from "./ton/EscrowService";
import { makeLiveSender } from "./ton/liveSender";
import { Leaderboard } from "./Leaderboard";
import type { Conn } from "./Room";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";

const PORT = Number(process.env.PORT ?? 8090);
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE ?? "./data/leaderboard.json";

// On-chain escrow. Enabled only when ESCROW_ADDRESS + TON_ENDPOINT +
// ORACLE_MNEMONIC are set; otherwise settlement is a logged no-op so the game
// server runs fine in development.
const escrowAddr = process.env.ESCROW_ADDRESS
  ? Address.parse(process.env.ESCROW_ADDRESS)
  : null;
let oracleSender = null;
if (escrowAddr && process.env.TON_ENDPOINT && process.env.ORACLE_MNEMONIC) {
  oracleSender = await makeLiveSender(
    process.env.TON_ENDPOINT,
    process.env.TON_API_KEY,
    process.env.ORACLE_MNEMONIC,
  );
}
const escrow = new EscrowService(oracleSender, escrowAddr);
console.log(`[escrow] ${escrow.enabled ? "ENABLED" : "disabled (dev)"}`);

const leaderboard = new Leaderboard(LEADERBOARD_FILE);

// HTTP server: serves the weekly leaderboard and hosts the WebSocket upgrade.
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").startsWith("/leaderboard")) {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({ week: leaderboard.currentWeek(), entries: leaderboard.top(20) }),
    );
    return;
  }
  if (req.method === "GET" && (req.url ?? "") === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
const mm = new Matchmaker(escrow, leaderboard);
const pr = new PrivateRooms(escrow, leaderboard);
let nextId = 0;

wss.on("connection", (ws: WebSocket) => {
  const id = "p" + ++nextId;
  let joined = false;

  const conn: Conn = {
    id,
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  conn.send({ t: "welcome", id });

  ws.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.t === "join" && !joined) {
      joined = true;
      mm.join(conn, normMode(msg.mode), clampStake(msg.stake), normName(msg.name), validWallet(msg.wallet));
    } else if (msg.t === "createRoom" && !joined) {
      joined = true;
      pr.create(conn, normMode(msg.mode), clampStake(msg.stake), normName(msg.name), validWallet(msg.wallet));
    } else if (msg.t === "joinRoom" && !joined) {
      joined = true;
      const code = String(msg.code ?? "").replace(/\D/g, "").slice(0, 4);
      pr.join(conn, code, normName(msg.name), validWallet(msg.wallet));
    } else if (msg.t === "ready") {
      pr.setReady(id, !!msg.ready);
    } else if (msg.t === "startRoom") {
      pr.start(id);
    } else if (msg.t === "leaveRoom") {
      pr.leave(id);
    } else if (msg.t === "input") {
      mm.routeInput(id, msg);
      pr.routeInput(id, msg);
    }
  });

  ws.on("close", () => {
    mm.leave(id);
    pr.leave(id);
  });
  ws.on("error", () => {
    mm.leave(id);
    pr.leave(id);
  });
});

function normMode(v: unknown): "duel" | "elimination" {
  return v === "elimination" ? "elimination" : "duel";
}

function normName(v: unknown): string {
  return String(v ?? "Player").slice(0, 16);
}

function clampStake(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.1, Math.min(100, n));
}

function validWallet(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    Address.parse(v);
    return v;
  } catch {
    return undefined;
  }
}

httpServer.listen(PORT, () => {
  console.log(
    `[tg-shooter] server listening — ws://localhost:${PORT} · leaderboard http://localhost:${PORT}/leaderboard`,
  );
});
