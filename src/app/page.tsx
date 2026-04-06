// src/app/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useRef, useEffect, useState } from "react";
import InteractiveCrystal from "@/components/home/InteractiveCrystal";

// ---------------------------------------------------------------------------
// Utility hooks
// ---------------------------------------------------------------------------

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function useInViewOnce(opts: IntersectionObserverInit = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); obs.disconnect(); }
    }, opts);
    obs.observe(el);
    return () => obs.disconnect();
  }, [seen]);
  return { ref, seen };
}

// ---------------------------------------------------------------------------
// Reveal wrapper
// ---------------------------------------------------------------------------

function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const { ref, seen } = useInViewOnce({ rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
  const reduced = usePrefersReducedMotion();
  return (
    <div
      ref={ref}
      className={[
        className,
        reduced ? "" : seen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6 will-change-transform",
        reduced ? "" : "transition duration-700 ease-out",
      ].join(" ")}
      style={reduced ? undefined : { transitionDelay: `${Math.max(0, delayMs)}ms` }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animated crystal SVG background
// ---------------------------------------------------------------------------

function CrystalBackground() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Large radial glow */}
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px]"
        style={{
          background: "radial-gradient(ellipse at center, rgba(139,70,255,0.18) 0%, rgba(168,85,247,0.08) 40%, transparent 70%)",
        }}
      />
      {/* Secondary glow */}
      <div
        className="absolute top-60 right-0 w-[600px] h-[400px]"
        style={{
          background: "radial-gradient(ellipse at 70% 30%, rgba(192,132,252,0.1) 0%, transparent 65%)",
        }}
      />
      {/* Left deep glow */}
      <div
        className="absolute top-96 -left-40 w-[500px] h-[500px]"
        style={{
          background: "radial-gradient(circle, rgba(90,24,191,0.12) 0%, transparent 60%)",
        }}
      />

      {/* Floating crystal facets */}
      <svg
        className={`absolute top-20 left-[10%] w-20 h-20 text-amyth-500/10 ${reduced ? "" : "animate-float"}`}
        viewBox="0 0 80 80" fill="currentColor"
      >
        <polygon points="40,5 70,30 55,75 25,75 10,30" />
      </svg>
      <svg
        className={`absolute top-40 right-[15%] w-12 h-12 text-amyth-400/8 ${reduced ? "" : "animate-float"}`}
        style={reduced ? {} : { animationDelay: "2s" }}
        viewBox="0 0 48 48" fill="currentColor"
      >
        <polygon points="24,2 44,18 36,46 12,46 4,18" />
      </svg>
      <svg
        className={`absolute top-[500px] left-[25%] w-16 h-16 text-amyth-600/6 ${reduced ? "" : "animate-float"}`}
        style={reduced ? {} : { animationDelay: "4s" }}
        viewBox="0 0 64 64" fill="currentColor"
      >
        <polygon points="32,4 56,22 48,60 16,60 8,22" />
      </svg>

      {/* Grid / noise overlay */}
      <div className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(139,70,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(139,70,255,0.3) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature cards
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    title: "CPI Vault Architecture",
    desc: "Your funds stay in a program-owned PDA vault. Every trade is executed via Jupiter Perps — no intermediary wallets, no custodial risk.",
  },
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: "Signal Execution",
    desc: "TradingView webhooks trigger the relayer. The on-chain program validates leverage caps, cooldowns, and nonce replay protection before placing any order.",
  },
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
    title: "On-Chain Risk Rails",
    desc: "Max leverage, max notional, cooldown timers, and reduce-only mode are all enforced at the program level. The relayer cannot exceed your limits.",
  },
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    title: "Deposit & Withdraw",
    desc: "Admin deposits USDC through the vault into Jupiter Perps. Withdraw back anytime — the program transfers from Jupiter Perps to your ATA in a single CPI call.",
  },
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    title: "Strategy Config",
    desc: "Set your perp market, leverage cap, notional limit, collateral index, cooldown, and authorized relayer. Update params live without redeploying.",
  },
  {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
      </svg>
    ),
    title: "Jupiter Perps",
    desc: "Built against Jupiter's perpetuals program. Market increase/decrease requests with keeper fulfillment model.",
  },
];

function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay: number }) {
  return (
    <Reveal delayMs={delay}>
      <div className="glass-facet rounded-2xl p-6 h-full transition-all duration-300 group">
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-amyth-500/10 border border-amyth-500/20 text-amyth-400 mb-4 group-hover:bg-amyth-500/20 group-hover:text-amyth-300 transition-all duration-300">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-amyth-100 mb-2 tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-amyth-200/60">{desc}</p>
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Architecture diagram (simplified visual)
// ---------------------------------------------------------------------------

function ArchitectureDiagram() {
  return (
    <div className="relative w-full max-w-3xl mx-auto">
      <div className="glass-facet rounded-2xl p-8 md:p-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4 text-center">
          {/* Signal source */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-amyth-500/15 border border-amyth-500/25 flex items-center justify-center">
              <svg className="w-7 h-7 text-amyth-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
                <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
              </svg>
            </div>
            <span className="text-sm font-medium text-amyth-200">TradingView</span>
            <span className="text-xs text-amyth-300/50">Webhook Signal</span>
          </div>

          {/* Arrow → Vault */}
          <div className="flex flex-col items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-amyth-500/40 mb-2">
              <div className="h-px w-8 bg-amyth-500/30" />
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2l6 6-6 6V2z" />
              </svg>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-amyth-600/20 border border-amyth-400/30 flex items-center justify-center shadow-crystal-sm">
              <svg className="w-7 h-7 text-amyth-300" viewBox="0 0 32 32" fill="none">
                <path d="M16 2 L26 10 L22 30 L10 30 L6 10 Z" fill="currentColor" opacity="0.6" />
                <path d="M16 2 L6 10 L16 14 Z" fill="currentColor" opacity="0.3" />
                <path d="M16 14 L26 10 L22 30 Z" fill="currentColor" opacity="0.2" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-amyth-100">amyth Vault</span>
            <span className="text-xs text-amyth-300/50">On-chain Program</span>
          </div>

          {/* Arrow → Jupiter */}
          <div className="flex flex-col items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-amyth-500/40 mb-2">
              <div className="h-px w-8 bg-amyth-500/30" />
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2l6 6-6 6V2z" />
              </svg>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-crystal-deep/60 border border-amyth-800/30 flex items-center justify-center">
              <span className="text-lg font-bold text-amyth-400 font-mono">D</span>
            </div>
            <span className="text-sm font-medium text-amyth-200">Drift Protocol</span>
            <span className="text-xs text-amyth-300/50">CPI Execution</span>
          </div>
        </div>

        {/* Flow labels */}
        <div className="mt-8 pt-6 border-t border-amyth-800/20 grid grid-cols-3 gap-4 text-center">
          <span className="text-[11px] text-amyth-300/40 font-mono">Signal → Relayer</span>
          <span className="text-[11px] text-amyth-300/40 font-mono">Validate → Place Order</span>
          <span className="text-[11px] text-amyth-300/40 font-mono">CPI → Drift Perps</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const reduced = usePrefersReducedMotion();

  // Parallax blooms
  const bloomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (bloomRef.current) {
          const t = Math.min(1, y / 800);
          bloomRef.current.style.transform = `translate3d(0, ${t * 30}px, 0)`;
          bloomRef.current.style.opacity = `${1 - t * 0.4}`;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduced]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div ref={bloomRef}>
        <CrystalBackground />
      </div>

      {/* ============================================ */}
      {/* HERO */}
      {/* ============================================ */}
      <section className="relative pt-20 pb-24 md:pt-32 md:pb-36 flex flex-col items-center text-center px-6">
        {/* Badge */}
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border border-amyth-700/30 bg-amyth-950/50 px-4 py-1.5 text-xs font-medium text-amyth-300 mb-8">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amyth-500 animate-pulse" />
            Built on Jupiter Perps
          </div>
        </Reveal>

        {/* Headline */}
        <Reveal delayMs={100}>
          <h1 className="max-w-4xl text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display tracking-tight leading-[1.08]">
            <span className="text-crystal">Automated perps.</span>
            <br />
            <span className="text-amyth-100/90">Crystallized on-chain.</span>
          </h1>
        </Reveal>

        {/* Sub */}
        <Reveal delayMs={200}>
          <p className="mt-6 max-w-2xl text-base sm:text-lg text-amyth-200/60 leading-relaxed">
            amyth is a non-custodial CPI vault that automates Jupiter perpetual
            futures trading. Your collateral, your program, your risk rails —
            executed by signal, enforced by code.
          </p>
        </Reveal>

        {/* CTAs */}
        <Reveal delayMs={300}>
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <Link href="/app" className="btn-amyth px-8 py-3 text-base">
              Launch Vault
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </Link>
            <a
              href="https://github.com/amyth-trade"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-amyth-700/25 bg-amyth-950/30 px-6 py-3 text-sm font-medium text-amyth-200/80 hover:text-amyth-100 hover:border-amyth-600/40 transition-all duration-200"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Source Code
            </a>
          </div>
        </Reveal>

        {/* Crystal hero decoration */}
        <Reveal delayMs={400}>
          <div className="mt-16 relative">
            <InteractiveCrystal />
          </div>
        </Reveal>
      </section>

      {/* ============================================ */}
      {/* HOW IT WORKS */}
      {/* ============================================ */}
      <section className="relative py-24 md:py-32 px-6">
        <Reveal>
          <div className="text-center mb-16">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-amyth-500/60 mb-3 block">Architecture</span>
            <h2 className="text-3xl sm:text-4xl font-display tracking-tight text-amyth-100">
              Signal to settlement in one CPI call
            </h2>
            <p className="mt-4 max-w-xl mx-auto text-sm text-amyth-200/50 leading-relaxed">
              TradingView fires a webhook. The relayer validates and submits. The on-chain program checks
              every risk parameter, then executes via Jupiter Perps. No custody. No trust assumptions.
            </p>
          </div>
        </Reveal>
        <Reveal delayMs={150}>
          <ArchitectureDiagram />
        </Reveal>
      </section>

      {/* ============================================ */}
      {/* FEATURES */}
      {/* ============================================ */}
      <section className="relative py-24 md:py-32 px-6">
        <Reveal>
          <div className="text-center mb-16">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-amyth-500/60 mb-3 block">Capabilities</span>
            <h2 className="text-3xl sm:text-4xl font-display tracking-tight text-amyth-100">
              Every facet, hardened
            </h2>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 80} />
          ))}
        </div>
      </section>

      {/* ============================================ */}
      {/* STATS / TRUST */}
      {/* ============================================ */}
      <section className="relative py-24 md:py-32 px-6">
        <Reveal>
          <div className="glass-facet rounded-3xl max-w-4xl mx-auto p-8 md:p-14 text-center">
            <h2 className="text-2xl sm:text-3xl font-display tracking-tight text-amyth-100 mb-6">
              Transparent by default
            </h2>
            <p className="text-sm text-amyth-200/50 max-w-xl mx-auto mb-10 leading-relaxed">
              The vault program is open source. Every instruction, every constraint, every PDA derivation
              is auditable on-chain. Your keys, your vault, your rules.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: "Program", value: "Anchor" },
                { label: "Jupiter Perps", value: "v2.160" },
                { label: "Custody", value: "None" },
                { label: "Risk Rails", value: "On-chain" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-1">
                  <span className="text-xl md:text-2xl font-display text-crystal">{s.value}</span>
                  <span className="text-xs text-amyth-300/40 font-mono uppercase tracking-wider">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============================================ */}
      {/* CTA */}
      {/* ============================================ */}
      <section className="relative py-24 md:py-36 px-6 text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight text-amyth-100 mb-6">
            Ready to crystallize your edge?
          </h2>
          <p className="text-sm text-amyth-200/50 max-w-lg mx-auto mb-10">
            Connect your wallet, configure your strategy, deposit collateral, and let amyth
            execute your signals through Drift — all enforced on-chain.
          </p>
          <Link href="/app" className="btn-amyth px-10 py-3.5 text-base">
            Launch Vault
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </Link>
        </Reveal>
      </section>

      {/* ============================================ */}
      {/* FOOTER */}
      {/* ============================================ */}
      <footer className="border-t border-amyth-900/20 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-6">
          <Image
            src="/brand/logo.webp"
            alt="amyth logo"
            width={96}
            height={96}
            className="h-16 w-auto opacity-90 drop-shadow-[0_0_24px_rgba(139,70,255,0.18)]"
            priority={false}
          />
          <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-amyth-300/30 font-mono">amyth · automated drift perps vaults</span>
            <div className="flex items-center gap-6">
              <a href="https://github.com/amyth-trade" target="_blank" rel="noopener noreferrer" className="text-xs text-amyth-300/30 hover:text-amyth-300/60 transition-colors">
                GitHub
              </a>
              <a href="https://x.com/amythtrade" target="_blank" rel="noopener noreferrer" className="text-xs text-amyth-300/30 hover:text-amyth-300/60 transition-colors">
                X / Twitter
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
