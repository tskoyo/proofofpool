"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { PUBLIC_REGISTRY_ADDRESS, registryAbi } from "./registry";
import { TARGET_CHAIN } from "./wallet";
import { attestationDigest, useAttestationFor } from "./attestation";

const publicClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

export type VerificationState =
  | "unconfigured"
  | "idle"
  /** No attestation held for this wallet, or it expired. */
  | "unverified"
  | "checking"
  /** Attestation is valid and still has discounted swaps left. */
  | "verified"
  /** Attestation is still in date but the swap cap is spent. */
  | "exhausted"
  | "error";

/**
 * Whether the connected wallet currently gets the discounted fee.
 *
 * Two limits, both of which must hold — the same AND the contract applies:
 * the attestation must be unexpired (checked here from `validUntil`) and under
 * the swap cap (read from Registry). Whichever runs out first ends the discount.
 */
export function useVerificationStatus(address: Address | null) {
  const held = useAttestationFor(address);
  const [state, setState] = useState<VerificationState>("idle");
  const [swapsRemaining, setSwapsRemaining] = useState<bigint | null>(null);

  const digest = held ? attestationDigest(held.attestation) : null;
  const validUntil = held?.attestation.validUntil ?? null;

  const check = useCallback(async (): Promise<void> => {
    if (!PUBLIC_REGISTRY_ADDRESS) {
      setState("unconfigured");
      return;
    }
    if (!address) {
      setState("idle");
      return;
    }
    if (!held || !digest) {
      setSwapsRemaining(null);
      setState("unverified");
      return;
    }

    setState("checking");
    try {
      // Ask the contract the same question the hook will ask. A bare
      // swapsRemaining(digest) read only counts a mapping slot — it verifies
      // nothing, so a tampered sessionStorage entry or a rotated trusted signer
      // would leave the UI claiming a discount the pool won't honour.
      const [[discounted], remaining] = await Promise.all([
        publicClient.readContract({
          address: PUBLIC_REGISTRY_ADDRESS,
          abi: registryAbi,
          functionName: "discountFor",
          args: [held.attestation, held.signature, address],
        }),
        publicClient.readContract({
          address: PUBLIC_REGISTRY_ADDRESS,
          abi: registryAbi,
          functionName: "swapsRemaining",
          args: [digest],
        }),
      ]);

      setSwapsRemaining(remaining);
      if (discounted) {
        setState("verified");
      } else {
        // Distinguish "allowance spent" from "signature no longer accepted", so
        // the UI can tell the user to verify again rather than leaving them
        // guessing why their swaps cost more.
        setState(remaining === 0n ? "exhausted" : "unverified");
      }
    } catch {
      setState("error");
    }
  }, [address, digest, held]);

  useEffect(() => {
    void check();
  }, [check]);

  // Expiry is a wall-clock event, not a render event. Without this a tab left
  // open past validUntil keeps showing the discounted tier while the pool has
  // already moved the wallet to the full fee. Re-check the moment it lapses.
  useEffect(() => {
    if (!validUntil) return;

    const msUntilExpiry = Number(validUntil) * 1000 - Date.now();
    if (msUntilExpiry <= 0) {
      void check();
      return;
    }

    // setTimeout clamps above ~24.8 days; cap so a long TTL can't overflow into
    // firing immediately.
    const delay = Math.min(msUntilExpiry + 1000, 2 ** 31 - 1);
    const timer = setTimeout(() => void check(), delay);
    return () => clearTimeout(timer);
  }, [validUntil, check]);

  return {
    state,
    isVerified: state === "verified",
    swapsRemaining,
    validUntil,
    isConfigured: Boolean(PUBLIC_REGISTRY_ADDRESS),
    refresh: check,
  };
}
