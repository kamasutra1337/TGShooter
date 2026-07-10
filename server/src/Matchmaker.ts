import { Room, type Conn } from "./Room";
import type { InputMsg, Mode } from "../../shared/protocol";

// Groups queued players into rooms by (mode, stake). A room starts as soon as it
// has enough humans, or after a short wait it fills the remaining seats with
// bots so a solo player never waits forever.
const FILL_TIMEOUT_MS = 4000;

export class Matchmaker {
  private pending = new Map<string, Room>(); // key `${mode}:${stake}` → filling room
  private roomOf = new Map<string, Room>(); // connId → room (routing)
  private fillTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  join(conn: Conn, mode: Mode, stake: number, name: string): void {
    const key = `${mode}:${stake}`;
    let room = this.pending.get(key);
    if (!room) {
      room = new Room("room-" + ++this.seq, mode, stake, () => {
        // room closed → drop routing entries
        for (const [id, r] of this.roomOf) if (r === room) this.roomOf.delete(id);
      });
      this.pending.set(key, room);
      // fill with bots if not full in time
      this.fillTimers.set(
        key,
        setTimeout(() => this.startRoom(key), FILL_TIMEOUT_MS),
      );
    }

    room.addHuman(conn, name);
    this.roomOf.set(conn.id, room);

    if (room.full) this.startRoom(key);
  }

  private startRoom(key: string): void {
    const room = this.pending.get(key);
    if (!room) return;
    this.pending.delete(key);
    const timer = this.fillTimers.get(key);
    if (timer) clearTimeout(timer);
    this.fillTimers.delete(key);
    room.start();
  }

  routeInput(id: string, msg: InputMsg): void {
    this.roomOf.get(id)?.setInput(id, msg);
  }

  leave(id: string): void {
    const room = this.roomOf.get(id);
    if (!room) return;
    room.removeHuman(id);
    this.roomOf.delete(id);
  }
}
