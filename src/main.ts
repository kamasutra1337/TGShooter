import "./styles.css";
import { Game, type Mode } from "./game/Game";
import { Telegram } from "./platform/telegram";
import { Ton } from "./platform/ton";

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
  btnPlay.textContent = `PLAY · POT ${pot} TON`;
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

// play
btnPlay.addEventListener("click", async () => {
  const stake = parseFloat(stakeSelect.value);
  const seats = mode === "duel" ? 2 : 5;
  const pot = +(stake * seats).toFixed(3);

  // Wager gate: if a wallet is connected, take the stake into escrow (mock).
  // Without a wallet we let the user play a "free" match so the game is always
  // demoable — real production would require a funded room before start.
  if (Ton.getState().connected) {
    const dep = await Ton.depositStake({
      matchId: "local",
      stake,
      players: seats,
      pot,
    });
    if (!dep.ok) {
      walletStatus.textContent = "Insufficient balance for stake";
      return;
    }
  }

  menu.classList.add("hidden");
  if (game.usingTouch) touch.classList.remove("hidden");

  game.startMatch({ mode, stake }, (win, payout) => {
    showResult(win, payout);
  });
});

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
  game.stopMatch();
});
