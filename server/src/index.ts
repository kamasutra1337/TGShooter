import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { Address } from "@ton/core";
import { TonClient } from "@ton/ton";
import { WEAPON_IDS, type WeaponId } from "../../shared/weapons";
import { loadEnv } from "./ton/env";
import { FundingCoordinator } from "./Funding";
import { Matchmaker } from "./Matchmaker";
import { PrivateRooms } from "./PrivateRooms";
import { EscrowService } from "./ton/EscrowService";
import { makeLiveSender } from "./ton/liveSender";
import { Leaderboard } from "./Leaderboard";
import type { Conn } from "./Room";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";

loadEnv(); // merge server/.env (oracle mnemonic, escrow address) before reading

const PORT = Number(process.env.PORT ?? 8090);
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE ?? "./data/leaderboard.json";

// On-chain escrow. Enabled only when ESCROW_ADDRESS + TON_ENDPOINT +
// ORACLE_MNEMONIC are set; otherwise settlement is a logged no-op so the game
// server runs fine in development.
const escrowAddr = process.env.ESCROW_ADDRESS
  ? Address.parse(process.env.ESCROW_ADDRESS)
  : null;
let oracleSender = null;
let tonClient: TonClient | null = null;
if (escrowAddr && process.env.TON_ENDPOINT && process.env.ORACLE_MNEMONIC) {
  oracleSender = await makeLiveSender(
    process.env.TON_ENDPOINT,
    process.env.TON_API_KEY,
    process.env.ORACLE_MNEMONIC,
  );
  tonClient = new TonClient({
    endpoint: process.env.TON_ENDPOINT,
    apiKey: process.env.TON_API_KEY,
  });
}
const escrow = new EscrowService(oracleSender, escrowAddr, tonClient);
console.log(`[escrow] ${escrow.enabled ? "ENABLED" : "disabled (dev)"}`);

// Funding coordinator drives the deposit phase of staked matches. Enabled only
// when the escrow is live + we have its friendly address to hand to clients.
const funding =
  escrow.enabled && escrowAddr
    ? new FundingCoordinator({ escrow, escrowAddress: process.env.ESCROW_ADDRESS! })
    : null;

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
const mm = new Matchmaker(escrow, leaderboard, funding);
const pr = new PrivateRooms(escrow, leaderboard, funding);
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
      mm.join(conn, normMode(msg.mode), clampStake(msg.stake), normName(msg.name), validWallet(msg.wallet), validWeapon(msg.weapon));
    } else if (msg.t === "createRoom" && !joined) {
      joined = true;
      pr.create(conn, normMode(msg.mode), clampStake(msg.stake), normName(msg.name), validWallet(msg.wallet), validWeapon(msg.weapon));
    } else if (msg.t === "joinRoom" && !joined) {
      joined = true;
      const code = String(msg.code ?? "").replace(/\D/g, "").slice(0, 4);
      pr.join(conn, code, normName(msg.name), validWallet(msg.wallet), validWeapon(msg.weapon));
    } else if (msg.t === "ready") {
      pr.setReady(id, !!msg.ready);
    } else if (msg.t === "startRoom") {
      pr.start(id);
    } else if (msg.t === "leaveRoom") {
      pr.leave(id);
    } else if (msg.t === "chat") {
      const text = String(msg.text ?? "").slice(0, 140);
      mm.chat(id, text);
      pr.chat(id, text);
    } else if (msg.t === "input") {
      mm.routeInput(id, msg);
      pr.routeInput(id, msg);
    } else if (msg.t === "deposited") {
      mm.deposited(id);
      pr.deposited(id);
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

function validWeapon(v: unknown): WeaponId | undefined {
  return (WEAPON_IDS as string[]).includes(v as string) ? (v as WeaponId) : undefined;
}

httpServer.listen(PORT, () => {
  console.log(
    `[tg-shooter] server listening — ws://localhost:${PORT} · leaderboard http://localhost:${PORT}/leaderboard`,
  );
});
