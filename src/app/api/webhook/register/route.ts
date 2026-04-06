import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { getSiteDomain } from '@/lib/env.server';
import { registerVaultWebhooks } from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function inferBaseUrl(req: NextRequest): string {
  const env = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  try { const url = new URL(req.url); return `${url.protocol}//${url.host}`; }
  catch { return `https://${getSiteDomain()}`; }
}

export async function POST(req: NextRequest) {
  try {
    const wallet = await getSessionWalletFromRequest(req as any);
    if (!wallet) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as Record<string, any>;
    const vaultPk = String(body?.vaultPk || '').trim();
    if (!vaultPk) return NextResponse.json({ ok: false, error: 'missing_vault' }, { status: 400 });

    const baseUrl = inferBaseUrl(req);
    const config = await registerVaultWebhooks({
      wallet,
      vaultPk,
      setId: Array.isArray(body.setId) ? body.setId : undefined,
      marketLabel: typeof body.marketLabel === 'string' ? body.marketLabel : undefined,
      cooldownSecs: typeof body.cooldownSecs === 'number' ? body.cooldownSecs : undefined,
      endpointUrl: `${baseUrl}/api/webhook/ingest`,
      // Jupiter-specific fields (legacy single-side compat)
      custody: typeof body.custody === 'string' ? body.custody : undefined,
      collateralCustody: typeof body.collateralCustody === 'string' ? body.collateralCustody : undefined,
      tokenMint: typeof body.tokenMint === 'string' ? body.tokenMint : undefined,
      side: typeof body.side === 'string' ? body.side : undefined,
      decimals: typeof body.decimals === 'number' ? body.decimals : undefined,
      // Dual-side configs
      shortConfig: body.shortConfig && typeof body.shortConfig === 'object' ? body.shortConfig : undefined,
      longConfig: body.longConfig && typeof body.longConfig === 'object' ? body.longConfig : undefined,
      leverage: typeof body.leverage === 'number' ? body.leverage : undefined,
    });

    return NextResponse.json({ ok: true, wallet, vaultPk, webhooks: config.webhooks, config });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: 'register_failed', detail: error?.message || String(error) }, { status: 500 });
  }
}
