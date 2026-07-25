import type { Address } from "viem";

/** Minimal ABI slice for the reads this app actually makes. */
export const registryAbi = [
  {
    // The authoritative check — the same call the hook makes. Unlike a bare
    // usageCount/swapsRemaining read, this verifies the signature, the signer,
    // the expiry and that the attestation belongs to this wallet.
    type: "function",
    name: "discountFor",
    stateMutability: "view",
    inputs: [
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
      { name: "swapper", type: "address" },
    ],
    outputs: [
      { name: "discounted", type: "bool" },
      { name: "digest", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "usageCount",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "swapsRemaining",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxSwaps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Registry address, exposed to the browser. Every call the app makes is a view,
 * and the signing key never leaves the server, so there is nothing sensitive in
 * shipping this.
 */
export const PUBLIC_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as Address | undefined;
