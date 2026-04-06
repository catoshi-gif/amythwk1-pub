import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function statusKey(vaultPk: string) { return `amyth:vault:status:${vaultPk}`; }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vaultPk = searchParams.get('vault') || '';
  if (!vaultPk || !redis) return NextResponse.json({ ok: true, status: 'stopped' });
  const status = await redis.get(statusKey(vaultPk)) || 'stopped';
  return NextResponse.json({ ok: true, status });
}

export async function POST(req: NextRequest) {
  const wallet = await getSessionWalletFromRequest(req as any);
  if (!wallet) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const vaultPk = String(body?.vaultPk || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();

  if (!vaultPk) return NextResponse.json({ ok: false, error: 'missing_vault' }, { status: 400 });
  if (action !== 'start' && action !== 'stop') return NextResponse.json({ ok: false, error: 'invalid_action' }, { status: 400 });

  const newStatus = action === 'start' ? 'running' : 'stopped';

  if (redis) {
    await redis.set(statusKey(vaultPk), newStatus);
    if (action === 'start') {
      await redis.set(`amyth:vault:startedAt:${vaultPk}`, String(Date.now()));
      // Record starting equity for accurate PnL calculation (sent from client)
      const startingEquity = Number(body?.startingEquity || 0);
      if (startingEquity > 0) {
        await redis.set(`amyth:vault:startEquity:${vaultPk}`, String(startingEquity));
      }
      // Reset capital flows and realized PnL for this run
      await redis.set(`amyth:vault:netDeposits:${vaultPk}`, '0');
      await redis.set(`amyth:vault:realizedPnl:${vaultPk}`, '0');
    }
  }

  return NextResponse.json({ ok: true, vaultPk, status: newStatus });
}
