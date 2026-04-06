// src/lib/server/webhook-handler.server.ts
// Calls processSignal directly — no HTTP self-fetch to avoid Vercel timeout issues.

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import {
  getHookRecord, getWebhookConfig, enqueueSignal, appendActivity,
  cooldownKey, markSignalStatus, recordRelayerExecution,
  type QueuedSignalRecord,
} from '@/lib/server/webhooks.server';
import { processSignal } from '@/lib/relayer.server';

export async function handleWebhookSignal(
  req: NextRequest,
  hookId: string,
  action: 'open_long' | 'close_long' | 'open_short' | 'close_short',
) {
  try {
    if (!hookId) return NextResponse.json({ error: 'missing_hook_id' }, { status: 400 });

    const hook = await getHookRecord(hookId);
    if (!hook) return NextResponse.json({ error: 'unknown_hook' }, { status: 404 });

    const config = await getWebhookConfig(hook.vaultPk);
    if (!config) return NextResponse.json({ error: 'no_config' }, { status: 404 });

    // Check vault running status
    if (redis) {
      const status = await redis.get(`amyth:vault:status:${hook.vaultPk}`);
      if (status !== 'running') {
        return NextResponse.json({ error: 'vault_stopped', message: 'Vault is not running. Start it first.' }, { status: 403 });
      }
    }

    // Cooldown check
    const cooldownSecs = Math.max(0, Number(config.cooldownSecs || 0));
    if (redis && cooldownSecs > 0) {
      const key = cooldownKey(hook.vaultPk);
      const now = Date.now();
      const prior = await redis.get<string>(key);
      const priorTs = Number(prior || 0);
      if (priorTs > 0 && now - priorTs < cooldownSecs * 1000) {
        return NextResponse.json({ error: 'cooldown', retryAfterMs: cooldownSecs * 1000 - (now - priorTs) }, { status: 429 });
      }
      await redis.set(key, String(now), { ex: Math.max(1, cooldownSecs) });
    }

    // Pick the correct side config based on action
    const isLong = action === 'open_long' || action === 'close_long';
    const sideConf = isLong ? config.longConfig : config.shortConfig;

    const signalRecord: QueuedSignalRecord = {
      id: crypto.randomUUID(),
      receivedAt: Date.now(),
      hookId,
      vault: hook.vaultPk,
      ownerWallet: config.wallet,
      setId: config.setId,
      action,
      signal: isLong ? 'long' : 'short',
      market: config.marketLabel || 'PERP',
      status: 'queued',
      custody: sideConf?.custody || config.custody,
      collateralCustody: sideConf?.collateralCustody || config.collateralCustody,
      tokenMint: sideConf?.tokenMint || config.tokenMint,
      entirePosition: action.startsWith('close_'),
      leverage: config.leverage || null,
    };

    await enqueueSignal(signalRecord);
    await markSignalStatus(signalRecord.id, 'queued');

    // Execute on-chain DIRECTLY — no HTTP round-trip
    let execResult: any = null;
    let execError: string | null = null;
    try {
      await markSignalStatus(signalRecord.id, 'executing', { executedAt: Date.now() });
      execResult = await processSignal(signalRecord);

      await markSignalStatus(signalRecord.id, 'completed', {
        txSig: execResult?.signature || null,
        executedAt: Date.now(),
      });

      // For close events, estimate the realized PnL from the position at close time
      let estimatedPnl: number | null = null;
      if (action.startsWith('close_')) {
        try {
          const { Connection, PublicKey } = await import('@solana/web3.js');
          const { fetchJupiterPositions } = await import('@/lib/jupiter/positions');
          const rpcUrl = process.env.RPC_URL || process.env.HELIUS_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || '';
          const conn = new Connection(rpcUrl, 'confirmed');
          // Read vault authority from vault PDA
          const vaultAcct = await conn.getAccountInfo(new PublicKey(hook.vaultPk), 'confirmed');
          if (vaultAcct) {
            const { VAULT_PROGRAM_ID } = await import('@/lib/jupiter-vault-accounts');
            const [vaultAuth] = PublicKey.findProgramAddressSync(
              [Buffer.from('vault_authority'), new PublicKey(hook.vaultPk).toBuffer()], VAULT_PROGRAM_ID,
            );
            const positions = await fetchJupiterPositions(conn, vaultAuth);
            // Find the position matching this close action's side
            const closeSide = action === 'close_long' ? 'long' : 'short';
            const pos = positions.find(p => p.side === closeSide && p.baseAsset === (config.marketLabel || '').replace('-PERP', ''));
            if (pos) estimatedPnl = pos.unrealizedPnl;
          }
        } catch {}

        // Store running realized PnL total in Redis
        if (estimatedPnl !== null && redis) {
          try {
            const pnlKey = `amyth:vault:realizedPnl:${hook.vaultPk}`;
            const current = Number(await redis.get(pnlKey) || '0');
            await redis.set(pnlKey, String(current + estimatedPnl));
          } catch {}
        }
      }

      await appendActivity(hook.vaultPk, {
        id: `exec-${signalRecord.id}`,
        kind: 'signal_executed',
        signal: action,
        ts: Date.now(),
        perpSymbol: config.marketLabel,
        status: 'completed',
        txSig: execResult?.signature || null,
        source: 'relayer',
        ...(estimatedPnl !== null ? { realizedPnl: Math.round(estimatedPnl * 100) / 100 } : {}),
      });
      await recordRelayerExecution({
        vaultPk: hook.vaultPk,
        signalId: signalRecord.id,
        status: 'completed',
        signature: execResult?.signature || null,
        executedAt: Date.now(),
      });
    } catch (err: any) {
      execError = err?.message || 'Execution failed';
      console.error('[webhook-handler] processSignal error:', execError);
      await markSignalStatus(signalRecord.id, 'failed', { error: execError, executedAt: Date.now() });
      await appendActivity(hook.vaultPk, {
        id: `exec-failed-${signalRecord.id}`,
        kind: 'signal_executed',
        signal: action,
        ts: Date.now(),
        perpSymbol: config.marketLabel,
        status: 'failed',
        error: execError,
        source: 'relayer',
      });
      await recordRelayerExecution({
        vaultPk: hook.vaultPk,
        signalId: signalRecord.id,
        status: 'failed',
        error: execError,
        executedAt: Date.now(),
      });
    }

    return NextResponse.json({
      ok: !execError,
      signalId: signalRecord.id,
      action,
      status: execError ? 'failed' : 'completed',
      execution: execResult,
      error: execError,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'internal', message: err?.message || 'failed' }, { status: 500 });
  }
}
