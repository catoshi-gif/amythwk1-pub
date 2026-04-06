import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getRpcUrl } from '@/lib/env.server';
import { fetchJupiterPositions } from '@/lib/jupiter/positions';
import { JUPITER_PERPS_PROGRAM_ID, JLP_POOL, JUPITER_PERP_MARKETS } from '@/lib/jupiter/markets';
import { derivePositionPda } from '@/lib/jupiter-vault-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authority = searchParams.get('authority') || '';
  const debug = searchParams.get('debug') === '1';
  if (!authority) return NextResponse.json({ ok: false, positions: [] });

  try {
    const connection = new Connection(getRpcUrl(), 'confirmed');
    const authorityPk = new PublicKey(authority);
    
    // Debug: check each position PDA directly
    const debugInfo: any[] = [];
    if (debug) {
      for (const market of JUPITER_PERP_MARKETS) {
        for (const sideConfig of [
          { side: 'short' as const, cc: market.sides.short[0]?.collateralCustody },
          { side: 'long' as const, cc: market.sides.long.collateralCustody },
        ]) {
          if (!sideConfig.cc) continue;
          const [posPk] = derivePositionPda(authorityPk, JLP_POOL, market.custody, sideConfig.cc, sideConfig.side);
          const acct = await connection.getAccountInfo(posPk, 'confirmed').catch(() => null);
          debugInfo.push({
            market: market.symbol,
            side: sideConfig.side,
            positionPk: posPk.toBase58(),
            exists: !!acct,
            dataLen: acct?.data?.length || 0,
            owner: acct?.owner?.toBase58() || null,
            sizeUsdRaw: acct && acct.data.length >= 170 ? acct.data.readBigUInt64LE(161).toString() : null,
            collateralRaw: acct && acct.data.length >= 178 ? acct.data.readBigUInt64LE(169).toString() : null,
            entryPriceRaw: acct && acct.data.length >= 162 ? acct.data.readBigUInt64LE(153).toString() : null,
            sideByte: acct && acct.data.length >= 153 ? acct.data[152] : null,
          });
        }
      }
    }
    
    const positions = await fetchJupiterPositions(connection, authorityPk);
    return NextResponse.json({ ok: true, positions, ...(debug ? { debug: debugInfo, authority } : {}) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, positions: [], error: err?.message });
  }
}
