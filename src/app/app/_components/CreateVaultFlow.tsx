"use client";

import React from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import JupiterMarketPicker from "./JupiterMarketPicker";
import { createRandomSetId, deriveCreateVaultPlan } from "@/lib/vault-sdk";
import type { JupiterPerpMarket } from "@/lib/jupiter/markets";
import { USDC_CUSTODY, USDC_MINT } from "@/lib/jupiter/markets";

export type CreateVaultResult = {
  setId: Uint8Array;
  vaultPk: string;
  strategyPk: string;
  signatures: string[];
  marketConfig: { symbol: string; custody: string; collateralCustody: string; tokenMint: string };
  leverage: number;
};

type Props = { onCreated: (result: CreateVaultResult) => void };
type StepKey = 1 | 2 | 3;

function getRelayerPk(): PublicKey | null {
  const addr = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "").trim();
  if (!addr) return null;
  try { return new PublicKey(addr); } catch { return null; }
}

function StepPill({ active, done, children }: { active: boolean; done: boolean; children: React.ReactNode }) {
  return <div className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition-all ${done ? "bg-brandMint/15 text-brandMint ring-1 ring-brandMint/25" : active ? "bg-amyth-500/15 text-amyth-100 ring-1 ring-amyth-500/30" : "bg-white/5 text-amyth-300/35"}`}>{children}</div>;
}
function shortPk(v: string) { return v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-6)}` : v; }
function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 rounded-2xl border border-amyth-800/25 bg-white/[0.025] px-4 py-3.5"><span className="text-[11px] uppercase tracking-[0.14em] text-amyth-300/45">{label}</span><span className="text-sm font-medium text-amyth-100">{value}</span></div>;
}

export default function CreateVaultFlow({ onCreated }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [step, setStep] = React.useState<StepKey>(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [setId] = React.useState<Uint8Array>(() => createRandomSetId());
  const [txSig, setTxSig] = React.useState<string>("");
  const [selectedMarket, setSelectedMarket] = React.useState<JupiterPerpMarket | null>(null);
  const [leverage, setLeverage] = React.useState(10);
  const relayerPk = React.useMemo(() => getRelayerPk(), []);

  const plan = React.useMemo(() => {
    if (!wallet.publicKey || !selectedMarket) return null;
    return deriveCreateVaultPlan(wallet.publicKey, setId, selectedMarket);
  }, [wallet.publicKey, setId, selectedMarket]);

  const canCreate = !!wallet.publicKey && !!plan && !!relayerPk && !!selectedMarket;

  async function runCreateFlow() {
    if (!wallet.publicKey || !wallet.sendTransaction || !plan || !relayerPk || !selectedMarket) return;
    setSubmitting(true); setError(null); setStep(3); setTxSig("");

    try {
      const response = await fetch("/api/vaults/create", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          admin: wallet.publicKey.toBase58(),
          setId: Array.from(setId),
          market: selectedMarket.symbol,
          side: "short", collateral: "USDC",
          maxOpenSizeUsd: "500000000000",
          maxPriceSlippage: "1000000000000",
          cooldownSecs: 0,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      // Handle already-exists case
      if (payload?.already) {
        onCreated({
          setId, vaultPk: payload.accounts.vault, strategyPk: payload.accounts.strategy,
          signatures: [],
          marketConfig: { symbol: selectedMarket.symbol, custody: selectedMarket.custody.toBase58(), collateralCustody: USDC_CUSTODY.toBase58(), tokenMint: USDC_MINT.toBase58() },
          leverage,
        });
        return;
      }

      if (!response.ok || !payload?.ok || !Array.isArray(payload?.txs64) || payload.txs64.length < 1) {
        throw new Error(payload?.detail || payload?.error || "Failed to prepare vault transaction.");
      }

      // Single v0 transaction
      const txBytes = Uint8Array.from(atob(payload.txs64[0]), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const sig = await wallet.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);

      // Register webhooks with both side configs
      try {
        await fetch("/api/webhook/register", {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vaultPk: plan.vaultPk.toBase58(), setId: Array.from(setId),
            marketLabel: selectedMarket.symbol, cooldownSecs: 0,
            custody: selectedMarket.custody.toBase58(),
            collateralCustody: USDC_CUSTODY.toBase58(),
            tokenMint: USDC_MINT.toBase58(), side: "short", decimals: 6,
            shortConfig: {
              custody: selectedMarket.custody.toBase58(),
              collateralCustody: USDC_CUSTODY.toBase58(),
              tokenMint: USDC_MINT.toBase58(),
            },
            longConfig: {
              custody: selectedMarket.custody.toBase58(),
              collateralCustody: selectedMarket.sides.long.collateralCustody.toBase58(),
              tokenMint: USDC_MINT.toBase58(),
            },
            leverage,
          }),
        });
      } catch {}

      onCreated({
        setId, vaultPk: plan.vaultPk.toBase58(), strategyPk: plan.strategyPk.toBase58(),
        signatures: [sig],
        marketConfig: { symbol: selectedMarket.symbol, custody: selectedMarket.custody.toBase58(), collateralCustody: USDC_CUSTODY.toBase58(), tokenMint: USDC_MINT.toBase58() },
        leverage,
      });
      // Store leverage preference
      try { localStorage.setItem(`amyth_j_leverage_${plan.vaultPk.toBase58()}`, String(leverage)); } catch {}
    } catch (err: any) {
      setError(err?.message || "Vault creation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <StepPill active={step === 1} done={step > 1}>1 · Market</StepPill>
        <StepPill active={step === 2} done={step > 2}>2 · Review</StepPill>
        <StepPill active={step === 3} done={!!txSig}>3 · Deploy</StepPill>
      </div>

      {step === 1 && (
        <div className="glass-facet rounded-[28px] p-6 md:p-8">
          <h2 className="text-2xl font-display tracking-tight text-amyth-100">Choose your market</h2>
          <p className="mt-2 text-sm text-amyth-200/50">Pick the asset to automate. Your vault uses USDC as collateral and accepts long &amp; short signals from TradingView.</p>
          <div className="mt-6"><JupiterMarketPicker onSelect={setSelectedMarket} leverage={leverage} onLeverageChange={setLeverage} /></div>
          <div className="mt-6 flex justify-end">
            <button type="button" className="btn-amyth px-6 py-3" disabled={!selectedMarket} onClick={() => setStep(2)}>
              Continue <svg className="ml-1 h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          </div>
        </div>
      )}

      {step === 2 && plan && selectedMarket && (
        <div className="glass-facet rounded-[28px] p-6 md:p-8">
          <h2 className="text-2xl font-display tracking-tight text-amyth-100">Review your vault</h2>
          <p className="mt-2 text-sm text-amyth-200/50">One transaction creates your vault, strategy, and USDC token account.</p>
          <div className="mt-6 space-y-2">
            <SummaryRow label="Market" value={selectedMarket.symbol} />
            <SummaryRow label="Collateral" value="USDC" />
            <SummaryRow label="Leverage" value={<span className="font-bold text-[#C2B6F7]">{leverage}x</span>} />
            <SummaryRow label="Signals" value="Open Long · Close Long · Open Short · Close Short" />
          </div>
          {!relayerPk && <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/70">No relayer configured. Set <span className="font-mono">NEXT_PUBLIC_RELAYER_ADDRESS</span>.</div>}
          {showAdvanced && (
            <div className="mt-4 space-y-2 text-xs">
              {[["Vault PDA", plan.vaultPk.toBase58()], ["Vault authority", plan.vaultAuthority.toBase58()], ["Strategy PDA", plan.strategyPk.toBase58()], ["USDC vault ATA", plan.vaultTokenAta.toBase58()], ["Position PDA", plan.positionPk.toBase58()]].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between gap-2 rounded-xl border border-amyth-800/15 bg-white/[0.015] px-3 py-2">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-amyth-300/35">{l}</span>
                  <span className="truncate font-mono text-[11px] text-amyth-200/60">{shortPk(v)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4"><button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-amyth-300/40 hover:text-amyth-300/70">{showAdvanced ? "Hide" : "Show"} derived accounts</button></div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="rounded-xl border border-amyth-800/30 px-4 py-3 text-sm text-amyth-200/70 transition hover:bg-white/5" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-amyth px-6 py-3" disabled={!canCreate || submitting} onClick={runCreateFlow}>{submitting ? "Creating vault…" : "Create vault"}</button>
          </div>
          {error && <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        </div>
      )}

      {step === 3 && (
        <div className="glass-facet rounded-[28px] p-6 md:p-8">
          <h2 className="text-2xl font-display tracking-tight text-amyth-100">{txSig ? "Vault deployed" : submitting ? "Deploying…" : "Deploy failed"}</h2>
          <p className="mt-2 text-sm text-amyth-200/50">{txSig ? "Your vault, strategy, and USDC ATA are live on-chain." : submitting ? "Sign the transaction in your wallet." : "Something went wrong."}</p>
          {submitting && !txSig && (
            <div className="mt-6 flex items-center justify-center py-8">
              <svg className="h-8 w-8 animate-spin text-amyth-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            </div>
          )}
          {txSig && (
            <div className="mt-6 rounded-2xl border border-brandMint/20 bg-brandMint/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm text-brandMint">
                <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                Transaction confirmed
              </div>
              <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-sm text-brandMint hover:underline">{shortPk(txSig)}</a>
            </div>
          )}
          {error && (
            <div className="mt-6">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
              <button type="button" className="mt-3 rounded-xl border border-amyth-800/30 px-4 py-3 text-sm text-amyth-200/70 transition hover:bg-white/5" onClick={() => { setError(null); setStep(2); }}>Back to review</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
