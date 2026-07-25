"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { TARGET_CHAIN } from "./wallet";
import { TOKENS, type Token } from "./tokens";

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

/** Raw base-unit balance per token symbol. */
export type Balances = Record<string, bigint>;

/**
 * Balances for every token in the pair, in base units. Kept raw rather than
 * pre-formatted so callers can compare against a swap amount without going
 * through a lossy float.
 */
export function useBalances(address: Address | null) {
  const [balances, setBalances] = useState<Balances>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalances({});
      return;
    }

    setLoading(true);
    try {
      const results = await Promise.all(
        TOKENS.map((token) =>
          publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
        ),
      );
      setBalances(Object.fromEntries(TOKENS.map((t, i) => [t.symbol, results[i]])));
    } catch {
      // A failed read shouldn't blank the UI — keep the last known values.
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balances, loading, refresh };
}

/** Base units -> display string, without going through a float. */
export function formatUnits(value: bigint, token: Token, maxFractionDigits = 6): string {
  const base = 10n ** BigInt(token.decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === 0n) return whole.toLocaleString("en-US");

  const padded = fraction.toString().padStart(token.decimals, "0").slice(0, maxFractionDigits);
  const trimmed = padded.replace(/0+$/, "");
  return trimmed ? `${whole.toLocaleString("en-US")}.${trimmed}` : whole.toLocaleString("en-US");
}

/** Display string -> base units. Returns null if the input isn't a valid amount. */
export function parseUnits(value: string, token: Token): bigint | null {
  if (!/^\d*\.?\d*$/.test(value.trim()) || value.trim() === "" || value.trim() === ".") return null;

  const [whole = "0", fraction = ""] = value.trim().split(".");
  if (fraction.length > token.decimals) return null;

  return BigInt(whole || "0") * 10n ** BigInt(token.decimals) + BigInt(fraction.padEnd(token.decimals, "0") || "0");
}
