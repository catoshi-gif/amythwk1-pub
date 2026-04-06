// src/lib/jupiter/positions.ts
// Read Jupiter Perps positions with live PnL via Jupiter Price V3 Pro.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  JUPITER_PERPS_PROGRAM_ID,
  JLP_POOL,
  JUPITER_PERP_MARKETS,
  type JupiterSide,
} from "@/lib/jupiter/markets";
import { derivePositionPda } from "@/lib/jupiter-vault-accounts";
import { fetchAssetPrices } from "@/lib/jupiter/jup-price";

export type JupiterPosition = {
  symbol: string;
  baseAsset: string;
  side: JupiterSide;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  positionPk: string;
  custody: string;
  collateralCustody: string;
  openTime: number;
};

// Jupiter Position account layout (after 8-byte Anchor discriminator):
//   owner:              Pubkey  32B  offset 8
//   pool:               Pubkey  32B  offset 40
//   custody:            Pubkey  32B  offset 72
//   collateralCustody:  Pubkey  32B  offset 104
//   openTime:           i64     8B   offset 136
//   updateTime:         i64     8B   offset 144
//   side:               u8      1B   offset 152  (1=Long, 2=Short)
//   price:              u64     8B   offset 153  (entry price, 6 decimals)
//   sizeUsd:            u64     8B   offset 161  (6 decimals)
//   collateralUsd:      u64     8B   offset 169  (6 decimals)
//   realisedPnlUsd:     i64     8B   offset 177
//   cumulativeInterest: u128   16B   offset 185
//   lockedAmount:       u64     8B   offset 201
//   bump:               u8      1B   offset 209

function parsePosition(data: Buffer): {
  side: JupiterSide; entryPrice: number; sizeUsd: number;
  collateralUsd: number; openTime: number;
} | null {
  if (data.length < 210) return null;
  const sizeRaw = data.readBigUInt64LE(161);
  if (sizeRaw === BigInt(0)) return null;
  return {
    side: data[152] === 1 ? "long" : "short",
    entryPrice: Number(data.readBigUInt64LE(153)) / 1e6,
    sizeUsd: Number(sizeRaw) / 1e6,
    collateralUsd: Number(data.readBigUInt64LE(169)) / 1e6,
    openTime: Number(data.readBigInt64LE(136)) * 1000,
  };
}

export async function fetchJupiterPositions(
  connection: Connection,
  vaultAuthority: PublicKey,
): Promise<JupiterPosition[]> {
  const positions: JupiterPosition[] = [];
  const assets = JUPITER_PERP_MARKETS.map((m) => m.baseAsset);
  const prices = await fetchAssetPrices(assets);

  for (const market of JUPITER_PERP_MARKETS) {
    const sides: { side: JupiterSide; collateralCustody: PublicKey }[] = [
      { side: "long", collateralCustody: market.sides.long.collateralCustody },
      ...market.sides.short.map((s) => ({ side: "short" as const, collateralCustody: s.collateralCustody })),
    ];

    for (const { side, collateralCustody } of sides) {
      try {
        const [positionPk] = derivePositionPda(
          vaultAuthority, JLP_POOL, market.custody, collateralCustody, side,
        );

        const account = await connection.getAccountInfo(positionPk, "confirmed");
        if (!account || account.data.length < 210) continue;
        if (!account.owner.equals(JUPITER_PERPS_PROGRAM_ID)) continue;

        const parsed = parsePosition(account.data);
        if (!parsed) continue;

        const markPrice = prices[market.baseAsset] || 0;
        let unrealizedPnl = 0;
        if (markPrice > 0 && parsed.entryPrice > 0) {
          const delta = parsed.side === "long"
            ? markPrice - parsed.entryPrice
            : parsed.entryPrice - markPrice;
          unrealizedPnl = parsed.sizeUsd * delta / parsed.entryPrice;
        }

        positions.push({
          symbol: market.symbol,
          baseAsset: market.baseAsset,
          side: parsed.side,
          sizeUsd: parsed.sizeUsd,
          collateralUsd: parsed.collateralUsd,
          entryPrice: parsed.entryPrice,
          markPrice,
          unrealizedPnl,
          leverage: parsed.collateralUsd > 0 ? parsed.sizeUsd / parsed.collateralUsd : 0,
          positionPk: positionPk.toBase58(),
          custody: market.custody.toBase58(),
          collateralCustody: collateralCustody.toBase58(),
          openTime: parsed.openTime,
        });
      } catch {}
    }
  }

  return positions;
}
