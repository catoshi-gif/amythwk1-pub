import { NextResponse } from "next/server";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram, type WalletLike } from "@/lib/anchorClient";
import {
  buildDepositCollateralAccounts,
  deriveVaultPda,
  deriveJupiterStrategyPda,
  type StrategyContext,
} from "@/lib/jupiter-vault-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMITMENT: Commitment = "confirmed";

type DepositPayload = {
  admin?: string;
  setId?: unknown;
  amountUi?: number;
  // Strategy identification
  custody?: string;
  collateralCustody?: string;
  tokenMint?: string;
  side?: string;
  decimals?: number;
};

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

function requireRpcUrl(): string {
  return [process.env.RPC_URL, process.env.HELIUS_RPC_URL, process.env.QUICKNODE_RPC_URL, process.env.NEXT_PUBLIC_RPC_URL, "https://api.mainnet-beta.solana.com"]
    .map((v) => (v || "").trim()).find(Boolean) || "";
}

function ensureSetId(value: unknown): Uint8Array {
  const arr = Array.isArray(value) ? value : [];
  if (arr.length !== 16) throw new Error("setId must contain exactly 16 bytes.");
  return Uint8Array.from(arr.map((v) => Number(v) & 0xff));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DepositPayload;
    const admin = new PublicKey(String(body.admin || "").trim());
    const setId = ensureSetId(body.setId);
    const amountUi = Number(body.amountUi);
    if (!Number.isFinite(amountUi) || amountUi <= 0) return jsonError(400, "invalid_amount");

    const custody = new PublicKey(String(body.custody || "").trim());
    const collateralCustody = new PublicKey(String(body.collateralCustody || "").trim());
    const tokenMint = new PublicKey(String(body.tokenMint || "").trim());
    const side = String(body.side || "long").toLowerCase() as "long" | "short";
    const decimals = Number(body.decimals ?? 6);

    const ctx: StrategyContext = { admin, setId, custody, collateralCustody, tokenMint, side };
    const connection = new Connection(requireRpcUrl(), COMMITMENT);

    // Use Anchor to build the deposit tx — no manual instruction encoding needed
    // because deposit_collateral is a simple SPL TransferChecked (no CPI)
    const dummyWallet: WalletLike = {
      publicKey: admin,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    };

    const program = getProgram(connection, dummyWallet) as any;
    const accounts = buildDepositCollateralAccounts(ctx);
    const amountRaw = new BN(Math.round(amountUi * 10 ** decimals));

    // Fresh PublicKeys to avoid prototype issues
    const fresh: Record<string, PublicKey> = {};
    for (const [k, v] of Object.entries(accounts)) {
      fresh[k] = new PublicKey((v as PublicKey).toBase58());
    }

    const tx = await program.methods
      .depositCollateral(amountRaw)
      .accounts(fresh)
      .transaction();

    tx.feePayer = admin;
    const latest = await connection.getLatestBlockhash(COMMITMENT);
    tx.recentBlockhash = latest.blockhash;

    return NextResponse.json({
      ok: true,
      txKind: "legacy",
      txBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      deposit: {
        mint: tokenMint.toBase58(),
        amount: amountRaw.toString(),
        decimals,
      },
    });
  } catch (err: any) {
    return jsonError(500, "failed_to_build_deposit_transaction", err?.message || String(err));
  }
}
