import type { Address } from "viem";

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

/**
 * The pair `script/DeployPool.s.sol` actually initialises on Sepolia. These are
 * the same addresses the deploy script pins — if you change them there, change
 * them here, or the UI will quote a pool that doesn't exist.
 */
export const WETH: Token = {
  symbol: "WETH",
  address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  decimals: 18,
};

export const USDC: Token = {
  symbol: "USDC",
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  decimals: 6,
};

export const TOKENS: Token[] = [USDC, WETH];

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
 * 18-decimal tokens get more room because their fee slices are tiny.
 */
export function formatAmount(value: number, token: Token): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: token.decimals >= 18 ? 6 : 4,
  });
}
