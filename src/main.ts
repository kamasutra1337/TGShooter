import "./styles.css";
import { Game, type Mode } from "./game/Game";
import { Telegram } from "./platform/telegram";
import { Ton } from "./platform/ton";
import { NetworkClient } from "./net/NetworkClient";

// Authoritative server URL. Override with VITE_SERVER_URL for production
// (wss://your-host). Defaults to the current host on the dev port so a phone on
// the same LAN can reach the dev server too.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `ws://${location.hostname || "localhost"}:8090`;

Telegram.init();

const canvas = document.getElementById("game") as HTMLCanvasElement;

// WebGL is required. If the context can't be created (very old device, blocked
// GPU), fail loudly with a readable message instead of a dead-looking menu.
let game: Game;
try {
  game = new Game(canvas);
  game.start();
} catch (err) {
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;
      justify-content:center;text-align:center;padding:24px;color:#e8edf4;
      font-family:-apple-system,sans-serif;background:#0b0e14">
      <div>
        <h2 style="color:#ff4d5e;margin-bottom:12px">WebGL unavailable</h2>
        <p style="color:#8b95a7;max-width:320px;line-height:1.5">
          This device or browser can't run 3D graphics. Try opening the game in
          the latest Telegram or a modern mobile browser.
        </p>
      </div>
    </div>`;
  throw err;
}

// ---- menu wiring ----
const menu = document.getElementById("menu")!;
const result = document.getElementById("result")!;
const touch = document.getElementById("touch")!;
const controlsHint = document.getElementById("controls-hint")!;
const walletStatus = document.getElementById("wallet-status")!;
const btnWallet = document.getElementById("btn-wallet") as HTMLButtonElement;
const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const btnPractice = document.getElementById("btn-practice") as HTMLButtonElement;
const netStatus = document.getElementById("net-status")!;
const stakeSelect = document.getElementById("stake-select") as HTMLSelectElement;
const modeChips = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".mode-chip"),
);

let mode: Mode = "duel";

controlsHint.textContent = game.usingTouch
  ? "Left stick move · right side look · buttons fire/jump/reload"
  : "Click to lock mouse · WASD move · mouse aim · click fire · R reload · Space jump";

// mode selection
for (const chip of modeChips) {
  chip.addEventListener("click", () => {
    modeChips.forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    mode = chip.dataset.mode as Mode;
    updatePlayLabel();
  });
}

function updatePlayLabel(): void {
  const stake = parseFloat(stakeSelect.value);
  const seats = mode === "duel" ? 2 : 5;
  const pot = +(stake * seats).toFixed(3);
  btnPlay.textContent = `PLAY ONLINE · POT ${pot} TON`;
}

function setNet(text: string, err = false): void {
  netStatus.textContent = text;
  netStatus.classList.toggle("err", err);
}

function enterMatch(): void {
  menu.classList.add("hidden");
  if (game.usingTouch) touch.classList.remove("hidden");
}
stakeSelect.addEventListener("change", updatePlayLabel);
updatePlayLabel();

// wallet
Ton.subscribe((s) => {
  if (s.connected) {
    walletStatus.textContent = `Wallet ${Ton.shortAddress()} · ${s.balance} TON`;
    btnWallet.textContent = "Disconnect";
  } else {
    walletStatus.textContent = "Wallet: not connected";
    btnWallet.textContent = "Connect TON";
  }
});

btnWallet.addEventListener("click", async () => {
  if (Ton.getState().connected) {
    await Ton.disconnect();
  } else {
    btnWallet.textContent = "Connecting…";
    await Ton.connect();
  }
});

// PLAY = online, authoritative-server match (the wager path).
btnPlay.addEventListener("click", async () => {
  const stake = parseFloat(stakeSelect.value);
  const seats = mode === "duel" ? 2 : 5;
  const pot = +(stake * seats).toFixed(3);

  // Wager gate: with a wallet connected, take the stake into escrow (mock).
  // Without one, a free match is allowed so the game is always demoable —
  // production would require a funded room before start.
  if (Ton.getState().connected) {
    const dep = await Ton.depositStake({ matchId: "online", stake, players: seats, pot });
    if (!dep.ok) {
      setNet("Insufficient balance for stake", true);
      return;
    }
  }

  btnPlay.disabled = true;
  setNet("Connecting to server…");
  const net = new NetworkClient();
  try {
    await net.connect(SERVER_URL);
  } catch {
    btnPlay.disabled = false;
    if (Ton.getState().connected) await Ton.refundStake(stake);
    setNet("Can't reach the game server. Start it (server/ → npm run dev) or use Practice.", true);
    return;
  }

  setNet(
    mode === "duel"
      ? "Matchmaking… (a bot fills in if no opponent)"
      : "Matchmaking 5 players… (bots fill empty seats)",
  );
  net.setHandlers({
    onStart: (start) => {
      btnPlay.disabled = false;
      setNet("");
      enterMatch();
      game.startOnline(mode, stake, net, start, (win, payout) => showResult(win, payout));
    },
  });
  net.join(
    mode,
    stake,
    Telegram.user()?.name ?? "Player",
    Ton.getState().address ?? undefined,
  );
});

// PRACTICE = offline vs local bots. No wallet, no stake — pure warm-up.
btnPractice.addEventListener("click", () => {
  const stake = parseFloat(stakeSelect.value);
  setNet("");
  enterMatch();
  game.startMatch({ mode, stake }, (win, payout) => showResult(win, payout));
});

// ---- weekly leaderboard ----
interface LbEntry {
  id: string;
  name: string;
  ton: number;
  wins: number;
  games: number;
  kills: number;
}

const SERVER_HTTP = SERVER_URL.replace(/^ws/, "http");
const btnBoard = document.getElementById("btn-board") as HTMLButtonElement;
const boardOverlay = document.getElementById("leaderboard")!;
const boardBody = document.getElementById("board-body")!;
const boardWeek = document.getElementById("board-week")!;
const btnBoardClose = document.getElementById("btn-board-close") as HTMLButtonElement;

btnBoard.addEventListener("click", async () => {
  boardOverlay.classList.remove("hidden");
  boardWeek.textContent = "";
  boardBody.innerHTML = `<p class="board-msg">Loading…</p>`;
  try {
    const res = await fetch(`${SERVER_HTTP}/leaderboard`, { cache: "no-store" });
    renderBoard((await res.json()) as { week: string; entries: LbEntry[] });
  } catch {
    boardBody.innerHTML = `<p class="board-msg">Server unreachable — start the server to see the weekly board.</p>`;
  }
});
btnBoardClose.addEventListener("click", () => boardOverlay.classList.add("hidden"));

function renderBoard(data: { week: string; entries: LbEntry[] }): void {
  boardWeek.textContent = data.week ?? "";
  const entries = data.entries ?? [];
  if (!entries.length) {
    boardBody.innerHTML = `<p class="board-msg">No games yet this week — be the first, play a match!</p>`;
    return;
  }
  const myName = Telegram.user()?.name ?? "Player";
  const myId = Ton.getState().address ?? `name:${myName}`;
  const rows = entries
    .map((e, i) => {
      const rank = i + 1;
      const medal = rank <= 3 ? `g${rank}` : "";
      const mine = e.id === myId || e.name === myName ? "me" : "";
      const ton = (e.ton > 0 ? "+" : "") + e.ton;
      return `<tr class="${mine}">
        <td class="l"><span class="rank ${medal}">${rank}</span></td>
        <td class="l">${escapeHtml(e.name)}</td>
        <td class="ton">${ton}</td>
        <td>${e.wins}</td>
        <td>${e.kills}</td>
      </tr>`;
    })
    .join("");
  boardBody.innerHTML = `<table class="board">
      <thead><tr><th class="l">#</th><th class="l">Player</th><th>TON</th><th>W</th><th>K</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

// result overlay
const resultTitle = document.getElementById("result-title")!;
const resultPayout = document.getElementById("result-payout")!;
const btnAgain = document.getElementById("btn-again") as HTMLButtonElement;

function showResult(win: boolean, payout: number): void {
  touch.classList.add("hidden");
  resultTitle.textContent = win ? "VICTORY" : "DEFEAT";
  (resultTitle as HTMLElement).style.color = win ? "#37e0a6" : "#ff4d5e";
  resultPayout.textContent = win
    ? payout > 0
      ? `+${payout} TON claimed`
      : "You won the pot"
    : "Better luck next round";
  result.classList.remove("hidden");
  Telegram.notify(win ? "success" : "error");
}

btnAgain.addEventListener("click", () => {
  result.classList.add("hidden");
  menu.classList.remove("hidden");
  btnPlay.disabled = false;
  setNet("");
  game.stopMatch();
});
