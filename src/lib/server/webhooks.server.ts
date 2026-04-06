import 'server-only';

import { redis } from '@/lib/redis';
import { buildWebhookDefinitions, type VaultWebhookAction } from '@/lib/jupiter/webhooks';

export type RegisteredWebhook = {
  action: VaultWebhookAction;
  hookId: string;
  label: string;
  description: string;
  badgeTone: 'emerald' | 'rose' | 'violet' | 'amber';
};

export type RegisteredWebhookConfig = {
  wallet: string;
  vaultPk: string;
  setId?: number[];
  marketLabel?: string;
  cooldownSecs?: number;
  createdAt: number;
  endpointUrl: string;
  webhooks: RegisteredWebhook[];
  // Jupiter-specific — short side (legacy single-side compat)
  custody?: string;
  collateralCustody?: string;
  tokenMint?: string;
  side?: string;
  decimals?: number;
  // Dual-side configs (new)
  shortConfig?: { custody: string; collateralCustody: string; tokenMint: string };
  longConfig?: { custody: string; collateralCustody: string; tokenMint: string };
  leverage?: number;
};

export type QueuedSignalRecord = {
  id: string;
  receivedAt: number;
  hookId: string;
  vault: string;
  ownerWallet: string;
  setId?: number[];
  action: string;
  signal: string;
  market: string;
  size?: number | null;
  leverage?: number | null;
  orderType?: 'market' | 'limit' | string;
  price?: number | null;
  reduceOnly?: boolean;
  signalNonce?: string | number | null;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'validated';
  test?: boolean;
  txSig?: string;
  error?: string;
  executedAt?: number;
  relayer?: string;
  // Jupiter-specific fields
  custody?: string;
  collateralCustody?: string;
  tokenMint?: string;
  priceSlippage?: number;
  collateralDelta?: number;
  entirePosition?: boolean;
};

const MAX_ACTIVITY_ITEMS = 250;

export function normalizeWallet(wallet: string): string {
  return String(wallet || '').trim().toLowerCase();
}

export function walletVaultsSetKey(wallet: string): string {
  return `amyth:wallet:vaults:${normalizeWallet(wallet)}`;
}

// Legacy single-vault key (for migration)
export function walletVaultKey(wallet: string): string {
  return `amyth:wallet:vault:${normalizeWallet(wallet)}`;
}

export function webhookConfigKey(vaultPk: string): string {
  return `amyth:webhook:config:${vaultPk}`;
}

export function hookRecordKey(hookId: string): string {
  return `amyth:webhook:hook:${hookId}`;
}

export function signalQueueKey(vaultPk: string): string {
  return `amyth:signal:queue:${vaultPk}`;
}

export function signalRecordKey(signalId: string): string {
  return `amyth:signal:record:${signalId}`;
}

export function cooldownKey(vaultPk: string): string {
  return `amyth:cooldown:${vaultPk}`;
}

export function signalNonceKey(vaultPk: string, nonce: string): string {
  return `amyth:nonce:${vaultPk}:${nonce}`;
}

export function activityKey(vaultPk: string): string {
  return `amyth:activity:${vaultPk}`;
}

export function relayerExecKey(vaultPk: string): string {
  return `amyth:relayer:exec:${vaultPk}`;
}

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

export async function getWebhookConfig(vaultPk: string): Promise<RegisteredWebhookConfig | null> {
  if (!redis) return null;
  return redis.get<RegisteredWebhookConfig>(webhookConfigKey(vaultPk));
}

export async function setWebhookConfig(vaultPk: string, config: RegisteredWebhookConfig) {
  if (!redis) return;
  await redis.set(webhookConfigKey(vaultPk), config);
}

export async function getHookRecord(hookId: string): Promise<RegisteredWebhook & { vaultPk: string } | null> {
  if (!redis) return null;
  return redis.get(hookRecordKey(hookId));
}

export async function setHookRecord(hookId: string, record: RegisteredWebhook & { vaultPk: string }) {
  if (!redis) return;
  await redis.set(hookRecordKey(hookId), record);
}

export async function enqueueSignal(record: QueuedSignalRecord) {
  if (!redis) return;
  await redis.set(signalRecordKey(record.id), record, { ex: 7 * 24 * 60 * 60 });
  await redis.lpush(signalQueueKey(record.vault), record.id);
}

export async function dequeueSignal(vaultPk: string): Promise<QueuedSignalRecord | null> {
  if (!redis) return null;
  const id = await redis.rpop(signalQueueKey(vaultPk));
  if (!id) return null;
  return readSignalRecord(String(id));
}

export async function readSignalRecord(signalId: string): Promise<QueuedSignalRecord | null> {
  if (!redis) return null;
  return redis.get<QueuedSignalRecord>(signalRecordKey(signalId));
}

export async function markSignalStatus(signalId: string, status: string, extra?: Record<string, unknown>) {
  if (!redis) return;
  const record = await readSignalRecord(signalId);
  if (!record) return;
  await redis.set(signalRecordKey(signalId), { ...record, status, ...extra }, { ex: 7 * 24 * 60 * 60 });
}

export async function removeQueuedSignal(vaultPk: string, signalId: string) {
  if (!redis) return;
  await redis.lrem(signalQueueKey(vaultPk), 1, signalId);
}

export async function requeueSignal(record: QueuedSignalRecord) {
  if (!redis) return;
  await redis.set(signalRecordKey(record.id), record, { ex: 7 * 24 * 60 * 60 });
  await redis.rpush(signalQueueKey(record.vault), record.id);
}

export async function getQueueDepth(vaultPk?: string): Promise<number> {
  if (!redis) return 0;
  if (!vaultPk) return 0;
  return redis.llen(signalQueueKey(vaultPk));
}

export async function appendActivity(vaultPk: string, event: Record<string, unknown>) {
  if (!redis) return;
  const key = activityKey(vaultPk);
  await redis.lpush(key, JSON.stringify(event));
  await redis.ltrim(key, 0, MAX_ACTIVITY_ITEMS - 1);
}

export async function getActivity(vaultPk: string, limit = 50): Promise<unknown[]> {
  if (!redis) return [];
  const items = await redis.lrange(activityKey(vaultPk), 0, limit - 1);
  return items.map((item) => {
    try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return item; }
  });
}

export async function recordRelayerExecution(entry: Record<string, unknown>) {
  if (!redis) return;
  const vaultPk = String(entry.vaultPk || '');
  if (!vaultPk) return;
  const key = relayerExecKey(vaultPk);
  await redis.lpush(key, JSON.stringify(entry));
  await redis.ltrim(key, 0, 99);
  // Also store as global last execution for health check
  await redis.set('amyth:relayer:last_exec', JSON.stringify(entry), { ex: 7 * 24 * 60 * 60 });
}

export async function readRelayerLastExecution(): Promise<unknown | null> {
  if (!redis) return null;
  // Scan for most recent relayer execution across all vaults
  // For simplicity, check a global key
  const raw = await redis.get('amyth:relayer:last_exec');
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return raw; }
}

/**
 * Read activity with offset/limit pagination (used by vault/activity API route).
 */
export async function readActivity(vaultPk: string, offset = 0, limit = 20): Promise<unknown[]> {
  if (!redis) return [];
  const items = await redis.lrange(activityKey(vaultPk), offset, offset + limit - 1);
  return items.map((item) => {
    try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return item; }
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerVaultWebhooks(input: {
  wallet: string;
  vaultPk: string;
  endpointUrl: string;
  setId?: number[];
  marketLabel?: string;
  cooldownSecs?: number;
  custody?: string;
  collateralCustody?: string;
  tokenMint?: string;
  side?: string;
  decimals?: number;
  shortConfig?: { custody: string; collateralCustody: string; tokenMint: string };
  longConfig?: { custody: string; collateralCustody: string; tokenMint: string };
  leverage?: number;
}): Promise<RegisteredWebhookConfig> {
  if (!redis) throw new Error('Redis is not configured.');

  // Read existing config so we never silently overwrite leverage (or other fields)
  // with undefined during idempotent re-registration.
  const existingConfig = await getWebhookConfig(input.vaultPk);

  const webhooks = buildWebhookDefinitions(input.vaultPk).map((item) => ({
    action: item.action,
    hookId: item.hookId,
    label: item.label,
    description: item.description,
    badgeTone: item.badgeTone,
  }));

  const config: RegisteredWebhookConfig = {
    wallet: input.wallet,
    vaultPk: input.vaultPk,
    setId: input.setId,
    marketLabel: input.marketLabel,
    cooldownSecs: input.cooldownSecs,
    createdAt: existingConfig?.createdAt || Date.now(),
    endpointUrl: input.endpointUrl,
    webhooks,
    custody: input.custody,
    collateralCustody: input.collateralCustody,
    tokenMint: input.tokenMint,
    side: input.side,
    decimals: input.decimals,
    shortConfig: input.shortConfig,
    longConfig: input.longConfig,
    // Never overwrite an existing leverage with undefined — keep the value already in Redis
    leverage: input.leverage ?? existingConfig?.leverage,
  };

  await redis.set(webhookConfigKey(input.vaultPk), config);
  // Add to wallet's vault set (multi-vault support)
  await (redis as any).sadd(walletVaultsSetKey(input.wallet), input.vaultPk);
  // Legacy single-vault key (keep for backward compat)
  await redis.set(walletVaultKey(input.wallet), {
    wallet: input.wallet,
    vaultPk: input.vaultPk,
    setId: input.setId,
    createdAt: Date.now(),
  });

  for (const webhook of webhooks) {
    await redis.set(
      hookRecordKey(webhook.hookId),
      { vaultPk: input.vaultPk, wallet: input.wallet, action: webhook.action, createdAt: Date.now() },
    );
  }

  return config;
}

/** Get all vault PKs for a wallet */
export async function getWalletVaultPks(wallet: string): Promise<string[]> {
  if (!redis) return [];
  const members = await (redis as any).smembers(walletVaultsSetKey(wallet));
  if (Array.isArray(members) && members.length > 0) return members;
  // Fallback: check legacy single-vault key
  const legacy = await getWalletVault(wallet);
  return legacy?.vaultPk ? [legacy.vaultPk] : [];
}

export async function getWalletVault(wallet: string): Promise<{ wallet: string; vaultPk: string; setId?: number[] } | null> {
  if (!redis) return null;
  const raw = await redis.get(walletVaultKey(wallet));
  if (!raw) return null;
  if (typeof raw === 'object') return raw as any;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return null;
}

/** Delete a vault and all associated Redis keys. Caller must verify ownership + zero equity. */
export async function deleteVaultFromRedis(wallet: string, vaultPk: string): Promise<boolean> {
  if (!redis) return false;
  // Get the config to find webhook hookIds
  const config = await getWebhookConfig(vaultPk);
  const keysToDelete: string[] = [
    webhookConfigKey(vaultPk),
    signalQueueKey(vaultPk),
    `amyth:vault:status:${vaultPk}`,
    `amyth:vault:activity:${vaultPk}`,
  ];
  if (config?.webhooks) {
    for (const wh of config.webhooks) {
      keysToDelete.push(hookRecordKey(wh.hookId));
    }
  }
  // Delete all keys
  for (const k of keysToDelete) {
    await redis.del(k);
  }
  // Remove from wallet's vault set
  await (redis as any).srem(walletVaultsSetKey(wallet), vaultPk);
  return true;
}
