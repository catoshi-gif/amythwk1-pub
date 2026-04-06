"use client";

import React from "react";
import Link from "next/link";
import { SectionTitle } from "@/components/ui/section-title";

const SECTIONS = [
  {
    title: "What is AMYTH?",
    body: "AMYTH is a non-custodial CPI vault program on Solana that automates Jupiter perpetual futures trading. Your USDC collateral lives in a program-derived address (PDA), never in a hot wallet. Every trade is executed via Cross-Program Invocation into Jupiter Perps with on-chain risk rails enforcing your limits.",
  },
  {
    title: "How does the vault work?",
    body: "When you create a vault, the program deploys a Vault account and a PDA authority. The PDA authority owns a Jupiter position account and an associated token account for USDC. You deposit collateral through the program, which transfers it into Jupiter Perps via CPI. Signals from TradingView trigger the relayer, which submits execute_signal_order instructions and the program validates every parameter before placing the order on Jupiter Perps.",
  },
  {
    title: "What are risk rails?",
    body: "Risk rails are on-chain constraints enforced by the program at execution time. They include max leverage, max notional position size, cooldown between executions, nonce-based replay protection, reduce-only mode, and a global pause switch. The relayer cannot bypass any of these because they are checked in the instruction handler before the Jupiter Perps is invoked.",
  },
  {
    title: "Is my collateral safe?",
    body: "Your USDC is held in a PDA-owned associated token account. Only the vault program can move funds via CPI, and only the admin wallet can deposit or withdraw. The relayer can place orders, but it cannot touch collateral. The program is open source and auditable.",
  },
  {
    title: "What signals does AMYTH support?",
    body: "The execute_signal_order instruction accepts Long, Short, and Flat signals. Each signal includes a perp market index, base asset amount, leverage, and optional parameters like order type, oracle price offset, and auction settings. Flat signals require a separate close or reduce flow in this MVP.",
  },
  {
    title: "How do I set up a strategy?",
    body: "After creating a vault, call init_jupiter_strategy with your desired parameters: market side, max open size, max price slippage, cooldown, and authorized relayer public key. Then call init_jupiter_strategy to create the Jupiter strategy account for your vault's PDA authority.",
  },
  {
    title: "Deployment",
    body: "The frontend is a Next.js app designed for Vercel. Set your environment variables, push to GitHub, and connect to Vercel. The on-chain program is built with Anchor and depends on the Jupiter Perps crate.",
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen py-8 md:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12">
          <SectionTitle
            eyebrow="Documentation"
            title="How AMYTH works"
            description="Everything you need to understand the vault architecture, risk model, and deployment flow."
          />
        </div>

        <div className="space-y-6">
          {SECTIONS.map((section, index) => (
            <details key={index} className="glass-facet group rounded-2xl" {...(index === 0 ? { open: true } : {})}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5 font-body text-base font-medium text-brandCharcoal [&::-webkit-details-marker]:hidden">
                <span>{section.title}</span>
                <svg
                  className="ml-4 h-4 w-4 flex-none text-brandMint/70 transition-transform duration-200 group-open:rotate-180"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </summary>
              <div className="border-t border-brandStroke/80 px-6 pb-6 pt-4 text-sm leading-relaxed text-brandSoft">
                {section.body}
              </div>
            </details>
          ))}
        </div>

        <div className="glass-facet mt-16 rounded-2xl p-8 text-center">
          <h3 className="font-display text-lg text-brandCharcoal">Ready to cut your first vault?</h3>
          <p className="mb-6 mt-3 text-sm text-brandMuted">Connect your wallet and configure your Drift automation rails.</p>
          <Link href="/app" className="btn-amyth px-6 py-2.5 text-sm">
            Launch Vault
          </Link>
        </div>
      </div>
    </div>
  );
}
