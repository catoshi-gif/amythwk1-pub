import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { getRpcUrl } from '@/lib/env.server';
import { deleteVaultFromRedis, getWebhookConfig } from '@/lib/server/webhooks.server';
import { USDC_MINT, JUPITER_PERP_MARKETS, JLP_POOL } from '@/lib/jupiter/markets';
import { derivePositionPda, VAULT_PROGRAM_ID } from '@/lib/jupiter-vault-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Verify wallet session — only the vault owner can delete
    const wallet = await getSessionWalletFromRequest(req as any);
    if (!wallet) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const vaultPkStr = String(body?.vaultPk || '').trim();
    if (!vaultPkStr) return NextResponse.json({ ok: false, error: 'missing_vault' }, { status: 400 });

    // 2. Verify vault exists and belongs to this wallet
    const connection = new Connection(getRpcUrl(), 'confirmed');
    const vaultPk = new PublicKey(vaultPkStr);
    const vaultAcct = await connection.getAccountInfo(vaultPk, 'confirmed');
    if (!vaultAcct) {
      // Vault doesn't exist on-chain — safe to delete from Redis
      await deleteVaultFromRedis(wallet, vaultPkStr);
      return NextResponse.json({ ok: true, message: 'Vault not found on-chain. Redis cleaned up.' });
    }

    // Verify the admin field matches the session wallet
    const adminOnChain = new PublicKey(vaultAcct.data.subarray(8, 40));
    if (adminOnChain.toBase58() !== wallet) {
      return NextResponse.json({ ok: false, error: 'not_owner', message: 'This vault does not belong to your wallet.' }, { status: 403 });
    }

    // 3. Check vault status in Redis — must not be running
    const config = await getWebhookConfig(vaultPkStr);
    // We'll check Redis status directly
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    });
    const status = await redis.get(`amyth:vault:status:${vaultPkStr}`);
    if (status === 'running') {
      return NextResponse.json({ ok: false, error: 'vault_running', message: 'Stop the vault before deleting.' }, { status: 400 });
    }

    // 4. Derive vault authority PDA
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_authority'), vaultPk.toBuffer()],
      VAULT_PROGRAM_ID,
    );

    // 5. Check vault USDC balance — must be zero
    const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);
    const ataBalance = await connection.getTokenAccountBalance(vaultUsdcAta, 'confirmed').catch(() => null);
    const balance = Number(ataBalance?.value?.amount || '0');
    if (balance > 0) {
      return NextResponse.json({
        ok: false, error: 'has_balance',
        message: `Vault still has ${(balance / 1e6).toFixed(6)} USDC. Withdraw all funds first.`,
      }, { status: 400 });
    }

    // 6. Check ALL position PDAs across all markets — must all be empty
    for (const market of JUPITER_PERP_MARKETS) {
      for (const sideInfo of [
        { side: 'long' as const, cc: market.sides.long.collateralCustody },
        ...market.sides.short.map(s => ({ side: 'short' as const, cc: s.collateralCustody })),
      ]) {
        const [posPk] = derivePositionPda(vaultAuthority, JLP_POOL, market.custody, sideInfo.cc, sideInfo.side);
        const posAcct = await connection.getAccountInfo(posPk, 'confirmed').catch(() => null);
        if (posAcct && posAcct.data.length >= 210) {
          // Check sizeUsd at offset 161
          const sizeRaw = posAcct.data.readBigUInt64LE(161);
          if (sizeRaw > BigInt(0)) {
            return NextResponse.json({
              ok: false, error: 'has_position',
              message: `Vault has an open ${sideInfo.side} ${market.symbol} position. Close all positions first.`,
            }, { status: 400 });
          }
        }
      }
    }

    // 7. All checks passed — delete from Redis
    await deleteVaultFromRedis(wallet, vaultPkStr);

    return NextResponse.json({ ok: true, message: 'Vault deleted successfully.' });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'delete_failed' }, { status: 500 });
  }
}
