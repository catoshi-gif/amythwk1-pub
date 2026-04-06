import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createWalletNonce } from "@/lib/auth/nonce.server";
import { getSessionWalletFromRequest } from "@/lib/auth/session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  ).trim();
}

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, private, must-revalidate",
    Pragma: "no-cache",
    Vary: "Cookie",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const wallet = String(body?.wallet || "").trim();
    if (!wallet) {
      return NextResponse.json({ ok: false, error: "missing_wallet" }, { status: 400, headers: noStoreHeaders() });
    }

    const sessionWallet = await getSessionWalletFromRequest(req as any);
    if (sessionWallet && sessionWallet === wallet) {
      return NextResponse.json({ ok: true, already: true }, { status: 200, headers: noStoreHeaders() });
    }

    const out = await createWalletNonce(wallet, { ip: getClientIp(req) });
    const status = out.ok ? 200 : out.error === "rate_limited" ? 429 : 400;
    return NextResponse.json(out, { status, headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500, headers: noStoreHeaders() });
  }
}
