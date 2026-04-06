import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  Connection, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  buildInitJupiterStrategyAccounts, deriveJupiterStrategyPda,
  VAULT_PROGRAM_ID, type StrategyContext,
} from "@/lib/jupiter-vault-accounts";
import {
  findMarketBySymbol, findMarketByCustody,
  USDC_CUSTODY, USDC_MINT,
} from "@/lib/jupiter/markets";
import { getSessionWalletFromRequest } from "@/lib/auth/session.server";
import { getWebhookConfig, registerVaultWebhooks } from "@/lib/server/webhooks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disc(name: string): Buffer { return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; }
function i64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v, 0); return b; }
function meta(pk: PublicKey, signer: boolean, writable: boolean) {
  return { pubkey: new PublicKey(pk.toBase58()), isSigner: signer, isWritable: writable };
}

/**
 * POST /api/vault/migrate-dual
 *
 * Adds a long-side strategy to an existing vault that only has a short-side strategy.
 * Also updates the Redis webhook config to include both shortConfig and longConfig.
 *
 * Body: { vaultPk: string }
 * Returns: { ok, tx (base64 serialized for wallet signing) }
 */
export async function POST(req: NextRequest) {
  try {
    const wallet = await getSessionWalletFromRequest(req as any);
    if (!wallet) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const vaultPkStr = String(body?.vaultPk || "").trim();
    if (!vaultPkStr) return NextResponse.json({ ok: false, error: "missing_vault" }, { status: 400 });

    const admin = new PublicKey(wallet);
    const vaultPk = new PublicKey(vaultPkStr);
    const rpcUrl = (process.env.RPC_URL || process.env.HELIUS_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "").trim();
    const relayerRaw = (process.env.RELAYER_ADDRESS || process.env.NEXT_PUBLIC_RELAYER_ADDRESS || "").trim();
    if (!relayerRaw) return NextResponse.json({ ok: false, error: "missing_relayer" }, { status: 500 });
    const relayerPk = new PublicKey(relayerRaw);
    const connection = new Connection(rpcUrl, "confirmed");

    // Read the vault to get setId
    const vaultAcct = await connection.getAccountInfo(vaultPk, "confirmed");
    if (!vaultAcct) return NextResponse.json({ ok: false, error: "vault_not_found" }, { status: 404 });
    const vaultData = vaultAcct.data;
    const setId = new Uint8Array(vaultData.subarray(40, 56));

    // Get the webhook config to find the market
    const config = await getWebhookConfig(vaultPkStr);
    const marketSymbol = config?.marketLabel || "BTC-PERP";
    const market = findMarketBySymbol(marketSymbol) || findMarketByCustody(new PublicKey(config?.custody || ""));
    if (!market) return NextResponse.json({ ok: false, error: "unknown_market" }, { status: 400 });

    // Check if long strategy already exists
    const [longStratPk] = deriveJupiterStrategyPda(
      vaultPk, market.custody,
      market.sides.long.collateralCustody, USDC_MINT,
    );
    const existing = await connection.getAccountInfo(longStratPk, "confirmed");
    if (existing && existing.owner.equals(VAULT_PROGRAM_ID)) {
      // Already migrated — just update Redis config
      await updateRedisConfig(config, vaultPkStr, wallet, market);
      return NextResponse.json({ ok: true, already: true, longStrategy: longStratPk.toBase58(), message: "Long strategy already exists. Redis config updated." });
    }

    // Build the long-side strategy context
    const longCtx: StrategyContext = {
      admin, setId, custody: market.custody,
      collateralCustody: market.sides.long.collateralCustody,
      tokenMint: USDC_MINT,
      side: "long",
    };
    const longAcc = buildInitJupiterStrategyAccounts(longCtx);

    const maxSize = BigInt("500000000000");
    const maxSlip = BigInt("1000000000000");
    const cooldown = BigInt(0);

    const initStratData = Buffer.concat([
      disc("init_jupiter_strategy"),
      relayerPk.toBuffer(),
      Buffer.from([0]), // sideIdx=0 for Long
      u64LE(maxSize), u64LE(maxSlip), i64LE(cooldown),
    ]);
    const initStratIx = new TransactionInstruction({
      programId: VAULT_PROGRAM_ID,
      keys: [
        meta(longAcc.admin, true, true), meta(longAcc.vault, false, true),
        meta(longAcc.vaultAuthority, false, false), meta(longAcc.strategy, false, true),
        meta(longAcc.jupiterProgram, false, false), meta(longAcc.eventAuthority, false, false),
        meta(longAcc.pool, false, false), meta(longAcc.custody, false, false),
        meta(longAcc.collateralCustody, false, false), meta(longAcc.tokenMint, false, false),
        meta(longAcc.vaultTokenAta, false, true), meta(longAcc.tokenProgram, false, false),
        meta(longAcc.associatedTokenProgram, false, false), meta(longAcc.systemProgram, false, false),
      ],
      data: initStratData,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: admin, recentBlockhash: blockhash,
      instructions: [initStratIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const tx64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json({
      ok: true, tx: tx64,
      longStrategy: longStratPk.toBase58(),
      message: "Sign this transaction to add the long-side strategy. After confirming, call this endpoint again to update Redis config.",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "migration_failed" }, { status: 500 });
  }
}

async function updateRedisConfig(
  config: any, vaultPk: string, wallet: string, market: any,
) {
  if (!config) return;
  // Re-register with both side configs
  await registerVaultWebhooks({
    wallet,
    vaultPk,
    setId: config.setId,
    marketLabel: config.marketLabel || market.symbol,
    cooldownSecs: config.cooldownSecs || 0,
    endpointUrl: config.endpointUrl || "",
    custody: market.custody.toBase58(),
    collateralCustody: config.collateralCustody,
    tokenMint: config.tokenMint,
    side: config.side,
    decimals: config.decimals,
    shortConfig: {
      custody: market.custody.toBase58(),
      collateralCustody: USDC_CUSTODY.toBase58(),
      tokenMint: USDC_MINT.toBase58(),
    },
    longConfig: {
      custody: market.custody.toBase58(),
      collateralCustody: market.sides.long.collateralCustody.toBase58(),
      tokenMint: USDC_MINT.toBase58(),
    },
  });
}
