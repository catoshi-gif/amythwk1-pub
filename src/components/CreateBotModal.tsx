"use client";

import * as React from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: "webhook") => void;
  wallet?: string | null;
};

export default function CreateBotModal({ open, onClose, onSelect, wallet }: Props) {
  const disabled = !wallet;

  // Close on ESC
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-[110] bg-brandBackground/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="absolute inset-0 z-[120] flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-sm overflow-hidden rounded-[28px] border border-amyth-800/50 shadow-crystal"
          style={{
            background:
              "linear-gradient(180deg, rgba(34,29,43,0.97) 0%, rgba(21,18,29,0.99) 100%)",
            WebkitTransform: "translateZ(0)",
          }}
        >
          {/* Atmosphere glow */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{
              background:
                "radial-gradient(ellipse at 50% -20%, rgba(84,31,243,0.18) 0%, transparent 55%), " +
                "radial-gradient(circle at 80% 120%, rgba(27,253,178,0.06) 0%, transparent 40%)",
            }}
          />

          <div className="relative p-6">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight text-crystal">
                  Create Bot
                </h2>
                <p className="mt-1 text-xs text-amyth-300/45">
                  Choose a strategy type to deploy
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amyth-800/40 bg-white/[0.03] text-amyth-300/50 transition-all hover:border-amyth-500/30 hover:bg-amyth-500/10 hover:text-amyth-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            {/* Bot type cards */}
            <div className="space-y-2.5">
              {/* TradingView Webhooks */}
              <button
                onClick={() => onSelect("webhook")}
                disabled={disabled}
                className="group flex w-full items-center gap-4 rounded-2xl border border-brandAmethyst/15 bg-brandAmethyst/[0.06] px-4 py-4 text-left transition-all hover:border-brandAmethyst/30 hover:bg-brandAmethyst/[0.12] hover:shadow-[0_0_30px_-12px_rgba(84,31,243,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ touchAction: "manipulation" }}
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brandAmethyst/25 bg-brandAmethyst/10 shadow-[0_0_16px_-6px_rgba(84,31,243,0.3)]">
                  <svg className="h-5 w-5 text-brandLavender" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-amyth-100 group-hover:text-white">
                    TradingView Webhooks
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-amyth-300/40">
                    Automated Jupiter perps via TradingView signals
                  </div>
                </div>
                <svg className="h-4 w-4 shrink-0 text-amyth-300/20 transition-all group-hover:translate-x-0.5 group-hover:text-amyth-300/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Future bot types — coming soon */}
              <div className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-amyth-800/30 px-4 py-4 text-left opacity-40">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amyth-800/25 bg-white/[0.02]">
                  <svg className="h-5 w-5 text-amyth-300/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-amyth-300/35">
                    More strategies
                  </div>
                  <div className="mt-0.5 text-[11px] text-amyth-300/25">
                    DCA, grid trading, and more — coming soon
                  </div>
                </div>
              </div>
            </div>

            {/* Wallet warning */}
            {!wallet && (
              <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs text-amber-200/70">
                Connect your wallet to create a bot.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
