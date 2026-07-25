"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbiParameters } from "viem";
import { TOKENS } from "./tokens";
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
  {
    type: "function",
    name: "demoPoolStats",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "totalSwaps", type: "uint256" },
      { name: "verifiedSwaps", type: "uint256" },
      { name: "unverifiedSwaps", type: "uint256" },
      { name: "verifiedInputVolume0", type: "uint256" },
      { name: "verifiedInputVolume1", type: "uint256" },
      { name: "unverifiedInputVolume0", type: "uint256" },
      { name: "unverifiedInputVolume1", type: "uint256" },
    ],
  },
] as const;

export const HOOK_ADDRESS = process.env.NEXT_PUBLIC_HOOK_ADDRESS as `0x${string}` | undefined;

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
const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 60;

const [CURRENCY0, CURRENCY1] = TOKENS.map((token) => token.address).sort((a, b) =>
  a.toLowerCase() < b.toLowerCase() ? -1 : 1,
);

export const DEMO_TOKEN0 = TOKENS.find((token) => token.address === CURRENCY0)!;
export const DEMO_TOKEN1 = TOKENS.find((token) => token.address === CURRENCY1)!;

/**
 * Mirrors PoolIdLibrary.toId: keccak256(abi.encode(poolKey)). PoolKey is fully
 * static, so encoding its five fields produces the same bytes as encoding the
 * Solidity struct.
 */
export function demoPoolId() {
  if (!HOOK_ADDRESS) return undefined;
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks"),
      [CURRENCY0, CURRENCY1, DYNAMIC_FEE_FLAG, TICK_SPACING, HOOK_ADDRESS],
    ),
  );
}

export interface DemoPoolStats {
  totalSwaps: bigint;
  verifiedSwaps: bigint;
  unverifiedSwaps: bigint;
  verifiedInputVolume0: bigint;
  verifiedInputVolume1: bigint;
  unverifiedInputVolume0: bigint;
  unverifiedInputVolume1: bigint;
}

export type DemoStatsState = "unconfigured" | "loading" | "live" | "error";

export function useDemoPoolStats() {
  const poolId = demoPoolId();
  const [stats, setStats] = useState<DemoPoolStats | null>(null);
  const [state, setState] = useState<DemoStatsState>(poolId ? "loading" : "unconfigured");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!HOOK_ADDRESS || !poolId) {
      setState("unconfigured");
      return;
    }

    try {
      const result = await publicClient.readContract({
        address: HOOK_ADDRESS,
        abi: hookAbi,
        functionName: "demoPoolStats",
        args: [poolId],
      });

      setStats({
        totalSwaps: result[0],
        verifiedSwaps: result[1],
        unverifiedSwaps: result[2],
        verifiedInputVolume0: result[3],
        verifiedInputVolume1: result[4],
        unverifiedInputVolume0: result[5],
        unverifiedInputVolume1: result[6],
      });
      setUpdatedAt(new Date());
      setState("live");
    } catch {
      setState("error");
    }
  }, [poolId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { stats, state, updatedAt, refresh, poolId };
}

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
