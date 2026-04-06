import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { activityKey } from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vaultPk = searchParams.get('vault') || '';
  if (!vaultPk || !redis) return NextResponse.json({ ok: true, stats: null });

  try {
    // Fetch all activity events for this vault
    const rawItems = await redis.lrange(activityKey(vaultPk), 0, 200);
    const items: any[] = rawItems.map((item: any) => {
      if (typeof item === 'string') try { return JSON.parse(item); } catch { return item; }
      return item;
    }).filter(Boolean);

    // Count trades — only relayer-executed signals, not client deposits/withdrawals
    // One trade epoch = open + close pair. Count completed closes as completed trades.
    // Opens without a close yet are "in progress" trade epochs.
    let completedTrades = 0;
    let failedTrades = 0;
    let opens = 0;
    let closes = 0;

    for (const ev of items) {
      // Only count relayer signal executions (not client deposit/withdraw events)
      if (ev?.kind !== 'signal_executed') continue;
      const sig = String(ev?.signal || '');
      if (ev?.status === 'completed') {
        if (sig.startsWith('open_')) opens++;
        if (sig.startsWith('close_')) closes++;
      }
      if (ev?.status === 'failed') failedTrades++;
    }

    // A "trade" = one complete open→close epoch
    // closes = completed trade epochs, opens without matching close = in progress
    completedTrades = closes;
    const totalSignals = opens + closes + failedTrades;

    // Get runtime (time since last start)
    const startedAtRaw = await redis.get(`amyth:vault:startedAt:${vaultPk}`);
    const startedAt = startedAtRaw ? Number(startedAtRaw) : null;
    const status = await redis.get(`amyth:vault:status:${vaultPk}`) || 'stopped';
    const runtimeMs = (status === 'running' && startedAt) ? Date.now() - startedAt : 0;

    // Realized PnL from closed positions (running total)
    const realizedPnlRaw = await redis.get(`amyth:vault:realizedPnl:${vaultPk}`);
    const realizedPnl = Number(realizedPnlRaw || '0');

    // Enterprise PnL: tracks starting equity and capital flows
    const startEquityRaw = await redis.get(`amyth:vault:startEquity:${vaultPk}`);
    const startEquity = Number(startEquityRaw || '0');
    const netDepositsRaw = await redis.get(`amyth:vault:netDeposits:${vaultPk}`);
    const netDeposits = Number(netDepositsRaw || '0');

    return NextResponse.json({
      ok: true,
      stats: {
        totalSignals,
        completedTrades,
        failedTrades,
        opens,
        closes,
        startedAt,
        runtimeMs,
        status,
        realizedPnl,
        startEquity,
        netDeposits,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: true, stats: null, error: err?.message });
  }
}
