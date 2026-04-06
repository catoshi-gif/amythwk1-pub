"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider as AdapterWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  LedgerWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";

const DEFAULT_RPC =
  (process.env.NEXT_PUBLIC_RPC_URL && process.env.NEXT_PUBLIC_RPC_URL.trim()) ||
  (process.env.NEXT_PUBLIC_SOLANA_RPC_URL && process.env.NEXT_PUBLIC_SOLANA_RPC_URL.trim()) ||
  clusterApiUrl("mainnet-beta");

/**
 * Returns true when the page is running inside Android Chromium (not a WebView
 * and not Jupiter's in-app browser). This covers both:
 *   - Bubblewrap TWAs (Seeker dApp Store APK)
 *   - Regular Chrome / standalone PWA
 */
function isAndroidChromiumSurface(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const ua = String(navigator.userAgent || "").toLowerCase();
    if (!ua.includes("android")) return false;
    // Exclude Android WebViews
    if (ua.includes("; wv)")) return false;
    // Exclude Jupiter in-app browser
    if (/jupiter/i.test(navigator.userAgent || "")) return false;
    return ua.includes("chrome/") || ua.includes("chromium/");
  } catch {
    return false;
  }
}

export default function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => DEFAULT_RPC, []);

  // We need window.location.origin for the MWA adapter's appIdentity.
  // On SSR it is undefined, so we defer adapter creation to a client-side effect.
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);

  useEffect(() => {
    setClientOrigin(window.location.origin || "https://www.amyth.com");
  }, []);

  const wallets = useMemo<Adapter[]>(() => {
    const adapters: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet }),
      new LedgerWalletAdapter(),
    ];

    // Register the official Solana Mobile Wallet Adapter on Android Chromium
    // surfaces (Seeker TWA, Chrome browser, standalone PWA). This adapter
    // handles the MWA protocol lifecycle — connect, disconnect/deauthorize,
    // auth token caching — which the dApp Store reviewers test explicitly.
    if (isAndroidChromiumSurface() && clientOrigin) {
      adapters.push(
        new SolanaMobileWalletAdapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: {
            name: "amyth",
            uri: clientOrigin,
            icon: "/icon-192.png",
          },
          authorizationResultCache: createDefaultAuthorizationResultCache(),
          cluster: "mainnet-beta",
          onWalletNotFound: createDefaultWalletNotFoundHandler(),
        })
      );
    }

    return adapters;
  }, [clientOrigin]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <AdapterWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </AdapterWalletProvider>
    </ConnectionProvider>
  );
}
