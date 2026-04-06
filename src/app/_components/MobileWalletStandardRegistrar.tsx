"use client";

import { useEffect } from "react";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";
import { isAndroidChromiumForMwa } from "@/lib/mwa-detect";

declare global {
  interface Window {
    __mmMwaRegistered?: boolean;
  }
}

export default function MobileWalletStandardRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAndroidChromiumForMwa()) return;
    if (window.__mmMwaRegistered) return;

    registerMwa({
      appIdentity: {
        name: "amyth",
        uri: window.location.origin || "https://www.amyth.com",
        icon: "/icon-192.png",
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: ["solana:mainnet"],
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });

    window.__mmMwaRegistered = true;
  }, []);

  return null;
}
