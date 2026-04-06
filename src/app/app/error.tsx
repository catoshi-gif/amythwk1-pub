"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/app] route error", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="glass-facet w-full max-w-xl rounded-2xl border border-white/10 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl">
          ⚠️
        </div>
        <h1 className="font-display text-2xl text-brandText">Something went wrong</h1>
        <p className="mt-3 text-sm text-brandMuted">
          The Amyth app hit an unexpected error while loading this view.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" className="btn-amyth rounded-xl px-4 py-2" onClick={reset}>
            Try again
          </button>
          <a href="/" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-brandText transition hover:bg-white/5">
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}
