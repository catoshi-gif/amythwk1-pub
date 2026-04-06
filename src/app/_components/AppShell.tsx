"use client";

import React from "react";
import SolanaWalletProvider from "@/app/solana/WalletProvider";
import SiteHeader from "@/components/SiteHeader";
import MobileWalletStandardRegistrar from "@/app/_components/MobileWalletStandardRegistrar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SolanaWalletProvider>
      <MobileWalletStandardRegistrar />
      <div className="min-h-screen bg-brandBackground text-brandCharcoal">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl px-6 py-6 md:px-8">{children}</main>
      </div>
    </SolanaWalletProvider>
  );
}
