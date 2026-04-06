import "server-only";

function readEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

export const env = {
  AUTH_SECRET: readEnv("AUTH_SECRET"),
  NEXT_PUBLIC_SITE_URL: readEnv("NEXT_PUBLIC_SITE_URL"),
  NEXT_PUBLIC_RPC_URL: readEnv("NEXT_PUBLIC_RPC_URL"),
  HELIUS_RPC_URL: readEnv("HELIUS_RPC_URL"),
  UPSTASH_REDIS_REST_URL: readEnv("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: readEnv("UPSTASH_REDIS_REST_TOKEN"),
  RELAYER_PRIVATE_KEY: readEnv("RELAYER_PRIVATE_KEY"),
  INTERNAL_EXECUTE_SECRET: readEnv("INTERNAL_EXECUTE_SECRET"),
};

export function getAuthSecret(): string {
  const secret = env.AUTH_SECRET;
  if (secret.length < 16) {
    throw new Error("AUTH_SECRET must be set to at least 16 characters.");
  }
  return secret;
}

export function getSiteDomain(): string {
  const raw = env.NEXT_PUBLIC_SITE_URL || "https://amyth.trade";
  try {
    return new URL(raw).hostname;
  } catch {
    return "amyth.trade";
  }
}

export function getRpcUrl(): string {
  // Server-side: prefer HELIUS_RPC_URL (private, rate-limited, authenticated)
  // Falls back to NEXT_PUBLIC_RPC_URL (exposed to client) then public endpoint
  return env.HELIUS_RPC_URL || env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function hasRedisEnv(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}


export function getRelayerPrivateKey(): string {
  const value = env.RELAYER_PRIVATE_KEY;
  if (!value) throw new Error("RELAYER_PRIVATE_KEY must be configured.");
  return value;
}

export function getInternalExecuteSecret(): string {
  return env.INTERNAL_EXECUTE_SECRET || getAuthSecret();
}
