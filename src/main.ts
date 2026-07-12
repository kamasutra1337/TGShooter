import "./styles.css";
import { Game, type Mode } from "./game/Game";
import { SEATS } from "../shared/protocol";
import { Telegram } from "./platform/telegram";
import { Ton } from "./platform/ton";
import { NetworkClient } from "./net/NetworkClient";
import { playIntro } from "./game/Intro";
import { loadSettings, saveSettings, applyCrosshair, SWATCHES } from "./game/Settings";
import { Sound } from "./game/Audio";

// Authoritative server URL. Override with VITE_SERVER_URL for production
// (wss://your-host). Defaults to the current host on the dev port so a phone on
// the same LAN can reach the dev server too.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `ws://${location.hostname || "localhost"}:8090`;

Telegram.init();

// Web Audio needs a user gesture — unlock on the first interaction, and add a
// soft UI tick to menu/panel buttons.
window.addEventListener("pointerdown", () => Sound.unlock());
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement)?.closest(".menu-card, .panel-card")) Sound.ui();
});

// Loading intro: tracer rounds fly up, then it fades into the menu.
playIntro();

const canvas = document.getElementById("game") as HTMLCanvasElement;

// WebGL is required. If the context can't be created (very old device, blocked
// GPU), fail loudly with a readable message instead of a dead-looking menu.
let game: Game;
try {
  game = new Game(canvas);
  game.start();
  // Debug handle for headless verification only (opt-in via ?debug).
  if (new URLSearchParams(location.search).has("debug"))
    (window as unknown as { __game: Game }).__game = game;
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
  const seats = SEATS[mode];
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
  const seats = SEATS[mode];
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
      : "Matchmaking 5v5… (bots fill empty seats)",
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

// ---- settings (crosshair) ----
const settings = loadSettings();
applyCrosshair(settings);
Sound.setMuted(!settings.sound);

const settingsOverlay = document.getElementById("settings")!;
const sndOpts = Array.from(document.querySelectorAll<HTMLButtonElement>(".snd-opt"));
const gfxOpts = Array.from(document.querySelectorAll<HTMLButtonElement>(".gfx-opt"));
game.setGraphics(settings.graphics !== "lite");
const btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
const btnSettingsClose = document.getElementById("btn-settings-close") as HTMLButtonElement;
const chStyleBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".ch-style"));
const chColor = document.getElementById("ch-color") as HTMLInputElement;
const chSwatches = document.getElementById("ch-swatches")!;

for (const c of SWATCHES) {
  const sw = document.createElement("button");
  sw.className = "swatch";
  sw.style.background = c;
  sw.dataset.color = c;
  sw.addEventListener("click", () => setColor(c));
  chSwatches.appendChild(sw);
}

function refreshSettingsUI(): void {
  chStyleBtns.forEach((b) => b.classList.toggle("active", b.dataset.ch === settings.crosshair));
  chColor.value = settings.color;
  Array.from(chSwatches.children).forEach((el) =>
    el.classList.toggle("active", (el as HTMLElement).dataset.color === settings.color),
  );
  sndOpts.forEach((b) =>
    b.classList.toggle("active", (b.dataset.snd === "on") === settings.sound),
  );
  gfxOpts.forEach((b) => b.classList.toggle("active", b.dataset.gfx === settings.graphics));
  applyCrosshair(settings);
}

for (const b of sndOpts) {
  b.addEventListener("click", () => {
    settings.sound = b.dataset.snd === "on";
    Sound.setMuted(!settings.sound);
    saveSettings(settings);
    refreshSettingsUI();
  });
}

for (const b of gfxOpts) {
  b.addEventListener("click", () => {
    settings.graphics = b.dataset.gfx === "lite" ? "lite" : "high";
    game.setGraphics(settings.graphics !== "lite");
    saveSettings(settings);
    refreshSettingsUI();
  });
}

function setColor(c: string): void {
  settings.color = c;
  saveSettings(settings);
  refreshSettingsUI();
}

for (const b of chStyleBtns) {
  b.addEventListener("click", () => {
    settings.crosshair = b.dataset.ch === "circle" ? "circle" : "cross";
    saveSettings(settings);
    refreshSettingsUI();
  });
}
chColor.addEventListener("input", () => setColor(chColor.value));

btnSettings.addEventListener("click", () => {
  settingsOverlay.classList.remove("hidden");
  refreshSettingsUI();
});
btnSettingsClose.addEventListener("click", () => settingsOverlay.classList.add("hidden"));
refreshSettingsUI();

// ---- private rooms (play with friends) ----
const btnCreateRoom = document.getElementById("btn-create-room") as HTMLButtonElement;
const btnJoinRoom = document.getElementById("btn-join-room") as HTMLButtonElement;
const joinCodeOverlay = document.getElementById("join-code")!;
const joinInput = document.getElementById("join-code-input") as HTMLInputElement;
const btnJoinCancel = document.getElementById("btn-join-cancel") as HTMLButtonElement;
const btnJoinConfirm = document.getElementById("btn-join-confirm") as HTMLButtonElement;
const joinError = document.getElementById("join-error")!;
const roomOverlay = document.getElementById("room")!;
const roomCodeEl = document.getElementById("room-code")!;
const roomSub = document.getElementById("room-sub")!;
const roomPlayers = document.getElementById("room-players")!;
const btnRoomStart = document.getElementById("btn-room-start") as HTMLButtonElement;
const btnRoomReady = document.getElementById("btn-room-ready") as HTMLButtonElement;
const btnRoomLeave = document.getElementById("btn-room-leave") as HTMLButtonElement;
const roomError = document.getElementById("room-error")!;
const roomChatLog = document.getElementById("room-chat-log")!;
const roomChatInput = document.getElementById("room-chat-input") as HTMLInputElement;
const roomChatSend = document.getElementById("room-chat-send") as HTMLButtonElement;
const chatInputBar = document.getElementById("chat-input-bar")!;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const btnChat = document.getElementById("btn-chat") as HTMLButtonElement;

function chatLine(log: HTMLElement, name: string, text: string, cls: string): void {
  const el = document.createElement("div");
  el.className = "chat-line";
  el.innerHTML = `<span class="cl-name ${cls}">${escapeHtml(name)}</span>${escapeHtml(text)}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

let roomNet: NetworkClient | null = null;
const roomInfo = { mode: "duel" as Mode, stake: 1, isHost: false, ready: true };

function playerName(): string {
  return Telegram.user()?.name ?? "Player";
}

function leaveRoomToMenu(): void {
  roomNet?.leaveRoom();
  roomNet?.close();
  roomNet = null;
  roomOverlay.classList.add("hidden");
  joinCodeOverlay.classList.add("hidden");
  menu.classList.remove("hidden");
  setNet("");
}

function renderRoomPlayers(m: { players: { name: string; ready: boolean; host: boolean }[]; canStart: boolean }): void {
  btnRoomStart.disabled = !m.canStart;
  const seats = SEATS[roomInfo.mode];
  let html = "";
  for (const p of m.players) {
    const tag = p.host
      ? '<span class="rp-tag host">HOST</span>'
      : p.ready
        ? '<span class="rp-tag ready">READY</span>'
        : '<span class="rp-tag wait">…</span>';
    html += `<div class="room-player ${p.ready ? "is-ready" : ""}"><span class="rp-dot"></span><span class="rp-name">${escapeHtml(p.name)}</span>${tag}</div>`;
  }
  for (let i = m.players.length; i < seats; i++)
    html += `<div class="empty-slot">Empty slot — a bot will fill it</div>`;
  roomPlayers.innerHTML = html;
}

function wireRoom(net: NetworkClient): void {
  net.setHandlers({
    onRoomJoined: (m) => {
      roomInfo.mode = m.mode;
      roomInfo.stake = m.stake;
      roomInfo.isHost = m.host;
      roomInfo.ready = m.host;
      roomCodeEl.textContent = "#" + m.code;
      const pot = (m.stake * SEATS[m.mode]).toFixed(1);
      roomSub.textContent = `${m.mode === "duel" ? "1v1 Duel" : "5v5 Team"} · pot ${pot} TON · share the code with friends`;
      btnRoomStart.classList.toggle("hidden", !m.host);
      btnRoomReady.classList.toggle("hidden", m.host);
      btnRoomReady.classList.toggle("on", roomInfo.ready);
      roomError.textContent = "";
      roomChatLog.innerHTML = "";
      joinCodeOverlay.classList.add("hidden");
      menu.classList.add("hidden");
      roomOverlay.classList.remove("hidden");
    },
    onRoomState: (m) => renderRoomPlayers(m),
    onChat: (m) =>
      chatLine(roomChatLog, m.name, m.text, m.name === playerName() ? "me" : "blue"),
    onRoomError: (m) => {
      btnJoinConfirm.disabled = false;
      if (!joinCodeOverlay.classList.contains("hidden")) {
        joinError.textContent = m.reason;
      } else {
        roomError.textContent = m.reason;
        if (/closed/i.test(m.reason)) setTimeout(leaveRoomToMenu, 1300);
      }
    },
    onStart: (start) => {
      roomOverlay.classList.add("hidden");
      enterMatch();
      const net2 = roomNet!;
      roomNet = null; // the game owns the connection now
      game.startOnline(roomInfo.mode, roomInfo.stake, net2, start, (win, payout) =>
        showResult(win, payout),
      );
    },
  });
}

btnCreateRoom.addEventListener("click", async () => {
  setNet("Creating room…");
  const net = new NetworkClient();
  try {
    await net.connect(SERVER_URL);
  } catch {
    setNet("Can't reach the game server. Start it (server/ → npm run dev).", true);
    return;
  }
  setNet("");
  roomNet = net;
  wireRoom(net);
  net.createRoom(mode, parseFloat(stakeSelect.value), playerName(), Ton.getState().address ?? undefined);
});

btnJoinRoom.addEventListener("click", () => {
  joinError.textContent = "";
  joinInput.value = "";
  joinCodeOverlay.classList.remove("hidden");
  joinInput.focus();
});
btnJoinCancel.addEventListener("click", () => joinCodeOverlay.classList.add("hidden"));
btnJoinConfirm.addEventListener("click", async () => {
  const code = joinInput.value.replace(/\D/g, "").slice(0, 4);
  if (code.length !== 4) {
    joinError.textContent = "Enter the 4-digit code";
    return;
  }
  btnJoinConfirm.disabled = true;
  joinError.textContent = "Connecting…";
  const net = new NetworkClient();
  try {
    await net.connect(SERVER_URL);
  } catch {
    joinError.textContent = "Can't reach the game server.";
    btnJoinConfirm.disabled = false;
    return;
  }
  joinError.textContent = "";
  roomNet = net;
  wireRoom(net);
  net.joinRoom(code, playerName(), Ton.getState().address ?? undefined);
});

btnRoomReady.addEventListener("click", () => {
  roomInfo.ready = !roomInfo.ready;
  btnRoomReady.classList.toggle("on", roomInfo.ready);
  roomNet?.setReady(roomInfo.ready);
});
btnRoomStart.addEventListener("click", () => roomNet?.startRoom());
btnRoomLeave.addEventListener("click", leaveRoomToMenu);

// ---- chat: lobby ----
function sendRoomChat(): void {
  const t = roomChatInput.value.trim();
  if (!t || !roomNet) return;
  roomNet.sendChat(t);
  roomChatInput.value = "";
}
roomChatSend.addEventListener("click", sendRoomChat);
roomChatInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    sendRoomChat();
  }
});

// ---- chat: in-match ----
function openChat(): void {
  if (!game.isOnline()) return;
  chatInputBar.classList.remove("hidden");
  game.clearMovement();
  if (document.pointerLockElement) document.exitPointerLock();
  chatInput.focus();
}
function closeChat(): void {
  chatInputBar.classList.add("hidden");
  chatInput.value = "";
  chatInput.blur();
}
function sendMatchChat(): void {
  const t = chatInput.value.trim();
  if (t) game.sendChat(t);
  closeChat();
}
btnChat.addEventListener("click", () => {
  if (chatInputBar.classList.contains("hidden")) openChat();
  else closeChat();
});
chatInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    sendMatchChat();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeChat();
  }
});
// Desktop: Enter opens chat during a match
window.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    game.isOnline() &&
    chatInputBar.classList.contains("hidden") &&
    !(document.activeElement instanceof HTMLInputElement)
  ) {
    e.preventDefault();
    openChat();
  }
});

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
  chatInputBar.classList.add("hidden");
  touch.classList.add("hidden");
  resultTitle.textContent = win ? "VICTORY" : "DEFEAT";
  (resultTitle as HTMLElement).style.color = win ? "#37e0a6" : "#ff4d5e";
  resultPayout.textContent = win
    ? payout > 0
      ? `+${payout} TON claimed`
      : "You won the pot"
    : "Better luck next round";
  result.classList.remove("hidden");
  if (win) Sound.win();
  else Sound.lose();
  Telegram.notify(win ? "success" : "error");
}

btnAgain.addEventListener("click", () => {
  result.classList.add("hidden");
  menu.classList.remove("hidden");
  btnPlay.disabled = false;
  setNet("");
  game.stopMatch();
});
