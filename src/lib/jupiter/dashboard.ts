// src/lib/jupiter/dashboard.ts
//
// Dashboard data aggregation for Jupiter Perps vaults.

import { Connection } from "@solana/web3.js";
import { deriveAllPdas, type StrategyContext } from "@/lib/jupiter-vault-accounts";
import { fetchJupiterPositions, type JupiterPosition } from "@/lib/jupiter/positions";

export type VaultSnapshot = {
  idleCollateral: number;
  openExposureUsd: number;
  totalUnrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  entryValueUsd: number;
  currentEquity: number;
  totalDeposited: number;
  totalWithdrawn: number;
  wins: number;
  losses: number;
  winRate: number;
  totalExecutions: number;
  activeSide: "long" | "short" | "flat" | "mixed";
  positionsCount: number;
  lastUpdated: number;
};

export type VaultDashboardData = {
  positions: JupiterPosition[];
  snapshot: VaultSnapshot;
  activity: any[];
  fills: any[];
};

export async function fetchVaultDashboardData(
  connection: Connection,
  ctx: StrategyContext,
): Promise<VaultDashboardData> {
  const pdas = deriveAllPdas(ctx);

  // Fetch vault token balance
  let idleCollateral = 0;
  try {
    const balance = await connection.getTokenAccountBalance(pdas.vaultTokenAta, "confirmed");
    idleCollateral = balance?.value?.uiAmount ?? 0;
  } catch {}

  // Fetch positions
  const positions = await fetchJupiterPositions(connection, pdas.vaultAuthority);

  const openExposureUsd = positions.reduce((sum, p) => sum + p.sizeUsd, 0);
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const positionsCount = positions.length;

  let activeSide: VaultSnapshot["activeSide"] = "flat";
  if (positionsCount > 0) {
    const sides = new Set(positions.map((p) => p.side));
    if (sides.size > 1) activeSide = "mixed";
    else activeSide = positions[0].side;
  }

  const snapshot: VaultSnapshot = {
    idleCollateral,
    openExposureUsd,
    totalUnrealizedPnl,
    realizedPnl: 0,
    totalPnl: totalUnrealizedPnl,
    entryValueUsd: positions.reduce((sum, p) => sum + p.collateralUsd, 0),
    currentEquity: idleCollateral + positions.reduce((sum, p) => sum + p.collateralUsd + p.unrealizedPnl, 0),
    totalDeposited: 0,
    totalWithdrawn: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalExecutions: 0,
    activeSide,
    positionsCount,
    lastUpdated: Date.now(),
  };

  return { positions, snapshot, activity: [], fills: [] };
}
