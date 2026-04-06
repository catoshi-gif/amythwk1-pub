import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getInternalExecuteSecret } from '@/lib/env.server';
import { processSignal } from '@/lib/relayer.server';
import {
  appendActivity,
  dequeueSignal,
  getQueueDepth,
  getWebhookConfig,
  markSignalStatus,
  readSignalRecord,
  recordRelayerExecution,
  requeueSignal,
  removeQueuedSignal,
} from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const provided = String(req.headers.get('x-internal-secret') || '').trim();
  return Boolean(provided && provided === getInternalExecuteSecret());
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({} as { signalId?: string; vaultPk?: string }));
    const directSignalId = String(body.signalId || '').trim();
    const vaultPk = String(body.vaultPk || '').trim();

    const signal = directSignalId
      ? await readSignalRecord(directSignalId)
      : vaultPk
        ? await dequeueSignal(vaultPk)
        : null;

    if (!signal) {
      return NextResponse.json({ ok: true, status: 'idle', message: 'No queued signals available.' });
    }

    const queueVault = String(signal.vault || '').trim();
    await markSignalStatus(signal.id, 'executing', { executedAt: Date.now() });

    try {
      let result;
      try {
        result = await processSignal(signal);
      } catch (firstError: any) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        result = await processSignal(signal);
      }
      await removeQueuedSignal(queueVault, signal.id);

      return NextResponse.json({
        ok: true,
        status: 'completed',
        signalId: signal.id,
        vaultPk: queueVault,
        queueDepth: await getQueueDepth(queueVault),
        result,
      });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Relayer execution failed.';
      await markSignalStatus(signal.id, 'failed', { error: message, executedAt: Date.now() });

      if (!directSignalId) {
        await requeueSignal({ ...signal, status: 'queued' });
      }

      const config = await getWebhookConfig(queueVault);
      await appendActivity(queueVault, {
        id: `exec-failed-${signal.id}`,
        kind: 'signal_executed',
        ts: Date.now(),
        signal: signal.action,
        perpSymbol: config?.marketLabel || signal.market,
        signalNonce: signal.signalNonce != null ? Number(signal.signalNonce) : undefined,
        status: 'failed',
        source: 'relayer',
        error: message,
      });
      await recordRelayerExecution({
        vaultPk: queueVault,
        signalId: signal.id,
        status: 'failed',
        error: message,
        executedAt: Date.now(),
      });

      return NextResponse.json({
        ok: false,
        status: 'failed',
        signalId: signal.id,
        vaultPk: queueVault,
        queueDepth: await getQueueDepth(queueVault),
        error: message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[webhook/execute] Error:', error);
    return NextResponse.json({ ok: false, error: 'internal', message: 'Failed to execute queued signal.' }, { status: 500 });
  }
}
