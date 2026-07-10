// TON wallet + match-escrow interface.
//
// This is the SEAM where real money will flow. Right now it is a mock so the
// game loop is fully playable offline, but the shape matches what the real
// implementation must provide, so wiring in @tonconnect/ui + an escrow smart
// contract later touches ONLY this file.
//
// Real implementation plan (documented, not yet built):
//   - Wallet:  @tonconnect/ui-react / TonConnect for connect + sign.
//   - Escrow:  a match-escrow contract on TON. Each player sends `stake` to the
//              contract for a matchId. The AUTHORITATIVE game server reports the
//              winner (signed), and the contract releases the pot to the winner
//              minus a rake. Funds can never move on client say-so — that is the
//              anti-cheat boundary for wagers.

export interface MatchStake {
  matchId: string;
  stake: number; // TON per player
  players: number; // seats in the room
  pot: number; // stake * players
}

export interface WalletState {
  connected: boolean;
  address: string | null;
  balance: number; // TON (mock)
}

type Listener = (s: WalletState) => void;

class TonServiceImpl {
  private state: WalletState = { connected: false, address: null, balance: 0 };
  private listeners = new Set<Listener>();

  getState(): WalletState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  // MOCK connect. Real: open TonConnect modal, await wallet, read address+balance.
  async connect(): Promise<WalletState> {
    await delay(500);
    const addr = "EQ" + randomBase64(46);
    this.state = { connected: true, address: addr, balance: 25 };
    this.emit();
    return this.state;
  }

  async disconnect(): Promise<void> {
    this.state = { connected: false, address: null, balance: 0 };
    this.emit();
  }

  shortAddress(): string {
    const a = this.state.address;
    if (!a) return "";
    return `${a.slice(0, 4)}…${a.slice(-4)}`;
  }

  // MOCK escrow deposit. Real: build & sign a TonConnect transaction to the
  // escrow contract, then wait for the server to confirm the room is funded.
  async depositStake(m: MatchStake): Promise<{ ok: boolean }> {
    if (!this.state.connected) return { ok: false };
    if (this.state.balance < m.stake) return { ok: false };
    await delay(400);
    this.state = { ...this.state, balance: this.state.balance - m.stake };
    this.emit();
    return { ok: true };
  }

  // MOCK payout. Real: the escrow contract releases the pot to the winner after
  // the authoritative server submits a signed result. Client never moves funds.
  async claimPayout(m: MatchStake, rake = 0.05): Promise<number> {
    await delay(400);
    const payout = +(m.pot * (1 - rake)).toFixed(3);
    this.state = { ...this.state, balance: this.state.balance + payout };
    this.emit();
    return payout;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBase64(len: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const Ton = new TonServiceImpl();
