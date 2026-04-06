'use client';

import React from 'react';
import type { VaultSnapshot } from '@/lib/jupiter/dashboard';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPnl(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmtUsd(n)}`;
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'neutral' }) {
  const color = tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-rose-300' : 'text-amyth-100';
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amyth-800/15 bg-crystal-abyss/20 px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.14em] text-amyth-300/40">{label}</span>
      <span className={`font-mono text-sm ${color}`}>{value}</span>
    </div>
  );
}

export default function MetricsPanel({
  snapshot,
  strategy,
  events,
  createdAt,
}: {
  snapshot: VaultSnapshot;
  strategy: { lastExecTs: number; lastSignalNonce: number; maxOpenSizeUsd: number; cooldownSecs: number };
  events: any[];
  createdAt: number;
}) {
  const pnlTone = snapshot.totalPnl >= 0 ? 'green' : 'red';

  return (
    <div className="glass-facet rounded-[28px] p-5 sm:p-6">
      <h3 className="mb-1 text-base font-medium text-amyth-100">Performance</h3>
      <p className="mb-5 text-xs text-amyth-300/40">Vault lifetime metrics since deployment.</p>

      <div className="space-y-2">
        <MetricRow label="Idle collateral" value={fmtUsd(snapshot.idleCollateral)} />
        <MetricRow label="Open exposure" value={fmtUsd(snapshot.openExposureUsd)} />
        <MetricRow label="Unrealized PnL" value={fmtPnl(snapshot.totalUnrealizedPnl)} tone={snapshot.totalUnrealizedPnl >= 0 ? 'green' : 'red'} />
        <MetricRow label="Total PnL" value={fmtPnl(snapshot.totalPnl)} tone={pnlTone} />
        <MetricRow label="Active side" value={snapshot.activeSide} />
        <MetricRow label="Positions" value={String(snapshot.positionsCount)} />
        <MetricRow label="Last execution" value={fmtTime(strategy.lastExecTs)} />
        <MetricRow label="Signal nonce" value={`#${strategy.lastSignalNonce}`} />
        <MetricRow label="Vault created" value={fmtTime(createdAt)} />
      </div>
    </div>
  );
}
