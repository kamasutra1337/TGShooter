// Deploys MatchEscrow to TON, owned by the oracle wallet in server/.env.
// Idempotent: if the deterministic address is already deployed, it just prints
// it. On success it appends ESCROW_ADDRESS=... to server/.env so both the
// server (settlement) and — after you copy it to the client — deposits point at
// the same contract.
//
//   npm run wallet:gen      # once: create + fund the oracle wallet
//   npm run escrow:deploy   # deploy the contract owned by that wallet
//
// Env (from server/.env): ORACLE_MNEMONIC, TON_ENDPOINT, TON_API_KEY?
import { toNano } from "@ton/core";
import { TonClient, WalletContractV4 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "./env";
import { MatchEscrow } from "./MatchEscrow.gen";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env");

// House rake in basis points (500 = 5%). The winner receives pot * (1 - rake).
const RAKE_BPS = 500n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnv();
  const mnemonic = process.env.ORACLE_MNEMONIC;
  const endpoint = process.env.TON_ENDPOINT;
  if (!mnemonic) fail("ORACLE_MNEMONIC missing — run `npm run wallet:gen` first.");
  if (!endpoint) fail("TON_ENDPOINT missing in server/.env.");

  const key = await mnemonicToPrivateKey(mnemonic!.trim().split(/\s+/));
  const client = new TonClient({ endpoint: endpoint!, apiKey: process.env.TON_API_KEY });
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: key.publicKey });
  const walletContract = client.open(wallet);
  const oracle = wallet.address;
  const testnet = /testnet/.test(endpoint!);

  // Oracle must be funded to pay deploy gas.
  const balance = await client.getBalance(oracle);
  console.log(`\n[deploy] oracle: ${oracle.toString({ testOnly: testnet, bounceable: false })}`);
  console.log(`[deploy] balance: ${Number(balance) / 1e9} TON`);
  if (balance < toNano("0.1")) {
    fail(
      "oracle wallet has < 0.1 TON — fund it first:\n" +
        (testnet
          ? "   • Telegram: @testgiver_ton_bot (send the testnet address above)"
          : "   • send TON to the address above"),
    );
  }

  // Deterministic escrow address from (owner, rakeBps).
  const escrow = await MatchEscrow.fromInit(oracle, RAKE_BPS);
  const addr = escrow.address;
  const friendly = addr.toString({ testOnly: testnet, bounceable: true });
  console.log(`[deploy] escrow address: ${friendly}`);

  const already = await client.isContractDeployed(addr);
  if (already) {
    console.log("[deploy] already deployed — nothing to do.");
    return recordAddress(friendly);
  }

  // Send the Deploy message from the oracle wallet.
  const opened = client.open(escrow);
  const seqno = await walletContract.getSeqno();
  await opened.send(
    walletContract.sender(key.secretKey),
    { value: toNano("0.1"), bounce: false },
    { $$type: "Deploy", queryId: 0n },
  );
  console.log("[deploy] deploy message sent — waiting for confirmation...");

  // Poll until the wallet's seqno advances AND the contract shows deployed.
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const s = await walletContract.getSeqno().catch(() => seqno);
    if (s > seqno && (await client.isContractDeployed(addr).catch(() => false))) {
      console.log(`\n✅ MatchEscrow deployed at:\n   ${friendly}\n`);
      return recordAddress(friendly);
    }
    process.stdout.write(".");
  }
  fail("timed out waiting for deploy confirmation — check the explorer and re-run (idempotent).");
}

function recordAddress(friendly: string): void {
  const env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (/^ESCROW_ADDRESS=/m.test(env)) {
    writeFileSync(ENV_PATH, env.replace(/^ESCROW_ADDRESS=.*$/m, `ESCROW_ADDRESS=${friendly}`));
  } else if (/^#\s*ESCROW_ADDRESS=/m.test(env)) {
    writeFileSync(ENV_PATH, env.replace(/^#\s*ESCROW_ADDRESS=.*$/m, `ESCROW_ADDRESS=${friendly}`));
  } else {
    appendFileSync(ENV_PATH, `ESCROW_ADDRESS=${friendly}\n`);
  }
  console.log("[deploy] ESCROW_ADDRESS written to server/.env");
  console.log("[deploy] now set the client's VITE_ESCROW_ADDRESS to the same value.\n");
}

function fail(msg: string): never {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
