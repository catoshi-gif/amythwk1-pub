"use client";

import React from "react";
import { JUPITER_PERP_MARKETS, type JupiterPerpMarket } from "@/lib/jupiter/markets";

type Props = {
  onSelect: (market: JupiterPerpMarket) => void;
  leverage: number;
  onLeverageChange: (lev: number) => void;
  disabled?: boolean;
  selectedCustody?: string;
};

export default function JupiterMarketPicker({ onSelect, leverage, onLeverageChange, disabled = false, selectedCustody }: Props) {
  const [activeMarketIdx, setActiveMarketIdx] = React.useState(0);

  React.useEffect(() => {
    if (selectedCustody) {
      const idx = JUPITER_PERP_MARKETS.findIndex((m) => m.custody.toBase58() === selectedCustody);
      if (idx >= 0) setActiveMarketIdx(idx);
    }
  }, [selectedCustody]);

  const market = JUPITER_PERP_MARKETS[activeMarketIdx];
  React.useEffect(() => { onSelect(market); }, [market]);

  return (
    <div className="space-y-5">
      {/* Market buttons */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-amyth-300/45">Market</div>
        <div className="flex gap-2">
          {JUPITER_PERP_MARKETS.map((m, idx) => (
            <button key={m.symbol} type="button" disabled={disabled} onClick={() => setActiveMarketIdx(idx)}
              className={`flex-1 rounded-2xl border px-4 py-3 text-center text-sm font-medium transition-all ${
                idx === activeMarketIdx
                  ? "border-[#541FF3]/40 bg-[#541FF3]/15 text-white ring-1 ring-[#541FF3]/30"
                  : "border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.06]"
              } disabled:cursor-not-allowed disabled:opacity-50`}>
              <div className="text-base font-semibold">{m.baseAsset}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.12em] opacity-50">{m.symbol}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Leverage slider */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-amyth-300/45">Leverage</span>
          <span className="rounded-md border border-[#541FF3]/25 bg-[#541FF3]/10 px-2.5 py-1 text-sm font-bold text-[#C2B6F7] tabular-nums">{leverage}x</span>
        </div>
        <div className="relative">
          <input
            type="range" min={1} max={20} step={1} value={leverage}
            onChange={(e) => onLeverageChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 accent-[#541FF3]
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#7C3AEE] [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-[#C2B6F7] [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(124,58,238,0.5)]
              [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110
              [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-[#7C3AEE] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#C2B6F7]"
          />
          {/* Tick marks */}
          <div className="mt-1 flex justify-between px-0.5 text-[9px] text-white/20">
            <span>1x</span><span>5x</span><span>10x</span><span>15x</span><span>20x</span>
          </div>
        </div>
        {leverage >= 15 && (
          <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-[10px] text-amber-300/80">
            High leverage increases liquidation risk.
          </div>
        )}
      </div>
    </div>
  );
}
