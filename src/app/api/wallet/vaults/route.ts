import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { getWalletVaultPks, getWebhookConfig } from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Try session auth first, fall back to query param (vault PKs are public on-chain data)
    let wallet = await getSessionWalletFromRequest(req as any);
    if (!wallet) {
      const { searchParams } = new URL(req.url);
      wallet = searchParams.get('wallet') || '';
    }
    if (!wallet) return NextResponse.json({ ok: false, error: 'missing_wallet' }, { status: 400 });

    const vaultPks = await getWalletVaultPks(wallet);
    const vaults = [];

    for (const pk of vaultPks) {
      const config = await getWebhookConfig(pk);
      if (config) {
        vaults.push({
          vaultPk: pk,
          marketLabel: config.marketLabel,
          createdAt: config.createdAt,
          setId: config.setId,
          custody: config.custody,
          collateralCustody: config.collateralCustody,
          tokenMint: config.tokenMint,
          leverage: config.leverage,
        });
      }
    }

    return NextResponse.json({ ok: true, vaults });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'failed' }, { status: 500 });
  }
}
