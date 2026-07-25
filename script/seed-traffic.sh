#!/usr/bin/env bash
#
# Seeds the pool with synthetic demo traffic for the subgraph and the Pool
# Guardian agent to reason over.
#
#   ./script/seed-traffic.sh                    # 30 ticks, 20s apart
#   ./script/seed-traffic.sh 50 20              # 50 ticks, 20s apart
#   ./script/seed-traffic.sh --resume           # continue from the checkpoint tick
#   ./script/seed-traffic.sh --restart          # ignore the checkpoint, start at 0
#   ./script/seed-traffic.sh --dry-run          # price it, send nothing
#   ./script/seed-traffic.sh --yes              # no confirmation prompt
#   ./script/seed-traffic.sh --gentle           # for a tightly rate-limited RPC
#
# RATE LIMITS. Normally a tick's swaps are broadcast together — they come from
# different wallets, so nothing orders them. That means ~10-25 sends in under a
# second, which trips any limit below roughly 15 req/s.
#
# --gentle serialises them instead (forge --slow: one transaction, wait for its
# receipt, next). Request rate drops to ~1/s, and a run that takes 30-45 minutes
# normally takes 1.5-2 hours. Use it on a 5-10 req/s free tier. Above ~15 req/s
# you do not need it.
#
# SEED_RPC_URL points seeding at a different endpoint from the app's
# SEPOLIA_RPC_URL, so a second free-tier key can absorb this run's traffic
# without touching the quota the demo itself depends on.
#
# RESUMING. Every completed tick is recorded in .seed-progress, and a re-run
# picks up from the next one. This matters more than it sounds: ticks are not
# idempotent — re-running tick 12 sends its swaps a second time, doubling that
# slice of the history and paying for it twice. If a run dies partway, use
# --resume, not a fresh start. --restart is the deliberate override.
#
# --resume changes only the starting tick. Wallet funding and setup run every
# time: both are idempotent, and skipping them would strand the wallets whose
# archetype was idle in the earlier tick range and so was never funded.
#
# This is SYNTHETIC TESTNET TRAFFIC and must be described as such in the demo and
# the submission. The point is to plant behaviour the agent can then be shown
# finding — bot cadence, allowance burn, the 2x attestation overlap — not to
# imply organic usage. See README.md.
#
# Run it AFTER a deploy: the hook address is part of the PoolKey, so traffic
# seeded against an older deployment sits in a pool the dashboard never queries.
#
# Costs real Sepolia ETH. The run is priced from a dry pass over the exact same
# dispatch code before anything is sent, and you are asked before it spends.
#
# Ticks are separate forge invocations on purpose — one invocation broadcasts its
# whole batch into a couple of consecutive blocks, and a history where every swap
# shares a timestamp makes cadence analysis meaningless.

set -euo pipefail
cd "$(dirname "$0")/.."

TICKS=30
SLEEP_SECONDS=20
RESUME=0
RESTART=0
DRY_RUN=0
ASSUME_YES=0
GENTLE=0
PROGRESS_FILE=${SEED_PROGRESS_FILE:-.seed-progress}

for arg in "$@"; do
  case "$arg" in
    --resume)  RESUME=1 ;;
    --restart) RESTART=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    --gentle)  GENTLE=1 ;;
    *)
      if   [ "$TICKS" = 30 ] && [[ "$arg" =~ ^[0-9]+$ ]]; then TICKS=$arg
      elif [[ "$arg" =~ ^[0-9]+$ ]]; then SLEEP_SECONDS=$arg
      else echo "ERROR: unrecognised argument '$arg'" >&2; exit 1
      fi ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- Checkpoint -------------------------------------------------------------
#
# Ticks are not idempotent: re-running one sends its swaps again, doubling that
# slice of the history and paying for it twice. The checkpoint is what makes a
# half-finished run recoverable instead of a choice between duplicate traffic
# and starting over.

START_TICK=0

if [ "$RESTART" -eq 1 ]; then
  rm -f "$PROGRESS_FILE"
elif [ -f "$PROGRESS_FILE" ]; then
  last_done=$(cat "$PROGRESS_FILE" 2>/dev/null || echo "")
  if [[ "$last_done" =~ ^[0-9]+$ ]]; then
    START_TICK=$((last_done + 1))
    if [ "$RESUME" -ne 1 ]; then
      echo "A previous run reached tick $last_done ($PROGRESS_FILE)."
      echo "Re-sending those ticks would duplicate that traffic and pay for it twice."
      echo
      echo "  --resume   continue from tick $START_TICK"
      echo "  --restart  discard the checkpoint and seed from tick 0"
      exit 1
    fi
    echo "  resuming from tick $START_TICK (previous run reached $last_done)"
  fi
fi

if [ "$START_TICK" -ge "$TICKS" ] && [ "$DRY_RUN" -ne 1 ]; then
  echo "Nothing to do: the checkpoint is already at tick $((START_TICK - 1)) of $((TICKS - 1))."
  echo "Raise the tick count to extend the history, or --restart to seed afresh."
  exit 0
fi

command -v forge >/dev/null || fail "forge not found — install Foundry"
command -v cast  >/dev/null || fail "cast not found — install Foundry"
command -v python3 >/dev/null || fail "python3 not found — needed for wei arithmetic"

[ -f .env ] || fail "no .env in the repo root — copy .env.example and fill it in"
set -a; source .env; set +a

for var in PRIVATE_KEY SEPOLIA_RPC_URL TOKEN_USDC TOKEN_WBTC \
           PROOFPOOL_ROUTER PROOFPOOL_REGISTRY PROOFPOOL_ORACLE PROOFPOOL_HOOK; do
  [ -n "${!var:-}" ] || fail "$var is not set in .env (the PROOFPOOL_* addresses come from the deploy)"
done

# Foundry's test mnemonic is public knowledge, and its addresses are watched by
# sweeper bots on every public testnet. ETH sent to them is gone within seconds
# — the funding loop reports success, the transfers confirm, and the wallets are
# empty by the time the next step reads them. Fine for local tests, fatal here.
DEFAULT_MNEMONIC="test test test test test test test test test test test junk"
if [ -z "${SEED_MNEMONIC:-}" ] || [ "$SEED_MNEMONIC" = "$DEFAULT_MNEMONIC" ]; then
  fail "SEED_MNEMONIC is unset, so seeding would use Foundry's public test mnemonic.
       Those addresses are swept by bots within seconds of being funded — the
       transfers succeed and the wallets are empty immediately after.

       Generate a throwaway one and put it in the root .env:

         cast wallet new-mnemonic

         SEED_MNEMONIC=\"<the twelve words>\"

       It only ever holds testnet gas, but it must not be a mnemonic anyone
       else knows."
fi

# Seeding is by far the heaviest RPC consumer in this repo. Pointing it at a
# separate endpoint keeps it off the quota the demo itself runs on.
RPC=${SEED_RPC_URL:-$SEPOLIA_RPC_URL}
[ "$RPC" = "$SEPOLIA_RPC_URL" ] || echo "  using SEED_RPC_URL for seeding, not the app's endpoint"

# A slow free-tier endpoint needs room before forge gives up waiting on a
# receipt — the failure the deploy script kept hitting.
export ETH_RPC_TIMEOUT="${ETH_RPC_TIMEOUT:-120}"

if [ "$GENTLE" -eq 1 ]; then
  TICK_FLAGS=(--slow)
  SEED_FUND_DELAY=${SEED_FUND_DELAY:-5}
  echo "  gentle mode: transactions sent one at a time (~1 req/s, much slower)"
else
  TICK_FLAGS=()
  SEED_FUND_DELAY=${SEED_FUND_DELAY:-2}
fi

# The seeder signs attestations directly with the attester key — seed wallets
# never touch World. Same key the backend uses, so the contracts cannot tell the
# difference; it lives in web/.env, like deploy-sepolia.sh assumes.
if [ -z "${ATTESTER_PRIVATE_KEY:-}" ]; then
  [ -f web/.env ] || fail "ATTESTER_PRIVATE_KEY is not set and web/.env does not exist"
  ATTESTER_PRIVATE_KEY=$(grep -E '^ATTESTER_PRIVATE_KEY=.' web/.env | head -1 | cut -d= -f2- || true)
  [ -n "$ATTESTER_PRIVATE_KEY" ] || fail "web/.env has no ATTESTER_PRIVATE_KEY — no swap could be discounted"
  export ATTESTER_PRIVATE_KEY
fi

# --- Pre-flight -------------------------------------------------------------

# A mismatch here means every seeded "verified" swap silently prices at the full
# fee, and the whole point of the history — the verified/unverified split — is
# lost. Cheap to check, expensive to discover after paying for the run.
attester_address=$(cast wallet address --private-key "$ATTESTER_PRIVATE_KEY")
onchain_signer=$(cast call "$PROOFPOOL_ORACLE" "trustedSigner()(address)" --rpc-url "$RPC" | awk '{print $1}')
if [ "${attester_address,,}" != "${onchain_signer,,}" ]; then
  fail "attester key is $attester_address but LivenessOracle trusts $onchain_signer.
       Every seeded verified swap would price at the unverified fee."
fi
echo "  attester matches oracle ($attester_address)"

# The hook address is baked into the PoolKey, so a stale one addresses a pool
# that was never initialized and every swap reverts.
hook_code=$(cast code "$PROOFPOOL_HOOK" --rpc-url "$RPC")
[ "$hook_code" != "0x" ] || fail "no contract at PROOFPOOL_HOOK ($PROOFPOOL_HOOK) — redeploy first"

# Production runs hour-long epochs; a seeding run lasts minutes. Left at 3600
# every wallet would hold one attestation for the entire history and the
# verified side would barely move. See SeedBase._epochSeconds.
if [ "${SEED_EPOCH_SECONDS:-120}" -gt "$((TICKS * SLEEP_SECONDS / 3))" ]; then
  echo "  NOTE: SEED_EPOCH_SECONDS=${SEED_EPOCH_SECONDS:-120} is long relative to this run"
  echo "        (~$((TICKS * SLEEP_SECONDS / 60)) min). Few epochs will turn over, so expect"
  echo "        little re-verification in the history."
fi

# --- Pricing ----------------------------------------------------------------
#
# plan() walks the identical dispatch run() does, counting instead of sending.
# An estimate computed by a separate code path drifts from what actually runs.

echo
echo "Pricing $TICKS ticks..."

plan_output=$(forge script script/SeedTraffic.s.sol:SeedTraffic --sig "plan(uint256)" "$TICKS" \
  --rpc-url "$RPC" 2>&1) || fail "planning failed:
$plan_output"

plan_field() { echo "$plan_output" | grep -oE "$1 [0-9]+" | head -1 | awk '{print $2}'; }

TOTAL_SWAPS=$(plan_field PLAN_SWAPS)
VERIFIED=$(plan_field PLAN_VERIFIED)
UNVERIFIED=$(plan_field PLAN_UNVERIFIED)
TOTAL_GAS=$(plan_field PLAN_GAS)
GAS_PER_WALLET=$(plan_field PLAN_GAS_PER_WALLET)
BUSIEST=$(plan_field PLAN_BUSIEST_WALLET_SWAPS)
WALLET_COUNT=$(plan_field PLAN_WALLETS)

[ -n "$TOTAL_SWAPS" ] || fail "could not parse the plan output:
$plan_output"

gas_price=$(cast gas-price --rpc-url "$RPC")

# Gas prices move between pricing and the last tick, and a wallet that runs dry
# mid-run leaves a lopsided history rather than an obvious failure. Fund at a
# multiple of the estimate; unspent ETH stays in the wallets.
SAFETY=${SEED_SAFETY_FACTOR:-3}
bare_cost=$(python3 -c "print($TOTAL_GAS * $gas_price)")

# Per-wallet funding, sized to what each archetype will actually do. A bot swaps
# every tick and retail roughly every third, so funding everyone at the busiest
# wallet's rate would over-allocate several times over — which matters when the
# supply is a faucet.
# Declared first: mapfile leaves the name unset when its input is empty, and
# `${#WALLET_GAS[@]}` on an unset array is an unbound-variable error under set -u.
WALLET_GAS=()
mapfile -t WALLET_GAS < <(echo "$plan_output" | grep -oE 'PLAN_WALLET_GAS [0-9]+ [0-9]+' | sort -k2 -n | awk '{print $NF}')

# Floor, in gas, under the proportional figure. A wallet can legitimately be
# planned for zero swaps — an overlapper first fires at tick 5, so a 3-tick run
# allocates it nothing — and then it holds no gas at all, which SeedWallets
# cannot mint or approve from. It also has to survive the tick range growing on
# a later --resume, when archetypes that were idle start trading.
FLOOR_GAS=${SEED_FLOOR_GAS:-1300000} # ~5 swaps

if [ "${#WALLET_GAS[@]}" -eq "$WALLET_COUNT" ] && [ -z "${SEED_ETH_PER_WALLET:-}" ]; then
  WALLET_FUNDING=()
  for g in "${WALLET_GAS[@]}"; do
    WALLET_FUNDING+=("$(python3 -c "print(max($g, $FLOOR_GAS) * $gas_price * $SAFETY)")")
  done
  total_funding=$(python3 -c "print(sum([$(IFS=,; echo "${WALLET_FUNDING[*]}")]))")
else
  # Explicit override, or the per-wallet figures could not be parsed: fall back
  # to funding every wallet for the busiest one's workload.
  ETH_PER_WALLET=${SEED_ETH_PER_WALLET:-$(python3 -c "print($GAS_PER_WALLET * $gas_price * $SAFETY)")}
  WALLET_FUNDING=()
  for (( i=0; i<WALLET_COUNT; i++ )); do WALLET_FUNDING+=("$ETH_PER_WALLET"); done
  total_funding=$(python3 -c "print($WALLET_COUNT * $ETH_PER_WALLET)")
fi

deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
balance=$(cast balance "$deployer" --rpc-url "$RPC")

cat <<SUMMARY

  wallets:        $WALLET_COUNT  (busiest does $BUSIEST swaps)
  swaps:          $TOTAL_SWAPS  ($VERIFIED verified / $UNVERIFIED unverified)
  gas:            $TOTAL_GAS
  gas price:      $(cast from-wei "$gas_price" gwei) gwei
  ---
  gas cost:       $(cast from-wei "$bare_cost") ETH
  funding needed: $(cast from-wei "$total_funding") ETH  (${SAFETY}x headroom, per archetype; unspent stays in the wallets)
  deployer has:   $(cast from-wei "$balance") ETH
SUMMARY

if [ "$(python3 -c "print(1 if $balance < $total_funding else 0)")" -eq 1 ]; then
  fail "not enough Sepolia ETH. Lower the tick count, lower SEED_WALLET_COUNT,
       lower SEED_SAFETY_FACTOR, or top up from a faucet."
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "Dry run — nothing sent."
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  echo
  read -rp "Spend it? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# --- Wallet setup -----------------------------------------------------------

# Always run, including on --resume. Both steps are idempotent — funded wallets
# are skipped, minted and approved ones are skipped — and skipping them on a
# resume would strand exactly the wallets that need attention: an archetype idle
# during the first tick range starts trading in a later one, having never been
# funded because it was planned for nothing at the time.
echo
echo "Deriving seed wallet addresses..."

# Derivation happens in Solidity only. Re-deriving the mnemonic in bash would
# be a second implementation, and a derivation-path mismatch would send the
# gas to addresses that never swap.
wallet_output=$(forge script script/SeedWallets.s.sol:SeedWallets --sig "walletList()" \
  --rpc-url "$RPC" 2>&1) || fail "could not list seed wallets:
$wallet_output"

SEED_ADDRESSES=()
mapfile -t SEED_ADDRESSES < <(echo "$wallet_output" | grep -oE '^\s+WALLET [0-9]+ [a-z]+ 0x[0-9a-fA-F]{40}' | awk '{print $NF}')

[ "${#SEED_ADDRESSES[@]}" -eq "$WALLET_COUNT" ] \
  || fail "expected $WALLET_COUNT seed addresses, parsed ${#SEED_ADDRESSES[@]}"

echo "Funding ${#SEED_ADDRESSES[@]} wallets from $deployer..."

# Sent with cast, not from inside the forge script: value sent within a script
# leaves the script contract's balance during simulation rather than the
# broadcasting EOA's. Doing it here also makes each transfer individually
# visible and the whole step resumable — top-ups skip wallets already funded.
for i in "${!SEED_ADDRESSES[@]}"; do
  addr=${SEED_ADDRESSES[$i]}
  want=${WALLET_FUNDING[$i]}
  have=$(cast balance "$addr" --rpc-url "$RPC")

  if [ "$(python3 -c "print(1 if $have >= $want else 0)")" -eq 1 ]; then
    echo "  [$i] $addr already has $(cast from-wei "$have") ETH"
    continue
  fi

  top_up=$(python3 -c "print($want - $have)")
  echo "  [$i] $addr <- $(cast from-wei "$top_up") ETH"
  cast send "$addr" --value "$top_up" \
    --rpc-url "$RPC" \
    --private-key "$PRIVATE_KEY" \
    >/dev/null

  # Free-tier RPCs rate-limit on requests per second, and this loop is the
  # burstiest part of the run.
  sleep "$SEED_FUND_DELAY"
done

echo
echo "Minting tokens and approving the router..."
# --slow: each wallet broadcasts its own mint/approve, and a one-time setup is
# worth doing gently on a free-tier key.
forge script script/SeedWallets.s.sol:SeedWallets \
  --rpc-url "$RPC" \
  --broadcast \
  --slow

# --- Traffic ----------------------------------------------------------------

remaining=$((TICKS - START_TICK))
echo
echo "Seeding ticks $START_TICK..$((TICKS - 1)), ${SLEEP_SECONDS}s apart (~$((remaining * SLEEP_SECONDS / 60)) minutes)."
echo "Interrupt with Ctrl-C at any point — the history so far stays valid and"
echo "--resume picks up from the last completed tick."
echo

failed_ticks=0

for (( tick=START_TICK; tick<TICKS; tick++ )); do
  echo "--- tick $tick / $((TICKS - 1)) ---"

  # By default no --slow: a tick's swaps come from different wallets, so nothing
  # orders them and they land together in a block or two. That is a burst of
  # ~10-25 sends, which a free tier under ~15 req/s will reject — pass --gentle
  # to serialise them instead.
  #
  # One retry with a longer pause, because the common failure on a free-tier key
  # is a transient rate limit rather than anything wrong with the tick.
  attempt=0
  until forge script script/SeedTraffic.s.sol:SeedTraffic --sig "run(uint256)" "$tick" \
          --rpc-url "$RPC" \
          --broadcast \
          "${TICK_FLAGS[@]}" \
          >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 2 ]; then
      echo "    tick $tick failed twice — skipping. Re-run that tick with -vvvv to see why."
      failed_ticks=$((failed_ticks + 1))
      break
    fi
    echo "    tick $tick failed, backing off $((SLEEP_SECONDS * 2))s and retrying once"
    sleep "$((SLEEP_SECONDS * 2))"
  done

  # Recorded even for a skipped tick. A failed tick may still have broadcast
  # some of its swaps before dying, so replaying it would duplicate those —
  # a gap in the history is cheaper to live with than double-counted traffic.
  echo "$tick" > "$PROGRESS_FILE"

  [ "$tick" -lt "$((TICKS - 1))" ] && sleep "$SLEEP_SECONDS"
done

echo
[ "$failed_ticks" -eq 0 ] || echo "$failed_ticks tick(s) were skipped — the history has gaps but is still valid."

cat <<'NEXT'
Seeding complete.

Before the demo, tighten the cap so the mechanism is legible on stage:

  cast send $PROOFPOOL_REGISTRY "setMaxSwaps(uint256)" 1 \
    --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY

setMaxSwaps only affects future swaps, so the seeded history keeps the varied
burn-down the agent has something to say about, while a live verify-then-swap
demo shows the discount ending after exactly one swap.
NEXT
