# ProofPool

Uniswap v4 hook that charges unverified addresses more on every swap, and shares that extra fee with LPs. World Selfie Check proves a live human authorized the swap — not that the wallet belongs to a unique one.

## Why

Bots and disposable wallets pay the same fee as everyone else on every AMM pool right now. We tax them instead. Doesn't stop bots, doesn't detect sandwich attacks — just makes anonymous flow more expensive and gives that money to LPs. We say this out loud in the pitch, don't oversell it.

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

This is what Selfie Check can actually back — liveness at signing time — and the
mechanism claims nothing more. See [Known limitations](#known-limitations).

**3. The Graph + Pool Guardian agent** — *in progress.*
The hook stores no aggregates and `Registry` keeps only per-digest counts, so
"what share of volume is verified" and "how much did anonymous flow pay LPs" are
not answerable by any RPC read. A subgraph indexes `SwapPriced` and
`DiscountedSwapRecorded` to answer them, and an agent reasons over that data —
flags suspicious cadence, summarizes fee flow, answers follow-ups — rather than
printing raw rows. A plain subgraph would not be worth building on its own.

Status: the hook's event surface is in place (see
[DESIGN.md](./DESIGN.md#event-surface-for-indexers)). Subgraph, dashboard, and
agent are not built yet.

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

## Stack

- Solidity + Foundry (hook, registry, oracle, router)
- IDKit (Selfie Check widget). Selfie Check has **no** on-chain verifier — the
  proof is checked server-side against World's cloud endpoint and the result
  attested by an EIP-712 signature.
- Next.js (verify + swap UI, server-side RP signing and proof verification)
- The Graph subgraph + agent dashboard — planned, not built

## Sponsors we're targeting

- **World** — Selfie Check Beta Test, $3,500
- **Uniswap** — Best API Integration ($7,000) is the only reachable prize. We're on Classic track (confirmed, see below), and Continuity requires an actual pre-existing project to extend — we don't have one, so the $3k Stack Contribution prize is off the table regardless of what we build.
- **The Graph** — Best AI Use Case of The Graph, $3,000. Requires an agent
  reasoning over live data, not just a subgraph. Best Use of Composable or
  Standardized Graph Products ($3,000) is a secondary target if we also compose
  with a Uniswap v4 subgraph for settled amounts. The $4,000 AI Use Case pot is
  the Continuity track and is out of reach for the same reason as Uniswap's.

## MVP checklist — 36 hours

Must ship:
- [x] Hook: two-tier dynamic fee, tested in Foundry
- [x] `LivenessOracle` verifies the attestation signature and expiry; `Registry`
      enforces the swap cap per digest
- [x] Epoch-challenge binding so a saved World proof cannot mint a fresh allowance
- [x] IDKit widget wired up
- [x] Deployed on Sepolia, both pieces talking to each other
- [x] Selfie Check testing documentation — [FEEDBACK_WORLD.md](./FEEDBACK_WORLD.md),
      required for the World prize

The Graph track, in dependency order — each step invalidates the previous one if
done out of sequence:
- [x] Event surface: `poolId`, `digest`, and direction on `SwapPriced`
- [ ] Redeploy (new hook address → new salt → new pool → re-point the web app)
- [ ] Seed traffic: ~30-40 wallets, ~400-600 swaps, planted behavioural
      archetypes, spread over time. Run with `maxSwaps` high, then
      `setMaxSwaps(1)` before the demo — history keeps the variance, the live
      demo stays legible
- [ ] Subgraph indexing `SwapPriced` + `DiscountedSwapRecorded`
- [ ] Pool Guardian agent: answers fee-flow and cadence questions, refuses to
      overclaim on "how many bots" style questions
- [ ] Dashboard: agent-written verdict on load, chat for follow-ups

If time left after that:
- [ ] Scripted sandwich showing the attacker paying the unverified tier on both
      legs, so a marginal sandwich stops clearing. It does not *fail* — nothing
      here detects or blocks it, it just costs 6x more in fees. Demo it that way
      or not at all.

<!-- Not building, don't even discuss during the hackathon:
- Reputation scoring
- Off-chain keeper/oracle
- Substreams
- Volatility-aware or auction fees
- Multi-chain -->
