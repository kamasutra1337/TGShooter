import { Room, type Conn } from "./Room";
import { SEATS, type Mode, type InputMsg } from "../../shared/protocol";
import type { EscrowService } from "./ton/EscrowService";
import type { Leaderboard } from "./Leaderboard";

// Private rooms for playing with friends: a host creates a lobby (gets a 4-digit
// code), friends join by code, everyone readies up, and the host starts. On
// start the lobby hands its members to a normal authoritative game Room (bots
// fill any empty seats).

interface Member {
  conn: Conn;
  name: string;
  wallet?: string;
  ready: boolean;
}

interface Lobby {
  code: string;
  mode: Mode;
  stake: number;
  hostId: string;
  members: Member[];
  game: Room | null;
}

export class PrivateRooms {
  private lobbies = new Map<string, Lobby>(); // code → lobby
  private lobbyOf = new Map<string, Lobby>(); // connId → lobby
  private chainSeq = 1_000_000n; // offset from matchmaker ids
  private escrow: EscrowService;
  private leaderboard: Leaderboard;

  constructor(escrow: EscrowService, leaderboard: Leaderboard) {
    this.escrow = escrow;
    this.leaderboard = leaderboard;
  }

  create(conn: Conn, mode: Mode, stake: number, name: string, wallet?: string): void {
    const code = this.genCode();
    const lobby: Lobby = {
      code,
      mode,
      stake,
      hostId: conn.id,
      members: [{ conn, name, wallet, ready: true }],
      game: null,
    };
    this.lobbies.set(code, lobby);
    this.lobbyOf.set(conn.id, lobby);
    conn.send({ t: "roomJoined", code, youId: conn.id, host: true, mode, stake });
    this.broadcast(lobby);
  }

  join(conn: Conn, code: string, name: string, wallet?: string): void {
    const lobby = this.lobbies.get(code);
    if (!lobby) return conn.send({ t: "roomError", reason: "Room not found" });
    if (lobby.game) return conn.send({ t: "roomError", reason: "Match already started" });
    if (lobby.members.length >= SEATS[lobby.mode])
      return conn.send({ t: "roomError", reason: "Room is full" });

    lobby.members.push({ conn, name, wallet, ready: false });
    this.lobbyOf.set(conn.id, lobby);
    conn.send({
      t: "roomJoined",
      code: lobby.code,
      youId: conn.id,
      host: false,
      mode: lobby.mode,
      stake: lobby.stake,
    });
    this.broadcast(lobby);
  }

  setReady(id: string, ready: boolean): void {
    const lobby = this.lobbyOf.get(id);
    if (!lobby || lobby.game) return;
    const m = lobby.members.find((x) => x.conn.id === id);
    if (!m) return;
    m.ready = ready;
    this.broadcast(lobby);
  }

  start(id: string): void {
    const lobby = this.lobbyOf.get(id);
    if (!lobby || lobby.game || lobby.hostId !== id || !this.canStart(lobby)) return;

    const game = new Room(
      "priv-" + lobby.code,
      lobby.mode,
      lobby.stake,
      ++this.chainSeq,
      this.escrow,
      this.leaderboard,
      () => {
        this.lobbies.delete(lobby.code);
        for (const m of lobby.members) this.lobbyOf.delete(m.conn.id);
      },
    );
    for (const m of lobby.members) game.addHuman(m.conn, m.name, m.wallet);
    lobby.game = game;
    game.start(); // fills empty seats with bots + sends MatchStart to members
  }

  leave(id: string): void {
    const lobby = this.lobbyOf.get(id);
    if (!lobby) return;
    this.lobbyOf.delete(id);

    if (lobby.game) {
      lobby.game.removeHuman(id);
      return;
    }

    if (lobby.hostId === id) {
      // host left → close the lobby, kick the rest back to the menu
      for (const m of lobby.members) {
        if (m.conn.id === id) continue;
        this.lobbyOf.delete(m.conn.id);
        m.conn.send({ t: "roomError", reason: "Host left — room closed" });
      }
      this.lobbies.delete(lobby.code);
      return;
    }

    lobby.members = lobby.members.filter((m) => m.conn.id !== id);
    this.broadcast(lobby);
  }

  routeInput(id: string, msg: InputMsg): void {
    this.lobbyOf.get(id)?.game?.setInput(id, msg);
  }

  chat(id: string, text: string): void {
    const lobby = this.lobbyOf.get(id);
    if (!lobby) return;
    if (lobby.game) {
      lobby.game.chat(id, text);
      return;
    }
    const m = lobby.members.find((x) => x.conn.id === id);
    if (!m) return;
    const clean = text.slice(0, 140).trim();
    if (!clean) return;
    const msg = { t: "chatMsg" as const, name: m.name, text: clean, team: 0 };
    for (const mm of lobby.members) mm.conn.send(msg);
  }

  private canStart(lobby: Lobby): boolean {
    return lobby.members
      .filter((m) => m.conn.id !== lobby.hostId)
      .every((m) => m.ready);
  }

  private broadcast(lobby: Lobby): void {
    const players = lobby.members.map((m) => ({
      id: m.conn.id,
      name: m.name,
      ready: m.conn.id === lobby.hostId ? true : m.ready,
      host: m.conn.id === lobby.hostId,
    }));
    const msg = {
      t: "roomState" as const,
      code: lobby.code,
      players,
      canStart: this.canStart(lobby),
    };
    for (const m of lobby.members) m.conn.send(msg);
  }

  private genCode(): string {
    let code: string;
    do {
      code = String(Math.floor(1000 + Math.random() * 9000));
    } while (this.lobbies.has(code));
    return code;
  }
}
