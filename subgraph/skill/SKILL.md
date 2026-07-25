---
name: proofpool-analytics
description: Query and reason over the ProofPool Uniswap v4 pool's Subgraph. Use whenever the user asks about ProofPool, its pool, swaps or swappers; whether an address looks automated, bot-like or human; how much extra fee anonymous flow paid LPs; or how World ID attestation allowances are being spent.
---

# ProofPool analytics

Answer questions about ProofPool by querying its Subgraph and reasoning over
what comes back. The data is small enough to interpret directly — the hard part
is knowing what the numbers *mean*, which is most of what this skill carries.

## What ProofPool is

A Uniswap v4 hook that charges two fee tiers on the same pool:

| | Fee | Who |
|---|---|---|
| Verified | 500 (0.05%) | wallet presented a valid World ID liveness attestation |
| Unverified | 3000 (0.30%) | everyone else |

The premium unverified flow pays goes to liquidity providers through v4's normal
fee accounting. The thesis is that anonymous flow should cost more, and the
question the data answers is whether that is actually happening.

**"Verified" means a live human authorised that swap. It does not mean a unique
human.** Nothing binds a World nullifier to one wallet, so the same person can
verify any number of addresses. Never describe a verified wallet as a
distinct or unique person.

A discount holds while **both** limits hold: the attestation is inside its
expiry, and under `maxSwaps` uses. Whichever runs out first ends it.

## The endpoint

```
https://api.studio.thegraph.com/query/1756994/proof-pool-sepolia/0.1.1
```

Ethereum Sepolia. Query with a plain POST:

```bash
curl -s -X POST <endpoint> -H 'content-type: application/json' \
  -d '{"query":"{ pools { totalSwaps verifiedSwaps unverifiedSwaps } }"}'
```

The URL is version-pinned. If it 404s the subgraph has been redeployed — ask the
user for the current endpoint rather than guessing a version number.

## Schema

**`Pool`** — one per pool, with running totals.
`id`, `currency0`, `currency1`, `hook`, `fee`, `tickSpacing`, `swaps`,
`totalSwaps`, `verifiedSwaps`, `unverifiedSwaps`,
`verifiedVolume0`, `verifiedVolume1`, `unverifiedVolume0`, `unverifiedVolume1`

**`Swap`** — one per priced swap.
`id`, `pool`, `swapper`, `verified`, `feeApplied`, `zeroForOne`,
`amountSpecified`, `digest`, `usageRecord`, `tokenIn`, `tokenOut`, `amountIn`,
`amountOut`, `routerExecuted`, `blockNumber`, `timestamp`, `transactionHash`

**`Swapper`** — one per address. `id`, `totalSwaps`, `verifiedSwaps`, `swaps`

**`SwapRecord`** — one per attestation, keyed by EIP-712 digest.
`id`, `usageCount`, `swaps`, `uses`

**`DiscountedSwapUse`** — one per discounted swap, in order.
`id`, `record`, `digest`, `newCount`, `transactionHash`, `blockNumber`, `timestamp`

**`RegistryConfig`** — `id`, `hook`, `maxSwaps`

**`TransactionPoolCursor`** — internal scratch the mapping uses to join Hook and
Router events inside a transaction. Queryable, but carries no analytical
meaning. Ignore it.

**`SwapRecord.swaps` vs `SwapRecord.uses`** — the same events from two sides.
`uses` is the Registry's log, with the running count and timestamps: use it for
cadence and allowance burn. `swaps` is the Hook's, with amounts, direction and
pool: use it for value, and it is the only route from an attestation back to a
wallet. The two should be the same length; a divergence means the index is
broken, not that something interesting happened.

**IDs do not join across contracts.** `Swap.id` and `DiscountedSwapUse.id` are
both transaction hash + log index, but different log indices within the same
transaction, so they never match. Join on `digest`, or through
`Swap.usageRecord`.

`_meta { block { number } hasIndexingErrors }` tells you how far the subgraph has
synced. Check it when a user reports something missing — the answer is often
that the subgraph is behind, not that the data is absent.

## Reading the fields correctly

These are the traps. Getting them wrong produces confident wrong answers.

**`amountSpecified` is signed and is the *requested* amount.** Negative means
exact-input, so the input amount is its absolute value. Positive means
exact-output. It is read before the swap executes, so it is not what settled.

**`amountIn` / `amountOut` are settled, and are null unless
`routerExecuted: true`.** Only swaps through ProofPool's own router emit them.
A swap with `routerExecuted: false` still has a fee tier and a requested amount,
but no settled figures — say so rather than treating null as zero.

**Volume totals on `Pool` are requested exact-input amounts**, in raw token
units, split by which currency was paid in. Exact-output swaps are counted in
`totalSwaps` but contribute no volume. Denominate carefully: `*Volume0` is in
currency0's decimals, `*Volume1` in currency1's.

**`digest` is `0x000…0` for unverified swaps.** A non-zero digest identifies the
attestation that paid for the discount, and joins to `SwapRecord`.

**`swapper` is the initiating account only when `verified: true` or
`routerExecuted: true`.** Either flag means the address paid for and received the
swap: the Registry rejects any attestation whose `subject` is not the swapper,
and the router always reports its own caller. When neither is true, `swapper` is
whatever contract called PoolManager — an aggregator, a periphery contract,
another router — and you cannot tell a wallet from a contract. Never read a high
`totalSwaps` there as a busy trader; that is how an aggregator ends up looking
like a textbook bot.

Note this is *initiating account*, not *human*. A contract can call the router,
and a contract can hold an attestation issued to its own address.

**Timestamps are Unix seconds as strings.** Convert before doing arithmetic.

## Answering "is this address a bot?"

This is the most common analytical question, and the honest answer is always
probabilistic. You are looking at trading behaviour, not identity.

**On the demo deployment the history is seeded synthetic traffic** — wallets
scripted into behavioural archetypes. Say so when presenting a conclusion about
any wallet; see [One thing to disclose](#one-thing-to-disclose). The detection is
real, the traders were planted.

Pull the wallet's swaps in time order:

```graphql
{
  swapper(id: "0x...") {
    totalSwaps
    verifiedSwaps
    swaps(first: 100, orderBy: timestamp, orderDirection: asc) {
      timestamp
      verified
      feeApplied
      amountSpecified
      amountIn
      zeroForOne
      digest
    }
  }
}
```

Address ids are lowercase hex. If `swapper` returns null, try lowercasing before
concluding the address never traded.

### Read the configuration first — it changes what everything means

Before interpreting anything, get `maxSwaps`:

```graphql
{ registryConfigs { maxSwaps hook } }
```

`maxSwaps` is how many discounted swaps one attestation buys, and each
attestation required a **live Selfie Check** — a real face, at that moment,
which is the one thing in this system that cannot be scripted. So `maxSwaps` is
effectively *the number of swaps a wallet may automate per proven human
presence*.

That single number rescales the whole analysis:

| `maxSwaps` | What 20 verified swaps means |
|---|---|
| 1 | 20 separate live selfies. Very hard to fake. Strong human signal. |
| 10 | 2 verifications. A human verified twice; a script could have done the rest. |
| 0 (uncapped) | Expiry alone bounds it. Verification count says little. |

Count the wallet's **distinct non-zero `digest` values** — that is how many times
a human actually stood in front of a camera for it. `verifiedSwaps ÷ distinct
digests` tells you how much automation each human moment authorised. And because
the backend issues at most one attestation per wallet per epoch, distinct digests
also tell you across how many separate time windows that person showed up.

**`maxSwaps` is often null, and that is expected.** The Registry's constructor
sets the initial cap without emitting `MaxSwapsUpdated`, so until an owner
changes it there is no event for the subgraph to index. Null means *not
observed*, not *uncapped* — uncapped is the value `0`, which is a real setting.

When it is null, either ask the user what the cap is, or read it from the
Registry directly if you have chain access:

```bash
cast call <registry> "maxSwaps()(uint256)" --rpc-url <sepolia rpc>
```

Do not proceed as if the cap were 1 or 10 — the difference between those two
readings flips a wallet from "clearly a person" to "a person with a script", and
guessing it silently is the worst failure this skill can have. Say the cap is
unknown, give the reasoning both ways if it matters, and ask.

### Then weigh the behavioural evidence

**Direction pattern.** Strict alternation (buy, sell, buy, sell) or an unvarying
direction across many swaps is mechanical. Humans do not alternate perfectly.
This is usually the clearest signal in the data, and unlike timing it does not
degrade with network conditions.

**Amount uniformity — compare per direction, not across all swaps.** The two
currencies have different decimals, so the *same* trade size appears as two
different raw numbers depending on which way it went. A wallet swapping 10
MyUSDC one way and the equivalent 0.0001 MyWBTC back shows `amountSpecified`
values of `10000000` and `10000`, which looks varied and is in fact perfectly
uniform. Group by `zeroForOne` first, then look for repetition inside each group.

**Interval regularity — weaker than it looks.** Near-constant gaps are strong
evidence, but irregular gaps prove very little. Scripted traders pause, batch,
get rate-limited, and stop overnight, so a wallet with gaps of 190s, 290s and
950s can easily be automated. Treat tight regularity as confirming and
irregularity as uninformative, not as exculpatory. Report actual numbers either
way, and be honest that the sample is usually small.

**Verification behaviour — the only signal that cuts both ways.** Everything
else is circumstantial; this one has a live human behind it.

*Frequent verification is positive evidence of a human*, weighted by `maxSwaps`
as above. A wallet with many distinct digests spread across many epochs is
someone repeatedly choosing to pass a liveness check. Under a tight cap that is
close to dispositive, and it should override moderate regularity elsewhere — a
person trading on a schedule still looks periodic.

*Never verifying is much weaker in the other direction.* It is consistent with
automation, but a selfie for a fee discount is a trade plenty of humans decline.
Do not treat an unverified wallet as presumed automated.

The precise claim, which is worth stating rather than blurring: verification
proves a human authorised the swap, not that a human *executed* it. Someone can
verify and let a script spend the allowance. So high verification under a tight
cap rules out an unattended bot; it does not rule out a person running tooling.

**Duration and volume.** Many swaps over a long window matters more than a burst
of five. With fewer than about ten swaps, say plainly that the sample is too
small to characterise, and give what the data does show instead of stretching.

### Synthesise, do not tally

These are not a checklist to score. Weigh them against each other and against
the configuration, and let the strongest evidence lead. Two examples of the
reasoning actually mattering:

- Mostly-verified swaps, irregular intervals, `maxSwaps: 1` → almost certainly a
  human. Every discounted swap needed its own selfie, and the timing is
  unremarkable. Say so with confidence; hedging here is its own kind of wrong.
- Mostly-verified swaps, rigid alternation, `maxSwaps: 10` → a human verifying
  occasionally while something automated trades in between. That is a more
  interesting answer than either "human" or "bot", and the data supports it.

State the conclusion as a likelihood with the evidence attached, and say what
would change it:

> Consistent with a scripted trader. Five swaps, strictly alternating direction,
> identical size within each direction (10 MyUSDC out, 0.0001 MyWBTC back),
> never verified. Intervals varied (192–948s), which neither supports nor
> undercuts this — scripts pause. Five swaps is a small sample; a longer history
> with the same alternation would make it firmer. Note this describes the flow,
> not the person: a human running a trading bot produces exactly this.

That is a useful answer. "This is a bot" is not, and neither is a refusal to
engage.

**What you cannot conclude from this data:** that an address is not a human;
that two addresses are the same person (nothing links them); that a wallet is
malicious. Bot-like flow is not wrongdoing — ProofPool prices it, it does not
accuse it.

## Other common questions

**"How much extra did anonymous flow pay LPs?"** The premium is the fee
difference on unverified volume: `unverifiedVolume × (3000 − 500) / 1_000_000`,
per currency, in raw units. Convert with the token's decimals before presenting.
Say it is based on requested exact-input volume, which excludes exact-output
swaps.

**"What share of activity is verified?"** `verifiedSwaps / totalSwaps` for
count, and the volume fields for value. Give both — they usually differ, and the
gap is interesting: verified wallets trading smaller amounts means something
different from verified wallets trading more.

**"Who burns their allowance fastest?"** Neither `SwapRecord` nor
`DiscountedSwapUse` stores a wallet, so the answer has to come back through
`swaps`:

```graphql
{
  swapRecords(orderBy: usageCount, orderDirection: desc, first: 10) {
    usageCount
    swaps(first: 1) { swapper { id } }
    uses(orderBy: timestamp) { timestamp newCount }
  }
}
```

`swaps(first: 1)` is enough to identify the wallet: the digest commits to a
single `subject`, and the Registry only grants the discount when `subject`
equals the swapper, so every swap under one record belongs to one address.

An attestation going from 1 to `maxSwaps` in seconds is a wallet front-loading
its discount. Read `maxSwaps` from `RegistryConfig` rather than assuming — it is
owner-configurable and may have changed.

**"Did anyone bypass the router?"** `swaps(where: {routerExecuted: false})`.
Those paid full fee regardless of verification, because the hook only trusts
identity from ProofPool's own router.

**"Did any wallet hold two attestations at once?"** Attestation expiry is not in
this data — `validUntil` and `nonce` never leave calldata, and the Registry event
carries only the digest and a count. So do not reason about overlapping validity
windows. What is observable is overlapping *use*:

```graphql
{ swapper(id: "0x...") { swaps(orderBy: timestamp) { timestamp digest verified } } }
```

Two distinct non-zero digests whose timestamps interleave — A, B, A — mean both
attestations were live at the same time, since a digest cannot be used outside
its own validity. Consecutive but non-overlapping digests prove nothing either
way. Report the interleaving you can see, and say that the validity windows
themselves are off-chain and unverifiable from here.

## Working method

Query, then reason. The pool is small — a few hundred swaps — so prefer pulling
the actual rows and computing over them to asking the subgraph for something
clever. GraphQL has no aggregation beyond what is stored.

Use `first`, `orderBy`, `orderDirection`, and `where` to keep responses small.
Default page size is 100; `first` caps at 1000 and `skip` at 5000. Nested lists
like `swapper { swaps }` are subject to the same caps, so a wallet past 100 swaps
is silently truncated unless you ask for more — check whether you hit the page
size before concluding anything about a wallet's history.

Show the numbers you reasoned from. A claim about cadence is only as good as the
intervals behind it, and a user who can see them can check you.

When the data does not support an answer, say which query you ran and what was
missing. Silence about limits is what turns analysis into guesswork.

## One thing to disclose

The indexed history on the demo deployment is **seeded synthetic testnet
traffic** — wallets deliberately scripted into behavioural archetypes (bot
cadence, allowance burning, attestation overlap) so the analysis has something
to find. It is not organic usage.

If a user seems to be reading it as real market activity, say so. The patterns
are real and the detection is real; the traders were planted.
