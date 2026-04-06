import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { getWalletVault, getWebhookConfig } from '@/lib/server/webhooks.server';
import { fetchVaultStateForWallet } from '@/lib/server/vault-state.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const wallet = await getSessionWalletFromRequest(req as any);
  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const walletVault = await getWalletVault(wallet);
  if (!walletVault?.vaultPk) {
    return NextResponse.json({ ok: true, wallet, vault: null, strategy: null, webhookConfig: null });
  }

  const state = await fetchVaultStateForWallet(wallet, walletVault.setId);
  const webhookConfig = await getWebhookConfig(walletVault.vaultPk);

  return NextResponse.json({
    ok: true,
    wallet,
    vault: state.vault,
    strategy: null,
    webhookConfig,
  });
}
