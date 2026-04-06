"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import ConnectWallet from "@/components/ConnectWallet";

function NavLink({
  href,
  children,
  active,
}: {
  href: string;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={[
        "group relative inline-flex items-center font-body text-xs font-medium transition-all duration-200 ease-out sm:text-sm",
        active ? "text-brandCharcoal" : "text-brandMuted hover:text-brandCharcoal",
      ].join(" ")}
    >
      <span>{children}</span>
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-x-0 -bottom-1 mx-auto h-[2px] w-full rounded-full bg-brandMint transition-all duration-200 ease-out",
          active ? "scale-x-100 opacity-100" : "scale-x-75 opacity-0",
        ].join(" ")}
      />
    </Link>
  );
}

function AmythLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-none">
        <defs>
          <linearGradient id="crystalGradHeader" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#C2B6F7" />
            <stop offset="55%" stopColor="#7C3AEE" />
            <stop offset="100%" stopColor="#541FF3" />
          </linearGradient>
        </defs>
        <path d="M16 2 L26 10 L22 30 L10 30 L6 10 Z" fill="url(#crystalGradHeader)" opacity="0.95" />
        <path d="M16 2 L6 10 L16 14 Z" fill="#FBF8FA" opacity="0.8" />
        <path d="M16 2 L26 10 L16 14 Z" fill="#C2B6F7" opacity="0.6" />
        <path d="M16 14 L6 10 L10 30 Z" fill="#7C3AEE" opacity="0.45" />
        <path d="M16 14 L26 10 L22 30 Z" fill="#541FF3" opacity="0.42" />
        <path d="M16 14 L10 30 L22 30 Z" fill="#4D22CB" opacity="0.52" />
      </svg>
      <span className="font-display text-xl tracking-[0.05em] text-crystal">AMYTH</span>
    </span>
  );
}

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const isApp = pathname.startsWith("/app");
  const isHelp = pathname.startsWith("/help");

  return (
    <header className="sticky top-0 z-40 border-b border-brandStroke/90 bg-brandBackground/80 backdrop-blur-xl supports-[backdrop-filter]:bg-brandBackground/76">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(700px 180px at 18% -60px, rgba(84,31,243,0.18), transparent 60%), radial-gradient(520px 160px at 76% -80px, rgba(27,253,178,0.08), transparent 55%)",
        }}
        aria-hidden
      />

      <div className="mx-auto w-full max-w-7xl px-4 md:px-8">
        <div className="flex h-16 flex-nowrap items-center justify-between gap-3 md:gap-4">
          <div className="flex min-w-0 items-center gap-4 md:gap-8">
            <Link
              href="/"
              prefetch={false}
              aria-label="Go to AMYTH home"
              className="group flex min-w-0 flex-none items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brandAmethyst/30"
            >
              <AmythLogo />
            </Link>

            <nav className="flex flex-none items-center gap-4 sm:gap-5 md:gap-8">
              <NavLink href="/app" active={isApp}>
                Vault
              </NavLink>
              <NavLink href="/help" active={isHelp}>
                Docs
              </NavLink>
            </nav>
          </div>

          <div className="flex flex-none items-center justify-end gap-2">
            <ConnectWallet />
          </div>
        </div>
      </div>
    </header>
  );
}
