// src/components/security/HumanCheckGate.tsx
"use client";

import * as React from "react";

/**
 * HumanCheckGate — Amyth
 * ----------------------
 * - Default: Renders Turnstile in *invisible* mode and verifies via /api/turnstile/verify.
 * - On transient failures: soft-retry and then fall back to *visible* mode (user tap).
 * - On likely-embedded / mobile in-app browser surfaces, use a scoped escape hatch so
 *   legit users are not permanently stuck if Turnstile never initializes.
 * - TTL stored in localStorage key "amyth_turnstile_ok_ts"; when valid, gate short-circuits.
 */

type Props = {
  /** Preferred callback: fired once human verification succeeds. */
  onPassed?: (ttlMs?: number) => void;
  /** Back-compat: some callers still pass `onVerified`; treated the same as `onPassed`. */
  onVerified?: (ttlMs?: number) => void;

  /** Optional Turnstile site key; defaults to NEXT_PUBLIC_TURNSTILE_SITE_KEY */
  siteKey?: string;
  /** Suggest a TTL (ms) for the caller to cache the OK flag (defaults 6h). */
  ttlMs?: number;
  /** Optional wrapper className for the gate card. */
  className?: string;
  /** Force the fallback visible widget immediately (used during manual testing) */
  forceVisible?: boolean;
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => any;
      reset: (id: any) => void;
      remove: (id: any) => void;
    };
  }
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const LS_KEY = "amyth_turnstile_ok_ts";
const AUTO_PASS_MS = 8_000;
const SCRIPT_WAIT_MS = 5_000;

function isLikelyEmbeddedMobileSurface(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = String(navigator.userAgent || "").toLowerCase();

  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMobile = isAndroid || isIOS;
  const isChromium = /chrome|chromium|crios/.test(ua);
  const isWebView = /; wv\)|version\/[\d.]+.*mobile.*safari/.test(ua);
  const isStandalone = (() => {
    try {
      return (
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (navigator as any).standalone === true
      );
    } catch {
      return false;
    }
  })();

  return Boolean(
    isMobile && (isStandalone || isWebView || (isAndroid && isChromium))
  );
}

export default function HumanCheckGate({
  onPassed,
  onVerified,
  siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY as string,
  ttlMs = DEFAULT_TTL_MS,
  className,
  forceVisible = false,
}: Props) {
  const _onPassed = React.useCallback(
    (ms?: number) => {
      try {
        (onPassed || onVerified)?.(ms);
      } catch {}
    },
    [onPassed, onVerified]
  );

  const [status, setStatus] = React.useState<"idle" | "loading" | "verifying" | "ok" | "error">("idle");
  const [visibleMode, setVisibleMode] = React.useState<boolean>(!!forceVisible);
  const [message, setMessage] = React.useState<string>("Verifying You Are Human…");

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<any>(null);
  const retriesRef = React.useRef<number>(0);
  const destroyedRef = React.useRef<boolean>(false);
  const passedRef = React.useRef<boolean>(false);
  const visibleModeRef = React.useRef<boolean>(!!forceVisible);
  const startedAtRef = React.useRef<number>(Date.now());
  const scriptReadyRef = React.useRef<boolean>(false);
  const visibleModeSinceRef = React.useRef<number>(0);
  const lenientSurfaceRef = React.useRef<boolean>(isLikelyEmbeddedMobileSurface());

  React.useEffect(() => {
    visibleModeRef.current = visibleMode;
    if (visibleMode) visibleModeSinceRef.current = Date.now();
  }, [visibleMode]);

  // ── Pass gate ──────────────────────────────────────────────────────

  const passGate = React.useCallback(
    (ms?: number) => {
      if (passedRef.current) return;
      passedRef.current = true;
      setStatus("ok");
      try {
        localStorage.setItem(LS_KEY, String(Date.now() + (ms ?? ttlMs)));
      } catch {}
      _onPassed(ms ?? ttlMs);
    },
    [_onPassed, ttlMs]
  );

  // ── Check localStorage on mount ────────────────────────────────────

  React.useEffect(() => {
    try {
      const ts = Number(localStorage.getItem(LS_KEY) || "0");
      if (ts > Date.now()) {
        passGate(ttlMs);
        return;
      }
    } catch {}
  }, [passGate, ttlMs]);

  // ── Auto-pass timeout for stuck states ─────────────────────────────

  React.useEffect(() => {
    if (passedRef.current) return;
    const timer = setTimeout(() => {
      if (passedRef.current || destroyedRef.current) return;

      const isLenientSurface = lenientSurfaceRef.current;
      const scriptReady = scriptReadyRef.current;
      const spentVisibleMs = visibleModeSinceRef.current > 0 ? Date.now() - visibleModeSinceRef.current : 0;

      // Only auto-pass on mobile surfaces likely to hang.
      // Desktop users get the visible challenge fallback instead.
      if (isLenientSurface && (!scriptReady || (visibleModeRef.current && spentVisibleMs >= 2500))) {
        console.warn("[HumanCheckGate] scoped auto-pass after timeout on lenient mobile surface");
        passGate(ttlMs);
        return;
      }

      setVisibleMode(true);
      setStatus("error");
      setMessage("Complete the check to continue.");
    }, AUTO_PASS_MS);

    return () => clearTimeout(timer);
  }, [passGate, ttlMs]);

  // ── Helpers ────────────────────────────────────────────────────────

  const whenVisible = React.useCallback(async () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") return;
    await new Promise<void>((resolve) => {
      const onVis = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVis);
          resolve();
        }
      };
      document.addEventListener("visibilitychange", onVis, { once: true });
    });
  }, []);

  const ensureScript = React.useCallback(async (): Promise<void> => {
    if (destroyedRef.current) return;
    if (typeof window === "undefined") return;
    if (window.turnstile) {
      scriptReadyRef.current = true;
      return;
    }

    const EXISTING_ID = "cf-turnstile-script";
    const src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

    if (!document.getElementById(EXISTING_ID)) {
      const s = document.createElement("script");
      s.id = EXISTING_ID;
      s.src = src;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    const started = Date.now();
    while (!window.turnstile && Date.now() - started < SCRIPT_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 50));
    }

    if (window.turnstile) scriptReadyRef.current = true;
  }, []);

  // ── Widget rendering ───────────────────────────────────────────────

  const renderWidgetRef = React.useRef<(() => Promise<void>) | null>(null);

  const onChallengeError = React.useCallback((err?: Error) => {
    if (destroyedRef.current || passedRef.current) return;
    retriesRef.current += 1;

    if (retriesRef.current <= 2) {
      const backoff = 300 * retriesRef.current;
      setMessage("Trying again…");
      setTimeout(() => {
        if (!destroyedRef.current && !passedRef.current) renderWidgetRef.current?.();
      }, backoff);
      return;
    }

    setVisibleMode(true);
    setStatus("error");
    setMessage("Complete the check to continue.");

    const elapsedMs = Date.now() - startedAtRef.current;
    if (lenientSurfaceRef.current && elapsedMs >= AUTO_PASS_MS) {
      setTimeout(() => {
        if (!destroyedRef.current && !passedRef.current) passGate(ttlMs);
      }, 0);
      return;
    }

    setTimeout(() => {
      if (!destroyedRef.current && !passedRef.current) renderWidgetRef.current?.();
    }, 0);
  }, [passGate, ttlMs]);

  const verifyToken = React.useCallback(
    async (token: string) => {
      if (destroyedRef.current || passedRef.current) return;
      setStatus("verifying");
      setMessage("Verifying access…");
      try {
        const res = await fetch("/api/turnstile/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error("verify-http-" + res.status);
        const data = await res.json();
        if (data?.success) {
          passGate(ttlMs);
        } else {
          throw new Error("verify-failed");
        }
      } catch (e: any) {
        console.warn("[HumanCheckGate] verify error:", e?.message || e);
        onChallengeError(e instanceof Error ? e : new Error("verify-error"));
      }
    },
    [passGate, onChallengeError, ttlMs]
  );

  const renderWidget = React.useCallback(async () => {
    if (destroyedRef.current || passedRef.current) return;
    await whenVisible();
    if (destroyedRef.current || passedRef.current) return;

    const isVisible = visibleModeRef.current;

    setStatus("loading");
    setMessage(isVisible ? "Complete the check to continue." : "Verifying access…");

    await ensureScript();

    if (destroyedRef.current || passedRef.current) return;

    if (!window.turnstile) {
      if (!isVisible) {
        setVisibleMode(true);
        setStatus("error");
        setMessage("Complete the check to continue.");
      }
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    try {
      if (widgetIdRef.current) {
        try {
          window.turnstile!.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile!.render(el, {
        sitekey: siteKey,
        theme: "dark",
        size: isVisible ? "normal" : "invisible",
        retry: "auto",
        "retry-interval": 800,
        callback: (token: string) => verifyToken(token),
        "error-callback": () => onChallengeError(new Error("challenge-error")),
        "timeout-callback": () => onChallengeError(new Error("challenge-timeout")),
        "expired-callback": () => onChallengeError(new Error("challenge-expired")),
      });

      setMessage(isVisible ? "Complete the check to continue." : "Verifying access…");
    } catch (e: any) {
      console.warn("[HumanCheckGate] render error:", e?.message || e);
      onChallengeError(e instanceof Error ? e : new Error("render-error"));
    }
  }, [ensureScript, onChallengeError, siteKey, verifyToken, whenVisible]);

  React.useEffect(() => {
    renderWidgetRef.current = renderWidget;
  }, [renderWidget]);

  React.useEffect(() => {
    renderWidget();
    return () => {
      destroyedRef.current = true;
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = React.useCallback(() => {
    retriesRef.current = 0;
    setStatus("idle");
    setMessage("Verifying access…");
    renderWidget();
  }, [renderWidget]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className={className}>
      <div className="relative mx-auto max-w-md overflow-hidden rounded-[28px] border border-amyth-800/40 bg-amyth-50 shadow-crystal ring-1 ring-amyth-500/10">
        {/* Gradient atmosphere */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, rgba(84,31,243,0.22), transparent 38%), " +
              "radial-gradient(circle at top right, rgba(124,58,238,0.18), transparent 34%), " +
              "radial-gradient(circle at bottom, rgba(27,253,178,0.10), transparent 38%)",
          }}
        />
        {/* Top edge shimmer */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amyth-300/30 to-transparent" />

        <div className="relative p-5 sm:p-6">
          <div className="mb-4 flex flex-col items-center text-center">
            {/* Icon circle */}
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amyth-500/15 bg-amyth-500/[0.06] shadow-[0_0_24px_rgba(84,31,243,0.14)]">
              {status === "ok" ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-brandMint"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : status === "error" ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-rose-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 8v5" />
                  <path d="M12 16h.01" />
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                </svg>
              ) : (
                <span
                  className="inline-block h-6 w-6 animate-spin rounded-full border-[2.5px] border-amyth-500/15 border-t-brandAmethyst border-r-brandViolet"
                  aria-hidden="true"
                />
              )}
            </div>

            <h2 className="mt-4 font-display text-[22px] font-semibold tracking-tight text-amyth-100 sm:text-2xl">
              {status === "ok" ? "You're in" : status === "error" ? "Verification needed" : "One moment"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-amyth-200/50">{message}</p>
          </div>

          {/* Invisible progress shimmer */}
          {!visibleMode && status !== "ok" && status !== "error" && (
            <div className="mx-auto mb-2 h-1 max-w-[200px] overflow-hidden rounded-full bg-amyth-500/[0.08]">
              <div
                className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brandAmethyst/40 via-brandViolet/40 to-brandAmethyst/40"
                style={{ backgroundSize: "200% 100%" }}
              />
            </div>
          )}

          {/* Visible Turnstile widget container */}
          {visibleMode && (
            <div className="rounded-2xl border border-amyth-500/15 bg-amyth-500/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_30px_rgba(84,31,243,0.08)]">
              <div
                ref={containerRef}
                className="flex w-full items-center justify-center"
                aria-hidden={status === "ok" ? "true" : "false"}
              />
            </div>
          )}

          {/* Invisible Turnstile container */}
          {!visibleMode && (
            <div
              ref={containerRef}
              className="h-0 w-0 overflow-hidden opacity-0"
              aria-hidden="true"
            />
          )}

          {/* Retry button */}
          {status === "error" ? (
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleRetry}
                className="inline-flex items-center rounded-xl border border-brandAmethyst/30 bg-brandAmethyst/10 px-3 py-1.5 text-xs font-medium text-amyth-100 transition-colors hover:bg-brandAmethyst/20"
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
