import 'server-only';
import { NextResponse } from 'next/server';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getRpcUrl, getRelayerPrivateKey } from '@/lib/env.server';
import { getQueueDepth, readRelayerLastExecution } from '@/lib/server/webhooks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseRelayer(raw: string): Keypair {
  const value = String(raw || '').trim();
  if (value.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value)));
  return Keypair.fromSecretKey(bs58.decode(value));
}

export async function GET() {
  try {
    const relayer = parseRelayer(getRelayerPrivateKey());
    const connection = new Connection(getRpcUrl(), 'confirmed');
    const lamports = await connection.getBalance(relayer.publicKey, 'confirmed');
    const lastExecution = await readRelayerLastExecution();
    const queueDepth = await getQueueDepth();

    return NextResponse.json({
      ok: true,
      relayerAddress: relayer.publicKey.toBase58(),
      balanceSol: lamports / 1_000_000_000,
      queueDepth,
      lastExecution,
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Relayer health check failed.',
    }, { status: 500 });
  }
}
