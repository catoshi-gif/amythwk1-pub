import 'server-only';

import { Connection, PublicKey } from '@solana/web3.js';
import { deriveVaultPda } from '@/lib/jupiter-vault-accounts';
import { getRpcUrl } from '@/lib/env.server';

export type ServerVaultInfo = {
  vaultPk: string;
  admin: string;
  setId: number[];
  paused: boolean;
  createdAt: number;
};

/**
 * Fetch vault info from on-chain. Strategy lookup requires custody/collateral/mint
 * which are stored client-side, so this only returns the vault itself.
 */
export async function fetchVaultStateForWallet(wallet: string, setId?: number[] | Uint8Array | null) {
  const admin = new PublicKey(wallet);
  const setIdBytes = setId instanceof Uint8Array
    ? setId
    : new Uint8Array(Array.isArray(setId) && setId.length ? setId : new Array(16).fill(0));

  const connection = new Connection(getRpcUrl(), 'confirmed');
  const [vaultPk] = deriveVaultPda(admin, setIdBytes);
  const vaultAccount = await connection.getAccountInfo(vaultPk);
  if (!vaultAccount) return { vault: null };

  const data = vaultAccount.data;
  const paused = data[8 + 32 + 16] === 1;
  const createdAt = Number(data.readBigInt64LE(8 + 32 + 16 + 3)) * 1000;

  const vault: ServerVaultInfo = {
    vaultPk: vaultPk.toBase58(),
    admin: wallet,
    setId: Array.from(setIdBytes),
    paused,
    createdAt,
  };

  return { vault };
}
