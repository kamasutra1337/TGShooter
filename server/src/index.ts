import { WebSocketServer, WebSocket } from "ws";
import { Address } from "@ton/core";
import { Matchmaker } from "./Matchmaker";
import { EscrowService } from "./ton/EscrowService";
import { makeLiveSender } from "./ton/liveSender";
import type { Conn } from "./Room";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";

const PORT = Number(process.env.PORT ?? 8090);

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

const wss = new WebSocketServer({ port: PORT });
const mm = new Matchmaker(escrow);
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
      const mode = msg.mode === "elimination" ? "elimination" : "duel";
      const stake = clampStake(msg.stake);
      const name = String(msg.name ?? "Player").slice(0, 16);
      const wallet = validWallet(msg.wallet);
      mm.join(conn, mode, stake, name, wallet);
    } else if (msg.t === "input") {
      mm.routeInput(id, msg);
    }
  });

  ws.on("close", () => mm.leave(id));
  ws.on("error", () => mm.leave(id));
});

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

console.log(`[tg-shooter] authoritative server listening on ws://localhost:${PORT}`);
