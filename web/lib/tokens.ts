import type { Address } from "viem";

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

/**
 * The demo pair deployed by `script/DeployTestTokens.s.sol` and pooled by
 * `script/DeployPool.s.sol` on Sepolia. These must stay in sync with the
 * TOKEN_USDC / TOKEN_WBTC values in the root .env — redeploy the tokens and the
 * UI will quote a pool that doesn't exist.
 *
 * Decimals mirror the assets they stand in for (USDC 6, WBTC 8), so anything
 * converting to base units must read them from here rather than assuming 18.
 */
export const WBTC: Token = {
  symbol: "MyWBTC",
  address: "0x455f89677e869fbb096b53ce611ab1fb580c951f",
  decimals: 8,
};

export const USDC: Token = {
  symbol: "MyUSDC",
  address: "0x936dd0f62ea658f9f0e275fbc7324f5552dc2c91",
  decimals: 6,
};

export const TOKENS: Token[] = [USDC, WBTC];

export function tokenBySymbol(symbol: string): Token {
  return TOKENS.find((t) => t.symbol === symbol) ?? USDC;
}

export const TOKEN_OPTIONS = TOKENS.map((t) => ({ label: t.symbol, value: t.symbol }));

/** The token on the other side of the pair. With a single pool, that's the only other token. */
export function counterpart(token: Token): Token {
  return TOKENS.find((t) => t.symbol !== token.symbol) ?? token;
}

/**
 * Display formatting only — never use this to build a transaction amount.
 * High-decimal tokens get more room because their fee slices are tiny: 0.30%
 * of 0.1 MyWBTC is 0.0003, which rounds to nothing at 4 decimal places.
 */
export function formatAmount(value: number, token: Token): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: token.decimals >= 8 ? 6 : 4,
  });
}
