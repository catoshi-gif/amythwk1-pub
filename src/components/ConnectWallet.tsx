"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { clearWalletSessionClient } from "@/lib/auth/initWalletSession";

// ── Helpers ──────────────────────────────────────────────────────────

function safeImageSrc(value: unknown): string | undefined {
  const src = String(value || "").trim();
  if (!src) return undefined;
  if (/^data:image\//i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return src;
  return undefined;
}

function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K`;
  if (sol >= 100) return sol.toFixed(1);
  if (sol >= 1) return sol.toFixed(2);
  if (sol >= 0.01) return sol.toFixed(3);
  return sol.toFixed(4);
}

// ── Component ────────────────────────────────────────────────────────

export default function ConnectWallet() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [menuOpen, setMenuOpen] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const connected = !!wallet?.connected;
  const publicKey = wallet?.publicKey;

  // ── Fetch SOL balance ──────────────────────────────────────────────

  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBalance(null);
      return;
    }

    let cancelled = false;

    async function fetchBalance() {
      try {
        const lamports = await connection.getBalance(publicKey!, "confirmed");
        if (!cancelled) setSolBalance(lamports);
      } catch {
        if (!cancelled) setSolBalance(null);
      }
    }

    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected, publicKey, connection]);

  // ── Click outside to close menu ────────────────────────────────────

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // ── Wallet icon ────────────────────────────────────────────────────

  const providerIcon = useMemo(() => {
    return safeImageSrc((wallet?.wallet?.adapter as any)?.icon);
  }, [wallet?.wallet]);

  // ── Actions ────────────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    if (wallet.wallet && !wallet.connecting && !wallet.connected) {
      wallet.connect().catch(() => {});
      return;
    }
    setVisible(true);
  }, [wallet, setVisible]);

  const handleDisconnect = useCallback(async () => {
    try {
      await clearWalletSessionClient();
    } catch {}
    try {
      await wallet.disconnect();
    } catch {}
    setMenuOpen(false);
  }, [wallet]);

  const handleChangeWallet = useCallback(() => {
    setVisible(true);
    setMenuOpen(false);
  }, [setVisible]);

  const handleCopyAddress = useCallback(async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
    setMenuOpen(false);
  }, [publicKey]);

  // ── Disconnected state ─────────────────────────────────────────────

  if (!connected || !publicKey) {
    return (
      <button
        onClick={handleConnect}
        disabled={wallet.connecting}
        className="btn-amyth text-sm"
      >
        {wallet.connecting ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Connecting…
          </span>
        ) : (
          "Connect Wallet"
        )}
      </button>
    );
  }

  // ── Connected state ────────────────────────────────────────────────

  const addr = publicKey.toBase58();
  const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;

  return (
    <div className="relative" ref={menuRef}>
      {/* Main button */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-brandStroke bg-brandSurface px-3 text-sm transition-all duration-200 hover:border-brandLavender/50 hover:shadow-crystal-sm"
        aria-label="Wallet menu"
      >
        {/* Wallet icon */}
        {providerIcon ? (
          <img
            src={providerIcon}
            alt=""
            className="h-5 w-5 rounded-md"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brandAmethyst/20">
            <svg className="h-3 w-3 text-brandLavender" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="12" height="10" rx="2" />
              <path d="M11 8.5h.01" />
            </svg>
          </div>
        )}

        {/* Address */}
        <span className="hidden font-mono text-xs tracking-wide text-brandSoft sm:inline-block">
          {short}
        </span>

        {/* SOL balance badge */}
        {solBalance !== null && (
          <span className="hidden rounded-md bg-brandAmethyst/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-brandLavender md:inline-block">
            {formatSol(solBalance)} SOL
          </span>
        )}

        {/* Chevron */}
        <svg
          className={`h-3.5 w-3.5 text-brandMuted transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-brandStroke bg-brandSurface shadow-crystal">
          {/* Wallet info header */}
          <div className="border-b border-brandStroke/60 px-4 py-3">
            <div className="flex items-center gap-2">
              {providerIcon && (
                <img src={providerIcon} alt="" className="h-5 w-5 rounded-md" />
              )}
              <span className="font-mono text-xs text-brandSoft">{short}</span>
            </div>
            {solBalance !== null && (
              <div className="mt-1.5 font-mono text-lg font-medium text-amyth-100">
                {formatSol(solBalance)} <span className="text-xs text-brandMuted">SOL</span>
              </div>
            )}
          </div>

          {/* Menu items */}
          <div className="p-1.5">
            <button
              type="button"
              onClick={handleCopyAddress}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-brandSoft transition-colors hover:bg-brandAmethyst/8"
            >
              <svg className="h-4 w-4 text-brandMuted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="9" height="9" rx="1.5" />
                <path d="M2 10.5V3a1.5 1.5 0 011.5-1.5H11" />
              </svg>
              {copied ? "Copied!" : "Copy address"}
            </button>

            <button
              type="button"
              onClick={handleChangeWallet}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-brandSoft transition-colors hover:bg-brandAmethyst/8"
            >
              <svg className="h-4 w-4 text-brandMuted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 8A6 6 0 116.5 2.5" />
                <path d="M14 2v4h-4" />
              </svg>
              Change wallet
            </button>

            <div className="my-1 mx-2 h-px bg-brandStroke/50" />

            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-rose-300/80 transition-colors hover:bg-rose-500/8"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 2H13a1 1 0 011 1v10a1 1 0 01-1 1h-3" />
                <path d="M7 11l3-3-3-3" />
                <path d="M10 8H2" />
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
