"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { TARGET_CHAIN } from "./wallet";

export const hookAbi = [
  {
    type: "function",
    name: "VERIFIED_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "function",
    name: "UNVERIFIED_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
] as const;

const HOOK_ADDRESS = process.env.NEXT_PUBLIC_HOOK_ADDRESS as `0x${string}` | undefined;

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

/**
 * The values compiled into `src/ProofPoolHook.sol`. Used only until
 * NEXT_PUBLIC_HOOK_ADDRESS points at a deployment — the UI says which of the two
 * it's showing rather than passing these off as live readings.
 */
const SOURCE_DEFAULTS = { verified: 500, unverified: 3000 } as const;

export type FeeSource = "chain" | "source-defaults" | "error";

/** v4 fees are hundredths of a bip: 3000 = 0.30%. */
export function formatFee(fee: number): string {
  const percent = fee / 10_000;
  return `${percent.toFixed(percent < 0.01 ? 4 : 2)}%`;
}

/** What this fee costs on `amount` of the input token, in that same token. */
export function feeCost(amount: number, fee: number): number {
  return (amount * fee) / 1_000_000;
}

/**
 * Reads VERIFIED_FEE and UNVERIFIED_FEE from the deployed hook. These are the
 * exact constants `_beforeSwap` uses to price a swap, so what the UI shows is
 * what the pool charges.
 */
export function useFeeTiers() {
  const [verified, setVerified] = useState<number>(SOURCE_DEFAULTS.verified);
  const [unverified, setUnverified] = useState<number>(SOURCE_DEFAULTS.unverified);
  const [source, setSource] = useState<FeeSource>(HOOK_ADDRESS ? "chain" : "source-defaults");

  useEffect(() => {
    if (!HOOK_ADDRESS) {
      setSource("source-defaults");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [v, u] = await Promise.all([
          publicClient.readContract({ address: HOOK_ADDRESS, abi: hookAbi, functionName: "VERIFIED_FEE" }),
          publicClient.readContract({ address: HOOK_ADDRESS, abi: hookAbi, functionName: "UNVERIFIED_FEE" }),
        ]);
        if (cancelled) return;
        setVerified(Number(v));
        setUnverified(Number(u));
        setSource("chain");
      } catch {
        if (!cancelled) setSource("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    verifiedFee: verified,
    unverifiedFee: unverified,
    verifiedLabel: formatFee(verified),
    unverifiedLabel: formatFee(unverified),
    source,
    isLive: source === "chain",
  };
}
