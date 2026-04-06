// src/lib/jupiter/jup-price.ts
// Jupiter Price V3 (Pro key if available) — accurate real-time pricing.
// Uses the same endpoint and auth pattern as mojomaxi's price-lite.ts.

const JUP_PRICE_V3 = 'https://api.jup.ag/price/v3';

// Well-known mints for perp markets
export const MINT_SOL = 'So11111111111111111111111111111111111111112';
export const MINT_BTC = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh';
export const MINT_ETH = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';

export const ASSET_TO_MINT: Record<string, string> = {
  SOL: MINT_SOL,
  BTC: MINT_BTC,
  ETH: MINT_ETH,
};

function authHeaders(): Record<string, string> {
  const key = (process.env.JUP_API_KEY || process.env.JUP_PRO_API_KEY || '').trim();
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (key) h['x-api-key'] = key;
  return h;
}

/**
 * Fetch USD prices for a list of token mints using Jupiter Price V3.
 * Returns a map of mint → USD price.
 */
export async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(mints.filter(Boolean))];
  if (!uniq.length) return {};

  const out: Record<string, number> = {};
  try {
    const u = new URL(JUP_PRICE_V3);
    u.searchParams.set('ids', uniq.join(','));
    const r = await fetch(u.toString(), {
      cache: 'no-store',
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return out;
    const j = await r.json();
    const data: any = j?.data || j?.prices || j;
    for (const mint of uniq) {
      const node: any = data?.[mint];
      const usd = Number(node?.usdPrice ?? node?.price ?? node?.priceUsd ?? node);
      if (Number.isFinite(usd) && usd > 0) out[mint] = usd;
    }
  } catch {}
  return out;
}

/**
 * Get USD prices by asset name (SOL, BTC, ETH).
 * Returns a map of asset → USD price.
 */
export async function fetchAssetPrices(assets: string[]): Promise<Record<string, number>> {
  const mints = assets.map(a => ASSET_TO_MINT[a]).filter(Boolean);
  const mintPrices = await fetchJupiterPrices(mints);
  const out: Record<string, number> = {};
  for (const asset of assets) {
    const mint = ASSET_TO_MINT[asset];
    if (mint && mintPrices[mint]) out[asset] = mintPrices[mint];
  }
  return out;
}

/**
 * Get a single asset's USD price.
 */
export async function fetchAssetPrice(asset: string): Promise<number | null> {
  const prices = await fetchAssetPrices([asset]);
  return prices[asset] ?? null;
}
