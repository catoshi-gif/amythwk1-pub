// src/lib/jupiter/activity.ts
//
// Activity event types for the Jupiter Perps vault.

export type VaultActivityEvent = {
  id: string;
  kind: "signal_executed" | "deposit" | "withdraw" | "request_created" | "request_closed";
  ts: number;
  signal?: string;
  perpSymbol?: string;
  baseAssetAmount?: number;
  signalNonce?: number;
  txSig?: string;
  amount?: number;
  status?: string;
  source?: string;
  error?: string;
};
