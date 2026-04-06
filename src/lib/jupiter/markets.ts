// src/lib/jupiter/markets.ts
//
// Jupiter Perps supported markets. These map directly to the custody accounts
// in the on-chain program's validate_supported_market_config().

import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Jupiter Perps constants (must match lib.rs)
// ---------------------------------------------------------------------------

export const JUPITER_PERPS_PROGRAM_ID = new PublicKey("PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu");
export const JUPITER_EVENT_AUTHORITY = new PublicKey("37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN");
export const JLP_POOL = new PublicKey("5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq");

// Custody accounts
export const SOL_CUSTODY = new PublicKey("7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz");
export const ETH_CUSTODY = new PublicKey("AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn");
export const BTC_CUSTODY = new PublicKey("5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm");
export const USDC_CUSTODY = new PublicKey("G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa");
export const USDT_CUSTODY = new PublicKey("4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk");

// Mints
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
export const WBTC_MINT = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

// ---------------------------------------------------------------------------
// Side enum (matches JupiterSide in lib.rs)
// ---------------------------------------------------------------------------

export type JupiterSide = "long" | "short";

export function sideToSeed(side: JupiterSide): number {
  return side === "long" ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Market configuration
// ---------------------------------------------------------------------------

export type JupiterPerpMarket = {
  /** Human label */
  symbol: string;
  /** Base asset label */
  baseAsset: string;
  /** The custody account for the traded asset */
  custody: PublicKey;
  /** Configurations per side */
  sides: {
    long: JupiterMarketSideConfig;
    short: JupiterMarketSideConfig[];
  };
};

export type JupiterMarketSideConfig = {
  side: JupiterSide;
  collateralCustody: PublicKey;
  tokenMint: PublicKey;
  /** Human label for the collateral */
  collateralLabel: string;
  /** Token decimals */
  decimals: number;
};

/**
 * All supported Jupiter Perps markets.
 * These must match validate_supported_market_config() in lib.rs.
 */
export const JUPITER_PERP_MARKETS: JupiterPerpMarket[] = [
  {
    symbol: "SOL-PERP",
    baseAsset: "SOL",
    custody: SOL_CUSTODY,
    sides: {
      long: { side: "long", collateralCustody: SOL_CUSTODY, tokenMint: WSOL_MINT, collateralLabel: "SOL", decimals: 9 },
      short: [
        { side: "short", collateralCustody: USDC_CUSTODY, tokenMint: USDC_MINT, collateralLabel: "USDC", decimals: 6 },
        { side: "short", collateralCustody: USDT_CUSTODY, tokenMint: USDT_MINT, collateralLabel: "USDT", decimals: 6 },
      ],
    },
  },
  {
    symbol: "ETH-PERP",
    baseAsset: "ETH",
    custody: ETH_CUSTODY,
    sides: {
      long: { side: "long", collateralCustody: ETH_CUSTODY, tokenMint: WETH_MINT, collateralLabel: "ETH", decimals: 8 },
      short: [
        { side: "short", collateralCustody: USDC_CUSTODY, tokenMint: USDC_MINT, collateralLabel: "USDC", decimals: 6 },
        { side: "short", collateralCustody: USDT_CUSTODY, tokenMint: USDT_MINT, collateralLabel: "USDT", decimals: 6 },
      ],
    },
  },
  {
    symbol: "BTC-PERP",
    baseAsset: "BTC",
    custody: BTC_CUSTODY,
    sides: {
      long: { side: "long", collateralCustody: BTC_CUSTODY, tokenMint: WBTC_MINT, collateralLabel: "BTC", decimals: 8 },
      short: [
        { side: "short", collateralCustody: USDC_CUSTODY, tokenMint: USDC_MINT, collateralLabel: "USDC", decimals: 6 },
        { side: "short", collateralCustody: USDT_CUSTODY, tokenMint: USDT_MINT, collateralLabel: "USDT", decimals: 6 },
      ],
    },
  },
];

/**
 * Resolve the full market side configuration for a given custody + side.
 */
export function resolveMarketConfig(
  custodyPk: PublicKey,
  side: JupiterSide,
  collateralPreference: "USDC" | "USDT" = "USDC",
): JupiterMarketSideConfig | null {
  const market = JUPITER_PERP_MARKETS.find((m) => m.custody.equals(custodyPk));
  if (!market) return null;

  if (side === "long") return market.sides.long;

  const preferred = collateralPreference === "USDT"
    ? market.sides.short.find((s) => s.collateralLabel === "USDT")
    : market.sides.short.find((s) => s.collateralLabel === "USDC");
  return preferred ?? market.sides.short[0] ?? null;
}

/**
 * Find market by symbol (e.g. "SOL-PERP", "SOL", "BTC-PERP").
 */
export function findMarketBySymbol(symbol: string): JupiterPerpMarket | undefined {
  const s = symbol.toUpperCase().replace(/-PERP$/, "");
  return JUPITER_PERP_MARKETS.find(
    (m) => m.baseAsset === s || m.symbol === `${s}-PERP`,
  );
}

/**
 * Find market by custody pubkey.
 */
export function findMarketByCustody(custody: PublicKey): JupiterPerpMarket | undefined {
  return JUPITER_PERP_MARKETS.find((m) => m.custody.equals(custody));
}
