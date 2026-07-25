"use client";

import { useCallback, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, maxUint256, type Address } from "viem";
import { TARGET_CHAIN } from "./wallet";
import { TOKENS, type Token } from "./tokens";
import { erc20Abi } from "./erc20";
import type { LivenessAttestation, SignedAttestation } from "./attestation-types";

export const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS as Address | undefined;
const HOOK_ADDRESS = process.env.NEXT_PUBLIC_HOOK_ADDRESS as Address | undefined;

/// Must match the PoolKey that script/DeployPool.s.sol initialised, field for
/// field — v4 derives the pool id by hashing it, so any difference addresses a
/// pool that was never created.
const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 60;

/// TickMath bounds, nudged one tick inward. Passing the bound itself reverts.
const MIN_SQRT_PRICE_LIMIT = 4295128739n + 1n;
const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;

export const routerAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "key",
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
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "subject", type: "address" },
          { name: "validUntil", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/** Sent when the swapper holds no attestation; the router then omits it entirely. */
const NO_ATTESTATION: LivenessAttestation = {
  subject: "0x0000000000000000000000000000000000000000",
  validUntil: 0n,
  nonce: 0n,
};

/** v4 requires currency0 < currency1, compared as raw addresses. */
const [CURRENCY0, CURRENCY1] = TOKENS.map((t) => t.address).sort((a, b) =>
  a.toLowerCase() < b.toLowerCase() ? -1 : 1,
) as [Address, Address];

export function poolKey() {
  if (!HOOK_ADDRESS) throw new Error("NEXT_PUBLIC_HOOK_ADDRESS is not set");
  return {
    currency0: CURRENCY0,
    currency1: CURRENCY1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS,
  } as const;
}

/** True when `token` is the pool's currency0, i.e. paying it is a 0 -> 1 swap. */
export function isCurrency0(token: Token) {
  return token.address.toLowerCase() === CURRENCY0.toLowerCase();
}

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

export type SwapStage = "idle" | "approving" | "swapping" | "done" | "error";

export interface SwapArgs {
  account: Address;
  tokenIn: Token;
  amountIn: bigint;
  /** Reverts the swap if the output falls below this. 0 disables the check. */
  amountOutMinimum: bigint;
  /** Minutes from now. */
  deadlineMinutes: number;
  /**
   * Held attestation, or null to swap at the full fee. An invalid or expired one
   * costs the discount but never reverts the swap.
   */
  attestation: SignedAttestation | null;
}

/**
 * Executes a swap through ProofPoolRouter — never the Universal Router. The hook
 * only honours an identity claim forwarded by its trusted router, so a swap sent
 * any other way is priced at the unverified tier regardless of registration.
 */
export function useSwap() {
  const [stage, setStage] = useState<SwapStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const swap = useCallback(async (
    { account, tokenIn, amountIn, amountOutMinimum, deadlineMinutes, attestation }: SwapArgs,
  ) => {
    setError(null);
    setTxHash(null);

    try {
      if (!ROUTER_ADDRESS) throw new Error("NEXT_PUBLIC_ROUTER_ADDRESS is not set");
      const provider = window.ethereum;
      if (!provider) throw new Error("No injected wallet found");

      const walletClient = createWalletClient({
        account,
        chain: TARGET_CHAIN,
        transport: custom(provider),
      });

      // The router settles by pulling the input token straight from the payer,
      // so the allowance has to be granted to the router itself, not Permit2.
      const allowance = await publicClient.readContract({
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, ROUTER_ADDRESS],
      });

      if (allowance < amountIn) {
        setStage("approving");
        const approveHash = await walletClient.writeContract({
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [ROUTER_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setStage("swapping");
      const zeroForOne = isCurrency0(tokenIn);

      const hash = await walletClient.writeContract({
        address: ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [
          {
            key: poolKey(),
            zeroForOne,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT,
            deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60),
          },
          attestation?.attestation ?? NO_ATTESTATION,
          // An empty signature is the router's signal to send the identity alone,
          // which keeps an unverified swap off the attestation calldata path.
          attestation?.signature ?? "0x",
        ],
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Swap transaction reverted");

      setStage("done");
      return hash;
    } catch (err) {
      setStage("error");
      const message = err instanceof Error ? err.message : "Swap failed";
      // Wallet rejections arrive as a long RPC dump; keep the useful line only.
      setError(/User rejected|denied transaction/i.test(message) ? "Rejected in your wallet." : message.split("\n")[0]);
      return null;
    }
  }, []);

  return { swap, stage, error, txHash, reset, isBusy: stage === "approving" || stage === "swapping" };
}
