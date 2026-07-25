// Minimal ABI slice for the calls this app actually makes.
export const registryAbi = [
  {
    type: "function",
    name: "registerVerifiedHuman",
    stateMutability: "nonpayable",
    inputs: [
      { name: "signal", type: "address" },
      { name: "nullifierHash", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nullifierHashes",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isVerifiedHuman",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Server-side only — used by the attester route to write registrations. */
export const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS as `0x${string}`;

/**
 * Same contract, exposed to the browser so the UI can read verification status
 * directly. Reads are public, so there is nothing sensitive in shipping this;
 * the attester key stays server-side.
 */
export const PUBLIC_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined;
