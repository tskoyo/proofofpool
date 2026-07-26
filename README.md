# ProofPool

Uniswap v4 hook that charges unverified addresses more on every swap, and shares that extra fee with LPs. World Selfie Check proves a live human authorized the swap — not that the wallet belongs to a unique one.

## Try it — temporary live instance

**https://claimed-tourism-sculpture-trial.trycloudflare.com**

Running against the [contracts deployed on Sepolia](#deployments--ethereum-sepolia-chain-id-11155111)
below — same hook, same pool, same Subgraph. Nothing about it is mocked.

**This is a temporary deployment for easier testing.** The URL may be
inaccessible or already killed — [get in touch](#team) if you hit a problem. If
it does not load, the project is unaffected: everything it talks to is on-chain
and independently reachable, and [SETUP.md](./SETUP.md) brings up your own copy.

To actually swap you need Sepolia ETH for gas. The two demo ERC-20s have a
public unrestricted `mint`, so fund yourself from any wallet — no faucet needed
for the tokens, only for gas. Approve `ProofPoolRouter` before the first swap.

Please use it responsibly: **testnet only, so connect a burner wallet and never
send real funds**. It is a small instance behind a rate limit, so go easy on it.
And the Selfie Check is a real World credential against production — verify only
if you are happy to; the swap works fine without it at the unverified tier.

## Why

Bots and disposable wallets pay the same fee as everyone else on every AMM pool right now. We tax them instead. Doesn't stop bots, doesn't detect sandwich attacks — just makes anonymous flow more expensive than verified flow and gives that difference to LPs. We say this out loud in the pitch, don't oversell it.

**Why anyone shows up.** Nobody has to be driven off for this to work. An
unverified wallet pays 0.30% here and 0.30% on a standard pool, so a bot is
indifferent and that flow has no reason to leave. A verified trader pays 0.05%,
cheaper than the same pair anywhere else, so retail has a reason to arrive — at
no cost beyond a selfie. LPs take the lower rate on verified flow in exchange
for attracting it, and keep the anonymous flow on unchanged terms. The question
the pool puts to a trader is just: why should you pay the same price as an MEV
bot?

## The 3 pieces

**1. Uniswap v4 hook** — does the actual work.
`beforeSwap` checks the wallet identity supplied by the trusted ProofPool
router. Verified = low fee. Not verified, or any untrusted router = high fee.
See [DESIGN.md](./DESIGN.md) for the current trusted-router design and the
planned signed-hook-data upgrade.

**2. World Selfie Check** — makes "verified" mean something.
User verifies via IDKit. The backend checks the proof with World, then signs an
EIP-712 attestation that the wallet carries and presents on each swap. The
backend never sends a transaction. `LivenessOracle` recovers the signature and
checks expiry; `Registry` counts how many discounted swaps that attestation has
left.

A swap is discounted while **both** limits hold — inside `validUntil` **and**
under `maxSwaps`. Whichever runs out first ends the discount.

**The World nullifier is a rate-limiting key, not an identity key.** A World
proof is a bearer token that stays valid forever, so a saved one could otherwise
mint attestation after attestation without the user facing the camera again.
Instead, time is cut into epochs, each with its own unguessable challenge the
client folds into the World ID signal, and the attestation nonce is
`HMAC(nullifier, epoch)`. Two consequences:

- Replaying a proof inside its epoch rebuilds a **byte-identical** attestation —
  same digest, same already-spent allowance. Re-verifying does not top you up.
- A genuinely new allowance requires a new epoch, so a new challenge, so a new
  Selfie Check.

The nullifier goes through HMAC so the on-chain digest is not a plain function
of it; learning someone's nullifier does not let you follow their swaps. It is
never stored and never logged next to a wallet address.

📄 **[Walkthrough of the whole handshake](./web/public/protocol-flow.html)** — a
self-contained page with a sequence diagram across all five parties, and what
specific attack each piece closes. Open it in a browser; it needs no server. It
is also served at `/protocol-flow.html` when the web app is running.

This is what Selfie Check can actually back — liveness at signing time — and the
mechanism claims nothing more. See [Known limitations](#known-limitations).

**3. The Graph + a packaged analytics skill** — the part that makes the data
answerable.

A subgraph indexes `SwapPriced`, `SwapExecuted` and the Registry events for
durable, transaction-level analytics. But a subgraph on its own only returns
rows, and the rows are full of traps: `amountSpecified` is signed and is the
*requested* amount, settled amounts are null for anything that bypassed our
router, the two currencies have different decimals so identical trade sizes look
varied, and `swapper` is only a wallet under specific conditions. Every one of
those produces a confident wrong answer.

So the deliverable is [`proofpool-analytics`](./subgraph/skill) — a reusable
agent skill carrying the endpoint, the schema, those field-level traps, and the
analytical method for questions like *"does this address look automated?"*.
**We ship the skill, not a chat UI.** Any agent or workflow can load it and
answer in plain language; that is the point of packaging it that way, and it is
why it outlives this demo in a way a bespoke dashboard would not.

The hook also keeps a small set of explicitly `Demo only` per-pool aggregates:
swap counts and requested exact-input volume split by fee tier and input token,
readable over plain RPC. They exist so the indexed totals can be checked against
the contract's own — the subgraph mirrors them field for field on purpose. They
are not settled-volume accounting: exact-output volume is excluded.

## Known limitations

Say these out loud rather than letting anyone infer otherwise.

**No Sybil resistance — one human, many wallets.** The nullifier rate-limits a
*given wallet* per epoch (above), but `subject` is part of the digest, so the
same human verifying a second address gets a separate, full allowance on it.
Nothing binds a nullifier to one wallet.

That gap is deliberate, not an oversight we ran out of time on. A Selfie Check
nullifier is unique per World identity, not per human — only Orb establishes
one-identity-per-human. Enforcing uniqueness on a selfie-level credential would
advertise a guarantee the credential cannot back. Do not claim
anti-multi-accounting; the claim is "a live human authorized this swap".

**Federated trust, not a ZK proof.** Selfie Check has no on-chain verifier — only
Orb does (`groupId = 1`). Every discount reduces to "the `trustedSigner` key was
not compromised". A leaked signing key mints discounts at will until the owner
calls `LivenessOracle.setTrustedSigner`.

**No revocation before expiry.** A signature cannot be withdrawn once issued, so
`ATTESTATION_TTL_SECONDS` is the revocation window — keep it short. Rotating the
trusted signer invalidates every outstanding attestation at once and is the only
bulk lever.

**Discount only through our router.** The hook trusts identity solely from
`ProofPoolRouter`. Swaps routed via Universal Router or any aggregator pay the
full tier regardless of verification.

**The cap bursts to 2x.** Attestations are issued per verification window and
expire two windows out, so a user who verifies in consecutive windows briefly
holds two live attestations and can take up to `2 * maxSwaps` in that overlap.
The sustained rate is still `maxSwaps` per window. The alternative — expiring
after one window — would hand somebody who verifies near a boundary an
attestation lasting seconds, so the overlap is the deliberate trade.

## Deployments — Ethereum Sepolia (chain id 11155111)

All deployed in block **11349795**. Use that as the subgraph `startBlock`: no
swap exists before it, so starting earlier only costs sync time.

| Contract | Address |
|---|---|
| `ProofPoolHook` | [`0xA98F33C701F0D206e3f940810e2135d930fc8080`](https://sepolia.etherscan.io/address/0xA98F33C701F0D206e3f940810e2135d930fc8080) |
| `Registry` | [`0xA8B46486c2AC0Cec419b3e205aAd9AaC4c33C7D4`](https://sepolia.etherscan.io/address/0xA8B46486c2AC0Cec419b3e205aAd9AaC4c33C7D4) |
| `LivenessOracle` | [`0x13E392859360ff3b6F05EbdAde5913A67F877c84`](https://sepolia.etherscan.io/address/0x13E392859360ff3b6F05EbdAde5913A67F877c84) |
| `ProofPoolRouter` | [`0x60a058a835da19Ba8db84602b3474d999985B76F`](https://sepolia.etherscan.io/address/0x60a058a835da19Ba8db84602b3474d999985B76F) |

The hook address is not arbitrary — its low bits encode the `beforeSwap`
permission, mined as a CREATE2 salt. Redeploying the hook therefore always
produces a new address, hence a new `PoolKey`, hence a different pool.

### Demo tokens

Throwaway ERC-20s with `mint` public and unrestricted, so anyone can fund a
wallet to try the pool. They mirror the decimals of the assets they stand in for
so the pool math and UI formatting behave like the real pair.

| Token | Address | Decimals |
|---|---|---|
| `MyWBTC` (currency0) | [`0x455F89677E869FbB096b53Ce611ab1FB580c951F`](https://sepolia.etherscan.io/address/0x455F89677E869FbB096b53Ce611ab1FB580c951F) | 8 |
| `MyUSDC` (currency1) | [`0x936dD0f62ea658F9F0E275FBC7324F5552DC2C91`](https://sepolia.etherscan.io/address/0x936dD0f62ea658F9F0E275FBC7324F5552DC2C91) | 6 |

Order is not cosmetic: v4 requires `currency0 < currency1` by address, and the
`PoolKey` — so the pool id — depends on it.

### Pool

```
poolId       0xb5490fe81d9106e211b846e99f7fc153c18841c809502c88d1c2d4da6209de86
fee          0x800000  (DYNAMIC_FEE_FLAG — the hook overrides the fee per swap)
tickSpacing  60
liquidity    500,000 MyUSDC / 5 MyWBTC, full range
```

The pool **must** be initialized with `DYNAMIC_FEE_FLAG`, or `PoolManager`
silently ignores the hook's fee override and both tiers pay the static fee.

Built against the canonical Uniswap v4 deployment on Sepolia:
`PoolManager` `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`,
`PositionManager` `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4`,
`Permit2` `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

Run [`./script/check-deploy.sh`](./script/check-deploy.sh) to verify a
deployment landed and is wired — it reads the broadcast file back, checks every
transaction on-chain, and confirms the pool has liquidity.

### Subgraph

```
https://api.studio.thegraph.com/query/1756994/proof-pool-sepolia/0.1.1
```

Indexes `SwapPriced` from the hook, `SwapExecuted` from the router, and
`DiscountedSwapRecorded` / `HookUpdated` / `MaxSwapsUpdated` from the Registry,
all from `startBlock: 11349795`. Source in [subgraph/](./subgraph).

The query URL is version-pinned, so a redeploy changes it — read it from an
environment variable rather than hardcoding it.

Entities worth knowing:

- **`Pool`** — running totals: swap counts and requested exact-input volume,
  split by fee tier and input currency. Deliberately field-for-field with
  `ProofPoolHook.demoPoolStats`, so the indexed numbers can be checked against
  the contract's own.
- **`Swap`** — one per priced swap, with the fee tier applied, direction, and
  the digest of any attestation *presented* — which is not the same as one
  honoured. An expired or exhausted attestation still names itself here next to
  `verified: false`, so read `verified`, never `digest != 0`. That case is a
  signal, not noise: it is the only trace of a wallet spending an allowance it
  no longer had. `amountIn`/`amountOut` are settled amounts joined from the
  router, and are null for swaps that bypassed it (`routerExecuted: false`).
- **`Swapper`** — per-wallet totals, the basis for cadence analysis.
- **`SwapRecord`** / **`DiscountedSwapUse`** — an attestation's allowance
  draining, keyed by EIP-712 digest.

The history it indexes is **seeded synthetic testnet traffic**, not organic
usage — see [SETUP.md](./SETUP.md#6-seed-the-demo-traffic).

## Team

| | Telegram |
|---|---|
| tskoyo | [@tskoyo](https://t.me/tskoyo) |
| Sebi | [@Spyro7883](https://t.me/Spyro7883) |
| eduv09 | [@eduv09](https://t.me/eduv09) |

## Setting it up

[SETUP.md](./SETUP.md) walks through a deployment from scratch: keys, contracts,
pool, seeded traffic, subgraph, and the web app, in the order the dependencies
require.

## Stack

- Solidity + Foundry (hook, registry, oracle, router)
- IDKit (Selfie Check widget). Selfie Check has **no** on-chain verifier — the
  proof is checked server-side against World's cloud endpoint and the result
  attested by an EIP-712 signature.
- Next.js (verify + swap UI, server-side RP signing and proof verification)
- The Graph — subgraph deployed to Subgraph Studio ([endpoint](#subgraph))
- [`proofpool-analytics`](./subgraph/skill) — a packaged agent skill over that
  Subgraph. Portable by design: no runtime of ours, no API key, loads into
  whatever agent the reader already runs

## Tools and integrations used

**World** — [`@worldcoin/idkit`](https://www.npmjs.com/package/@worldcoin/idkit)
4.x and `@worldcoin/idkit-core` for the widget, `hashSignal` from
`idkit-core/hashing`, and server-side RP signing via `idkit-core/signing`.
Credential is the `selfieCheckLegacy` preset (`allow_legacy_proofs: true`),
producing protocol version `3.0` proofs verified against
`POST /api/v4/verify/{rp_id}` in the production environment. No on-chain World
verifier is used — Selfie Check has none.

**The Graph** — a Subgraph authored for this project, deployed to Subgraph
Studio, indexing three contracts from block 11349795. Built with
`@graphprotocol/graph-cli` 0.97 and `@graphprotocol/graph-ts` 0.38. It is the
load-bearing data source for everything the dashboard shows that is not a
single-swap quote: the verified/unverified split, per-wallet cadence, and
attestation burn-down exist only in these logs. Endpoint and entity list under
[Subgraph](#subgraph).

**Uniswap** — v4 hooks against the canonical Sepolia `PoolManager`, with
`v4-core` and `v4-periphery` (`HookMiner` for the CREATE2 salt,
`IPositionManager` and Permit2 for the liquidity position).

**Chain and app** — Solidity 0.8.26 with Foundry; Next.js 15 App Router with
viem 2.x.

### Agent skills

Development used three packaged agent skills, vendored under
[.claude/skills/](./.claude/skills) and [.agents/skills/](./.agents/skills):

| Skill | Used for |
|---|---|
| `swap-integration` | Uniswap integration — pinned in [skills-lock.json](./skills-lock.json) from `uniswap/uniswap-ai` |
| `world-id` | IDKit setup, proof verification, nullifier and session handling |
| `subgraph-dev` | schema design, mapping handlers, manifest and deployment |

We also ship one: [`proofpool-analytics`](./subgraph/skill) lets any agent query
this Subgraph and reason about the pool — verified flow, fee premium, per-wallet
cadence, attestation burn-down. It carries the field-level traps that otherwise
produce confident wrong answers, and it is deliberate about what the data cannot
support: bot-like *flow* is not a claim about a person, and a verified wallet is
not a unique human.

A note on `swap-integration`: installing it with
`npx skills add uniswap/uniswap-ai --skill swap-integration` and selecting Claude
Code created an `.agents/` directory rather than `.claude/`. See
[FEEDBACK.md](./FEEDBACK.md).

## Sponsors we're targeting

- **World** — Selfie Check Beta, $1,750.

- **The Graph**

  **A Subgraph authored for this project**, deployed to Subgraph Studio,
  indexing three contracts from block 11349795. It is load-bearing, not
  decorative: the verified/unverified split, per-wallet cadence, and attestation
  burn-down exist nowhere else. Verification never touches the chain, so the
  distinct digests on verified swaps are the only on-chain proxy for a
  verification funnel that exists at all. Entities and endpoint under
  [Subgraph](#subgraph).

  **A reusable agent skill on top of it** —
  [`proofpool-analytics`](./subgraph/skill), open source, with its own
  [README](./subgraph/skill/README.md) and SKILL.md. Not an app: a portable
  artifact any agent or workflow loads to query this Subgraph and reason over
  it. It encodes the field-level traps that otherwise produce confident wrong
  answers, and the analytical method for the questions people actually ask —
  *"is this address likely automated?"* — including when to refuse to answer.

## MVP checklist — 36 hours

Must ship:
- [x] Hook: two-tier dynamic fee, tested in Foundry
- [x] `LivenessOracle` verifies the attestation signature and expiry; `Registry`
      enforces the swap cap per digest
- [x] Epoch-challenge binding so a saved World proof cannot mint a fresh allowance
- [x] IDKit widget wired up
- [x] Deployed on Sepolia, both pieces talking to each other
- [x] Selfie Check testing report, developer **and** user feedback —
      [FEEDBACK_WORLD.md](./FEEDBACK_WORLD.md)
- [x] Selfie Check tested end to end on Android and iOS, both successful

The Graph track, in dependency order — each step invalidates the previous one if
done out of sequence:
- [x] Event surface: `poolId`, `digest`, and direction on `SwapPriced`
- [x] Redeploy (new hook address → new salt → new pool → re-point the web app)
- [x] Subgraph indexing `SwapPriced`, `SwapExecuted` and the Registry events,
      with per-pool aggregates
- [x] Seed traffic: 24 wallets with planted behavioural archetypes, spread over
      time. 290 swaps landed — 86 verified across 44 distinct attestations,
      204 unverified
- [x] Confirm the subgraph indexes the seeded swaps. Verified against the live
      endpoint: `hasIndexingErrors: false`, all 290 swaps present, every
      verified swap resolving to its `SwapRecord`, and the indexed per-pool
      aggregates agreeing with the hook's own
- [x] `proofpool-analytics` skill: answers fee-flow and cadence questions, and
      refuses to overclaim on "how many bots" style questions — bot-like *flow*
      is not a claim about a person. Shipped as a portable skill rather than a
      chat UI, so it works in whatever agent the reader already uses
- [x] Tools, SDKs and skills used, and team contacts — see above
- [x] `setMaxSwaps(2)` before demoing — the seeded history keeps its variance,
      and a low cap makes the live walkthrough legible. Set at block 11353322;
      the seeded traffic ran under `10`, so the two are not comparable and
      [the analytics skill](./subgraph/skill) segments there
- [ ] Demo video. The Graph's tracks state "a 2-4 minute demo video" verbatim;
      World's qualification bullets don't state a length, so cut a single video
      at roughly 3 minutes and it satisfies both

If time left after that:
- [ ] Scripted sandwich showing the attacker paying the unverified tier on both
      legs, so a marginal sandwich stops clearing. It does not *fail* — nothing
      here detects or blocks it, it just costs 6x more in fees. Demo it that way
      or not at all.
