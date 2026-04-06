// filepath: src/lib/auth/initWalletSession.ts
// Client-side helper to establish an httpOnly wallet session cookie used to gate private webhook data.
// Behaviour:
//   - Can be called as:
//       initWalletSession(wallet, signMessage)
//       initWalletSession({ wallet, signMessage })
//       initWalletSession({ wallet, signMessage, signTransaction }) // NEW: Ledger-safe fallback
//   - Talks to /api/auth/nonce to either:
//       • confirm an existing amyth_wallet_session cookie for this wallet (no signing), or
//       • obtain a nonce + message to sign once.
//   - Primary path uses signMessage (most wallets).
//   - Fallback path uses signTransaction to sign a *local* legacy tx that contains the same message
//     inside a Memo instruction (works on Ledger and other wallets that don't support signMessage).
//   - On success, dispatches a 'amyth-wallet-session-ready' browser event so pages can refetch
//     webhook data knowing the server sees the user as the owner.
//
// Security notes:
//   - Both paths bind the server session to a one-time nonce (5‑min TTL in Redis).
//   - The transaction fallback NEVER broadcasts — it only signs a legacy Transaction containing
//     a Memo with the nonce-bound message. Server verifies both the signature and the memo contents.
//   - The actual session is 100% server-side (Upstash + httpOnly cookie). This helper never stores secrets.

type SignMessageFn = ((message: Uint8Array) => Promise<Uint8Array>) | null | undefined;
type SignTransactionFn = ((tx: any) => Promise<any>) | null | undefined;

function safeWallet(addr: string | null | undefined): string {
  return String(addr || '').trim();
}

const SESSION_HINT_KEY = 'amyth_wallet_session_hint';
const FORCE_TX_PREFIX = 'amyth_wallet_session_force_tx:';

function getForceTxPreference(addr: string | null | undefined): boolean {
  try {
    if (isAndroidChromiumMwaLikeWallet(addr)) return false;
    if (typeof window === 'undefined') return false;
    const w: any = window as any;
    if (!w.localStorage) return false;
    const key = safeWallet(addr);
    if (!key) return false;
    return String(w.localStorage.getItem(FORCE_TX_PREFIX + key) || '') === '1';
  } catch {
    return false;
  }
}

function setForceTxPreference(addr: string | null | undefined, v: boolean): void {
  try {
    if (isAndroidChromiumMwaLikeWallet(addr)) {
      try {
        if (typeof window !== 'undefined') {
          const w: any = window as any;
          const key = safeWallet(addr);
          if (key && w?.localStorage) w.localStorage.removeItem(FORCE_TX_PREFIX + key);
        }
      } catch {}
      return;
    }
    if (typeof window === 'undefined') return;
    const w: any = window as any;
    if (!w.localStorage) return;
    const key = safeWallet(addr);
    if (!key) return;
    if (v) w.localStorage.setItem(FORCE_TX_PREFIX + key, '1');
    else w.localStorage.removeItem(FORCE_TX_PREFIX + key);
  } catch {
    // ignore
  }
}


function setSessionHint(addr: string | null | undefined): void {
  try {
    if (typeof window === 'undefined') return;
    const w: any = window as any;
    if (!w.localStorage) return;
    const key = safeWallet(addr);
    if (!key) {
      w.localStorage.removeItem(SESSION_HINT_KEY);
      return;
    }
    w.localStorage.setItem(SESSION_HINT_KEY, key);
  } catch {
    // ignore storage errors
  }
}

export function dispatchSessionReady(walletAddr: string) {
  if (typeof window === 'undefined') return;
  const w: any = window as any;
  const key = safeWallet(walletAddr);
  if (!key) return;
  if (!w.__amythWalletSessionReady) w.__amythWalletSessionReady = {};
  w.__amythWalletSessionReady[key] = true;
  try {
    const ev = new CustomEvent('amyth-wallet-session-ready', { detail: { wallet: key } });
    window.dispatchEvent(ev);
  } catch {}
}

async function postJson(path: string, body: any): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

/**
 * Overloads so legacy call sites still work:
 *
 *   initWalletSession(wallet, signMessage)
 *   initWalletSession({ wallet, signMessage })
 *   initWalletSession({ wallet, signMessage, signTransaction }) // new – ledger-safe
 */

const DEFAULT_SESSION_VERIFY_GRACE_MS = 20_000;
const CHROMIUM_MWA_SESSION_VERIFY_GRACE_MS = 300_000;

function isAndroidChromiumMwaLikeWallet(addr: string | null | undefined): boolean {
  try {
    if (typeof window === "undefined") return false;
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const isAndroidChromium = /android/.test(ua) && /chrome|chromium/.test(ua);
    if (!isAndroidChromium) return false;

    const key = safeWallet(addr).toLowerCase();
    const selected = String(window.localStorage?.getItem("walletName") || window.sessionStorage?.getItem("walletName") || "").toLowerCase();
    const isMwaSelection = selected.includes("mobile wallet") || selected.includes("mwa") || selected.includes("seeker") || selected.includes("seed");
    if (isMwaSelection) return true;

    if (!key) return false;
    const wa: any = (window as any)?.solana;
    const waPk = String(wa?.publicKey?.toBase58?.() || wa?.publicKey?.toString?.() || "").trim().toLowerCase();
    return Boolean(waPk && waPk === key);
  } catch {
    return false;
  }
}

function getSessionVerifyGraceMs(addr: string | null | undefined): number {
  return isAndroidChromiumMwaLikeWallet(addr) ? CHROMIUM_MWA_SESSION_VERIFY_GRACE_MS : DEFAULT_SESSION_VERIFY_GRACE_MS;
}

function getSessionRuntimeState(): { inflight: Record<string, Promise<void>>; verifiedAt: Record<string, number> } {
  if (typeof window === 'undefined') return { inflight: {}, verifiedAt: {} };
  const w: any = window as any;
  if (!w.__amythWalletSessionState) {
    w.__amythWalletSessionState = { inflight: {}, verifiedAt: {} };
  }
  return w.__amythWalletSessionState as { inflight: Record<string, Promise<void>>; verifiedAt: Record<string, number> };
}

export function markSessionVerified(addr: string | null | undefined): void {
  const key = safeWallet(addr);
  if (!key) return;
  try {
    const state = getSessionRuntimeState();
    state.verifiedAt[key] = Date.now();
  } catch {
    // ignore
  }
  setSessionHint(key);
  dispatchSessionReady(key);
}

export function hasRecentVerifiedSession(addr: string | null | undefined): boolean {
  const key = safeWallet(addr);
  if (!key) return false;
  try {
    const state = getSessionRuntimeState();
    const ts = Number(state.verifiedAt[key] || 0);
    return Number.isFinite(ts) && ts > 0 && (Date.now() - ts) <= getSessionVerifyGraceMs(key);
  } catch {
    return false;
  }
}

export async function initWalletSession(wallet: string, signMessage: SignMessageFn): Promise<void>;

export async function initWalletSession(opts: { wallet: string; signMessage?: SignMessageFn; signTransaction?: SignTransactionFn; preferTx?: boolean }): Promise<void>;
export async function initWalletSession(a: any, b?: any): Promise<void> {
  if (typeof window === 'undefined') return; // SSR guard

  // Normalize call signature
  let walletAddr: string;
  let signMessage: SignMessageFn | undefined;
  let signTransaction: SignTransactionFn | undefined;
  let preferTx = false;

  // Legacy signature: initWalletSession(wallet, signMessage)
  if (typeof a === 'string') {
    walletAddr = safeWallet(a);
    preferTx = getForceTxPreference(walletAddr);
    signMessage = b;
  } else {
    // New signature: initWalletSession({ wallet, signMessage, signTransaction })
    walletAddr = safeWallet(a?.wallet);
    signMessage = a?.signMessage;
    signTransaction = a?.signTransaction;
    preferTx = Boolean(a?.preferTx) || getForceTxPreference(walletAddr);
  }

  if (!walletAddr) return;

  if (hasRecentVerifiedSession(walletAddr)) {
    dispatchSessionReady(walletAddr);
    return;
  }

  const runtimeState = getSessionRuntimeState();
  const existingInflight = runtimeState.inflight[walletAddr];
  if (existingInflight) {
    await existingInflight;
    return;
  }

  const runner = (async (): Promise<void> => {
    // Shared helper for both signing paths.
    // Must work in browsers (Android/iOS/desktop) and not depend on Node Buffer.
    const toBase64 = (bytes: ArrayBuffer | Uint8Array): string => {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (typeof btoa === 'function') {
        let bin = '';
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
      }
      const B: any = (globalThis as any).Buffer;
      if (B && typeof B.from === 'function') return B.from(u8).toString('base64');
      throw new Error('Base64 encoder unavailable');
    };

    try {
      const r1 = await postJson('/api/auth/nonce', { wallet: walletAddr });
      const j1: any = await r1.json().catch(() => ({}));

      if (r1.ok && j1?.ok && j1?.already) {
        markSessionVerified(walletAddr);
        return;
      }

      const nonce = typeof j1?.nonce === 'string' ? j1.nonce : '';
      const message = typeof j1?.message === 'string' ? j1.message : '';
      const ts = Number(j1?.ts ?? 0);

      if (!r1.ok || !nonce || !message || !Number.isFinite(ts) || ts <= 0) return;

      let sessionOk = false;
      if (!preferTx && typeof signMessage === 'function') {
        let signSucceeded = false;
        try {
          const encoder = new TextEncoder();
          const msgBytes = encoder.encode(message);
          const rawSig = await signMessage(msgBytes);
          signSucceeded = true; // wallet signed OK — any failure after this is server-side
          const bs58 = (await import('bs58')).default;

          const normalizeSigB58 = (raw: any): string => {
            const isBase58 = (s: string) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
            if (typeof raw === 'string') {
              const s = raw.trim();
              if (isBase58(s) && s.length >= 40) return s;
            }
            const wrapped = raw?.signature ?? raw?.sig ?? raw?.data;
            if (wrapped != null && wrapped !== raw) return normalizeSigB58(wrapped);
            if (raw instanceof Uint8Array) return bs58.encode(raw);
            if (raw instanceof ArrayBuffer) return bs58.encode(new Uint8Array(raw));
            if (Array.isArray(raw)) return bs58.encode(Uint8Array.from(raw));
            if (raw && typeof raw === 'object' && typeof (raw as any).length === 'number') {
              try { return bs58.encode(Uint8Array.from(Array.from(raw as any))); } catch {}
            }
            throw new Error('Unsupported signature format from wallet adapter');
          };

          const signatureBase58 = normalizeSigB58(rawSig);
          const r2 = await postJson('/api/auth/session', { wallet: walletAddr, nonce, ts, signatureBase58 });
          const j2: any = await r2.json().catch(() => ({}));
          if (r2.ok && j2?.ok) {
            sessionOk = true;
            setForceTxPreference(walletAddr, false);
            markSessionVerified(walletAddr);
            return;
          }
        } catch {
          // Only fall back to signTransaction if the wallet itself can't sign messages.
          // If the wallet signed OK but the server rejected/timed out, do NOT set forceTx —
          // that would permanently latch this wallet into the tx-signing path.
          if (!signSucceeded && typeof signTransaction === 'function') setForceTxPreference(walletAddr, true);
        }
      }

      if (!sessionOk && typeof signTransaction === 'function') {
        try {
          const { PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
          const { ensureConnection } = await import('../rpc');
          const conn = ensureConnection();

          const feePayer = new PublicKey(walletAddr);
          // This transaction is never broadcast — it only exists so wallets that do not
          // support signMessage can sign a nonce-bound memo for session bootstrap.
          // On Android Chromium / MWA, waiting for a confirmed blockhash adds unnecessary
          // latency to protected actions. Prefer the freshest processed blockhash first
          // and fall back only if the RPC/provider rejects it.
          const { blockhash } = await conn.getLatestBlockhash('processed').catch(async () => {
            const { blockhash: bh1 } = await conn.getLatestBlockhash('confirmed').catch(async () => {
              const { blockhash: bh2 } = await conn.getLatestBlockhash('finalized');
              return { blockhash: bh2 };
            });
            return { blockhash: bh1 };
          });

          const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
          const memoIx = new TransactionInstruction({
            programId: memoProgramId,
            keys: [],
            data: new TextEncoder().encode(message) as any,
          });

          let txForSigning: any;
          try {
            const v0msg = new TransactionMessage({
              payerKey: feePayer,
              recentBlockhash: blockhash,
              instructions: [memoIx],
            }).compileToV0Message();
            txForSigning = new VersionedTransaction(v0msg);
          } catch {
            txForSigning = new Transaction({ feePayer, recentBlockhash: blockhash }).add(memoIx);
          }

          const signedTx = await signTransaction(txForSigning as any);
          const signedAny: any = signedTx as any;
          const serialized =
            signedAny instanceof Transaction
              ? signedAny.serialize({ requireAllSignatures: false, verifySignatures: false })
              : signedAny.serialize();
          const txBase64 = toBase64(serialized);
          const r3 = await postJson('/api/auth/session/tx', { wallet: walletAddr, nonce, ts, txBase64 });
          const j3: any = await r3.json().catch(() => ({}));
          if (r3.ok && j3?.ok) {
            sessionOk = true;
            setForceTxPreference(walletAddr, true);
            markSessionVerified(walletAddr);
            return;
          }
        } catch {
          // fall through
        }
      }
    } catch {
      // ignore
    }
  })();

  runtimeState.inflight[walletAddr] = runner;
  try {
    await runner;
  } finally {
    if (runtimeState.inflight[walletAddr] === runner) delete runtimeState.inflight[walletAddr];
  }
}

// Clear session hint from localStorage (called on wallet disconnect)
export async function clearWalletSessionClient(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('amyth_wallet_session_hint');
  } catch {}
}
