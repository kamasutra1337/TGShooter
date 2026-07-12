// Generates a fresh oracle wallet for the escrow and appends its mnemonic to
// server/.env (gitignored — never committed). The oracle is the contract owner:
// the only key that can settle a match and release the pot. Keep it server-side.
//
//   npm run wallet:gen          # generate + print the testnet address to fund
//
// After funding the printed address from the testnet faucet, run `npm run
// escrow:deploy` to deploy the contract owned by this wallet.
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env");

async function main() {
  if (existsSync(ENV_PATH) && /^ORACLE_MNEMONIC=/m.test(readFileSync(ENV_PATH, "utf8"))) {
    console.error(
      "\n⚠️  server/.env already has ORACLE_MNEMONIC. Refusing to overwrite an\n" +
        "   existing oracle wallet (would orphan a deployed contract + its funds).\n" +
        "   Delete that line first if you really want a new wallet.\n",
    );
    process.exit(1);
  }

  const words = await mnemonicNew(); // 24-word BIP39-style TON mnemonic
  const key = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: key.publicKey });

  const testnet = wallet.address.toString({ testOnly: true, bounceable: false });
  const mainnet = wallet.address.toString({ testOnly: false, bounceable: false });

  // Persist the mnemonic + a sensible default testnet endpoint into server/.env.
  const lines = [
    `ORACLE_MNEMONIC="${words.join(" ")}"`,
    `TON_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC`,
    `# TON_API_KEY=   # optional toncenter key to raise rate limits`,
    `# ESCROW_ADDRESS=  # filled in by escrow:deploy`,
  ];
  const prev = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").trimEnd() + "\n" : "";
  writeFileSync(ENV_PATH, prev + lines.join("\n") + "\n");

  console.log("\n✅ Oracle wallet generated. Mnemonic saved to server/.env (gitignored).\n");
  console.log("   Testnet address (fund THIS one):");
  console.log(`     ${testnet}\n`);
  console.log("   Mainnet address (for later):");
  console.log(`     ${mainnet}\n`);
  console.log("   Next steps:");
  console.log("     1) Fund the testnet address with ~1 TON:");
  console.log("        • Telegram: @testgiver_ton_bot  (send the address)");
  console.log("        • or https://testnet.tonapi.io / faucet");
  console.log("     2) npm run escrow:deploy\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
