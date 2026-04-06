'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';

function fmtTimeRel(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = Math.floor(diff / 86_400_000);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

const badge: Record<string, string> = {
  open_long: 'bg-[#1BFDB2]/15 text-[#1BFDB2] border-[#1BFDB2]/20',
  close_long: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
  open_short: 'bg-[#C2B6F7]/15 text-[#C2B6F7] border-[#C2B6F7]/20',
  close_short: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  deposit: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  withdraw: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
};

const dot: Record<string, string> = { completed: 'bg-emerald-400', queued: 'bg-amber-400', executing: 'bg-amber-400', failed: 'bg-rose-400', validated: 'bg-blue-400' };

type EventRow = { id?: string; ts?: number; kind?: string; signal?: string; action?: string; status?: string; perpSymbol?: string; txSig?: string; error?: string; source?: string; realizedPnl?: number };

export default function ActivityPanel({ wallet }: { wallet?: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchEvents = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/vault/activity?wallet=${encodeURIComponent(wallet)}&limit=50`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (mountedRef.current && Array.isArray(data?.events)) {
        // Deduplicate: keep only events with txSig when a matching signal+timestamp exists without one
        const withTx = new Set<string>();
        for (const e of data.events) {
          if (e.txSig) {
            const sig = String(e.signal || e.action || e.kind || '');
            withTx.add(sig);
          }
        }
        const deduped = data.events.filter((e: EventRow) => {
          // Keep if it has a txSig
          if (e.txSig) return true;
          // Keep if it's a type that never has txSig (deposit/withdraw from client)
          const sig = String(e.signal || e.action || e.kind || '');
          if (sig === 'deposit' || sig === 'withdraw') return true;
          // Remove if a matching event with txSig exists
          if (withTx.has(sig)) return false;
          // Keep failed events (they have error messages)
          if (e.status === 'failed') return true;
          return true;
        });
        setEvents(deduped);
      }
    } catch {}
  }, [wallet]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchEvents().finally(() => { if (mountedRef.current) setLoading(false); });
    const interval = setInterval(fetchEvents, 15_000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [fetchEvents]);

  if (!wallet) return null;

  return (
    <section className="rounded-xl border border-brandAmethyst/8 bg-white/[0.02] p-4 shadow-[0_0_40px_rgba(84,31,243,0.03)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/30">Activity</span>
        <span className="text-[10px] text-white/20 tabular-nums">{events.length} event{events.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        {events.length === 0 && !loading && (
          <div className="py-6 text-center text-xs text-white/20">No activity yet. Signals, deposits, and withdrawals will appear here.</div>
        )}
        {loading && events.length === 0 && (
          <div className="flex justify-center py-6">
            <svg className="h-5 w-5 animate-spin text-white/15" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {events.map((e, idx) => {
          const action = String(e.signal || e.action || e.kind || '').toLowerCase();
          const label = action.replace(/_/g, ' ').toUpperCase();
          const cls = badge[action] || 'bg-white/5 text-white/50 border-white/10';
          const statusDot = dot[e.status || ''] || 'bg-white/20';
          const txHref = e.txSig ? (e.txSig.startsWith('http') ? e.txSig : `https://solscan.io/tx/${e.txSig}`) : null;

          return (
            <div key={e.id || idx} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
              <span className={`inline-flex rounded border px-1.5 py-px text-[9px] font-semibold tracking-wider ${cls}`}>{label}</span>
              {e.perpSymbol && <span className="text-[10px] text-white/30">{e.perpSymbol}</span>}
              {e.error && <span className="text-[10px] text-rose-300/60 truncate max-w-[120px]" title={e.error}>⚠ {e.error.slice(0, 30)}</span>}
              {typeof e.realizedPnl === 'number' && e.realizedPnl !== 0 && (
                <span className={`text-[10px] font-semibold tabular-nums ${e.realizedPnl >= 0 ? 'text-[#1BFDB2]/70' : 'text-rose-400/70'}`}>
                  {e.realizedPnl >= 0 ? '+' : ''}{e.realizedPnl.toFixed(2)} USD
                </span>
              )}
              {txHref && (
                <a href={txHref} target="_blank" rel="noreferrer"
                  className="text-[10px] font-medium text-[#C2B6F7]/50 hover:text-[#C2B6F7] transition-colors">
                  Tx ↗
                </a>
              )}
              <span className="ml-auto text-[10px] text-white/20 tabular-nums shrink-0">{fmtTimeRel(e.ts)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
