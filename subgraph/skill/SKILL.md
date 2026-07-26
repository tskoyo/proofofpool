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

**`SwapRecord.swaps` vs `SwapRecord.uses`** — two views of one attestation, and
**they are not the same length.**
`uses` is the Registry's log, with the running count and timestamps: use it for
cadence and allowance burn. `swaps` is the Hook's, with amounts, direction and
pool: use it for value, and it is the only route from an attestation back to a
wallet.

`swaps` includes every swap that *presented* this attestation; `uses` records
only the ones that were *honoured*, because the Registry is called only on a
granted discount. So the invariant is:

```
count(swaps where verified) == len(uses) == usageCount
```

and the leftover, `len(swaps) − len(uses)`, is the number of times this
attestation was presented and refused. That gap is a **signal, not corruption**:
it is a wallet still reaching for an allowance that had expired or run out.

**IDs do not join across contracts.** `Swap.id` and `DiscountedSwapUse.id` are
both transaction hash + log index, but different log indices within the same
transaction, so they never match. Join on `digest`, or through
`Swap.usageRecord`.

`_meta { block { number } hasIndexingErrors }` tells you how far the subgraph has
synced. Check it when a user reports something missing — the answer is often
that the subgraph is behind, not that the data is absent.

## Read the configuration first

`maxSwaps` is how many discounted swaps one attestation buys, and each
attestation required a **live Selfie Check** — a real face, at that moment,
which is the one thing in this system that cannot be scripted. So `maxSwaps` is
effectively *the number of swaps a wallet may automate per proven human
presence*, and it rescales almost every answer this skill gives. Read it before
interpreting anything.

```graphql
{ registryConfigs { maxSwaps hook } }
```

### It is a timeline, not a value — read it at the swap's block

`maxSwaps` is owner-configurable and **has changed on the demo deployment**.
Reading today's value and applying it to older swaps is the same error as
guessing, just harder to notice: those swaps were made under a different rule.

The Graph answers historical queries directly. Pin the block:

```graphql
{ registryConfigs(block: {number: 11350000}) { maxSwaps } }
```

So, whenever the cap matters to an answer:

1. Get the block range of the swaps you are analysing (`blockNumber` on `Swap`).
2. Query `registryConfigs` at the **start** and **end** of that range.
3. If the two differ, the cap changed mid-history. Segment your analysis at the
   boundary and say so — do not average across it.

Find a boundary by bisecting on `block: {number: N}` between the two. Anything
below the subgraph's `startBlock` errors rather than returning empty, which is a
useful floor: the error message names the earliest available block.

On the demo deployment the cap has changed **twice**, so the history is in three
segments:

| Blocks | `maxSwaps` | |
|---|---|---|
| below 11350309 | null | not observed — see [When it reads null](#when-it-reads-null) |
| 11350309 – 11353321 | `10` | almost all the seeded traffic |
| 11353322 and after | `2` | current; live demo swaps land here |

Two consequences worth stating in any answer that spans them. Roughly a third of
the indexed history sits below the first boundary, where the cap is genuinely
unknown — name those swaps rather than back-filling them with today's value. And
the bulk of the seeded traffic ran under `10` while anything a reader tries
themselves runs under `2`, so a seeded wallet's verified-swaps-per-attestation is
**not** comparable to a live one's. Segment at 11353322 before comparing them.

These numbers are a snapshot. Re-derive the boundaries by bisecting if an answer
turns on them — the owner can change the cap again at any time, and this table
does not update itself.

Time-travel works on every entity, not just this one.

### When it reads null

**Null is expected, and it does not mean uncapped.** The Registry's constructor
sets the initial cap without emitting `MaxSwapsUpdated`, so until an owner
changes it there is no event for the subgraph to index. Null means *not
observed*; uncapped is the value `0`, which is a real setting.

Either ask the user what the cap is, or read it from the Registry directly if
you have chain access — noting this gives you the cap *now*, not at the block
you care about:

```bash
cast call <registry> "maxSwaps()(uint256)" --rpc-url <sepolia rpc>
```

Do not proceed as if the cap were 1 or 10 — the difference between those two
readings flips a wallet from "clearly a person" to "a person with a script", and
guessing it silently is the worst failure this skill can have. Say the cap is
unknown, give the reasoning both ways if it matters, and ask.

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
`totalSwaps` but contribute no volume.

Every amount in this Subgraph is raw base units. There is no `Token` entity, so
decimals are not in the data — apply them yourself. On the demo deployment:

| | Token | Decimals | Fields |
|---|---|---|---|
| `currency0` | MyWBTC | **8** | `*Volume0`, and `amountSpecified` when `zeroForOne: true` |
| `currency1` | MyUSDC | **6** | `*Volume1`, and `amountSpecified` when `zeroForOne: false` |

v4 orders currencies by address, so `currency0` is **not** the "base" asset in
any economic sense — here it happens to be the 8-decimal one. Read
`pool { currency0 currency1 }` and confirm against the addresses rather than
assuming this holds on another deployment.

`zeroForOne: true` means currency0 was paid *in*. Getting this backwards
attributes volume to the wrong token and silently rescales it by 100x, since the
two decimals differ by two.

**A non-zero `digest` means an attestation was *presented*, not that a discount
was *granted*.** This is the single easiest field to get wrong, and getting it
wrong silently inflates every verification number you report.

`LivenessOracle.verify` hashes the attestation before it checks anything, and
returns that digest whether or not the attestation holds. So a swap that
presented an expired attestation, or one signed by a rotated-out key, or a valid
one whose allowance was already spent, emits `verified: false` with a **non-zero
digest**. Only a `subject`/`swapper` mismatch returns zero.

The invariant is therefore *not* `verified ⟺ digest != 0`. It is:

| `verified` | `digest` | Meaning |
|---|---|---|
| `true` | non-zero | Attestation presented and honoured. Paid 500. |
| `false` | non-zero | Attestation presented and **refused** — expired, wrong signer, or allowance exhausted. Paid 3000. |
| `false` | zero | No attestation offered at all (or `subject` did not match the swapper). Paid 3000. |

What holds unconditionally is `verified ⟺ feeApplied == 500`.

**Use the middle row — it is real behavioural data, not noise.** It is the only
observable trace of a wallet trying to spend an allowance it no longer had, and
it separates two populations the docs would otherwise merge: wallets that never
verify, and wallets that verified and then ran out. Those mean very different
things about a person.

```graphql
{ swaps(first: 1000, where: {verified: false, digest_not: "0x0000000000000000000000000000000000000000000000000000000000000000"}) {
    swapper { id } digest timestamp usageRecord { usageCount } } }
```

If `usageRecord` is null, that attestation never completed a single discounted
swap — it expired or was rejected outright. If it is non-null, compare
`usageCount` against `maxSwaps`: equal means the wallet hit its cap and kept
trading at full fee, which is a wallet that wanted the discount and could not
get it.

**Never count distinct non-zero digests as "verifications that converted".**
That figure includes refused presentations. Count distinct digests on swaps with
`verified: true`.

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

### Read the cap first — it changes what everything means

Get `maxSwaps` for this wallet's block range before going further, and mind that
it is a timeline rather than a fixed value — see
[Read the configuration first](#read-the-configuration-first). That single number
rescales the whole analysis:

| `maxSwaps` | What 20 verified swaps means |
|---|---|
| 1 | 20 separate live selfies. Very hard to fake. Strong human signal. |
| 2 (current) | 10 separate live selfies. Still a strong human signal. |
| 10 | 2 verifications. A human verified twice; a script could have done the rest. |
| 0 (uncapped) | Expiry alone bounds it. Verification count says little. |

Count the wallet's **distinct digests across its `verified: true` swaps** (only
honoured ones — see the digest table above) — that is how many times a human
actually stood in front of a camera and got the discount for it.
`verifiedSwaps ÷ distinct honoured digests` tells you how much automation each
human moment authorised. And because the backend issues at most one attestation
per wallet per epoch, distinct honoured digests also tell you across how many
separate time windows that person showed up.

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

**"How much extra did anonymous flow pay LPs?"** Report this as a **floor plus a
named remainder**, never as a single number.

The floor is the fee difference on stored unverified volume, per currency, in
raw units:

```
premium = unverifiedVolume × (3000 − 500) / 1_000_000
```

That is a floor and not a total, because `Pool.*Volume*` accumulates only
*requested exact-input* amounts. Exact-output swaps (`amountSpecified > 0`) are
counted in `totalSwaps` but contribute no volume, so their premium is missing
from the figure.

Some of that gap is recoverable and some is not — separate the two rather than
dropping both:

- **Recoverable:** an exact-output swap with `routerExecuted: true` has a
  settled `amountIn`. Add it to the matching currency and you have measured it.
- **Unmeasurable:** an exact-output swap with `routerExecuted: false` has no
  settled amount anywhere in this Subgraph. Count these and report the count.
  Do not estimate them.

So the honest shape of the answer is: *"at least X, plus Y recovered from
exact-output swaps, with N swaps whose contribution is not measurable from this
data."* Check the exact-output population before writing any of this — if it is
empty, say the floor is the complete figure and move on rather than hedging
about a gap that does not exist:

```graphql
{ swaps(first: 1000, where: {verified: false, amountSpecified_gt: "0"}) {
    routerExecuted amountIn zeroForOne } }
```

Convert with each token's decimals before presenting. Note the fee tiers are
compile-time constants in the hook (`VERIFIED_FEE = 500`,
`UNVERIFIED_FEE = 3000`) — they cannot be changed without redeploying, so unlike
`maxSwaps` you may rely on them. Sanity-check against `feeApplied` on real rows
anyway if the numbers look wrong.

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
its discount — read the cap at those swaps' block, not today's
([why](#it-is-a-timeline-not-a-value--read-it-at-the-swaps-block)).

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

Two distinct digests **on `verified: true` swaps** whose timestamps interleave —
A, B, A — mean both attestations were live at the same time, since a digest
cannot be *honoured* outside its own validity. Restrict to honoured swaps before
concluding anything: a digest appearing on an unverified swap was refused, which
is evidence it was **not** live, and reading it as overlap inverts the finding.
Consecutive but non-overlapping digests prove nothing either way. Report the
interleaving you can see, and say that the validity windows themselves are
off-chain and unverifiable from here.

## Reconcile before you report

This Subgraph stores the same quantities twice, by different routes, on purpose.
Checking them against each other costs one extra query and turns "here are some
numbers" into "here are some numbers, and here is why you can believe them".
Do this whenever you are producing a written summary rather than answering a
one-line question.

Three checks, in increasing order of what they catch:

**1. Aggregates against rows.** Re-derive `Pool.unverifiedVolume0/1` by summing
`|amountSpecified|` over unverified exact-input swaps, grouped by `zeroForOne`.
They must match exactly. A mismatch means the mapping and the raw log disagree,
and nothing downstream is trustworthy.

**2. Aggregates against the contract.** The hook keeps its own on-chain
`demoPoolStats`, written field-for-field with what the mapping computes. If you
have chain access, read it and compare — this catches an indexing error that
check 1 cannot, because check 1 only proves the mapping is self-consistent:

```bash
cast call <hook> "demoPoolStats(bytes32)" <poolId> --rpc-url <sepolia rpc>
```

**3. Both sides of an attestation.** Per record, assert
`count(swaps where verified) == len(uses) == usageCount`. Do **not** compare raw
lengths — `swaps` also carries refused presentations, so `len(swaps) ≥ len(uses)`
is the normal state and the difference is meaningful rather than corrupt. Only a
failure of that equality means the index is broken.

Also check `_meta { block { number } hasIndexingErrors }` first, always. A
surprising answer is more often a subgraph that is behind than a real finding.

State the result of these checks in your output, including when they pass. "The
stored aggregates reconcile exactly against 290 indexed rows" is a sentence that
earns the rest of the analysis its credibility.

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
