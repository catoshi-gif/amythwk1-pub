// src/lib/anchorClient.ts
// Anchor client helpers for the Amyth Jupiter Perps vault program.

import type { Idl, Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import type { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import idlJson from "@/idl/amyth_vault.json";

export type WalletLike = {
  publicKey: PublicKey;
  signTransaction?: (tx: any) => Promise<any>;
  signAllTransactions?: (txs: any[]) => Promise<any[]>;
};

function requireVaultProgramId(): PublicKey {
  const address = (
    process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID || "8fVxzfLyPrATjNCcVpR2jPJAeSiJCKxwo6BLq2KrNUis"
  ).trim();
  try {
    return new PublicKey(address);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_VAULT_PROGRAM_ID.");
  }
}

export function getVaultProgramId(): PublicKey {
  return requireVaultProgramId();
}

export function getProvider(connection: Connection, wallet: WalletLike): AnchorProvider {
  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
}

export function getProgram(connection: Connection, wallet: WalletLike): Program<Idl> {
  const provider = getProvider(connection, wallet);
  const programId = requireVaultProgramId();
  const safeIdl = idlJson as unknown as Idl;
  return new (anchor as any).Program(safeIdl, programId, provider) as Program<Idl>;
}
