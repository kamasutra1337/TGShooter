// Minimal Telegram bot: replies to /start and /play with a polished welcome and
// a button that launches the SHOOTon Mini App. Long-polling, zero deps (Node 20
// global fetch). Enabled only when BOT_TOKEN is set, so the game server runs fine
// without it. The token lives in the environment — never in the repo.

const API = "https://api.telegram.org/bot";

const WELCOME = [
  "🎯 *SHOOTon* — the TON arena shooter",
  "",
  "Fast *1v1 duels* & *5v5 team battles*, right inside Telegram.",
  "Stake TON, outgun everyone, and take the whole pot.",
  "",
  "💎 *Real stakes* — winner takes all",
  "🔫 *4 weapons* — rifle · SMG · sniper · shotgun",
  "🗺️ *4 arenas* + grenades, sprint & aim",
  "🏆 *Ranks*, daily challenges & leaderboards",
  "",
  "Tap *Play* and drop in 👇",
].join("\n");

const HELP = [
  "❓ *How to play SHOOTon*",
  "",
  "• *1v1* — first to 5 frags wins the pot.",
  "• *5v5* — last team standing takes it.",
  "• Move with the left stick, aim + fire on the right.",
  "• Tap 🎯 to aim, 💣 for grenades, ⬇ to crouch.",
  "• Pick a *weapon* + *map* before you queue — you only face your own weapon.",
  "",
  "💎 *Stakes:* connect a TON wallet, everyone deposits, the winner is paid on-chain.",
  "🕹️ Free *Practice vs bots* is always one tap away.",
  "",
  "Tap *Play* to jump in 👇",
].join("\n");

export function startBot(token: string, miniAppUrl: string): void {
  const base = API + token;
  const playKb = {
    inline_keyboard: [[{ text: "🎮 Play SHOOTon", web_app: { url: miniAppUrl } }]],
  };

  async function send(chatId: number, text: string): Promise<void> {
    try {
      await fetch(base + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          reply_markup: playKb,
          link_preview_options: { is_disabled: true },
        }),
      });
    } catch {
      /* transient — the next update will retry */
    }
  }

  let offset = 0;
  async function poll(): Promise<void> {
    try {
      const res = await fetch(base + `/getUpdates?timeout=30&offset=${offset}`);
      const json = (await res.json()) as {
        ok: boolean;
        result?: { update_id: number; message?: { chat: { id: number }; text?: string } }[];
      };
      for (const u of json.result ?? []) {
        offset = u.update_id + 1;
        const text = (u.message?.text ?? "").trim().toLowerCase();
        const chatId = u.message?.chat.id;
        if (!chatId) continue;
        if (text.startsWith("/help")) await send(chatId, HELP);
        else if (text.startsWith("/start") || text.startsWith("/play") || text === "")
          await send(chatId, WELCOME);
        else await send(chatId, WELCOME);
      }
    } catch {
      await new Promise((r) => setTimeout(r, 3000)); // back off on network errors
    }
    void poll();
  }

  // Use long polling (drop any stale webhook first), then run forever.
  fetch(base + "/deleteWebhook?drop_pending_updates=false")
    .catch(() => {})
    .finally(() => void poll());

  console.log("[bot] SHOOTon welcome bot started (long polling)");
}
