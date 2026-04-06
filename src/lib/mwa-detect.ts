// filepath: src/lib/mwa-detect.ts
// Consolidated MWA surface detection. Import this everywhere instead of
// duplicating the UA-sniffing logic in each component.
"use client";

/**
 * Returns true when the page is running inside Android Chromium and is
 * eligible for MWA (Mobile Wallet Adapter) connections. This covers:
 *
 *   - Bubblewrap TWAs (Seeker dApp Store APK)
 *   - Chrome browser on Android
 *   - Standalone PWA on Android
 *
 * Excludes:
 *   - Android WebViews ("; wv)" in UA)
 *   - Jupiter in-app browser
 */
export function isAndroidChromiumForMwa(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const ua = String(navigator.userAgent || "");
    const uaL = ua.toLowerCase();
    if (!uaL.includes("android")) return false;

    // Exclude Android WebViews
    const isWebView =
      uaL.includes("; wv)") ||
      (uaL.includes("version/") && uaL.includes("chrome") && uaL.includes("wv"));
    if (isWebView) return false;

    // Exclude Jupiter in-app browser
    if (/jupiter/i.test(ua)) return false;

    return uaL.includes("chrome/") || uaL.includes("chromium/") || uaL.includes("crios/");
  } catch {
    return false;
  }
}

/**
 * Returns true when the page is running in standalone display mode
 * (PWA installed to home screen, or Bubblewrap TWA).
 */
export function isStandaloneDisplayMode(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Best-effort Trusted Web Activity detection. Checks document.referrer
 * (set on initial load from a TWA) and standalone display mode as fallback.
 *
 * NOTE: document.referrer can be empty after in-app navigation or reload,
 * so we also accept standalone + Android Chrome as a TWA signal — this is
 * correct for Seeker dApp Store APKs which are Bubblewrap TWAs.
 */
export function isTrustedWebActivity(): boolean {
  try {
    if (typeof document === "undefined") return false;
    // Direct TWA referrer check
    if (String(document.referrer || "").startsWith("android-app://")) return true;
    // Fallback: Android Chrome in standalone mode is almost certainly a TWA
    // (Seeker Store APKs are Bubblewrap TWAs that run in standalone display mode)
    if (isAndroidChromiumForMwa() && isStandaloneDisplayMode()) return true;
    return false;
  } catch {
    return false;
  }
}
