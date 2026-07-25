# Setting up ProofPool from scratch

Everything needed to go from a fresh clone to a working deployment with a live
subgraph. Follow it in order — most steps depend on an address or a block number
printed by the one before.

If you only want to run the existing deployment, skip to
[Running the web app](#8-run-the-web-app); the addresses in
[README.md](./README.md#deployments--ethereum-sepolia-chain-id-11155111) are live.

## What you need first

| | Why |
|---|---|
| [Foundry](https://book.getfoundry.sh/getting-started/installation) | contracts, deploy scripts, traffic seeding |
| Node.js 20+ | the Next.js app and the subgraph toolchain |
| An Ethereum Sepolia RPC endpoint | everything on-chain |
| Sepolia ETH (~0.5 ETH) | deployment plus seeded demo traffic |
| A [World Developer Portal](https://developer.world.org) app | Selfie Check verification |
| A [Subgraph Studio](https://thegraph.com/studio/) account | publishing the subgraph |

**On the RPC endpoint.** Rate limits matter more than monthly quotas here. The
traffic seeder broadcasts 10–25 transactions at once, which needs roughly
15 req/s. Alchemy and Chainstack free tiers have that headroom; a 5 req/s tier
does not, and you will hit 429s during deployment as well as seeding. If you are
stuck with a slow endpoint, the seeder has a `--gentle` mode — see step 6.

```bash
git clone <this repo> && cd proofofpool
forge install
(cd web && npm install)
(cd subgraph && npm install)
```

## 1. Generate the two keys

The **attester** signs liveness attestations. It never sends a transaction and
never needs funding, but its address is baked into `LivenessOracle` at deploy
time.

```bash
cast wallet new          # attester: keep the private key, note the address
```

The **seed mnemonic** derives the wallets that generate demo traffic.

```bash
cast wallet new-mnemonic
```

> Do not use Foundry's public test mnemonic (`test test test ... junk`). Those
> addresses are watched by sweeper bots on every public testnet: the funding
> transfers confirm normally and the wallets are drained within seconds, which
> then surfaces as a confusing "seed wallet has no gas". `seed-traffic.sh`
> refuses to run with it.

## 2. Fill in the root `.env`

Copy [.env.example](./.env.example) to `.env` and set at minimum:

```bash
PRIVATE_KEY=          # deployer, needs Sepolia ETH
SEPOLIA_RPC_URL=
ETHERSCAN_API_KEY=    # optional, only for --verify
TRUSTED_SIGNER=       # the attester ADDRESS from step 1
CONTRACTS_OWNER=      # set to the deployer address
MAX_SWAPS=10
SEED_MNEMONIC=        # the twelve words from step 1
SEED_RPC_URL=         # optional, a second endpoint for seeding
```

`TRUSTED_SIGNER` must be the address of the key the web backend signs with. A
mismatch means every attestation fails signature recovery and nobody is ever
discounted — `deploy-sepolia.sh` cross-checks it against `web/.env` before
broadcasting.

## 3. Deploy the demo tokens

```bash
forge script script/DeployTestTokens.s.sol:DeployTestTokens \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Paste the two addresses it prints into `.env` as `TOKEN_USDC` and `TOKEN_WBTC`.
Order does not matter; the deploy script sorts them as v4 requires.

These are `MockERC20`s with `mint` public and unrestricted, so anyone can fund a
wallet to try the pool.

## 4. Deploy the contracts and the pool

```bash
./script/deploy-sepolia.sh
```

It pre-flights the deployer's ETH and token balances, mines a CREATE2 salt so
the hook address encodes the `beforeSwap` permission, deploys all four
contracts, wires `registry.setHook()`, initializes the pool with the dynamic-fee
flag, and seeds 500,000 MyUSDC / 5 MyWBTC of full-range liquidity.

**If it fails waiting for receipts**, that is usually a slow RPC rather than a
failed deploy. The script retries once with `forge script --resume`, which picks
up transactions that already confirmed instead of deploying a second set. If it
still reports failure:

```bash
./script/check-deploy.sh
```

That reads the broadcast file back, checks every transaction on-chain, verifies
the contracts are wired to each other, and confirms the pool has liquidity. It
prints the addresses ready to paste. **Never re-run a fresh deploy without
checking first** — a second run deploys a whole new set and orphans the first.

Record the block number the deploy landed in; the subgraph needs it.

Then copy the four addresses into **two** places:

- root `.env` as `PROOFPOOL_ORACLE`, `PROOFPOOL_REGISTRY`, `PROOFPOOL_ROUTER`,
  `PROOFPOOL_HOOK` — the seeder reads these
- `web/.env` as `NEXT_PUBLIC_*` — the app reads these

## 5. Configure the web app

Copy `web/.env.example` to `web/.env`. Beyond the four addresses above:

```bash
ATTESTER_PRIVATE_KEY=      # the attester PRIVATE key from step 1
ATTESTATION_SECRET=        # any long random string; seeds the epoch challenge
ATTESTATION_TTL_SECONDS=3600
WORLD_RP_ID=               # from the World Developer Portal
WORLD_ACTION=
WORLD_ENVIRONMENT=production
RP_SIGNING_KEY=
NEXT_PUBLIC_WLD_APP_ID=
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_RPC_URL=
```

`ATTESTATION_SECRET` is what makes a World proof single-use per epoch: the
per-epoch challenge is derived from it, and so is the attestation nonce. Losing
or rotating it invalidates every outstanding attestation.

## 6. Seed the demo traffic

The pool starts empty, and an agent reasoning over twelve swaps is not a demo.
This plants behavioural archetypes — bot cadence, allowance burn, the 2x
attestation overlap — for the subgraph to index and the dashboard to surface.

**This is synthetic testnet traffic and must be described that way.** The point
is to show the protocol detecting planted behaviour, not to imply organic usage.

```bash
./script/seed-traffic.sh --dry-run     # price it, send nothing
./script/seed-traffic.sh 3 20          # smoke test: 3 ticks
./script/seed-traffic.sh 30 20 --resume  # the rest
```

The dry run walks the same dispatch the real run does, counts the swaps, prices
them at the live gas price, and tells you what funding it needs. Nothing is sent
until you confirm.

Roughly 400 swaps across 24 wallets over 30 ticks, ~30–45 minutes, most of it
one-time wallet setup. Costs depend on gas price — around 0.3 ETH of funding at
1 gwei, of which the unspent remainder stays in the seed wallets.

Useful flags:

- `--gentle` — one transaction at a time, ~1 req/s instead of ~15. Use it below
  a 15 req/s rate limit. Takes 1.5–2 hours instead of 30–45 minutes.
- `--resume` — continue from the last completed tick. **Ticks are not
  idempotent**: re-running one sends its swaps again, doubling that slice of the
  history and paying for it twice. Progress is checkpointed in `.seed-progress`,
  and the script refuses to start over without `--restart`.

Before demoing, tighten the cap so the mechanism is legible on stage:

```bash
cast send $PROOFPOOL_REGISTRY "setMaxSwaps(uint256)" 1 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
```

`setMaxSwaps` only affects future swaps, so the seeded history keeps its varied
burn-down while a live verify-then-swap demo shows the discount ending after
exactly one swap.

## 7. Deploy the subgraph

Point [subgraph/subgraph.yaml](./subgraph/subgraph.yaml) at your deployment —
all three data sources need the new addresses and the deploy block from step 4:

```yaml
source:
  address: "<the contract>"
  startBlock: <the deploy block>
```

Set the same values in [subgraph/src/constants.ts](./subgraph/src/constants.ts),
which carries the pool ID and currency addresses used to attribute swaps.

```bash
cd subgraph
npx graph auth <your Studio deploy key>
npm run codegen && npm run build
npm run deploy -- --version-label 0.1.0
```

Then confirm it is indexing rather than silently empty:

```bash
curl -s -X POST <your query endpoint> -H 'content-type: application/json' \
  -d '{"query":"{ _meta { block { number } hasIndexingErrors } pools { totalSwaps verifiedSwaps unverifiedSwaps } }"}'
```

A synced subgraph with seeded traffic returns non-zero counts. Empty `pools`
with confirmed on-chain swaps means the `SwapPriced` handler is not matching,
and everything downstream is blocked until it does.

`Pool`'s aggregate fields mirror `ProofPoolHook.demoPoolStats` field for field.
Comparing them is the cheapest check that the mapping still agrees with the
chain.

## 8. Run the web app

```bash
cd web && npm run dev
```

- `/` — landing page
- `/verify` — World ID Selfie Check, mints the attestation
- `/swap` — swap through `ProofPoolRouter`, presenting the attestation
- `/dashboard` — live stats

Verification needs a real World App and a Developer Portal app whose `rp_id`,
action, and environment match `web/.env`. A mismatch is rejected before the
proof ever reaches World, with the reason logged server-side.

## Order of operations, and why

Each step invalidates the ones before it if done out of sequence:

1. **Contract events before deploying.** The event surface is the subgraph's
   data contract; changing it means redeploying.
2. **Deploy before seeding.** The hook address is part of the `PoolKey`, so a
   redeploy creates a *different pool*. Traffic seeded against the old one sits
   where nothing will query it.
3. **Seed before the subgraph, or after — either works.** The subgraph backfills
   from `startBlock`, so it picks up traffic seeded before it existed. Seeding
   first just means it syncs the whole history in one pass.

Redeploying the contracts means redoing steps 4 through 7. Budget for it, and
avoid it after seeding.
