import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-4 font-display text-6xl text-crystal">404</h1>
      <p className="mb-8 text-sm text-brandMuted">This facet doesn't exist.</p>
      <Link href="/" className="btn-amyth px-6 py-2.5 text-sm">
        Return Home
      </Link>
    </div>
  );
}
