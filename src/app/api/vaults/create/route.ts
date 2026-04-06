import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  Connection, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, type Commitment,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  buildInitVaultAccounts, buildInitJupiterStrategyAccounts,
  VAULT_PROGRAM_ID, type VaultContext, type StrategyContext,
} from "@/lib/jupiter-vault-accounts";
import {
  JUPITER_PERPS_PROGRAM_ID, JUPITER_EVENT_AUTHORITY, JLP_POOL,
  findMarketBySymbol, USDC_CUSTODY, USDC_MINT,
} from "@/lib/jupiter/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMITMENT: Commitment = "confirmed";

function jsonError(s: number, e: string, d?: string, x?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: e, detail: d, ...(x || {}) }, { status: s });
}
function requireRpcUrl(): string {
  return [process.env.RPC_URL, process.env.HELIUS_RPC_URL, process.env.NEXT_PUBLIC_RPC_URL, "https://api.mainnet-beta.solana.com"]
    .map((v) => (v || "").trim()).find(Boolean) || "";
}
function requireRelayerPk(): PublicKey {
  const raw = (process.env.RELAYER_ADDRESS || process.env.NEXT_PUBLIC_RELAYER_ADDRESS || "").trim();
  if (!raw) throw new Error("Missing RELAYER_ADDRESS.");
  return new PublicKey(raw);
}
function ensureSetId(value: unknown): Uint8Array {
  const arr = Array.isArray(value) ? value : [];
  if (arr.length !== 16) throw new Error("setId must contain exactly 16 bytes.");
  return Uint8Array.from(arr.map((v) => Number(v) & 0xff));
}
function disc(name: string): Buffer { return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; }
function i64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v, 0); return b; }
function meta(pk: PublicKey, signer: boolean, writable: boolean) {
  return { pubkey: new PublicKey(pk.toBase58()), isSigner: signer, isWritable: writable };
}

function buildStrategyIx(
  acc: ReturnType<typeof buildInitJupiterStrategyAccounts>,
  relayer: PublicKey, sideIdx: number,
  maxSize: bigint, maxSlip: bigint, cooldown: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    disc("init_jupiter_strategy"),
    relayer.toBuffer(),
    Buffer.from([sideIdx]),
    u64LE(maxSize), u64LE(maxSlip), i64LE(cooldown),
  ]);
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      meta(acc.admin, true, true), meta(acc.vault, false, true),
      meta(acc.vaultAuthority, false, false), meta(acc.strategy, false, true),
      meta(acc.jupiterProgram, false, false), meta(acc.eventAuthority, false, false),
      meta(acc.pool, false, false), meta(acc.custody, false, false),
      meta(acc.collateralCustody, false, false), meta(acc.tokenMint, false, false),
      meta(acc.vaultTokenAta, false, true), meta(acc.tokenProgram, false, false),
      meta(acc.associatedTokenProgram, false, false), meta(acc.systemProgram, false, false),
    ],
    data,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const adminRaw = String(body?.admin || "").trim();
    if (!adminRaw) return jsonError(400, "missing_admin");

    const admin = new PublicKey(adminRaw);
    const setId = ensureSetId(body?.setId);
    const marketSymbol = String(body?.market || "SOL-PERP").trim();
    const cooldown = BigInt(Number(body?.cooldownSecs ?? 0));
    const maxSize = BigInt(String(body?.maxOpenSizeUsd ?? "500000000000"));
    const maxSlip = BigInt(String(body?.maxPriceSlippage ?? "1000000000000"));
    const relayerPk = requireRelayerPk();

    const market = findMarketBySymbol(marketSymbol);
    if (!market) return jsonError(400, "unknown_market", `Market "${marketSymbol}" not found.`);

    const connection = new Connection(requireRpcUrl(), COMMITMENT);
    const vaultCtx: VaultContext = { admin, setId };

    // Short-side strategy context (USDC collateral)
    const shortCtx: StrategyContext = {
      admin, setId, custody: market.custody,
      collateralCustody: USDC_CUSTODY, tokenMint: USDC_MINT, side: "short",
    };

    // Long-side strategy context
    // collateral_custody = asset custody (BTC/SOL/ETH) — this is where Jupiter deposits collateral
    // token_mint = USDC — this is the INPUT/FUNDING token (Jupiter swaps USDC → asset for longs)
    // The vault_token_ata will be ATA(vaultAuthority, USDC) — same as short side
    const longCtx: StrategyContext = {
      admin, setId, custody: market.custody,
      collateralCustody: market.sides.long.collateralCustody,  // BTC_CUSTODY for BTC-PERP
      tokenMint: USDC_MINT,  // Fund with USDC, Jupiter keeper swaps to asset
      side: "long",
    };

    const vaultAcc = buildInitVaultAccounts(vaultCtx);
    const shortAcc = buildInitJupiterStrategyAccounts(shortCtx);
    const longAcc = buildInitJupiterStrategyAccounts(longCtx);

    // Check if vault already exists
    const existingVault = await connection.getAccountInfo(vaultAcc.vault, COMMITMENT);
    if (existingVault?.owner?.equals(VAULT_PROGRAM_ID)) {
      return NextResponse.json({
        ok: true, already: true, txKind: "v0", txs64: [],
        accounts: {
          vault: vaultAcc.vault.toBase58(),
          vaultAuthority: vaultAcc.vaultAuthority.toBase58(),
          shortStrategy: shortAcc.strategy.toBase58(),
          longStrategy: longAcc.strategy.toBase58(),
        },
      });
    }

    const instructions: TransactionInstruction[] = [];

    // 1. Pre-warm USDC ATA for vault authority (used by both short and long sides)
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(
      admin, shortAcc.vaultTokenAta, vaultAcc.vaultAuthority, USDC_MINT, TOKEN_PROGRAM_ID,
    ));

    // 3. init_vault
    const initVaultData = Buffer.concat([disc("init_vault"), Buffer.from(setId)]);
    instructions.push(new TransactionInstruction({
      programId: VAULT_PROGRAM_ID,
      keys: [
        meta(vaultAcc.admin, true, true), meta(vaultAcc.vault, false, true),
        meta(vaultAcc.vaultAuthority, false, false), meta(SystemProgram.programId, false, false),
      ],
      data: initVaultData,
    }));

    // 4. init_jupiter_strategy — SHORT side (USDC collateral, sideIdx=1)
    instructions.push(buildStrategyIx(shortAcc, relayerPk, 1, maxSize, maxSlip, cooldown));

    // 5. init_jupiter_strategy — LONG side (asset collateral, sideIdx=0)
    instructions.push(buildStrategyIx(longAcc, relayerPk, 0, maxSize, maxSlip, cooldown));

    // Build single v0 transaction
    const { blockhash } = await connection.getLatestBlockhash(COMMITMENT);
    const message = new TransactionMessage({
      payerKey: admin, recentBlockhash: blockhash, instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const tx64 = Buffer.from(tx.serialize()).toString("base64");

    // Simulate
    let simError = null;
    try {
      const sim = await connection.simulateTransaction(tx, { sigVerify: false });
      if (sim?.value?.err) simError = { err: sim.value.err, logs: sim.value.logs || [] };
    } catch {}

    if (simError) return jsonError(400, "vault_simulation_failed", JSON.stringify(simError.err), { logs: simError.logs });

    return NextResponse.json({
      ok: true, txKind: "v0", txs64: [tx64],
      accounts: {
        vault: vaultAcc.vault.toBase58(),
        vaultAuthority: vaultAcc.vaultAuthority.toBase58(),
        shortStrategy: shortAcc.strategy.toBase58(),
        longStrategy: longAcc.strategy.toBase58(),
        usdcAta: shortAcc.vaultTokenAta.toBase58(),
      },
      marketConfig: {
        symbol: market.symbol,
        custody: market.custody.toBase58(),
        short: {
          collateralCustody: USDC_CUSTODY.toBase58(),
          tokenMint: USDC_MINT.toBase58(),
          side: "short",
        },
        long: {
          collateralCustody: market.sides.long.collateralCustody.toBase58(),
          tokenMint: USDC_MINT.toBase58(),  // USDC input, Jupiter swaps to asset
          side: "long",
        },
      },
    });
  } catch (error: any) {
    return jsonError(500, "failed_to_build_vault_transactions", error?.message || String(error));
  }
}
