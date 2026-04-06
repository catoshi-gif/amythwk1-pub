import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { getWalletVault, readActivity } from '@/lib/server/webhooks.server';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const wallet = await getSessionWalletFromRequest(req as any);
  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const vaultPk = String(searchParams.get('vault') || searchParams.get('vaultPk') || '').trim() || (await getWalletVault(wallet))?.vaultPk || '';
  if (!vaultPk) {
    return NextResponse.json({ ok: true, events: [], nextOffset: 0 });
  }

  const offset = Math.max(0, Number(searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || 20)));
  const events = await readActivity(vaultPk, offset, limit);

  return NextResponse.json({
    ok: true,
    vaultPk,
    events,
    nextOffset: offset + events.length,
  });
}

export async function POST(req: NextRequest) {
  const wallet = await getSessionWalletFromRequest(req as any);
  if (!wallet) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const vaultPk = String(body?.vaultPk || '').trim();
  if (!vaultPk) return NextResponse.json({ ok: false, error: 'missing_vault' }, { status: 400 });

  const { appendActivity } = await import('@/lib/server/webhooks.server');
  const kind = String(body?.kind || 'unknown');
  const amountUi = Number(body?.amountUi || 0);

  // Track deposits/withdrawals as capital flows for PnL calculation
  if (redis && (kind === 'deposit' || kind === 'withdraw') && amountUi > 0) {
    const netKey = `amyth:vault:netDeposits:${vaultPk}`;
    const current = Number(await redis.get(netKey) || '0');
    const delta = kind === 'deposit' ? amountUi : -amountUi;
    await redis.set(netKey, String(current + delta));
  }

  await appendActivity(vaultPk, {
    id: `client-${crypto.randomUUID()}`,
    kind,
    signal: kind,
    ts: Date.now(),
    perpSymbol: String(body?.perpSymbol || ''),
    status: 'completed',
    txSig: String(body?.txSig || ''),
    source: 'client',
    amountUi: amountUi || null,
  });

  return NextResponse.json({ ok: true });
}
