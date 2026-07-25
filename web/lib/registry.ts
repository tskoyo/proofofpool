// Minimal ABI slice for the calls the backend actually makes.
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
] as const;

export const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS as `0x${string}`;
