import "server-only";
import { issueNonce } from "@/lib/auth/session.server";

export async function createWalletNonce(wallet: string, opts?: { ip?: string | null }) {
  return issueNonce(wallet, opts);
}
