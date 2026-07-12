import type {
  ClientMsg,
  ServerMsg,
  Mode,
  MatchStartMsg,
  SnapshotMsg,
  HitEventMsg,
  ShotEventMsg,
  MatchEndMsg,
  InputMsg,
  RoomJoinedMsg,
  RoomStateMsg,
  RoomErrorMsg,
  ChatEventMsg,
  FundMatchMsg,
  FundStatusMsg,
  FundFailedMsg,
} from "../../shared/protocol";

// Client-side WebSocket transport. Connects, joins a queue, streams input, and
// surfaces server messages via callbacks. Knows nothing about rendering.

export interface NetHandlers {
  onStart?: (m: MatchStartMsg) => void;
  onSnapshot?: (m: SnapshotMsg) => void;
  onHit?: (m: HitEventMsg) => void;
  onShot?: (m: ShotEventMsg) => void;
  onEnd?: (m: MatchEndMsg) => void;
  onRoomJoined?: (m: RoomJoinedMsg) => void;
  onRoomState?: (m: RoomStateMsg) => void;
  onRoomError?: (m: RoomErrorMsg) => void;
  onChat?: (m: ChatEventMsg) => void;
  onFund?: (m: FundMatchMsg) => void;
  onFundStatus?: (m: FundStatusMsg) => void;
  onFundFailed?: (m: FundFailedMsg) => void;
  onClose?: () => void;
}

export class NetworkClient {
  myId = "";
  private ws: WebSocket | null = null;
  private handlers: NetHandlers = {};
  private seq = 0;

  setHandlers(h: NetHandlers): void {
    this.handlers = h;
  }

  // Resolves once the server welcomes us (connection ready). Rejects on failure.
  connect(url: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const to = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error("connect timeout"));
        }
      }, timeoutMs);

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          this.myId = msg.id;
          if (!settled) {
            settled = true;
            clearTimeout(to);
            resolve();
          }
          return;
        }
        this.dispatch(msg);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(to);
          reject(new Error("connect error"));
        }
      };

      ws.onclose = () => this.handlers.onClose?.();
    });
  }

  private dispatch(msg: ServerMsg): void {
    switch (msg.t) {
      case "start":
        this.handlers.onStart?.(msg);
        break;
      case "snap":
        this.handlers.onSnapshot?.(msg);
        break;
      case "hit":
        this.handlers.onHit?.(msg);
        break;
      case "shot":
        this.handlers.onShot?.(msg);
        break;
      case "end":
        this.handlers.onEnd?.(msg);
        break;
      case "roomJoined":
        this.handlers.onRoomJoined?.(msg);
        break;
      case "roomState":
        this.handlers.onRoomState?.(msg);
        break;
      case "roomError":
        this.handlers.onRoomError?.(msg);
        break;
      case "chatMsg":
        this.handlers.onChat?.(msg);
        break;
      case "fund":
        this.handlers.onFund?.(msg);
        break;
      case "fundStatus":
        this.handlers.onFundStatus?.(msg);
        break;
      case "fundFailed":
        this.handlers.onFundFailed?.(msg);
        break;
    }
  }

  sendChat(text: string): void {
    const t = text.trim().slice(0, 140);
    if (t) this.send({ t: "chat", text: t });
  }

  sendDeposited(): void {
    this.send({ t: "deposited" });
  }

  join(mode: Mode, stake: number, name: string, wallet?: string): void {
    this.send({ t: "join", mode, stake, name, wallet });
  }

  createRoom(mode: Mode, stake: number, name: string, wallet?: string): void {
    this.send({ t: "createRoom", mode, stake, name, wallet });
  }
  joinRoom(code: string, name: string, wallet?: string): void {
    this.send({ t: "joinRoom", code, name, wallet });
  }
  setReady(ready: boolean): void {
    this.send({ t: "ready", ready });
  }
  startRoom(): void {
    this.send({ t: "startRoom" });
  }
  leaveRoom(): void {
    this.send({ t: "leaveRoom" });
  }

  sendInput(i: Omit<InputMsg, "t" | "seq">): void {
    this.send({ t: "input", seq: ++this.seq, ...i });
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
