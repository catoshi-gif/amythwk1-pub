import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeWebhookAction } from '@/lib/jupiter/webhooks';
import { getSessionWalletFromRequest } from '@/lib/auth/session.server';
import { redis } from '@/lib/redis';
import { getInternalExecuteSecret } from '@/lib/env.server';
import {
  appendActivity,
  cooldownKey,
  enqueueSignal,
  getHookRecord,
  getWebhookConfig,
  markSignalStatus,
  signalNonceKey,
  type QueuedSignalRecord,
} from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WebhookPayload = {
  secret?: string;
  vault?: string;
  market?: string;
  hookId?: string;
  action?: string;
  signal?: 'long' | 'short' | 'flat' | string;
  size?: number | string;
  leverage?: number | string;
  order_type?: 'market' | 'limit';
  price?: number | string;
  reduce_only?: boolean;
  signalNonce?: string | number;
  test?: boolean;
  // Jupiter-specific
  collateralDelta?: number | string;
  priceSlippage?: number | string;
  entirePosition?: boolean;
};

const WEBHOOK_SECRET = String(process.env.WEBHOOK_SECRET || '').trim();

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function enforceCooldown(vaultPk: string, cooldownSecs: number) {
  if (!redis || cooldownSecs <= 0) return { ok: true as const };
  const key = cooldownKey(vaultPk);
  const now = Date.now();
  const prior = await redis.get<number | string | null>(key);
  const priorTs = typeof prior === 'number' ? prior : Number(prior || 0);
  if (Number.isFinite(priorTs) && priorTs > 0 && now - priorTs < cooldownSecs * 1000) {
    return { ok: false as const, retryAfterMs: cooldownSecs * 1000 - (now - priorTs) };
  }
  await redis.set(key, String(now), { ex: Math.max(1, cooldownSecs) });
  return { ok: true as const };
}

async function reserveSignalNonce(vaultPk: string, nonce: string | null) {
  if (!redis || !nonce) return { ok: true as const };
  const res = await redis.set(signalNonceKey(vaultPk, nonce), '1', { nx: true, ex: 7 * 24 * 60 * 60 });
  if (res !== 'OK') return { ok: false as const };
  return { ok: true as const };
}

async function triggerImmediateExecution(req: NextRequest, signalId: string) {
  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/webhook/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': getInternalExecuteSecret() },
      body: JSON.stringify({ signalId }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  } catch (error: any) {
    return { ok: false as const, data: { error: error?.message || 'execute_call_failed' } };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as WebhookPayload;
    const hookId = String(body.hookId || '').trim();
    const vaultPk = String(body.vault || '').trim();
    const market = String(body.market || '').trim().toUpperCase();
    const isTest = body.test === true;

    if (!hookId || !vaultPk || !market) {
      return NextResponse.json({ error: 'bad_request', message: 'Missing required fields: hookId, vault, market' }, { status: 400 });
    }

    const hook = await getHookRecord(hookId);
    const config = await getWebhookConfig(vaultPk);
    if (!hook || hook.vaultPk !== vaultPk || !config) {
      return NextResponse.json({ error: 'bad_request', message: 'Unknown webhook hookId or vault.' }, { status: 400 });
    }

    if (hook.action !== body.action && body.action) {
      return NextResponse.json({ error: 'bad_request', message: 'Webhook action does not match registered hookId.' }, { status: 400 });
    }

    if (isTest) {
      const sessionWallet = await getSessionWalletFromRequest(req as any);
      if (!sessionWallet || sessionWallet.toLowerCase() !== config.wallet.toLowerCase()) {
        return NextResponse.json({ error: 'unauthorized', message: 'Test webhook requires the vault owner session.' }, { status: 401 });
      }
    } else if (!WEBHOOK_SECRET || String(body.secret || '').trim() !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'unauthorized', message: 'Invalid webhook secret' }, { status: 401 });
    }

    const normalized = normalizeWebhookAction({
      action: hook.action,
      signal: body.signal,
      reduceOnly: body.reduce_only,
    });

    if (!normalized) {
      return NextResponse.json({ error: 'bad_request', message: 'Action must be open_long, close_long, open_short, close_short.' }, { status: 400 });
    }

    const size = parseOptionalNumber(body.size);
    const collateralDelta = parseOptionalNumber(body.collateralDelta);
    const priceSlippage = parseOptionalNumber(body.priceSlippage);

    if (normalized.requiresSize && (!size || size <= 0)) {
      return NextResponse.json({ error: 'bad_request', message: 'Open actions require a positive size.' }, { status: 400 });
    }

    const cooldownSecs = Math.max(0, Number(config.cooldownSecs || 0));
    const cooldown = await enforceCooldown(vaultPk, cooldownSecs);
    if (!cooldown.ok) {
      return NextResponse.json({ error: 'rate_limited', message: 'Signal ignored — vault still in cooldown.', retryAfterMs: cooldown.retryAfterMs }, { status: 429 });
    }

    const nonce = body.signalNonce == null || body.signalNonce === '' ? null : String(body.signalNonce);
    const reserved = await reserveSignalNonce(vaultPk, nonce);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'duplicate_signal', message: 'Duplicate signalNonce rejected.' }, { status: 409 });
    }

    const signalRecord: QueuedSignalRecord = {
      id: crypto.randomUUID(),
      receivedAt: Date.now(),
      hookId,
      vault: vaultPk,
      ownerWallet: config.wallet,
      setId: config.setId,
      action: normalized.action,
      signal: normalized.signal,
      market,
      size: size ?? null,
      orderType: body.order_type ?? 'market',
      price: parseOptionalNumber(body.price),
      reduceOnly: body.reduce_only ?? normalized.reduceOnlyDefault,
      signalNonce: nonce,
      status: isTest ? 'validated' : 'queued',
      test: isTest,
      // Jupiter-specific
      custody: config.custody,
      collateralCustody: config.collateralCustody,
      tokenMint: config.tokenMint,
      collateralDelta: collateralDelta ?? undefined,
      priceSlippage: priceSlippage ?? undefined,
      entirePosition: body.entirePosition,
    };

    await appendActivity(vaultPk, {
      id: `ingest-${signalRecord.id}`,
      kind: 'signal_executed',
      ts: signalRecord.receivedAt,
      signal: normalized.action,
      perpSymbol: market,
      baseAssetAmount: size ?? undefined,
      signalNonce: nonce ? Number(nonce) : undefined,
      status: isTest ? 'validated' : 'queued',
      source: isTest ? 'test_webhook' : 'webhook_ingest',
    });

    if (isTest) {
      return NextResponse.json({ ok: true, signalId: signalRecord.id, status: 'validated', signal: signalRecord, message: 'Webhook validated successfully' });
    }

    await enqueueSignal(signalRecord);
    await markSignalStatus(signalRecord.id, 'queued');

    const execute = await triggerImmediateExecution(req, signalRecord.id);
    const executionAccepted = Boolean(execute.ok && execute.data?.ok);

    return NextResponse.json({
      ok: true,
      signalId: signalRecord.id,
      status: executionAccepted ? 'executing' : 'queued',
      signal: signalRecord,
      execution: execute.data,
      message: executionAccepted ? 'Signal queued and execution triggered' : 'Signal queued for execution',
    });
  } catch (err: any) {
    console.error('[webhook/ingest] Error:', err);
    return NextResponse.json({ error: 'internal', message: 'Failed to process webhook' }, { status: 500 });
  }
}
