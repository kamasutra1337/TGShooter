// TON wallet + match-escrow interface.
//
// This is the SEAM where real money flows. It is a mock today so the game is
// fully playable in dev, but the shape matches production, so going live touches
// ONLY this file.
//
// The other two thirds of the money loop already exist and are tested:
//   - Contract: contracts/contracts/match_escrow.tact (deposit/settle/cancel,
//     oracle-only settlement, pot payout minus rake) — sandbox-tested.
//   - Settlement: the server's EscrowService settles the winner on-chain —
//     sandbox-tested against the real contract.
//
// Remaining to go live (needs the user's keys / deployed contract):
//   1. Deploy match_escrow with owner = the server's oracle wallet; set
//      VITE_ESCROW_ADDRESS here and ESCROW_ADDRESS/ORACLE_MNEMONIC on the server.
//   2. Replace the mock connect() below with @tonconnect/ui (manifest is at
//      public/tonconnect-manifest.json — set its url/icon).
//   3. Replace depositStake() with a TonConnect sendTransaction to the escrow
//      address carrying a Deposit body (opcode from the contract ABI). The
//      server then settles; funds never move on client say-so.

// Escrow contract address (friendly form). Empty until deployed.
export const ESCROW_ADDRESS =
  (import.meta.env.VITE_ESCROW_ADDRESS as string | undefined) ?? "";

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

  // MOCK refund. Real: if a room fails to fill/fund, the escrow contract returns
  // each player's stake. Here we just credit the mock balance back.
  async refundStake(stake: number): Promise<void> {
    if (!this.state.connected) return;
    this.state = { ...this.state, balance: this.state.balance + stake };
    this.emit();
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
