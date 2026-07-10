import type { Sender } from "@ton/core";

// Builds a production oracle Sender backed by a TON wallet. @ton/ton and
// @ton/crypto are imported dynamically (computed specifier) so they are NOT a
// hard dependency of the offline-verifiable build — install them only for live
// on-chain settlement:  npm i @ton/ton @ton/crypto
//
// Env for live mode:  TON_ENDPOINT, TON_API_KEY (optional), ORACLE_MNEMONIC.
export async function makeLiveSender(
  endpoint: string,
  apiKey: string | undefined,
  mnemonic: string,
): Promise<Sender | null> {
  try {
    const tonSpec = "@ton/ton";
    const cryptoSpec = "@ton/crypto";
    const ton: any = await import(tonSpec);
    const crypto: any = await import(cryptoSpec);

    const key = await crypto.mnemonicToPrivateKey(mnemonic.trim().split(/\s+/));
    const client = new ton.TonClient({ endpoint, apiKey });
    const wallet = ton.WalletContractV4.create({
      workchain: 0,
      publicKey: key.publicKey,
    });
    const opened = client.open(wallet);
    return opened.sender(key.secretKey) as Sender;
  } catch (e) {
    console.warn(
      "[escrow] live sender unavailable — run `npm i @ton/ton @ton/crypto` for " +
        "on-chain settlement. Falling back to disabled escrow. Reason:",
      (e as Error).message,
    );
    return null;
  }
}
