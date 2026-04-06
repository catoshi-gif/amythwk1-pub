// src/lib/vault-sdk.ts
//
// Client SDK for the Amyth Jupiter Perps vault program.
// Uses manual instruction building to avoid Anchor IDL format issues.
// Deposit = SPL TransferChecked (admin → vault ATA)
// Withdraw = PDA-signed SPL TransferChecked (vault ATA → admin)

import { createHash } from "crypto";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  buildInitVaultAccounts,
  buildInitJupiterStrategyAccounts,
  buildDepositCollateralAccounts,
  buildWithdrawCollateralAccounts,
  deriveVaultPdas,
  deriveAllPdas,
  deriveJupiterStrategyPda,
  VAULT_PROGRAM_ID,
  type VaultContext,
  type StrategyContext,
} from "@/lib/jupiter-vault-accounts";
import {
  USDC_MINT,
  USDC_CUSTODY,
  type JupiterSide,
  type JupiterPerpMarket,
} from "@/lib/jupiter/markets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateVaultPlan = {
  vaultCtx: VaultContext;
  strategyCtx: StrategyContext;
  longStrategyCtx?: StrategyContext;
  setId: Uint8Array;
  vaultPk: PublicKey;
  vaultAuthority: PublicKey;
  strategyPk: PublicKey;
  longStrategyPk?: PublicKey;
  vaultTokenAta: PublicKey;
  adminTokenAta: PublicKey;
  positionPk: PublicKey;
};

type WalletTransactionSender = {
  publicKey: PublicKey;
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: {
      skipPreflight?: boolean;
      preflightCommitment?: "processed" | "confirmed" | "finalized";
      maxRetries?: number;
    },
  ) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anchorDiscriminator(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function u64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

function toMeta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey: new PublicKey(pubkey.toBase58()), isSigner, isWritable };
}

export function createRandomSetId(): Uint8Array {
  const setId = new Uint8Array(16);
  crypto.getRandomValues(setId);
  return setId;
}

// ---------------------------------------------------------------------------
// Plan derivation
// ---------------------------------------------------------------------------

/**
 * Derive a vault plan for a given market. Always uses Short side + USDC collateral
 * so the vault ATA is USDC and the user deposits/withdraws USDC.
 */
export function deriveCreateVaultPlan(
  admin: PublicKey,
  setId: Uint8Array,
  market: JupiterPerpMarket,
): CreateVaultPlan {
  const side: JupiterSide = "short";
  const vaultCtx: VaultContext = { admin, setId };
  const strategyCtx: StrategyContext = {
    admin, setId,
    custody: market.custody,
    collateralCustody: USDC_CUSTODY,
    tokenMint: USDC_MINT,
    side,
  };
  const longStrategyCtx: StrategyContext = {
    admin, setId,
    custody: market.custody,
    collateralCustody: market.sides.long.collateralCustody,
    tokenMint: USDC_MINT,  // Fund with USDC — Jupiter swaps to asset for longs
    side: "long",
  };
  const pdas = deriveAllPdas(strategyCtx);
  const [longStrategyPk] = deriveJupiterStrategyPda(
    pdas.vaultPk, market.custody,
    market.sides.long.collateralCustody, USDC_MINT,
  );
  return {
    vaultCtx,
    strategyCtx,
    longStrategyCtx,
    setId,
    vaultPk: pdas.vaultPk,
    vaultAuthority: pdas.vaultAuthority,
    strategyPk: pdas.strategyPk,
    longStrategyPk,
    vaultTokenAta: pdas.vaultTokenAta,
    adminTokenAta: pdas.adminTokenAta,
    positionPk: pdas.positionPk,
  };
}

// ---------------------------------------------------------------------------
// Deposit — manual instruction building (avoids Anchor IDL format issues)
// ---------------------------------------------------------------------------

const DEPOSIT_DISCRIMINATOR = anchorDiscriminator("deposit_collateral");
const WITHDRAW_DISCRIMINATOR = anchorDiscriminator("withdraw_collateral");

export async function buildDepositTx(
  connection: Connection,
  _wallet: AnchorWallet,
  ctx: StrategyContext,
  amountUi: number,
  decimals: number,
): Promise<Transaction> {
  if (!Number.isFinite(amountUi) || amountUi <= 0) throw new Error("Enter a valid amount greater than zero.");

  const accounts = buildDepositCollateralAccounts(ctx);
  const amountRaw = BigInt(Math.round(amountUi * 10 ** decimals));

  const keys: AccountMeta[] = [
    toMeta(accounts.admin, true, true),
    toMeta(accounts.vault, false, false),
    toMeta(accounts.strategy, false, false),
    toMeta(accounts.vaultAuthority, false, false),
    toMeta(accounts.tokenMint, false, false),
    toMeta(accounts.adminTokenAta, false, true),
    toMeta(accounts.vaultTokenAta, false, true),
    toMeta(accounts.tokenProgram, false, false),
  ];

  const data = Buffer.concat([DEPOSIT_DISCRIMINATOR, u64LE(amountRaw)]);

  const ix = new TransactionInstruction({ programId: VAULT_PROGRAM_ID, keys, data });
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: ctx.admin, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  tx.add(ix);
  return tx;
}

// ---------------------------------------------------------------------------
// Withdraw — manual instruction building
// ---------------------------------------------------------------------------

export async function buildWithdrawTx(
  connection: Connection,
  _wallet: AnchorWallet,
  ctx: StrategyContext,
  amountUi: number,
  decimals: number,
): Promise<Transaction> {
  if (!Number.isFinite(amountUi) || amountUi <= 0) throw new Error("Enter a valid amount greater than zero.");

  const accounts = buildWithdrawCollateralAccounts(ctx);
  const amountRaw = BigInt(Math.round(amountUi * 10 ** decimals));

  const keys: AccountMeta[] = [
    toMeta(accounts.admin, true, true),
    toMeta(accounts.vault, false, false),
    toMeta(accounts.strategy, false, true),
    toMeta(accounts.vaultAuthority, false, false),
    toMeta(accounts.tokenMint, false, false),
    toMeta(accounts.vaultTokenAta, false, true),
    toMeta(accounts.adminTokenAta, false, true),
    toMeta(accounts.tokenProgram, false, false),
  ];

  const data = Buffer.concat([WITHDRAW_DISCRIMINATOR, u64LE(amountRaw)]);

  const ix = new TransactionInstruction({ programId: VAULT_PROGRAM_ID, keys, data });
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: ctx.admin, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  tx.add(ix);
  return tx;
}

// ---------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------

export async function fetchWalletTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  const balance = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return balance?.value?.uiAmount ?? 0;
}

export async function fetchVaultTokenBalance(
  connection: Connection,
  ctx: StrategyContext,
): Promise<number> {
  const pdas = deriveAllPdas(ctx);
  const balance = await connection.getTokenAccountBalance(pdas.vaultTokenAta, "confirmed").catch(() => null);
  return balance?.value?.uiAmount ?? 0;
}

// ---------------------------------------------------------------------------
// Send helper
// ---------------------------------------------------------------------------

export async function sendAndConfirmWalletTx(
  connection: Connection,
  wallet: WalletTransactionSender,
  tx: Transaction,
): Promise<string> {
  tx.feePayer = new PublicKey(wallet.publicKey.toBase58());
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;

  try {
    const signature = await wallet.sendTransaction(tx, connection, {
      skipPreflight: true,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return signature;
  } catch (err: any) {
    const logs = err?.logs || [];
    if (logs.length > 0) {
      const programError = logs.find((l: string) =>
        l.includes("Error:") || l.includes("failed:") || l.includes("AnchorError")
      );
      if (programError) throw new Error(`Transaction failed: ${programError}`);
    }
    throw new Error(err?.message || String(err));
  }
}
