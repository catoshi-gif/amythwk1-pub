import { NextResponse } from "next/server";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveVaultPda, deriveVaultAuthorityPda } from "@/lib/jupiter-vault-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMITMENT: Commitment = "confirmed";

function requireRpcUrl(): string {
  return [process.env.RPC_URL, process.env.HELIUS_RPC_URL, process.env.NEXT_PUBLIC_RPC_URL, "https://api.mainnet-beta.solana.com"]
    .map((v) => (v || "").trim()).find(Boolean) || "";
}

/**
 * GET /api/vaults/withdraw-capacity?admin=...&setId=...&tokenMint=...
 *
 * For Jupiter Perps, withdraw capacity is simply the vault ATA balance
 * (no Drift liquidity constraints to worry about).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const admin = new PublicKey(url.searchParams.get("admin") || "");
    const setIdRaw = url.searchParams.get("setId") || "";
    const tokenMintRaw = url.searchParams.get("tokenMint") || "";

    const setId = new Uint8Array(JSON.parse(setIdRaw));
    const tokenMint = new PublicKey(tokenMintRaw);

    const [vaultPk] = deriveVaultPda(admin, setId);
    const [vaultAuthority] = deriveVaultAuthorityPda(vaultPk);
    const vaultAta = getAssociatedTokenAddressSync(tokenMint, vaultAuthority, true);

    const connection = new Connection(requireRpcUrl(), COMMITMENT);
    const balance = await connection.getTokenAccountBalance(vaultAta, COMMITMENT).catch(() => null);
    const available = balance?.value?.uiAmount ?? 0;

    return NextResponse.json({
      ok: true,
      maxWithdrawable: available,
      vaultAtaBalance: available,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
