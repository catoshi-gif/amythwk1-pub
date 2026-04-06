import "server-only";
import { NextResponse } from "next/server";
import bs58 from "bs58";
import {
  buildSignMessage,
  clearWalletSession,
  consumeNonce,
  setWalletSessionCookie,
  SESSION_TTL_SEC,
  verifySolanaSignature,
} from "@/lib/auth/session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, private, must-revalidate",
    Pragma: "no-cache",
    Vary: "Cookie",
  };
}

function isValidBase58Pubkey(s: string): boolean {
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String((body as any)?.wallet || "").trim();
    const nonce = String((body as any)?.nonce || "").trim();
    const tsRaw = (body as any)?.ts;
    const signatureBase58 = String((body as any)?.signatureBase58 || "").trim();

    if (!wallet || !isValidBase58Pubkey(wallet)) {
      return NextResponse.json({ ok: false, error: "invalid_wallet" }, { status: 400, headers: noStoreHeaders() });
    }
    if (!nonce) {
      return NextResponse.json({ ok: false, error: "nonce_required" }, { status: 400, headers: noStoreHeaders() });
    }
    const ts = typeof tsRaw === "number" ? tsRaw : Number(tsRaw || 0);
    if (!Number.isFinite(ts) || ts <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_ts" }, { status: 400, headers: noStoreHeaders() });
    }
    if (!signatureBase58) {
      return NextResponse.json({ ok: false, error: "signature_required" }, { status: 400, headers: noStoreHeaders() });
    }

    const okNonce = await consumeNonce(wallet, nonce);
    if (!okNonce) {
      return NextResponse.json({ ok: false, error: "nonce_mismatch" }, { status: 401, headers: noStoreHeaders() });
    }

    const okSig = verifySolanaSignature(buildSignMessage(wallet, nonce, ts), signatureBase58, wallet);
    if (!okSig) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401, headers: noStoreHeaders() });
    }

    const res = NextResponse.json({ ok: true, ttlSec: SESSION_TTL_SEC }, { status: 200, headers: noStoreHeaders() });
    await setWalletSessionCookie(res, wallet, { ttlSec: SESSION_TTL_SEC, reqHost: req.headers.get("host") || "" });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true }, { status: 200, headers: noStoreHeaders() });
  await clearWalletSession(res, req);
  return res;
}
