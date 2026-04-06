import 'server-only';

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  deriveAllPdas,
  deriveJupiterStrategyPda,
  derivePositionPda,
  derivePositionRequestPda,
  deriveExecRecordPda,
  VAULT_PROGRAM_ID,
  JUPITER_PERPS_PROGRAM_ID,
  JUPITER_EVENT_AUTHORITY,
  JLP_POOL,
  type StrategyContext,
} from '@/lib/jupiter-vault-accounts';
import { getRpcUrl, getRelayerPrivateKey } from '@/lib/env.server';
import { findMarketByCustody, type JupiterSide } from '@/lib/jupiter/markets';
import {
  appendActivity,
  markSignalStatus,
  readSignalRecord,
  recordRelayerExecution,
  type QueuedSignalRecord,
} from '@/lib/server/webhooks.server';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

// ---------------------------------------------------------------------------
// Strategy snapshot (read from on-chain account)
// ---------------------------------------------------------------------------

type StrategySnapshot = {
  vault: PublicKey;
  admin: PublicKey;
  authorizedRelayer: PublicKey;
  custody: PublicKey;
  collateralCustody: PublicKey;
  tokenMint: PublicKey;
  side: JupiterSide;
  maxOpenSizeUsd: number;
  maxPriceSlippage: number;
  cooldownSecs: number;
  lastExecTs: number;
  lastSignalNonce: number;
  pendingRequest: PublicKey;
  paused: boolean;
  reduceOnly: boolean;
};

function parseRelayerKeypair(raw: string): Keypair {
  const value = String(raw || '').trim();
  if (!value) throw new Error('RELAYER_PRIVATE_KEY is not configured.');
  try {
    if (value.startsWith('[')) {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  } catch {}
  try { return Keypair.fromSecretKey(bs58.decode(value)); } catch {
    throw new Error('RELAYER_PRIVATE_KEY must be a base58 secret key or JSON array.');
  }
}

// ---------------------------------------------------------------------------
// Process signal — builds and sends the on-chain execute_perps_signal tx
// ---------------------------------------------------------------------------

async function readStrategySnapshot(connection: Connection, strategyPk: PublicKey): Promise<StrategySnapshot> {
  const account = await connection.getAccountInfo(strategyPk, 'confirmed');
  if (!account) throw new Error('Jupiter strategy account not found.');
  const data = account.data;
  const o = 8; // skip discriminator

  return {
    vault: new PublicKey(data.subarray(o, o + 32)),
    admin: new PublicKey(data.subarray(o + 32, o + 64)),
    authorizedRelayer: new PublicKey(data.subarray(o + 64, o + 96)),
    custody: new PublicKey(data.subarray(o + 192, o + 224)),
    collateralCustody: new PublicKey(data.subarray(o + 224, o + 256)),
    tokenMint: new PublicKey(data.subarray(o + 256, o + 288)),
    side: data[o + 320] === 0 ? 'long' : 'short' as JupiterSide,
    maxOpenSizeUsd: Number(data.readBigUInt64LE(o + 321)),
    maxPriceSlippage: Number(data.readBigUInt64LE(o + 329)),
    cooldownSecs: Number(data.readBigInt64LE(o + 337)),
    lastExecTs: Number(data.readBigInt64LE(o + 345)),
    lastSignalNonce: Number(data.readBigUInt64LE(o + 353)),
    pendingRequest: new PublicKey(data.subarray(o + 361, o + 393)),
    paused: data[o + 394] === 1,
    reduceOnly: data[o + 395] === 1,
  };
}

// ---------------------------------------------------------------------------
// Process signal
// ---------------------------------------------------------------------------

export async function processSignal(signalOrId: string | QueuedSignalRecord) {
  const signal = typeof signalOrId === 'string' ? await readSignalRecord(signalOrId) : signalOrId;
  if (!signal) throw new Error('Signal record not found.');

  const relayer = parseRelayerKeypair(getRelayerPrivateKey());
  const connection = new Connection(getRpcUrl(), 'confirmed');

  const vaultPk = new PublicKey(String(signal.vault || '').trim());

  // Read vault to get setId and admin
  const vaultAccount = await connection.getAccountInfo(vaultPk, 'confirmed');
  if (!vaultAccount) throw new Error('Vault account not found on-chain.');
  const vaultData = vaultAccount.data;
  const admin = new PublicKey(vaultData.subarray(8, 40));
  const setIdBytes = vaultData.subarray(40, 56);

  // We need the strategy PK — it's stored in the webhook config
  // For now, derive it from the signal's market info
  const market = findMarketByCustody(new PublicKey(signal.custody || ''));
  if (!market) throw new Error(`Unknown custody in signal: ${signal.custody}`);

  const side = String(signal.action).includes('long') ? 'long' : 'short' as JupiterSide;
  const sideConfig = side === 'long'
    ? market.sides.long
    : market.sides.short.find((s) => s.collateralLabel === 'USDC') ?? market.sides.short[0];

  // Use stored webhook config custody/collateral (always matches the created strategy)
  const custodyPk = signal.custody ? new PublicKey(signal.custody) : market.custody;
  const collateralCustodyPk = signal.collateralCustody
    ? new PublicKey(signal.collateralCustody)
    : sideConfig.collateralCustody;
  const tokenMintPk = signal.tokenMint
    ? new PublicKey(signal.tokenMint)
    : sideConfig.tokenMint;

  const [strategyPk] = deriveJupiterStrategyPda(vaultPk, custodyPk, collateralCustodyPk, tokenMintPk);
  const strategy = await readStrategySnapshot(connection, strategyPk);

  // Derive vault authority and key PDAs early (needed for pending request clearing)
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), vaultPk.toBuffer()], VAULT_PROGRAM_ID,
  );
  const vaultTokenAta = getAssociatedTokenAddressSync(strategy.tokenMint, vaultAuthority, true);
  const [positionPk] = derivePositionPda(vaultAuthority, JLP_POOL, strategy.custody, strategy.collateralCustody, strategy.side);

  if (strategy.authorizedRelayer.toBase58() !== relayer.publicKey.toBase58()) {
    throw new Error(`Relayer mismatch. Strategy expects ${strategy.authorizedRelayer.toBase58()}`);
  }
  if (strategy.paused) throw new Error('Strategy is paused.');

  // Auto-clear stale pending request if the request account is already closed on Jupiter
  if (!strategy.pendingRequest.equals(PublicKey.default)) {
    const pendingAcct = await connection.getAccountInfo(strategy.pendingRequest, 'confirmed').catch(() => null);
    const isClosed = !pendingAcct || pendingAcct.data.length === 0;
    if (isClosed) {
      // Use clear_pending_request_state — relayer can sign (after on-chain upgrade)
      // Accounts: authority (signer, mut), vault, strategy (mut), closed_request
      const { createHash: ch } = await import('crypto');
      const clearDisc = ch('sha256').update('global:clear_pending_request_state').digest().subarray(0, 8);
      const { TransactionInstruction: TxIx, Transaction: Tx } = await import('@solana/web3.js');

      const clearKeys = [
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultPk, isSigner: false, isWritable: false },
        { pubkey: strategyPk, isSigner: false, isWritable: true },
        { pubkey: strategy.pendingRequest, isSigner: false, isWritable: false },
      ];

      const clearIx = new TxIx({ programId: VAULT_PROGRAM_ID, keys: clearKeys, data: clearDisc });
      const clearTx = new Tx();
      clearTx.add(clearIx);
      clearTx.feePayer = relayer.publicKey;
      const clearLatest = await connection.getLatestBlockhash('confirmed');
      clearTx.recentBlockhash = clearLatest.blockhash;
      clearTx.partialSign(relayer);

      try {
        const clearSig = await connection.sendRawTransaction(clearTx.serialize(), { skipPreflight: true });
        await connection.confirmTransaction({ signature: clearSig, blockhash: clearLatest.blockhash, lastValidBlockHeight: clearLatest.lastValidBlockHeight }, 'confirmed');
        // Re-read strategy after clearing
        const updatedStrategy = await readStrategySnapshot(connection, strategyPk);
        Object.assign(strategy, updatedStrategy);
      } catch (clearErr: any) {
        throw new Error(`Failed to clear stale pending request: ${clearErr?.message}`);
      }
    } else {
      throw new Error('Strategy has an active pending request on Jupiter. Wait for keeper to process it.');
    }
  }

  const baseNonce = BigInt(
    Number.isFinite(Number(signal.signalNonce)) && Number(signal.signalNonce) > strategy.lastSignalNonce
      ? Number(signal.signalNonce)
      : strategy.lastSignalNonce + 1,
  );
  let nextSignalNonce = baseNonce;

  const action = String(signal.action || '').trim().toLowerCase();
  const isOpen = action === 'open_long' || action === 'open_short';
  const signalAction = isOpen ? { open: {} } : { close: {} };

  const ctx: StrategyContext = {
    admin,
    setId: Uint8Array.from(setIdBytes),
    custody: strategy.custody,
    collateralCustody: strategy.collateralCustody,
    tokenMint: strategy.tokenMint,
    side: strategy.side,
  };

  const pdas = deriveAllPdas(ctx);

  // Find the next available nonce (exec_record might exist from failed attempts)
  for (let tries = 0; tries < 10; tries++) {
    const [testExecRecord] = deriveExecRecordPda(pdas.strategyPk, nextSignalNonce);
    const existing = await connection.getAccountInfo(testExecRecord, 'confirmed').catch(() => null);
    if (!existing) break; // this nonce is available
    nextSignalNonce = nextSignalNonce + BigInt(1);
  }

  const change = isOpen ? 'increase' : 'decrease';
  const [positionRequestPk] = derivePositionRequestPda(pdas.positionPk, nextSignalNonce, change);
  const positionRequestAta = getAssociatedTokenAddressSync(strategy.tokenMint, positionRequestPk, true);
  const [execRecordPk] = deriveExecRecordPda(pdas.strategyPk, nextSignalNonce);

  // Determine size and collateral for the signal
  let sizeUsdDelta: bigint;
  let collateralTokenDelta: bigint;

  if (isOpen) {
    // For opens: if no explicit size, use vault balance as collateral, leverage from localStorage or default 10x
    const vaultAtaBalance = await connection.getTokenAccountBalance(pdas.vaultTokenAta, 'confirmed').catch(() => null);
    const vaultBalanceRaw = BigInt(vaultAtaBalance?.value?.amount || '0');
    const vaultBalanceUi = Number(vaultAtaBalance?.value?.uiAmount || 0);

    if (signal.size && Number(signal.size) > 0) {
      sizeUsdDelta = BigInt(Math.round(Number(signal.size) * 1e6));
    } else {
      // Use vault balance * leverage as position size
      const leverage = Number(signal.leverage || 10);
      if (!signal.leverage) {
        console.warn(`[relayer] vault=${signal.vault} action=${signal.action} — no leverage in signal, falling back to default 10x. Check Redis webhook config.`);
      }
      console.log(`[relayer] vault=${signal.vault} action=${signal.action} leverage=${leverage} vaultBalance=${vaultBalanceUi} sizeUsd=${vaultBalanceUi * leverage}`);
      const sizeUsd = vaultBalanceUi * leverage;
      sizeUsdDelta = BigInt(Math.round(sizeUsd * 1e6));
    }

    if (signal.collateralDelta && Number(signal.collateralDelta) > 0) {
      collateralTokenDelta = BigInt(Math.round(Number(signal.collateralDelta)));
    } else {
      // Default: use entire vault balance as collateral
      collateralTokenDelta = vaultBalanceRaw;
    }
  } else {
    // For closes: size and collateral don't matter when entirePosition=true
    sizeUsdDelta = signal.size ? BigInt(Math.round(Number(signal.size) * 1e6)) : BigInt(1);
    collateralTokenDelta = BigInt(0);
  }

  // Price slippage for Jupiter: USD price threshold with 6 decimals.
  // Fetch current price from Jupiter Price V3 Pro (same as mojomaxi).
  // Use generous 50% buffer — this is a protection limit, not DEX slippage.
  let priceSlippage = BigInt(signal.priceSlippage || 0);
  if (priceSlippage === BigInt(0)) {
    try {
      const { fetchAssetPrice } = await import('@/lib/jupiter/jup-price');
      const market = findMarketByCustody(strategy.custody);
      if (market) {
        const price = await fetchAssetPrice(market.baseAsset);
        if (price && Number.isFinite(price)) {
          const act = String(signal.action || '').toLowerCase();
          // Shorts/close-long: max fill price (above current)
          // Longs/close-short: min fill price (below current)
          // Jupiter priceSlippage per side+action:
          //   open_long:    ceiling (price * 1.50) — oracle must be ≤ slippage
          //   close_long:   floor   (price * 0.50) — oracle must be ≥ slippage
          //   open_short:   floor   (price * 0.50) — oracle must be ≥ slippage
          //   close_short:  ceiling (price * 1.50) — oracle must be ≤ slippage
          const needsCeiling = act === 'open_long' || act === 'close_short';
          const slippagePrice = needsCeiling ? price * 1.50 : price * 0.50;
          priceSlippage = BigInt(Math.round(slippagePrice * 1e6));
        }
      }
    } catch {}
  }
  // Fallback: use strategy cap if we couldn't compute
  if (priceSlippage === BigInt(0)) {
    priceSlippage = BigInt(strategy.maxPriceSlippage);
  }

  // Build instruction manually (avoids Anchor IDL format incompatibility)
  const { createHash } = await import('crypto');
  const discriminator = createHash('sha256').update('global:execute_perps_signal').digest().subarray(0, 8);

  // ExecutePerpsSignalParams layout:
  // signal_nonce: u64 (8)
  // action: SignalAction enum (1 byte: 0=Open, 1=Close)
  // size_usd_delta: u64 (8)
  // collateral_token_delta: u64 (8)
  // price_slippage: u64 (8)
  // entire_position: bool (1)
  const actionByte = isOpen ? 0 : 1;
  const entirePosition = !isOpen;

  function u64LEBuf(value: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value, 0);
    return buf;
  }

  const ixData = Buffer.concat([
    discriminator,
    u64LEBuf(nextSignalNonce),
    Buffer.from([actionByte]),
    u64LEBuf(sizeUsdDelta),
    u64LEBuf(collateralTokenDelta),
    u64LEBuf(priceSlippage),
    Buffer.from([entirePosition ? 1 : 0]),
  ]);

  const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
  const { SystemProgram, TransactionInstruction, Transaction } = await import('@solana/web3.js');

  // Jupiter Perpetuals state PDA — required by the CPI but not in our Anchor struct.
  // Must be present in the transaction's account list for the runtime to allow the CPI to reference it.
  const jupiterPerpetualsPda = PublicKey.findProgramAddressSync(
    [Buffer.from('perpetuals')],
    JUPITER_PERPS_PROGRAM_ID,
  )[0];

  const keys = [
    { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
    { pubkey: pdas.vaultPk, isSigner: false, isWritable: false },
    { pubkey: pdas.strategyPk, isSigner: false, isWritable: true },
    { pubkey: pdas.vaultAuthority, isSigner: false, isWritable: true },
    { pubkey: JUPITER_PERPS_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: JUPITER_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: JLP_POOL, isSigner: false, isWritable: true },
    { pubkey: strategy.custody, isSigner: false, isWritable: true },
    { pubkey: strategy.collateralCustody, isSigner: false, isWritable: true },
    { pubkey: strategy.tokenMint, isSigner: false, isWritable: false },
    { pubkey: pdas.vaultTokenAta, isSigner: false, isWritable: true },
    { pubkey: pdas.positionPk, isSigner: false, isWritable: true },
    { pubkey: positionRequestPk, isSigner: false, isWritable: true },
    { pubkey: positionRequestAta, isSigner: false, isWritable: true },
    { pubkey: execRecordPk, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // Jupiter CPI requires this PDA in the transaction account list
    { pubkey: jupiterPerpetualsPda, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ programId: VAULT_PROGRAM_ID, keys, data: ixData });
  const tx = new Transaction();

  // Fund vault_authority with enough SOL for Jupiter to create position/request accounts.
  // Jupiter's CPI uses vault_authority as payer for position account rent (~0.003 SOL).
  // Check current balance and top up if needed.
  const authorityBalance = await connection.getBalance(pdas.vaultAuthority, 'confirmed');
  const rentNeeded = 10_000_000; // 0.01 SOL — covers position + position_request rent
  if (authorityBalance < rentNeeded) {
    const topUp = rentNeeded - authorityBalance;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: relayer.publicKey,
        toPubkey: pdas.vaultAuthority,
        lamports: topUp,
      }),
    );
  }

  tx.add(ix);
  tx.feePayer = relayer.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.partialSign(relayer);

  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed',
  );

  await markSignalStatus(signal.id, 'completed', {
    txSig: signature,
    executedAt: Date.now(),
    signalNonce: Number(nextSignalNonce),
    relayer: relayer.publicKey.toBase58(),
  });

  await appendActivity(vaultPk.toBase58(), {
    id: `exec-${signal.id}`,
    kind: 'signal_executed',
    ts: Date.now(),
    signal: action,
    perpSymbol: market.symbol,
    signalNonce: Number(nextSignalNonce),
    txSig: signature,
    status: 'completed',
    source: 'relayer',
  });

  await recordRelayerExecution({
    vaultPk: vaultPk.toBase58(),
    signalId: signal.id,
    txSig: signature,
    status: 'completed',
    relayer: relayer.publicKey.toBase58(),
    executedAt: Date.now(),
  });

  return {
    ok: true,
    txSig: signature,
    signalId: signal.id,
    signalNonce: Number(nextSignalNonce),
    relayer: relayer.publicKey.toBase58(),
    note: 'Jupiter position request created. Keeper will fulfill it.',
  };
}
