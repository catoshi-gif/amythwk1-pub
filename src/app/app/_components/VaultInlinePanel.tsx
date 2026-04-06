'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { buildWebhookDefinitions } from '@/lib/jupiter/webhooks';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtPnl(n: number): string { return `${n >= 0 ? '+' : ''}${fmtUsd(n)}`; }
function fmtRuntime(ms: number): string {
  if (ms <= 0) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

// Token logo URLs (Jupiter CDN)
const TOKEN_LOGOS: Record<string, string> = {
  USDC: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  BTC: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png',
  SOL: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  ETH: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png',
};
function TokenIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const src = TOKEN_LOGOS[symbol] || TOKEN_LOGOS.USDC;
  return <img src={src} alt={symbol} width={size} height={size} className="rounded-full ring-1 ring-white/10" loading="lazy" />;
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${copied ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80'}`}>
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function SafeButton({ label, confirmLabel, onConfirm, className, disabled }: {
  label: string; confirmLabel: (c: number) => string; onConfirm: () => void; className: string; disabled?: boolean;
}) {
  const [clicks, setClicks] = useState(0);
  const timerRef = React.useRef<any>(null);
  const lastRef = React.useRef(0);
  const handleClick = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    const next = (now - lastRef.current <= 1500) ? clicks + 1 : 1;
    lastRef.current = now;
    setClicks(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setClicks(0), 1500);
    if (next >= 3) { setClicks(0); onConfirm(); }
  }, [clicks, onConfirm, disabled]);
  return <button type="button" onClick={handleClick} disabled={disabled} className={`${className} disabled:opacity-30 disabled:cursor-not-allowed`}>{clicks > 0 ? confirmLabel(clicks) : label}</button>;
}

const actionSlug: Record<string, string> = { open_long: 'openlong', close_long: 'closelong', open_short: 'openshort', close_short: 'closeshort' };
const actionColor: Record<string, string> = { open_long: 'text-[#1BFDB2]', close_long: 'text-rose-300', open_short: 'text-[#C2B6F7]', close_short: 'text-amber-300' };

type PositionData = { symbol?: string; baseAsset?: string; side: string; sizeUsd: number; collateralUsd: number; entryPrice: number; markPrice: number; unrealizedPnl: number; leverage?: number; openTime?: number };

type Props = {
  vaultPk: string; setId: string; marketLabel: string;
  vaultBalance: number; walletBalance: number;
  unrealizedPnl: number; positionSide: 'long' | 'short' | 'flat'; positionSize: number;
  createdAt: number; leverage?: number;
  onDeposit: (amount: number) => void; onWithdraw: (amount: number) => void;
  onClosePosition?: () => void; onOpenPosition?: (side: 'long' | 'short') => void;
  onStart?: () => Promise<void>; onDelete?: () => void;
  txBusy: 'deposit' | 'withdraw' | 'close' | 'open' | null;
  positions?: PositionData[];
};

export default function VaultInlinePanel({
  vaultPk, setId, marketLabel, vaultBalance, walletBalance,
  unrealizedPnl, positionSide, positionSize, createdAt, leverage,
  onDeposit, onWithdraw, onClosePosition, onOpenPosition, onStart, onDelete,
  txBusy, positions,
}: Props) {
  const [vaultStatus, setVaultStatus] = useState<'running' | 'stopped'>('stopped');
  const [statusLoading, setStatusLoading] = useState(true);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [depAmount, setDepAmount] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [pendingAction, setPendingAction] = useState<'opening' | 'closing' | null>(null);
  const [pendingProgress, setPendingProgress] = useState(0);
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'https://amyth.trade';
  const webhooks = useMemo(() => buildWebhookDefinitions(vaultPk), [vaultPk]);
  const baseAsset = marketLabel.replace('-PERP', '');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/vaults/status?vault=${encodeURIComponent(vaultPk)}`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (alive && j?.status) setVaultStatus(j.status === 'running' ? 'running' : 'stopped');
      } catch {}
      if (alive) setStatusLoading(false);
    })();
    return () => { alive = false; };
  }, [vaultPk]);

  const isRunning = vaultStatus === 'running';
  const isStopped = vaultStatus === 'stopped';
  const hasPositions = positions && positions.length > 0;
  const positionBalance = positions ? positions.reduce((s, p) => s + p.collateralUsd + p.unrealizedPnl, 0) : 0;
  const equity = vaultBalance + positionBalance;

  // Track pending open/close actions with progress bar
  useEffect(() => {
    if (txBusy === 'open') {
      setPendingAction('opening');
      setPendingProgress(0);
    } else if (txBusy === 'close') {
      setPendingAction('closing');
      setPendingProgress(0);
    }
  }, [txBusy]);

  // Animate progress bar over ~20s when pending
  useEffect(() => {
    if (!pendingAction) return;
    const start = Date.now();
    const duration = 20_000;
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(elapsed / duration, 0.95); // cap at 95% until confirmed
      setPendingProgress(pct);
    };
    tick();
    const i = setInterval(tick, 200);
    return () => clearInterval(i);
  }, [pendingAction]);

  // Clear pending when position state changes (position appears or disappears)
  const prevHasPositions = React.useRef(hasPositions);
  useEffect(() => {
    if (prevHasPositions.current !== hasPositions && pendingAction) {
      setPendingAction(null);
      setPendingProgress(0);
    }
    prevHasPositions.current = hasPositions;
  }, [hasPositions, pendingAction]);

  const toggleVaultStatus = useCallback(async () => {
    const newAction = vaultStatus === 'running' ? 'stop' : 'start';
    if (newAction === 'start' && equity < 10) { alert('Vault equity must be at least $10 to start.'); return; }
    if (newAction === 'start' && onStart) {
      try { await onStart(); } catch (e: any) {
        alert(e?.message || 'Failed to start vault.'); return;
      }
    }
    setStatusLoading(true);
    try {
      const r = await fetch('/api/vaults/status', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vaultPk, action: newAction, ...(newAction === 'start' ? { startingEquity: equity } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (j?.status) setVaultStatus(j.status);
    } catch {}
    setStatusLoading(false);
  }, [vaultPk, vaultStatus, equity, onStart]);

  // Vault stats (trade count, runtime)
  const [stats, setStats] = useState<{ totalSignals: number; completedTrades: number; failedTrades: number; opens: number; closes: number; runtimeMs: number; startedAt: number | null; realizedPnl: number; startEquity: number; netDeposits: number } | null>(null);
  const [liveRuntime, setLiveRuntime] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/vault/stats?vault=${encodeURIComponent(vaultPk)}`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (alive && j?.stats) setStats(j.stats);
      } catch {}
    };
    load();
    const i = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(i); };
  }, [vaultPk]);

  // Tick runtime every second when running
  useEffect(() => {
    if (!isRunning || !stats?.startedAt) { setLiveRuntime(0); return; }
    const tick = () => setLiveRuntime(Date.now() - stats.startedAt!);
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [isRunning, stats?.startedAt]);

  return (
    <div className={`glass-facet rounded-[28px] p-4 sm:p-5 border-l-2 ${isRunning ? 'border-l-[#541FF3]' : 'border-l-white/[0.06]'}`}>
      {/* Header — compact single line: status · market · leverage · equity · controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${isRunning ? 'bg-[#1BFDB2] shadow-[0_0_6px_rgba(27,253,178,0.5)]' : 'bg-white/20'}`} />
          <TokenIcon symbol={baseAsset} size={18} />
          <span className="text-sm font-semibold text-white">{marketLabel}</span>
          {leverage && leverage > 0 && (
            <span className="rounded border border-[#541FF3]/25 bg-[#541FF3]/10 px-1.5 py-px text-[10px] font-bold text-[#C2B6F7] tabular-nums">{leverage}x</span>
          )}
          <span className="text-white/20">·</span>
          <span className={`text-[11px] font-medium ${isRunning ? 'text-[#1BFDB2]' : 'text-white/35'}`}>{isRunning ? 'Running' : 'Stopped'}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Equity — prominent but compact */}
          <span className="text-sm font-bold text-white tabular-nums">{fmtUsd(equity)}</span>
          {hasPositions && (
            <span className={`text-[11px] font-semibold tabular-nums ${unrealizedPnl >= 0 ? 'text-[#1BFDB2]' : 'text-rose-400'}`}>{fmtPnl(unrealizedPnl)}</span>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="mt-2 flex items-center gap-1.5 justify-end">
        <button type="button" onClick={() => setShowWebhooks(v => !v)}
          className="rounded-lg border border-white/10 bg-white/5 min-h-[28px] px-2 py-0.5 text-[10px] font-medium text-white/45 hover:bg-white/10 transition-colors">
          {showWebhooks ? 'Hide' : 'Webhooks'}
        </button>
        {!statusLoading && (
          isRunning ? (
            <SafeButton label="Stop" confirmLabel={(c) => `Stop (${c}/3)`} onConfirm={toggleVaultStatus}
              className="rounded-lg border border-rose-500/40 bg-rose-500 min-h-[28px] px-2.5 py-0.5 text-[10px] font-semibold text-white hover:opacity-90 transition-all active:translate-y-[0.5px]" />
          ) : (
            <button type="button" onClick={toggleVaultStatus}
              className="rounded-lg border border-[#1BFDB2]/40 bg-[#1BFDB2] min-h-[28px] px-2.5 py-0.5 text-[10px] font-semibold text-black hover:opacity-90 transition-all active:translate-y-[0.5px]">Start</button>
          )
        )}
      </div>

      {/* Balance breakdown */}
      <div className="mt-3 rounded-lg bg-black/60 p-3">
        <div className="flex gap-3 text-[10px]">
          {/* Hide vault balance card when it's $0 and a position is open */}
          {!(hasPositions && vaultBalance < 0.01) && (
            <div className="flex-1 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <div className="flex items-center gap-1 uppercase tracking-wider text-white/25 mb-0.5">
                <TokenIcon symbol="USDC" size={12} /> Vault
              </div>
              <div className="text-sm font-semibold text-white tabular-nums">{fmtUsd(vaultBalance)}</div>
            </div>
          )}
          {hasPositions && (
            <div className="flex-1 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <div className="flex items-center gap-1 uppercase tracking-wider text-white/25 mb-0.5">
                <TokenIcon symbol={baseAsset} size={12} /> Positions
              </div>
              <div className="text-sm font-semibold text-white tabular-nums">{fmtUsd(positionBalance)}</div>
            </div>
          )}
        </div>

        {/* Keeper processing indicator */}
        {pendingAction && (
          <div className="mt-2.5 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-1.5 text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C2B6F7] animate-pulse" />
                {pendingAction === 'opening' ? 'Jupiter keeper processing position…' : 'Jupiter keeper closing position…'}
              </span>
              <span className="tabular-nums text-white/30">{Math.round(pendingProgress * 100)}%</span>
            </div>
            <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#541FF3] to-[#C2B6F7] transition-all duration-200 ease-linear"
                style={{ width: `${Math.round(pendingProgress * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Metrics bar — trades · success rate · PnL · runtime */}
        {stats && (stats.totalSignals > 0 || stats.completedTrades > 0 || isRunning) && (
          <div className="mt-2.5 flex items-center gap-2.5 px-1 text-[10px] text-white/30">
            {stats.totalSignals > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-[#C2B6F7]/40" />
                <span className="tabular-nums text-white/45">{stats.completedTrades}</span> trade{stats.completedTrades !== 1 ? 's' : ''}
                {stats.opens > stats.closes && <span className="text-white/20">(1 open)</span>}
              </span>
            )}
            {stats.totalSignals > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-[#1BFDB2]/40" />
                <span className="tabular-nums text-white/45">{stats.failedTrades > 0 ? Math.round(((stats.opens + stats.closes) / (stats.opens + stats.closes + stats.failedTrades)) * 100) : 100}%</span> success
              </span>
            )}
            {(() => {
              // Enterprise PnL: current equity - starting equity - net deposits since start
              // This prevents gaming by depositing more funds to inflate PnL %
              const costBasis = (stats.startEquity || 0) + (stats.netDeposits || 0);
              const sessionPnl = costBasis > 0 ? equity - costBasis : (stats.realizedPnl || 0) + (hasPositions ? unrealizedPnl : 0);
              const pnlPct = costBasis > 0 ? (sessionPnl / costBasis) * 100 : 0;
              if (sessionPnl === 0 && costBasis === 0) return null;
              return (
                <span className={`flex items-center gap-1 ${sessionPnl >= 0 ? 'text-[#1BFDB2]/60' : 'text-rose-400/60'}`}>
                  <span className={`h-1 w-1 rounded-full ${sessionPnl >= 0 ? 'bg-[#1BFDB2]/40' : 'bg-rose-400/40'}`} />
                  <span className="tabular-nums">{fmtPnl(sessionPnl)}</span>
                  {costBasis > 0 && <span className="tabular-nums">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>}
                  <span className="text-white/20">PnL</span>
                </span>
              );
            })()}
            {isRunning && liveRuntime > 0 && (
              <span className="ml-auto flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-[#1BFDB2]/50 animate-pulse" />
                <span className="tabular-nums text-white/40">{fmtRuntime(liveRuntime)}</span>
              </span>
            )}
          </div>
        )}

        {/* Open positions */}
        {hasPositions ? (
          <div className="mt-3 space-y-2">
            {positions!.map((pos, idx) => {
              // Calculate % PnL (based on collateral)
              const pnlPct = pos.collateralUsd > 0 ? (pos.unrealizedPnl / pos.collateralUsd) * 100 : 0;
              // Estimate liquidation price
              // For longs: liqPrice ≈ entryPrice * (1 - 1/leverage * 0.9) (90% of margin = liq)
              // For shorts: liqPrice ≈ entryPrice * (1 + 1/leverage * 0.9)
              const lev = pos.leverage && pos.leverage > 0 ? pos.leverage : 10;
              const liqPrice = pos.side === 'long'
                ? pos.entryPrice * (1 - 0.9 / lev)
                : pos.entryPrice * (1 + 0.9 / lev);
              const liqDistPct = pos.markPrice > 0
                ? Math.abs((liqPrice - pos.markPrice) / pos.markPrice) * 100
                : 0;

              return (
                <div key={idx} className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        pos.side === 'long' ? 'bg-[#1BFDB2]/15 text-[#1BFDB2] border-[#1BFDB2]/25' : 'bg-rose-500/15 text-rose-300 border-rose-500/25'
                      }`}>{pos.side}</span>
                      <span className="text-xs font-medium text-white/70">{pos.baseAsset || baseAsset}</span>
                      {lev > 0 && <span className="text-[10px] text-white/30">{lev.toFixed(1)}x</span>}
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-semibold tabular-nums ${pos.unrealizedPnl >= 0 ? 'text-[#1BFDB2]' : 'text-rose-400'}`}>
                        {fmtPnl(pos.unrealizedPnl)}
                      </span>
                      <span className={`ml-1 text-[10px] tabular-nums ${pnlPct >= 0 ? 'text-[#1BFDB2]/60' : 'text-rose-400/60'}`}>
                        ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[10px] text-white/35">
                    <span>Size: <span className="text-white/55">{fmtUsd(pos.sizeUsd)}</span></span>
                    <span>Collateral: <span className="text-white/55">{fmtUsd(pos.collateralUsd)}</span></span>
                    <span>Entry: <span className="text-white/55">${pos.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></span>
                    {pos.markPrice > 0 && <span>Mark: <span className="text-white/55">${pos.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></span>}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px]">
                    <span className={`flex items-center gap-1 ${liqDistPct < 5 ? 'text-rose-400' : liqDistPct < 15 ? 'text-amber-400/70' : 'text-white/30'}`}>
                      Liq: <span className="tabular-nums text-white/45">${liqPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      <span className="tabular-nums">({liqDistPct.toFixed(1)}% away)</span>
                    </span>
                  </div>
                  {isRunning && onClosePosition && (
                    <div className="mt-2 flex justify-end">
                      <SafeButton label="Close Position" confirmLabel={(c) => `Close (${c}/3)`}
                        onConfirm={onClosePosition} disabled={txBusy !== null}
                        className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 transition-colors" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2">
            <div className="text-xs text-white/25">No open position</div>
            {isRunning && vaultBalance >= 10 && onOpenPosition && (
              <div className="mt-2 flex gap-2">
                <SafeButton label="Open Long" confirmLabel={(c) => `Long (${c}/3)`}
                  onConfirm={() => onOpenPosition('long')} disabled={txBusy !== null}
                  className="flex-1 rounded-md border border-[#1BFDB2]/25 bg-[#1BFDB2]/10 min-h-[36px] px-3 py-1.5 text-[10px] font-semibold text-[#1BFDB2] hover:bg-[#1BFDB2]/20 transition-colors" />
                <SafeButton label="Open Short" confirmLabel={(c) => `Short (${c}/3)`}
                  onConfirm={() => onOpenPosition('short')} disabled={txBusy !== null}
                  className="flex-1 rounded-md border border-rose-500/25 bg-rose-500/10 min-h-[36px] px-3 py-1.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deposit / Withdraw — only when stopped */}
      {isStopped && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setDepAmount(String(walletBalance))}
              className="rounded-md border border-white/15 bg-white/8 min-h-[36px] px-2.5 py-1 text-[11px] font-medium text-white/55 hover:bg-white/12 transition-colors">Max</button>
            <input type="number" min="0" step="0.01" placeholder="Deposit USDC (min $10)"
              value={depAmount} onChange={e => setDepAmount(e.target.value)} inputMode="decimal"
              className="flex-1 rounded-lg border border-white/10 bg-transparent min-h-[44px] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#541FF3]/40 transition-colors" />
            <button type="button"
              disabled={!depAmount || parseFloat(depAmount) < 10 || txBusy !== null}
              onClick={() => { const amt = parseFloat(depAmount); if (amt >= 10) { onDeposit(amt); setDepAmount(''); } }}
              className="shrink-0 rounded-lg border border-[#1BFDB2]/40 bg-[#1BFDB2] min-h-[44px] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:translate-y-[0.5px]">
              {txBusy === 'deposit' ? 'Depositing…' : 'Deposit'}
            </button>
          </div>
          {vaultBalance > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setWdAmount(String(vaultBalance))}
                className="rounded-md border border-white/15 bg-white/8 min-h-[36px] px-2.5 py-1 text-[11px] font-medium text-white/55 hover:bg-white/12 transition-colors">Max</button>
              <input type="number" min="0" step="0.01" placeholder="Withdraw USDC"
                value={wdAmount} onChange={e => setWdAmount(e.target.value)} inputMode="decimal"
                className="flex-1 rounded-lg border border-white/10 bg-transparent min-h-[44px] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#541FF3]/40 transition-colors" />
              <button type="button"
                disabled={!wdAmount || parseFloat(wdAmount) <= 0 || txBusy !== null}
                onClick={() => { onWithdraw(parseFloat(wdAmount)); setWdAmount(''); }}
                className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500 min-h-[44px] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:translate-y-[0.5px]">
                {txBusy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Webhooks */}
      {showWebhooks && (
        <div className="mt-3 rounded-lg border border-[#541FF3]/10 bg-black/40 p-3 space-y-2.5">
          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">TradingView Webhook URLs</div>
          {webhooks.map(wh => {
            const slug = actionSlug[wh.action] || wh.action;
            const url = `${siteUrl}/${slug}/${wh.hookId}`;
            const color = actionColor[wh.action] || 'text-white/60';
            return (
              <div key={wh.hookId} className="flex items-center gap-2">
                <span className={`shrink-0 w-[80px] text-[11px] font-bold uppercase tracking-wider ${color}`}>{wh.label}</span>
                <div className="min-w-0 flex-1 select-all break-all rounded-md border border-white/5 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-white/45">{url}</div>
                <CopyBtn value={url} label="Copy" />
              </div>
            );
          })}
        </div>
      )}

      {/* Details */}
      <div className="mt-2">
        <button type="button" onClick={() => setShowDetails(v => !v)}
          className="flex w-full items-center gap-1.5 px-1 py-1.5 text-[11px] text-white/30 hover:text-white/50 transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`shrink-0 transition-transform duration-150 ${showDetails ? 'rotate-180' : ''}`}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="uppercase tracking-wider">Details</span>
          {!showDetails && <span className="ml-auto flex items-center gap-1 text-white/20"><TokenIcon symbol="USDC" size={10} /> {fmtUsd(walletBalance)}</span>}
        </button>
        {showDetails && (
          <div className="mt-1 rounded-lg bg-black/60 p-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1 text-white/30"><TokenIcon symbol="USDC" size={12} /> Wallet</span><span className="text-white/60 tabular-nums">{fmtUsd(walletBalance)}</span></div>
            <div className="border-t border-white/5 pt-2 space-y-1.5">
              <div><span className="text-white/30">Vault ID</span><div className="mt-0.5 font-mono text-[10px] text-white/40 break-all select-all">{vaultPk}</div></div>
              <div><span className="text-white/30">Set ID</span><div className="mt-0.5 font-mono text-[10px] text-white/40 break-all select-all">{setId}</div></div>
              <div className="flex justify-between"><span className="text-white/30">Created</span><span className="text-white/40">{fmtTime(createdAt)}</span></div>
            </div>
            {/* Delete vault — only when completely empty and stopped */}
            {isStopped && !hasPositions && equity <= 0 && onDelete && (
              <div className="border-t border-white/5 pt-3">
                <SafeButton
                  label="Delete Vault"
                  confirmLabel={(c) => c === 1 ? 'Are you sure? (2/3)' : 'Confirm delete (3/3)'}
                  onConfirm={() => {
                    if (confirm('Are you sure you want to delete this vault? All data will be permanently removed. This cannot be undone.')) {
                      onDelete();
                    }
                  }}
                  className="w-full rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-[10px] font-medium text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
