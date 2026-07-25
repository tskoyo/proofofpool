# ProofPool identity routing

The Uniswap v4 `sender` supplied to a swap hook is the immediate caller of
`PoolManager.swap`. For normal swaps this is a shared router, not the wallet
that initiated the transaction. ProofPool must therefore authenticate the
wallet identity separately before granting the verified fee.

## Current MVP: trusted ProofPool router

`ProofPoolRouter` is the only router whose hook data is trusted.

1. The user calls `ProofPoolRouter.exactInputSingle`.
2. The router fixes the identity, token payer, and output recipient to
   `msg.sender`. Callers cannot provide any of those values.
3. The router encodes `msg.sender` into the hook data and calls the PoolManager.
4. `ProofPoolHook` accepts the encoded identity only when the hook callback's
   `sender` is the immutable trusted-router address.
5. All other routers remain permissionless, but receive the unverified fee
   even if they place a verified wallet address in their hook data.

The first router version intentionally supports exact-input ERC-20 swaps only.
Native-token support, exact-output swaps, multihop routing, and arbitrary
recipients should be added only with tests that preserve the identity/payer
binding.

To swap, the wallet first approves the input ERC-20 directly to
`ProofPoolRouter`, then calls `exactInputSingle` with the pool key, direction,
input amount, minimum output, price limit, and deadline. The router does not
use Permit2 in this MVP.

### Trust boundary

The router is security-critical. A future router change must never allow the
caller to choose an unrelated verified identity or make a different account
pay for a low-fee swap. New trusted routers require a new hook deployment
because the trusted-router address is immutable.

## Event surface for indexers

`ProofPoolHook.SwapPriced` is the protocol's data contract, not incidental
logging. The hook keeps no aggregates and `Registry` stores only a per-digest
count, so the verified/unverified split and the fee premium anonymous flow pays
LPs exist *only* in these logs. Its fields are asserted in
`ProofOfPoolHook.t.sol` for that reason — a silent field change would surface as
wrong analytics rather than a failing build.

```solidity
event SwapPriced(
    PoolId indexed poolId,
    address indexed swapper,
    bool verified,
    uint24 feeApplied,
    bool zeroForOne,
    int256 amountSpecified,
    bytes32 digest
);
```

- `poolId` — one hook deployment can serve several pools. Consumers must filter
  on it rather than assume a single pool.
- `swapper` — only meaningful for swaps through `TRUSTED_ROUTER`. Otherwise it
  is the calling router, which is also why such a swap is never verified.
- `zeroForOne` — `amountSpecified`'s sign gives exact-input vs exact-output, not
  direction. Without this an indexer cannot tell which currency the amount is
  denominated in.
- `digest` — the attestation that paid for the discount, or zero when
  unverified. Joins to `Registry.DiscountedSwapRecorded(digest, newCount)`.
  Because the digest commits to `subject`, and the nonce derives from
  `HMAC(nullifier, epoch)`, distinct non-zero digests approximate the number of
  Selfie Checks actually converted into swaps — the only on-chain proxy for a
  verification funnel, since verification itself never touches the chain.

### What is deliberately absent

**Settled amounts.** `amountSpecified` is the *requested* amount, read in
`beforeSwap`. Emitting settled deltas would mean enabling `afterSwap`, which
would have to re-verify the attestation to know what it priced — a second
signature recovery on every swap. Instead, indexers join to `PoolManager`'s own
`Swap` event on transaction and pool id, which carries the settled deltas and
the applied fee. The same join is what captures swaps that bypass
`ProofPoolRouter` entirely: those reach `beforeSwap`, so `SwapPriced` fires with
the router as `swapper` and `verified == false`, but no `SwapExecuted` is
emitted and their amounts are only available from `PoolManager`.

**Verification events.** The backend never sends a transaction, so nothing
records an attestation being *issued* — only its use. An indexer can count
discounts taken, never verifications attempted or abandoned.

## Planned upgrade: signed hook data

The intended composable design accepts a per-swap authorization signed by the
verified wallet instead of trusting one router. Its hook data should include:

- verified account;
- chain ID, hook address, and pool ID;
- swap direction, amount, and price limit;
- authorized payer and recipient;
- nonce and deadline;
- an EIP-712 signature, with ERC-1271 support for smart accounts.

The hook must consume the nonce and reject expired or replayed authorizations.
The signed account must also be bound to the assets funding the swap and to the
recipient; a signature that merely says "this address is verified" is a
copyable bearer credential and is not sufficient.

This signed-hook-data path is the target architecture once compatibility with
multiple routers or aggregators becomes more important than MVP simplicity.
