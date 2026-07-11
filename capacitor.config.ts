import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tgshooter.app",
  appName: "TG Shooter",
  webDir: "dist",
  android: {
    // Allow the WebView (served over https://localhost) to talk to the LAN
    // game server over ws:// / http:// during testing.
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
    cleartext: true,
  },
};

export default config;
