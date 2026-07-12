// Thin wrapper around the Telegram Mini App SDK (telegram-web-app.js).
// Safe to call outside Telegram (e.g. plain browser during development):
// every method degrades gracefully.

interface TgWebApp {
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  initDataUnsafe?: { user?: { id: number; first_name: string; username?: string } };
  colorScheme?: string;
}

function getWebApp(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp ?? null;
}

export const Telegram = {
  isInsideTelegram(): boolean {
    return getWebApp() != null;
  },

  init(): void {
    const wa = getWebApp();
    if (!wa) return;
    wa.ready();
    wa.expand();
    wa.disableVerticalSwipes?.();
    wa.setHeaderColor?.("#0b0e14");
  },

  user(): { id: number; name: string } | null {
    const u = getWebApp()?.initDataUnsafe?.user;
    if (!u) return null;
    return { id: u.id, name: u.username ?? u.first_name };
  },

  haptic(style: "light" | "medium" | "heavy" = "light"): void {
    getWebApp()?.HapticFeedback?.impactOccurred(style);
  },

  notify(type: "error" | "success" | "warning"): void {
    getWebApp()?.HapticFeedback?.notificationOccurred(type);
  },

  // Open an external link (X, website). Uses Telegram's opener inside the app,
  // falls back to a new browser tab in a plain browser.
  openLink(url: string): void {
    const wa = getWebApp();
    if (wa?.openLink) wa.openLink(url);
    else window.open(url, "_blank", "noopener");
  },

  // Open a t.me link (channel, chat) — stays inside Telegram when available.
  openTelegramLink(url: string): void {
    const wa = getWebApp();
    if (wa?.openTelegramLink) wa.openTelegramLink(url);
    else window.open(url, "_blank", "noopener");
  },

  // Share the game via Telegram's native share sheet.
  shareGame(url: string, text: string): void {
    const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    this.openTelegramLink(share);
  },
};
