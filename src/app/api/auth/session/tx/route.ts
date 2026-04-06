import "server-only";
import { NextResponse } from "next/server";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  buildSignMessage,
  consumeNonce,
  setWalletSessionCookie,
  SESSION_TTL_SEC,
} from "@/lib/auth/session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, private, must-revalidate",
    Pragma: "no-cache",
    Vary: "Cookie",
  };
}

function isValidBase58Wallet(s: string): boolean {
  try {
    return !!new PublicKey(s);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const wallet = String(body?.wallet || "").trim();
    const nonce = String(body?.nonce || "").trim();
    const ts = Number(body?.ts || 0);
    const txBase64 = String(body?.txBase64 || "");
    if (!wallet || !isValidBase58Wallet(wallet) || !nonce || !Number.isFinite(ts) || ts <= 0 || !txBase64) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: noStoreHeaders() });
    }

    const okNonce = await consumeNonce(wallet, nonce);
    if (!okNonce) {
      return NextResponse.json({ ok: false, error: "invalid_nonce" }, { status: 401, headers: noStoreHeaders() });
    }

    const walletPk = new PublicKey(wallet);
    const expected = buildSignMessage(wallet, nonce, ts);

    let feePayer = "";
    try {
      const buf = Buffer.from(txBase64, "base64");
      try {
        const legacyTx = Transaction.from(buf);
        feePayer = legacyTx.feePayer?.toBase58() || "";
        const hasExpectedMemo = legacyTx.instructions.some((ix: any) => {
          try {
            return ix.programId?.toBase58?.() === MEMO_PROGRAM_ID && Buffer.from(ix.data as any).toString("utf8") === expected;
          } catch {
            return false;
          }
        });
        if (!hasExpectedMemo) {
          return NextResponse.json({ ok: false, error: "memo_mismatch" }, { status: 401, headers: noStoreHeaders() });
        }
        const sigEntry = (legacyTx.signatures || []).find((s: any) => {
          try {
            return !!s?.publicKey && s.publicKey.equals(walletPk) && !!s.signature;
          } catch {
            return false;
          }
        });
        if (!sigEntry?.signature) {
          return NextResponse.json({ ok: false, error: "missing_signature" }, { status: 401, headers: noStoreHeaders() });
        }
        const ok = nacl.sign.detached.verify(legacyTx.serializeMessage(), Uint8Array.from(sigEntry.signature as Buffer), walletPk.toBytes());
        if (!ok) {
          return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401, headers: noStoreHeaders() });
        }
      } catch {
        const v0Tx = VersionedTransaction.deserialize(buf);
        const staticKeys = v0Tx.message.staticAccountKeys || [];
        feePayer = staticKeys[0]?.toBase58?.() || "";
        const hasExpectedMemo = ((v0Tx.message as any).compiledInstructions || []).some((ix: any) => {
          try {
            return staticKeys[ix.programIdIndex]?.toBase58?.() === MEMO_PROGRAM_ID && Buffer.from(ix.data).toString("utf8") === expected;
          } catch {
            return false;
          }
        });
        if (!hasExpectedMemo) {
          return NextResponse.json({ ok: false, error: "memo_mismatch" }, { status: 401, headers: noStoreHeaders() });
        }
        const signerIdx = staticKeys.findIndex((k: any) => {
          try {
            return !!k && k.equals(walletPk);
          } catch {
            return false;
          }
        });
        const sig = signerIdx >= 0 ? v0Tx.signatures?.[signerIdx] : undefined;
        if (!sig) {
          return NextResponse.json({ ok: false, error: "missing_signature" }, { status: 401, headers: noStoreHeaders() });
        }
        const ok = nacl.sign.detached.verify(v0Tx.message.serialize(), Uint8Array.from(sig), walletPk.toBytes());
        if (!ok) {
          return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401, headers: noStoreHeaders() });
        }
      }
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_tx" }, { status: 400, headers: noStoreHeaders() });
    }

    if (feePayer !== wallet) {
      return NextResponse.json({ ok: false, error: "wrong_fee_payer" }, { status: 401, headers: noStoreHeaders() });
    }

    const res = NextResponse.json({ ok: true, ttlSec: SESSION_TTL_SEC }, { status: 200, headers: noStoreHeaders() });
    await setWalletSessionCookie(res, wallet, { ttlSec: SESSION_TTL_SEC, reqHost: req.headers.get("host") || "" });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500, headers: noStoreHeaders() });
  }
}
