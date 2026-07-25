"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { TARGET_CHAIN } from "./wallet";
import type { Token } from "./tokens";
import { isCurrency0, poolKey } from "./swap";

/// Canonical V4Quoter on Sepolia. Overridable for other networks.
const QUOTER_ADDRESS = (process.env.NEXT_PUBLIC_QUOTER_ADDRESS ??
  "0x61b3f2011a92d183c7dbadbda940a7555ccf9227") as Address;

/// v4 fees are hundredths of a bip, so 1_000_000 is 100%.
const FEE_DENOMINATOR = 1_000_000n;

export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

export type QuoteState = "idle" | "loading" | "ready" | "error";

/**
 * Simulates the swap against the live pool.
 *
 * The number that comes back is always priced at the *unverified* tier: the
 * quoter calls `_beforeSwap` with itself as `sender`, and the hook only honours
 * an identity claim forwarded by TRUSTED_ROUTER. So this is a lower bound on
 * what a verified wallet receives — which is exactly what makes it safe to build
 * a minimum-output floor from. See `applyVerifiedDiscount` for the display side.
 */
export function useQuote(tokenIn: Token, amountIn: bigint | null) {
  const [amountOut, setAmountOut] = useState<bigint | null>(null);
  const [state, setState] = useState<QuoteState>("idle");

  const zeroForOne = isCurrency0(tokenIn);
  const key = amountIn === null ? null : `${tokenIn.symbol}:${amountIn.toString()}`;

  useEffect(() => {
    if (amountIn === null || amountIn <= 0n) {
      setAmountOut(null);
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");

    // Debounced: the amount changes on every keystroke and each quote is an
    // eth_call against the pool.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { result } = await publicClient.simulateContract({
            address: QUOTER_ADDRESS,
            abi: quoterAbi,
            functionName: "quoteExactInputSingle",
            args: [{ poolKey: poolKey(), zeroForOne, exactAmount: amountIn, hookData: "0x" }],
          });
          if (cancelled) return;
          setAmountOut(result[0]);
          setState("ready");
        } catch {
          if (cancelled) return;
          setAmountOut(null);
          setState("error");
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` collapses token+amount into one primitive so bigint identity doesn't
    // retrigger the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, zeroForOne]);

  return { amountOut, state };
}

/**
 * Scales a quote priced at `unverifiedFee` up to what `verifiedFee` would yield.
 *
 * v4 takes the fee off the input before it reaches the curve, so a lower fee
 * means more input actually gets swapped. Output scales with that effective
 * input, which makes this exact only while price impact is negligible — it
 * ignores the extra ticks the slightly larger input might cross. For demo-sized
 * swaps the error is far below display precision, but this is an estimate, and
 * the UI says so rather than presenting it as a quote.
 */
export function applyVerifiedDiscount(quoted: bigint, verifiedFee: number, unverifiedFee: number): bigint {
  return (quoted * (FEE_DENOMINATOR - BigInt(verifiedFee))) / (FEE_DENOMINATOR - BigInt(unverifiedFee));
}

/** Minimum acceptable output for a given slippage tolerance, in percent. */
export function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100)); // percent -> bips
  return (amountOut * (10_000n - bps)) / 10_000n;
}
