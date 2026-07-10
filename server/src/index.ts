import { WebSocketServer, WebSocket } from "ws";
import { Matchmaker } from "./Matchmaker";
import type { Conn } from "./Room";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";

const PORT = Number(process.env.PORT ?? 8090);

const wss = new WebSocketServer({ port: PORT });
const mm = new Matchmaker();
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
      mm.join(conn, mode, stake, name);
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

console.log(`[tg-shooter] authoritative server listening on ws://localhost:${PORT}`);
