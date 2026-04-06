"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { initWalletSession, clearWalletSessionClient } from "@/lib/auth/initWalletSession";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import CreateVaultFlow from "./_components/CreateVaultFlow";
import VaultInlinePanel from "./_components/VaultInlinePanel";
import ActivityPanel from "./_components/ActivityPanel";
import CreateBotModal from "@/components/CreateBotModal";
import { deriveVaultPda, deriveJupiterStrategyPda, deriveAllPdas, type StrategyContext } from "@/lib/jupiter-vault-accounts";
import { findMarketByCustody, USDC_MINT, USDC_CUSTODY } from "@/lib/jupiter/markets";
import HumanCheckGate from "@/components/security/HumanCheckGate";
import { buildDepositTx, buildWithdrawTx, fetchWalletTokenBalance, fetchVaultTokenBalance, sendAndConfirmWalletTx } from "@/lib/vault-sdk";

type AppView = "hub" | "create-vault";
type VaultInfo = { vaultPk: PublicKey; admin: PublicKey; setId: Uint8Array; paused: boolean; createdAt: number; leverage?: number };
type StrategyInfo = {
  exists: boolean; strategyPk: PublicKey; custody: PublicKey; collateralCustody: PublicKey;
  tokenMint: PublicKey; side: "long" | "short"; maxOpenSizeUsd: number; maxPriceSlippage: number;
  cooldownSecs: number; authorizedRelayer: string; paused: boolean; reduceOnly: boolean;
  lastExecTs: number; lastSignalNonce: number;
};

// Multi-vault localStorage helpers
type StoredVaultConfig = { setId: number[]; custody: string; collateralCustody: string; tokenMint: string; leverage?: number };

function getStoredVaults(admin: string): StoredVaultConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(`amyth_vaults_${admin}`);
    if (s) return JSON.parse(s);
  } catch {}
  // Migrate from legacy single-vault storage
  const legacySetId = getStoredSetIdLegacy(admin);
  const legacyConfig = getStoredStrategyConfigLegacy(admin);
  if (legacySetId && legacyConfig) {
    const migrated = [{ setId: Array.from(legacySetId), ...legacyConfig }];
    try { localStorage.setItem(`amyth_vaults_${admin}`, JSON.stringify(migrated)); } catch {}
    return migrated;
  }
  return [];
}

function addStoredVault(admin: string, config: StoredVaultConfig) {
  const existing = getStoredVaults(admin);
  // Avoid duplicates by setId
  const key = config.setId.join(',');
  if (existing.some(v => v.setId.join(',') === key)) return;
  existing.push(config);
  try { localStorage.setItem(`amyth_vaults_${admin}`, JSON.stringify(existing)); } catch {}
}

function removeStoredVault(admin: string, setId: number[]) {
  const existing = getStoredVaults(admin);
  const key = setId.join(',');
  const filtered = existing.filter(v => v.setId.join(',') !== key);
  try { localStorage.setItem(`amyth_vaults_${admin}`, JSON.stringify(filtered)); } catch {}
}

// Legacy helpers (for migration)
function getStoredSetIdLegacy(admin: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  try { const s = localStorage.getItem(`amyth_j_setId_${admin}`); if (s) return new Uint8Array(JSON.parse(s)); } catch {} return null;
}
function getStoredStrategyConfigLegacy(admin: string): { custody: string; collateralCustody: string; tokenMint: string } | null {
  if (typeof window === "undefined") return null;
  try { const s = localStorage.getItem(`amyth_j_strategy_${admin}`); if (s) return JSON.parse(s); } catch {} return null;
}
// Keep legacy writers for backward compat with CreateVaultFlow
function storeSetId(admin: string, setId: Uint8Array) { try { localStorage.setItem(`amyth_j_setId_${admin}`, JSON.stringify(Array.from(setId))); } catch {} }
function storeStrategyConfig(admin: string, config: { custody: string; collateralCustody: string; tokenMint: string }) { try { localStorage.setItem(`amyth_j_strategy_${admin}`, JSON.stringify(config)); } catch {} }
function getStoredStrategyConfig(admin: string) { return getStoredStrategyConfigLegacy(admin); }

function fmtAddr(s: string): string { return `${s.slice(0, 4)}…${s.slice(-4)}`; }

// Convert setId bytes to hex string for display
function setIdToHex(setId: Uint8Array): string {
  return Array.from(setId).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchAllVaultsOnChain(connection: any, admin: PublicKey): Promise<{ vault: VaultInfo; strategy: StrategyInfo }[]> {
  const adminStr = admin.toBase58();

  // 1. Fetch vault configs from Redis (works across all devices/browsers)
  let serverConfigs: StoredVaultConfig[] = [];
  try {
    const r = await fetch(`/api/wallet/vaults?wallet=${encodeURIComponent(adminStr)}`, { credentials: 'include', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && Array.isArray(j.vaults)) {
      serverConfigs = j.vaults
        .filter((v: any) => v?.setId && v?.custody && v?.collateralCustody && v?.tokenMint)
        .map((v: any) => ({ setId: v.setId, custody: v.custody, collateralCustody: v.collateralCustody, tokenMint: v.tokenMint, leverage: v.leverage || undefined }));
    }
  } catch {}

  // 2. Merge with localStorage — server (Redis) is authoritative for leverage,
  //    but local may have vaults not yet in Redis. Merge both directions, and
  //    for any field that exists in one source but not the other, keep the
  //    non-empty value so no data is ever silently lost.
  const localConfigs = getStoredVaults(adminStr);
  const merged = new Map<string, StoredVaultConfig>();
  // Insert server configs first — they have the authoritative leverage from Redis
  for (const c of serverConfigs) {
    merged.set(c.setId.join(','), c);
  }
  // Merge local configs: add vaults only present locally, and for vaults already
  // in the map, back-fill any fields the server might be missing (shouldn't happen,
  // but belt-and-suspenders).
  for (const c of localConfigs) {
    const key = c.setId.join(',');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, c);
    } else {
      // Server already has this vault — only back-fill leverage if server is missing it
      if (!existing.leverage && c.leverage) {
        existing.leverage = c.leverage;
      }
    }
  }
  const allConfigs = Array.from(merged.values());

  // 3. Sync merged list back to localStorage (so next load is instant)
  if (allConfigs.length > 0) {
    try { localStorage.setItem(`amyth_vaults_${adminStr}`, JSON.stringify(allConfigs)); } catch {}
  }

  if (allConfigs.length === 0) return [];

  // 4. Load each vault from on-chain
  const results: { vault: VaultInfo; strategy: StrategyInfo }[] = [];
  for (const cfg of allConfigs) {
    try {
      const setId = new Uint8Array(cfg.setId);
      const [vaultPk] = deriveVaultPda(admin, setId);
      const vaultAccount = await connection.getAccountInfo(vaultPk);
      if (!vaultAccount || vaultAccount.data.length < 67) continue;
      const data = vaultAccount.data;
      const paused = data[8 + 32 + 16] === 1;
      const createdAt = Number(data.readBigInt64LE(8 + 32 + 16 + 3)) * 1000;
      const vaultInfo: VaultInfo = { vaultPk, admin, setId, paused, createdAt, leverage: cfg.leverage };
      const custody = new PublicKey(cfg.custody);
      const collateralCustody = new PublicKey(cfg.collateralCustody);
      const tokenMint = new PublicKey(cfg.tokenMint);
      const [strategyPk] = deriveJupiterStrategyPda(vaultPk, custody, collateralCustody, tokenMint);
      const strategyAccount = await connection.getAccountInfo(strategyPk);
      if (!strategyAccount || strategyAccount.data.length < 400) continue;
      const sd = strategyAccount.data; const o = 8;
      results.push({
        vault: vaultInfo,
        strategy: {
          exists: true, strategyPk, custody, collateralCustody, tokenMint,
          side: sd[o + 320] === 0 ? "long" : "short",
          maxOpenSizeUsd: Number(sd.readBigUInt64LE(o + 321)),
          maxPriceSlippage: Number(sd.readBigUInt64LE(o + 329)),
          cooldownSecs: Number(sd.readBigInt64LE(o + 337)),
          authorizedRelayer: new PublicKey(sd.subarray(o + 64, o + 96)).toBase58(),
          paused: sd[o + 394] === 1, reduceOnly: sd[o + 395] === 1,
          lastExecTs: Number(sd.readBigInt64LE(o + 345)) * 1000,
          lastSignalNonce: Number(sd.readBigUInt64LE(o + 353)),
        },
      });
    } catch {}
  }
  return results;
}

function VaultCard({ vault, strategy, onRefresh, onDelete }: { vault: VaultInfo; strategy: StrategyInfo; onRefresh: () => void; onDelete?: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [vaultUsdc, setVaultUsdc] = useState(0);
  const [positions, setPositions] = useState<any[]>([]);
  const [txBusy, setTxBusy] = useState<"deposit" | "withdraw" | "close" | "open" | null>(null);
  const [txError, setTxError] = useState("");
  const [lastTxSig, setLastTxSig] = useState("");

  const strategyCtx: StrategyContext = {
    admin: vault.admin, setId: vault.setId, custody: strategy.custody,
    collateralCustody: strategy.collateralCustody, tokenMint: strategy.tokenMint, side: strategy.side,
  };

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      const [w, v] = await Promise.all([
        fetchWalletTokenBalance(connection, publicKey, USDC_MINT),
        fetchVaultTokenBalance(connection, strategyCtx),
      ]);
      setWalletUsdc(w); setVaultUsdc(v);
    } catch {}
    // Fetch positions via server API (avoids CORS with Jupiter price API)
    try {
      const pdas = deriveAllPdas(strategyCtx);
      const authority = pdas.vaultAuthority.toBase58();
      const res = await fetch(`/api/vault/positions?authority=${encodeURIComponent(authority)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.positions)) setPositions(data.positions);
    } catch {}
  }, [connection, publicKey, vault.setId]);

  useEffect(() => { refreshBalances(); const i = setInterval(refreshBalances, 20_000); return () => clearInterval(i); }, [refreshBalances]);

  // Ensure webhooks are registered in Redis (idempotent — fixes any stale/miskeyed hooks)
  // IMPORTANT: Use vault.leverage (from Redis via server merge) as the authoritative
  // source. Fall back to per-vault localStorage key only as a last resort. Never
  // silently default to 10 — that would overwrite a user's chosen leverage in Redis.
  useEffect(() => {
    if (!vault.vaultPk || !publicKey) return;
    const market = findMarketByCustody(strategy.custody);
    const vaultPkStr = vault.vaultPk.toBase58();
    // Priority: vault.leverage (from Redis merge) > per-vault localStorage key > undefined (omit from payload so Redis keeps existing value)
    const resolvedLeverage: number | undefined = vault.leverage
      || (typeof window !== 'undefined' ? Number(localStorage.getItem(`amyth_j_leverage_${vaultPkStr}`) || '0') || undefined : undefined);
    fetch('/api/webhook/register', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vaultPk: vaultPkStr,
        setId: Array.from(vault.setId),
        marketLabel: market?.symbol || 'SOL-PERP',
        cooldownSecs: 0,
        custody: strategy.custody.toBase58(),
        collateralCustody: strategy.collateralCustody.toBase58(),
        tokenMint: strategy.tokenMint.toBase58(),
        side: 'short', decimals: 6,
        shortConfig: {
          custody: strategy.custody.toBase58(),
          collateralCustody: USDC_CUSTODY.toBase58(),
          tokenMint: USDC_MINT.toBase58(),
        },
        longConfig: market ? {
          custody: strategy.custody.toBase58(),
          collateralCustody: market.sides.long.collateralCustody.toBase58(),
          tokenMint: USDC_MINT.toBase58(),
        } : undefined,
        ...(resolvedLeverage ? { leverage: resolvedLeverage } : {}),
      }),
    }).catch(() => {});
  }, [vault.vaultPk.toBase58()]);

  const handleDeposit = useCallback(async (amount: number) => {
    if (!publicKey || !sendTransaction) return;
    setTxBusy("deposit"); setTxError(""); setLastTxSig("");
    try {
      const tx = await buildDepositTx(connection, { publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, strategyCtx, amount, 6);
      const sig = await sendAndConfirmWalletTx(connection, { publicKey, sendTransaction }, tx);
      setLastTxSig(sig); refreshBalances(); onRefresh();
      // Log deposit to activity feed
      try { await fetch('/api/vault/activity', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vaultPk: vault.vaultPk.toBase58(), kind: 'deposit', txSig: sig, amountUi: amount, perpSymbol: 'USDC' }) }); } catch {}
    } catch (err: any) { setTxError(err?.message || "Deposit failed"); }
    finally { setTxBusy(null); }
  }, [publicKey, sendTransaction, connection, strategyCtx, refreshBalances, onRefresh]);

  const handleWithdraw = useCallback(async (amount: number) => {
    if (!publicKey || !sendTransaction) return;
    setTxBusy("withdraw"); setTxError(""); setLastTxSig("");
    try {
      const tx = await buildWithdrawTx(connection, { publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, strategyCtx, amount, 6);

      // Check if strategy has a stale pending request — clear it first
      try {
        const { deriveJupiterStrategyPda, VAULT_PROGRAM_ID: VP } = await import('@/lib/jupiter-vault-accounts');
        const [stratPk] = deriveJupiterStrategyPda(
          vault.vaultPk, new PublicKey(strategyCtx.custody),
          new PublicKey(strategyCtx.collateralCustody), new PublicKey(strategyCtx.tokenMint),
        );
        const stratAcct = await connection.getAccountInfo(stratPk, 'confirmed');
        if (stratAcct && stratAcct.data.length > 400) {
          const o = 8;
          const pendingRequest = new PublicKey(stratAcct.data.subarray(o + 361, o + 393));
          if (!pendingRequest.equals(PublicKey.default)) {
            // Check if the request is closed on Jupiter
            const reqAcct = await connection.getAccountInfo(pendingRequest, 'confirmed').catch(() => null);
            const isClosed = !reqAcct || reqAcct.data.length === 0;
            if (isClosed) {
              // Hardcoded anchor discriminator for clear_pending_request_state
              // sha256("global:clear_pending_request_state")[0..8]
              const clearDisc = Buffer.from([195, 106, 28, 48, 85, 44, 126, 101]);
              const clearIx = new TransactionInstruction({
                programId: VP,
                keys: [
                  { pubkey: publicKey, isSigner: true, isWritable: true },
                  { pubkey: vault.vaultPk, isSigner: false, isWritable: false },
                  { pubkey: stratPk, isSigner: false, isWritable: true },
                  { pubkey: pendingRequest, isSigner: false, isWritable: false },
                ],
                data: clearDisc,
              });
              // Prepend clear instruction before the withdraw
              const instructions = tx.instructions;
              tx.instructions = [clearIx, ...instructions];
            }
          }
        }
      } catch (clearErr) {
        console.warn('[withdraw] pending request check failed:', clearErr);
      }

      const sig = await sendAndConfirmWalletTx(connection, { publicKey, sendTransaction }, tx);
      setLastTxSig(sig); refreshBalances(); onRefresh();
      try { await fetch('/api/vault/activity', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vaultPk: vault.vaultPk.toBase58(), kind: 'withdraw', txSig: sig, amountUi: amount, perpSymbol: 'USDC' }) }); } catch {}
    } catch (err: any) { setTxError(err?.message || "Withdraw failed"); }
    finally { setTxBusy(null); }
  }, [publicKey, sendTransaction, connection, strategyCtx, vault, refreshBalances, onRefresh]);

  const market = findMarketByCustody(strategy.custody);

  // Check for dual-strategy migration on Start
  const handleStart = useCallback(async () => {
    if (!publicKey || !sendTransaction) return;
    try {
      const res = await fetch('/api/vault/migrate-dual', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vaultPk: vault.vaultPk.toBase58() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.tx) {
        // Long strategy doesn't exist yet — sign the migration tx
        const txBytes = Uint8Array.from(atob(data.tx), (c: string) => c.charCodeAt(0));
        const { VersionedTransaction } = await import('@solana/web3.js');
        const tx = VersionedTransaction.deserialize(txBytes);
        const sig = await sendTransaction(tx, connection, { skipPreflight: false });
        await connection.confirmTransaction(sig, 'confirmed');
      }
      // data.already === true means long strategy exists, no migration needed
    } catch (err: any) {
      // If migration fails, still allow starting (shorts will work)
      console.warn('[migrate-dual]', err?.message);
    }
  }, [publicKey, sendTransaction, connection, vault]);

  const activePos = positions.length > 0 ? positions[0] : null;
  const totalPnl = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const totalSize = positions.reduce((s, p) => s + (p.sizeUsd || 0), 0);

  // Read leverage from vault config (Redis via server), fall back to per-vault localStorage key.
  // Default to 10 only as an absolute last resort (new vaults always set this explicitly).
  const storedLeverage = vault.leverage
    || (typeof window !== 'undefined' ? Number(localStorage.getItem(`amyth_j_leverage_${vault.vaultPk.toBase58()}`)) || undefined : undefined)
    || 10;

  // Manual close position via close_short webhook
  const handleClosePosition = useCallback(async () => {
    if (!publicKey) return;
    setTxBusy("close"); setTxError("");
    try {
      const side = activePos?.side === 'long' ? 'closelong' : 'closeshort';
      const hookDefs = (await import('@/lib/jupiter/webhooks')).buildWebhookDefinitions(vault.vaultPk.toBase58());
      const closeHook = hookDefs.find(h => h.action === (activePos?.side === 'long' ? 'close_long' : 'close_short'));
      if (closeHook) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const res = await fetch(`${origin}/${side}/${closeHook.hookId}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (data?.error) { setTxError(data.error); setTxBusy(null); return; }
        setLastTxSig(data?.execution?.txSig || '');
        // Soft poll for position change instead of hard refresh
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 2500));
          refreshBalances();
          onRefresh();
        }
      }
    } catch (err: any) { setTxError(err?.message || "Close failed"); }
    finally { setTxBusy(null); }
  }, [publicKey, vault, activePos, refreshBalances, onRefresh]);

  // Manual open position via open webhook
  const handleOpenPosition = useCallback(async (side: 'long' | 'short') => {
    if (!publicKey) return;
    setTxBusy("open"); setTxError("");
    try {
      const slug = side === 'long' ? 'openlong' : 'openshort';
      const hookDefs = (await import('@/lib/jupiter/webhooks')).buildWebhookDefinitions(vault.vaultPk.toBase58());
      const openHook = hookDefs.find(h => h.action === (side === 'long' ? 'open_long' : 'open_short'));
      if (openHook) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const res = await fetch(`${origin}/${slug}/${openHook.hookId}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (data?.error) { setTxError(data.error); setTxBusy(null); return; }
        setLastTxSig(data?.execution?.txSig || '');
        // Soft poll for position to appear instead of hard refresh
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 2500));
          refreshBalances();
          onRefresh();
        }
      }
    } catch (err: any) { setTxError(err?.message || "Open failed"); }
    finally { setTxBusy(null); }
  }, [publicKey, vault, refreshBalances, onRefresh]);

  return (
    <div>
      <VaultInlinePanel
        vaultPk={vault.vaultPk.toBase58()}
        setId={setIdToHex(vault.setId)}
        marketLabel={market?.symbol ?? "Unknown"}
        vaultBalance={vaultUsdc}
        walletBalance={walletUsdc}
        unrealizedPnl={totalPnl}
        positionSide={activePos?.side ?? "flat"}
        positionSize={totalSize}
        createdAt={vault.createdAt}
        leverage={storedLeverage}
        onDeposit={handleDeposit}
        onWithdraw={handleWithdraw}
        onClosePosition={handleClosePosition}
        onOpenPosition={handleOpenPosition}
        onStart={handleStart}
        onDelete={onDelete}
        txBusy={txBusy}
        positions={positions}
      />
      {(txError || lastTxSig) && (
        <div className="mt-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-xs">
          {txError ? <span className="text-rose-300">{txError}</span> : (
            <span className="text-white/50">Confirmed: <a href={`https://solscan.io/tx/${lastTxSig}`} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline font-mono">{fmtAddr(lastTxSig)}</a></span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AppPage() {
  const { connected, publicKey, signMessage, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [vaults, setVaults] = useState<{ vault: VaultInfo; strategy: StrategyInfo }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<AppView>("hub");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [humanOK, setHumanOK] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return Date.now() < Number(localStorage.getItem("amyth_turnstile_ok_ts") || "0"); } catch { return false; }
  });

  const sessionInitRef = useRef(false);
  useEffect(() => {
    if (!connected || !publicKey) { sessionInitRef.current = false; void clearWalletSessionClient().catch(() => {}); return; }
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;
    void initWalletSession({ wallet: publicKey.toBase58(), signMessage, signTransaction }).catch(() => {});
  }, [connected, publicKey, connection]);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!connected || !publicKey) { setVaults([]); setLoading(false); return; }
    // Only show loading spinner on first load, not on refresh
    if (vaults.length === 0) setLoading(true);
    let cancelled = false;
    fetchAllVaultsOnChain(connection, publicKey)
      .then((results) => { if (!cancelled) setVaults(results.sort((a, b) => b.vault.createdAt - a.vault.createdAt)); })
      .catch(() => { /* keep existing vaults on error */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connected, publicKey, connection, refreshKey]);

  const handleVaultCreated = useCallback((result: { setId: Uint8Array; vaultPk: string; strategyPk: string; signatures: string[]; marketConfig: { custody: string; collateralCustody: string; tokenMint: string }; leverage: number }) => {
    if (!publicKey) return;
    if (result.signatures.length > 0) {
      // Store in multi-vault array (include leverage so it survives page reloads)
      addStoredVault(publicKey.toBase58(), {
        setId: Array.from(result.setId),
        ...result.marketConfig,
        leverage: result.leverage,
      });
      // Also store leverage in the per-vault key (belt-and-suspenders)
      try { localStorage.setItem(`amyth_j_leverage_${result.vaultPk}`, String(result.leverage)); } catch {}
      // Also store in legacy format for backward compat
      storeSetId(publicKey.toBase58(), result.setId);
      storeStrategyConfig(publicKey.toBase58(), result.marketConfig);
    }
    setView("hub"); refresh();
  }, [publicKey, refresh]);

  const handleDeleteVault = useCallback(async (vaultPk: string, setId: Uint8Array) => {
    if (!publicKey) return;
    try {
      const res = await fetch('/api/vault/delete', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vaultPk }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        removeStoredVault(publicKey.toBase58(), Array.from(setId));
        refresh();
      } else {
        alert(data?.message || data?.error || 'Failed to delete vault.');
      }
    } catch (err: any) {
      alert(err?.message || 'Delete failed.');
    }
  }, [publicKey, refresh]);

  const hasBots = vaults.length > 0;
  const walletAddr = publicKey?.toBase58() ?? "";
  const walletShort = walletAddr ? fmtAddr(walletAddr) : "";

  if (!humanOK) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <HumanCheckGate onVerified={(ttlMs) => {
          try { const until = Date.now() + (typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : 6 * 60 * 60 * 1000); if (typeof window !== "undefined") localStorage.setItem("amyth_turnstile_ok_ts", String(until)); } catch {}
          setHumanOK(true);
        }} />
      </div>
    );
  }

  if (!connected || !publicKey) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <h2 className="mb-3 text-2xl font-display tracking-tight text-white">Connect your wallet</h2>
        <p className="max-w-sm text-sm text-white/40">Connect a Solana wallet to deploy vaults, wire TradingView webhooks, and automate Jupiter perps.</p>
      </div>
    );
  }

  if (view === "create-vault") {
    return (
      <div className="min-h-[70vh] py-4">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setView("hub")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/40 hover:bg-white/10">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4" /></svg>
          </button>
          <h1 className="text-lg font-semibold text-white">New Bot</h1>
        </div>
        <CreateVaultFlow onCreated={handleVaultCreated} />
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] py-4">
      {/* Compact header */}
      <section className="mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-white/40">{walletShort}</span>
            <span className="text-[10px] text-white/20">·</span>
            <span className="text-[11px] text-white/30">{vaults.length} bot{vaults.length !== 1 ? 's' : ''}</span>
          </div>
          <button onClick={() => setOpenCreateModal(true)}
            className="group flex items-center gap-1.5 rounded-lg border border-brandAmethyst/20 bg-brandAmethyst/[0.06] px-3 py-1.5 text-[11px] font-medium text-[#C2B6F7] transition-all hover:border-brandAmethyst/35 hover:bg-brandAmethyst/[0.12] active:scale-[0.97]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M3 7H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            New Bot
          </button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <svg className="h-6 w-6 animate-spin text-white/20" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : hasBots ? (
        <div className="space-y-4">
          {vaults.map(({ vault: v, strategy: s }) => (
            <VaultCard key={v.vaultPk.toBase58()} vault={v} strategy={s} onRefresh={refresh}
              onDelete={() => handleDeleteVault(v.vaultPk.toBase58(), v.setId)} />
          ))}
        </div>
      ) : (
        <div className="rounded-[28px] border border-dashed border-brandAmethyst/15 bg-brandAmethyst/[0.02] px-6 py-16 text-center shadow-[0_0_80px_rgba(84,31,243,0.04)]">
          <h3 className="font-display text-lg tracking-tight text-white/80">No bots deployed yet</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/30">
            Tap the <span className="text-brandLavender">+</span> button above to create your first Jupiter Perps webhook bot.
          </p>
        </div>
      )}

      {!loading && connected && (
        <div className="mt-6"><ActivityPanel wallet={walletAddr} /></div>
      )}

      <CreateBotModal open={openCreateModal} wallet={walletAddr} onClose={() => setOpenCreateModal(false)}
        onSelect={(kind) => { setOpenCreateModal(false); if (kind === "webhook") setView("create-vault"); }} />
    </div>
  );
}
