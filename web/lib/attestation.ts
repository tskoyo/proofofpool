"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hashTypedData, type Address, type Hex } from "viem";
import { TARGET_CHAIN } from "./wallet";
import {
  ATTESTATION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  deserializeAttestation,
  serializeAttestation,
  type LivenessAttestation,
  type SerializedAttestation,
  type SignedAttestation,
} from "./attestation-types";

export const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS as Address | undefined;

const STORAGE_KEY = "proofpool.attestation";

/**
 * The EIP-712 digest — the key Registry counts discounted swaps against.
 *
 * Derived client-side rather than read from the oracle so the UI can show swaps
 * remaining without a round trip. Domain fields must match
 * `EIP712("ProofPool", "1")` and the oracle's own address exactly, or this
 * produces a digest the contract never counted.
 */
export function attestationDigest(attestation: LivenessAttestation): Hex | null {
  if (!ORACLE_ADDRESS) return null;
  return hashTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: TARGET_CHAIN.id,
      verifyingContract: ORACLE_ADDRESS,
    },
    types: ATTESTATION_TYPES,
    primaryType: "LivenessAttestation",
    message: attestation,
  });
}

export function isExpired(attestation: LivenessAttestation): boolean {
  return BigInt(Math.floor(Date.now() / 1000)) > attestation.validUntil;
}

interface AttestationContextValue {
  attestation: SignedAttestation | null;
  setAttestation: (next: SignedAttestation) => void;
  clear: () => void;
}

const AttestationContext = createContext<AttestationContextValue | null>(null);

interface StoredShape {
  attestation: SerializedAttestation;
  signature: Hex;
}

/**
 * Holds the signed attestation for the session.
 *
 * Kept in React state so it survives client-side navigation from /verify to
 * /swap, and mirrored to sessionStorage so a page refresh mid-demo doesn't force
 * another Selfie Check. Deliberately not localStorage: the attestation is bound
 * to one subject, expires, and is usage-capped, so a stolen copy is close to
 * worthless — but there is no reason to keep it past the tab either.
 */
export function AttestationProvider({ children }: { children: ReactNode }) {
  const [attestation, setAttestationState] = useState<SignedAttestation | null>(null);

  // Rehydrate after mount only — sessionStorage doesn't exist during SSR, and
  // reading it during render would desync hydration.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredShape;
      const restored = {
        attestation: deserializeAttestation(parsed.attestation),
        signature: parsed.signature,
      };
      // Drop it rather than restore something the pool would reject anyway.
      if (isExpired(restored.attestation)) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      setAttestationState(restored);
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const setAttestation = useCallback((next: SignedAttestation) => {
    setAttestationState(next);
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ attestation: serializeAttestation(next.attestation), signature: next.signature }),
      );
    } catch {
      // Private-mode or quota failure: in-memory state still works for this page.
    }
  }, []);

  const clear = useCallback(() => {
    setAttestationState(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  const value = useMemo(() => ({ attestation, setAttestation, clear }), [attestation, setAttestation, clear]);

  return createElement(AttestationContext.Provider, { value }, children);
}

export function useAttestation() {
  const ctx = useContext(AttestationContext);
  if (!ctx) throw new Error("useAttestation must be used inside AttestationProvider");
  return ctx;
}

/**
 * The attestation for `address`, or null.
 *
 * An attestation issued to a different wallet is treated as absent: Registry
 * checks `subject == swapper` on-chain, so presenting it would silently fall
 * back to the full fee rather than fail visibly.
 */
export function useAttestationFor(address: Address | null) {
  const { attestation, clear } = useAttestation();

  // Memoised because callers put this in dependency arrays. Returning a fresh
  // object each render would recreate their callbacks, refire their effects,
  // and loop contract reads forever.
  return useMemo(() => {
    if (!attestation || !address) return null;
    if (attestation.attestation.subject.toLowerCase() !== address.toLowerCase()) return null;
    if (isExpired(attestation.attestation)) return null;
    return { ...attestation, clear };
  }, [attestation, address, clear]);
}
