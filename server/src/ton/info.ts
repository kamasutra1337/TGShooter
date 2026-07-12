// Prints oracle wallet + escrow status: address, balance, deployed?, rake.
// Handy to check whether the funding transfer has landed before deploying.
//
//   npm run escrow:info
import { TonClient, WalletContractV4 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { loadEnv } from "./env";
import { MatchEscrow } from "./MatchEscrow.gen";

async function main() {
  loadEnv();
  const mnemonic = process.env.ORACLE_MNEMONIC;
  const endpoint = process.env.TON_ENDPOINT;
  if (!mnemonic || !endpoint) {
    console.error("ORACLE_MNEMONIC / TON_ENDPOINT missing — run `npm run wallet:gen` first.");
    process.exit(1);
  }
  const testnet = /testnet/.test(endpoint);
  const key = await mnemonicToPrivateKey(mnemonic.trim().split(/\s+/));
  const client = new TonClient({ endpoint, apiKey: process.env.TON_API_KEY });
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: key.publicKey });

  const bal = await client.getBalance(wallet.address);
  console.log(`\nnetwork:  ${testnet ? "testnet" : "mainnet"}`);
  console.log(`oracle:   ${wallet.address.toString({ testOnly: testnet, bounceable: false })}`);
  console.log(`balance:  ${Number(bal) / 1e9} TON  ${bal < 100000000n ? "⚠️  fund it (need ≥0.1)" : "✓"}`);

  const escrow = await MatchEscrow.fromInit(wallet.address, 500n);
  const deployed = await client.isContractDeployed(escrow.address);
  console.log(`escrow:   ${escrow.address.toString({ testOnly: testnet, bounceable: true })}`);
  console.log(`deployed: ${deployed ? "✓ yes" : "no — run npm run escrow:deploy"}`);
  if (deployed) {
    const opened = client.open(escrow);
    const rake = await opened.getRake();
    console.log(`rake:     ${Number(rake) / 100}%`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
