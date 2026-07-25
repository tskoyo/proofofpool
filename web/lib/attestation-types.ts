import type { Address, Hex } from "viem";

/**
 * Mirrors `LivenessAttestation` in src/LivenessOracle.sol. The field order here
 * is the EIP-712 type definition, so it must match the Solidity struct exactly —
 * reordering changes the digest and every signature stops verifying.
 */
export interface LivenessAttestation {
  subject: Address;
  /** Unix seconds. */
  validUntil: bigint;
  nonce: bigint;
}

export interface SignedAttestation {
  attestation: LivenessAttestation;
  signature: Hex;
}

/** EIP-712 domain, matching `EIP712("ProofPool", "1")` in LivenessOracle. */
export const EIP712_DOMAIN_NAME = "ProofPool";
export const EIP712_DOMAIN_VERSION = "1";

export const ATTESTATION_TYPES = {
  LivenessAttestation: [
    { name: "subject", type: "address" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** JSON has no bigint, so the wire format carries these as decimal strings. */
export interface SerializedAttestation {
  subject: Address;
  validUntil: string;
  nonce: string;
}

export function serializeAttestation(a: LivenessAttestation): SerializedAttestation {
  return { subject: a.subject, validUntil: a.validUntil.toString(), nonce: a.nonce.toString() };
}

export function deserializeAttestation(a: SerializedAttestation): LivenessAttestation {
  return { subject: a.subject, validUntil: BigInt(a.validUntil), nonce: BigInt(a.nonce) };
}
