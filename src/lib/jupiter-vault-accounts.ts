/**
 * jupiter-vault-accounts.ts
 *
 * Client-side PDA derivation and account resolution for the Amyth Jupiter Perps
 * vault program (program ID: 8fVxzfLyPrATjNCcVpR2jPJAeSiJCKxwo6BLq2KrNUis).
 *
 * All seeds must match lib.rs exactly.
 */

import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  JUPITER_PERPS_PROGRAM_ID,
  JUPITER_EVENT_AUTHORITY,
  JLP_POOL,
  type JupiterSide,
  sideToSeed,
} from "@/lib/jupiter/markets";

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

export const VAULT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID || "8fVxzfLyPrATjNCcVpR2jPJAeSiJCKxwo6BLq2KrNUis"
);

// Seeds (must match lib.rs exactly)
const VAULT_SEED = Buffer.from("vault");
const VAULT_AUTH_SEED = Buffer.from("vault_authority");
const JUPITER_STRATEGY_SEED = Buffer.from("jupiter_strategy");
const EXEC_RECORD_SEED = Buffer.from("exec_record");

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

export function deriveVaultPda(
  admin: PublicKey,
  setId: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, admin.toBuffer(), setId],
    VAULT_PROGRAM_ID,
  );
}

export function deriveVaultAuthorityPda(
  vaultPk: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTH_SEED, vaultPk.toBuffer()],
    VAULT_PROGRAM_ID,
  );
}

export function deriveJupiterStrategyPda(
  vaultPk: PublicKey,
  custody: PublicKey,
  collateralCustody: PublicKey,
  tokenMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      JUPITER_STRATEGY_SEED,
      vaultPk.toBuffer(),
      custody.toBuffer(),
      collateralCustody.toBuffer(),
      tokenMint.toBuffer(),
    ],
    VAULT_PROGRAM_ID,
  );
}

export function deriveExecRecordPda(
  strategyPk: PublicKey,
  signalNonce: bigint | number,
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(signalNonce));
  return PublicKey.findProgramAddressSync(
    [EXEC_RECORD_SEED, strategyPk.toBuffer(), nonceBuf],
    VAULT_PROGRAM_ID,
  );
}

/**
 * Derive the Jupiter position PDA for the vault authority.
 */
export function derivePositionPda(
  vaultAuthority: PublicKey,
  pool: PublicKey,
  custody: PublicKey,
  collateralCustody: PublicKey,
  side: JupiterSide,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      vaultAuthority.toBuffer(),
      pool.toBuffer(),
      custody.toBuffer(),
      collateralCustody.toBuffer(),
      Buffer.from([sideToSeed(side)]),
    ],
    JUPITER_PERPS_PROGRAM_ID,
  );
}

/**
 * Derive the Jupiter position request PDA.
 */
export function derivePositionRequestPda(
  positionPk: PublicKey,
  counter: bigint | number,
  change: "increase" | "decrease",
): [PublicKey, number] {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64LE(BigInt(counter));
  const changeSeed = change === "increase" ? 1 : 2;
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position_request"),
      positionPk.toBuffer(),
      counterBuf,
      Buffer.from([changeSeed]),
    ],
    JUPITER_PERPS_PROGRAM_ID,
  );
}

/**
 * Jupiter perpetuals PDA (global config).
 */
export function deriveJupiterPerpetualsPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("perpetuals")],
    JUPITER_PERPS_PROGRAM_ID,
  );
}

// ---------------------------------------------------------------------------
// Vault context
// ---------------------------------------------------------------------------

export type VaultContext = {
  admin: PublicKey;
  setId: Uint8Array; // 16 bytes
};

export type StrategyContext = VaultContext & {
  custody: PublicKey;
  collateralCustody: PublicKey;
  tokenMint: PublicKey;
  side: JupiterSide;
};

// ---------------------------------------------------------------------------
// Derive all PDAs from contexts
// ---------------------------------------------------------------------------

export function deriveVaultPdas(ctx: VaultContext) {
  const [vaultPk] = deriveVaultPda(ctx.admin, ctx.setId);
  const [vaultAuthority] = deriveVaultAuthorityPda(vaultPk);
  return { vaultPk, vaultAuthority };
}

export function deriveAllPdas(ctx: StrategyContext) {
  const { vaultPk, vaultAuthority } = deriveVaultPdas(ctx);
  const [strategyPk] = deriveJupiterStrategyPda(
    vaultPk, ctx.custody, ctx.collateralCustody, ctx.tokenMint,
  );
  const vaultTokenAta = getAssociatedTokenAddressSync(
    ctx.tokenMint, vaultAuthority, true,
  );
  const adminTokenAta = getAssociatedTokenAddressSync(
    ctx.tokenMint, ctx.admin,
  );
  const [positionPk] = derivePositionPda(
    vaultAuthority, JLP_POOL, ctx.custody, ctx.collateralCustody, ctx.side,
  );
  return {
    vaultPk,
    vaultAuthority,
    strategyPk,
    vaultTokenAta,
    adminTokenAta,
    positionPk,
  };
}

// ---------------------------------------------------------------------------
// Account builders for each instruction
// ---------------------------------------------------------------------------

export function buildInitVaultAccounts(ctx: VaultContext) {
  const { vaultPk, vaultAuthority } = deriveVaultPdas(ctx);
  return {
    admin: ctx.admin,
    vault: vaultPk,
    vaultAuthority,
    systemProgram: SystemProgram.programId,
  };
}

export function buildInitJupiterStrategyAccounts(ctx: StrategyContext) {
  const pdas = deriveAllPdas(ctx);
  return {
    admin: ctx.admin,
    vault: pdas.vaultPk,
    vaultAuthority: pdas.vaultAuthority,
    strategy: pdas.strategyPk,
    jupiterProgram: JUPITER_PERPS_PROGRAM_ID,
    eventAuthority: JUPITER_EVENT_AUTHORITY,
    pool: JLP_POOL,
    custody: ctx.custody,
    collateralCustody: ctx.collateralCustody,
    tokenMint: ctx.tokenMint,
    vaultTokenAta: pdas.vaultTokenAta,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

export function buildDepositCollateralAccounts(ctx: StrategyContext) {
  const pdas = deriveAllPdas(ctx);
  return {
    admin: ctx.admin,
    vault: pdas.vaultPk,
    strategy: pdas.strategyPk,
    vaultAuthority: pdas.vaultAuthority,
    tokenMint: ctx.tokenMint,
    adminTokenAta: pdas.adminTokenAta,
    vaultTokenAta: pdas.vaultTokenAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

export function buildWithdrawCollateralAccounts(ctx: StrategyContext) {
  const pdas = deriveAllPdas(ctx);
  return {
    admin: ctx.admin,
    vault: pdas.vaultPk,
    strategy: pdas.strategyPk,
    vaultAuthority: pdas.vaultAuthority,
    tokenMint: ctx.tokenMint,
    vaultTokenAta: pdas.vaultTokenAta,
    adminTokenAta: pdas.adminTokenAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

export function buildExecutePerpsSignalAccounts(
  ctx: StrategyContext,
  relayer: PublicKey,
  signalNonce: bigint | number,
) {
  const pdas = deriveAllPdas(ctx);
  const [execRecordPk] = deriveExecRecordPda(pdas.strategyPk, signalNonce);
  const change = "increase"; // determined at call site
  const [positionRequestPk] = derivePositionRequestPda(pdas.positionPk, signalNonce, change);
  const positionRequestAta = getAssociatedTokenAddressSync(
    ctx.tokenMint, positionRequestPk, true,
  );

  return {
    relayer,
    vault: pdas.vaultPk,
    strategy: pdas.strategyPk,
    vaultAuthority: pdas.vaultAuthority,
    jupiterProgram: JUPITER_PERPS_PROGRAM_ID,
    eventAuthority: JUPITER_EVENT_AUTHORITY,
    pool: JLP_POOL,
    custody: ctx.custody,
    collateralCustody: ctx.collateralCustody,
    tokenMint: ctx.tokenMint,
    vaultTokenAta: pdas.vaultTokenAta,
    position: pdas.positionPk,
    positionRequest: positionRequestPk,
    positionRequestAta,
    execRecord: execRecordPk,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

// Re-export for convenience
export { JUPITER_PERPS_PROGRAM_ID, JUPITER_EVENT_AUTHORITY, JLP_POOL };
