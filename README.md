# ProofPool

Uniswap v4 hook that charges unverified addresses more on every swap, and shares that extra fee with LPs. World Selfie Check proves the address belongs to a real, unique human.

## Why

Bots and disposable wallets pay the same fee as everyone else on every AMM pool right now. We tax them instead. Doesn't stop bots, doesn't detect sandwich attacks — just makes anonymous flow more expensive and gives that money to LPs. We say this out loud in the pitch, don't oversell it.

## The 2 pieces

**1. Uniswap v4 hook** — does the actual work.
`beforeSwap` checks if `msg.sender` is verified. Verified = low fee. Not verified = high fee.

**2. World Selfie Check** — makes "verified" mean something.
User verifies once via IDKit, requesting only the `uniqueness` attribute — nothing else, no age/nationality/document data. Registry contract stores it. Hook reads from registry.

<!-- **3. The Graph + Pool Guardian agent** — not just a dashboard.
Classic subgraph indexes swaps + fee tier + verified/unverified split. An AI agent queries that data and reasons over it — flags suspicious cadence, summarizes fee flow, answers questions — instead of just printing raw numbers. The agent is what makes this count for the Graph prize; a plain subgraph doesn't qualify on its own. -->

## Stack

- Solidity + Foundry (hook, registry)
- IDKit (Selfie Check widget + on-chain verifier)
<!-- - React dashboard (also the agent's chat/report surface) -->

## Sponsors we're targeting

<!-- - **The Graph** — Best AI Use Case of The Graph, $4,000 -->
- **World** — Selfie Check Beta Test, $3,500
- **Uniswap** — Best API Integration ($7,000) is the only reachable prize. We're on Classic track (confirmed, see below), and Continuity requires an actual pre-existing project to extend — we don't have one, so the $3k Stack Contribution prize is off the table regardless of what we build.

## MVP checklist — 36 hours

Must ship:
- [ ] Hook: two-tier dynamic fee, tested in Foundry
- [ ] Registry: Selfie Check verification (uniqueness attribute), nullifier-gated
- [ ] IDKit widget wired up
- [ ] Deployed on testnet, both pieces talking to each other
- [ ] Selfie Check testing documentation (developer feedback + user feedback) — required for the World prize, don't forget it at hour 34

<!-- - [ ] Subgraph indexing swaps/fees/verification -->
<!-- - [ ] Pool Guardian agent: queries subgraph, answers at least the fee-flow and cadence-flagging questions, refuses to overclaim on "how many bots" style questions -->
<!-- - [ ] Dashboard showing verified vs unverified flow live + agent chat surface -->

<!-- If time left after that:
- [ ] Synthetic swap history so the pool doesn't look empty
- [ ] Scripted sandwich attack that fails/loses money on our pool — best demo moment we've got -->

<!-- Not building, don't even discuss during the hackathon:
- Reputation scoring
- Off-chain keeper/oracle
- Substreams
- Volatility-aware or auction fees
- Multi-chain -->
