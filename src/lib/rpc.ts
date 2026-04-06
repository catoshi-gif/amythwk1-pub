// src/lib/rpc.ts
// Client-side RPC connection singleton.

import { Connection, clusterApiUrl } from '@solana/web3.js';

let _conn: Connection | null = null;

export function ensureConnection(): Connection {
  if (_conn) return _conn;
  const url =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_RPC_URL?.trim()) ||
    clusterApiUrl('mainnet-beta');
  _conn = new Connection(url, 'confirmed');
  return _conn;
}
