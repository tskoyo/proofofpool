"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { PUBLIC_REGISTRY_ADDRESS, registryAbi } from "./registry";
import { TARGET_CHAIN } from "./wallet";

// Falls back to the chain's default public RPC when NEXT_PUBLIC_RPC_URL is unset,
// which is enough for a `view` call but rate-limited — set the env var for a demo.
const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

export type VerificationState = "unconfigured" | "idle" | "checking" | "verified" | "unverified" | "error";

/**
 * Reads `Registry.isVerifiedHuman(address)` — the same boolean the Uniswap hook
 * reads on every swap to pick the fee tier. This is the real status, not a
 * client-side guess: if it says verified, the pool charges the low fee.
 */
export function useVerificationStatus(address: Address | null) {
  const [state, setState] = useState<VerificationState>("idle");

  const check = useCallback(async (): Promise<boolean | null> => {
    if (!PUBLIC_REGISTRY_ADDRESS) {
      setState("unconfigured");
      return null;
    }
    if (!address) {
      setState("idle");
      return null;
    }

    setState("checking");
    try {
      const verified = await publicClient.readContract({
        address: PUBLIC_REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: "isVerifiedHuman",
        args: [address],
      });
      setState(verified ? "verified" : "unverified");
      return verified;
    } catch {
      setState("error");
      return null;
    }
  }, [address]);

  useEffect(() => {
    void check();
  }, [check]);

  return {
    state,
    isVerified: state === "verified",
    isConfigured: Boolean(PUBLIC_REGISTRY_ADDRESS),
    refresh: check,
  };
}
