# amyth

Automated Drift perps vaults on Solana.

Non-custodial CPI-powered trading automation with signal execution, collateral management, and on-chain risk rails.

## Architecture

```
TradingView Webhook → Relayer → amyth Program → Drift CPI → Perp Order
```

- **Vault**: PDA-owned account holding config and authority bumps
- **DriftStrategy**: Per-vault strategy with risk parameters (leverage cap, notional limit, cooldown, authorized relayer)
- **Signal Execution**: Relayer submits `execute_signal_order` — program validates all constraints before Drift CPI
- **Collateral**: Admin deposits/withdraws USDC through the program into Drift

## Stack

- **On-chain**: Anchor 0.29.0, Drift v2.160.0 CPI
- **Frontend**: Next.js 15, React 19, Tailwind CSS, Solana wallet-adapter
- **Deploy**: Vercel

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your RPC URL and program ID

# Run dev server
npm run dev
```

## On-chain Program

The Anchor program lives in `programs/drift-vault-automation/`. Build with:

```bash
anchor build
anchor deploy
```

Requires a local clone of [Drift protocol-v2](https://github.com/drift-labs/protocol-v2) at `../../../protocol-v2-master/` (or update the path in `Cargo.toml`).

## Client SDK

`src/lib/drift-vault-accounts.ts` provides all PDA derivation helpers and account set builders for constructing transactions against the vault program.

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Site URL for metadata |
| `NEXT_PUBLIC_VAULT_PROGRAM_ID` | Deployed vault program ID |
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint |
| `RELAYER_SECRET` | Relayer keypair (server-side) |

## License

MIT
