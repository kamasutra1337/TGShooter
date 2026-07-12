// TON wallet + match-escrow interface — REAL TonConnect integration.
//
// Money model (trustless): the client only ever SIGNS a Deposit transaction to
// the escrow contract with its own wallet. It can never move the pot. The
// authoritative server (oracle) is the only key that settles the pot to the
// winner or cancels + refunds. So a compromised client can lose its own stake
// at worst, never others'.
//
// Flow: connect wallet → server forms a staked match → server sends `fund`
// (matchId + escrow addr) → depositStake() signs a Deposit tx → server polls
// the contract and starts once every seat is funded → on finish the contract
// pays the winner directly.
import { TonConnectUI } from "@tonconnect/ui";
import { Address, beginCell, toNano } from "@ton/core";

// Where the wallet fetches app metadata. Must be a public HTTPS URL.
const MANIFEST_URL =
  (import.meta.env.VITE_TONCONNECT_MANIFEST as string | undefined) ??
  "https://kamasutra1337.github.io/TGShooter/tonconnect-manifest.json";

// Testnet by default; flip to mainnet by setting VITE_TON_NETWORK=mainnet.
export const IS_TESTNET =
  (import.meta.env.VITE_TON_NETWORK as string | undefined) !== "mainnet";

const TONCENTER = IS_TESTNET
  ? "https://testnet.toncenter.com/api/v2"
  : "https://toncenter.com/api/v2";

// Gas budget added on top of the stake so the Deposit message covers fees and
// leaves the contract enough to hold the pot.
const DEPOSIT_GAS = toNano("0.1");

// Deposit message opcode (from the compiled contract ABI). Layout:
//   uint32 op, uint64 matchId, coins stake, uint8 seats
const OP_DEPOSIT = 1089186241;

export interface WalletState {
  connected: boolean;
  address: string | null; // friendly form for the active network
  balance: number; // TON, best-effort (may lag)
}

type Listener = (s: WalletState) => void;

class TonServiceImpl {
  private state: WalletState = { connected: false, address: null, balance: 0 };
  private listeners = new Set<Listener>();
  private ui: TonConnectUI | null = null;
  private rawAddress: string | null = null; // raw "0:..." for balance lookups

  private ensureUI(): TonConnectUI {
    if (this.ui) return this.ui;
    this.ui = new TonConnectUI({ manifestUrl: MANIFEST_URL });
    this.ui.onStatusChange((wallet) => {
      if (wallet) {
        this.rawAddress = wallet.account.address;
        const addr = Address.parse(wallet.account.address).toString({
          testOnly: IS_TESTNET,
          bounceable: false,
        });
        this.state = { connected: true, address: addr, balance: this.state.balance };
        this.emit();
        void this.refreshBalance();
      } else {
        this.rawAddress = null;
        this.state = { connected: false, address: null, balance: 0 };
        this.emit();
      }
    });
    return this.ui;
  }

  getState(): WalletState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    // Wire up TonConnect lazily so a returning user's session is restored.
    try {
      this.ensureUI();
    } catch {
      /* non-browser / build context — ignore */
    }
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  async connect(): Promise<WalletState> {
    const ui = this.ensureUI();
    if (!ui.connected) await ui.openModal();
    return this.state;
  }

  async disconnect(): Promise<void> {
    if (this.ui?.connected) await this.ui.disconnect();
  }

  shortAddress(): string {
    const a = this.state.address;
    return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
  }

  // Sign + broadcast a Deposit into the escrow for this match. Resolves ok:true
  // once the wallet accepts the tx (the server confirms actual funding
  // on-chain; this only means "the user signed and sent it").
  async depositStake(
    matchId: string,
    escrow: string,
    stake: number,
    seats: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const ui = this.ui;
    if (!ui?.connected) return { ok: false, error: "wallet not connected" };

    let payload: string;
    try {
      const body = beginCell()
        .storeUint(OP_DEPOSIT, 32)
        .storeUint(BigInt(matchId), 64)
        .storeCoins(toNano(stake))
        .storeUint(seats, 8)
        .endCell();
      payload = body.toBoc().toString("base64");
    } catch (e) {
      return { ok: false, error: "bad match params: " + (e as Error).message };
    }

    const amount = (toNano(stake) + DEPOSIT_GAS).toString();
    try {
      await ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: escrow, amount, payload }],
      });
      void this.refreshBalance();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "transaction rejected" };
    }
  }

  // Best-effort balance read from the public RPC (no key). Never throws.
  private async refreshBalance(): Promise<void> {
    if (!this.rawAddress) return;
    try {
      const res = await fetch(
        `${TONCENTER}/getAddressBalance?address=${encodeURIComponent(this.rawAddress)}`,
      );
      const json = await res.json();
      if (json?.ok && typeof json.result === "string") {
        this.state = { ...this.state, balance: +(Number(json.result) / 1e9).toFixed(3) };
        this.emit();
      }
    } catch {
      /* offline / rate-limited — keep last known balance */
    }
  }
}

export const Ton = new TonServiceImpl();
