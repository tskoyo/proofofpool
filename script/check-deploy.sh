#!/usr/bin/env bash
#
# Checks whether the last DeployPool broadcast actually landed on-chain.
#
#   ./script/check-deploy.sh
#
# Foundry writes the transactions it broadcast to
# broadcast/DeployPool.s.sol/11155111/run-latest.json, but it only writes the
# receipts once the run finishes cleanly. A timeout, a dropped-then-remined
# transaction, or the divide-by-zero panic in forge's broadcast code all leave
# that file with hashes and no receipts — which says nothing about whether the
# deploy worked. Usually it did.
#
# This reads the hashes back, asks the chain what happened to each, and verifies
# the contracts are wired to each other. Prints nothing secret, sends nothing,
# costs nothing.
#
# Uses SEED_RPC_URL if set — the endpoint that just rate-limited you is a poor
# choice for finding out what it did.

set -euo pipefail
cd "$(dirname "$0")/.."

BROADCAST=${1:-broadcast/DeployPool.s.sol/11155111/run-latest.json}

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v cast >/dev/null || fail "cast not found — install Foundry"
[ -f .env ] || fail "no .env in the repo root"
[ -f "$BROADCAST" ] || fail "no broadcast file at $BROADCAST"

set -a; source .env; set +a
RPC=${SEED_RPC_URL:-${SEPOLIA_RPC_URL:-}}
[ -n "$RPC" ] || fail "neither SEED_RPC_URL nor SEPOLIA_RPC_URL is set"

echo "Checking $BROADCAST"
echo

# --- Transactions -----------------------------------------------------------

mapfile -t ENTRIES < <(python3 -c "
import json
d = json.load(open('$BROADCAST'))
for i, t in enumerate(d.get('transactions', [])):
    name = t.get('contractName') or '-'
    addr = t.get('contractAddress') or '-'
    print(i, t.get('transactionType'), name, addr, t.get('hash'))
")

[ "${#ENTRIES[@]}" -gt 0 ] || fail "no transactions in the broadcast file"

failed=0
missing=0

for entry in "${ENTRIES[@]}"; do
  read -r idx kind name addr hash <<<"$entry"

  # A dropped transaction that was never remined has no receipt at all, which is
  # different from one that reverted. Both matter, for different reasons.
  #
  # `cast receipt <hash> status` prints "1 (success)", not "1" — take the first
  # field, or every confirmed transaction reads as missing.
  status=$(cast receipt "$hash" status --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || echo "")

  case "$status" in
    1|0x1) printf '  [%2s] ok      %-16s %s\n' "$idx" "$kind" "${name}" ;;
    0|0x0) printf '  [%2s] REVERTED %-16s %s  %s\n' "$idx" "$kind" "$name" "$hash"; failed=$((failed + 1)) ;;
    *)     printf '  [%2s] NO RECEIPT %-14s %s  %s\n' "$idx" "$kind" "$name" "$hash"; missing=$((missing + 1)) ;;
  esac

  sleep "${CHECK_DELAY:-1}"
done

echo

# --- Contracts and wiring ---------------------------------------------------

addr_of() {
  python3 -c "
import json
d = json.load(open('$BROADCAST'))
for t in d.get('transactions', []):
    if t.get('contractName') == '$1':
        print(t.get('contractAddress')); break
"
}

ORACLE=$(addr_of LivenessOracle)
REGISTRY=$(addr_of Registry)
ROUTER=$(addr_of ProofPoolRouter)
HOOK=$(addr_of ProofPoolHook)

has_code() {
  local code
  code=$(cast code "$1" --rpc-url "$RPC" 2>/dev/null || echo "0x")
  [ "$code" != "0x" ] && [ -n "$code" ]
}

for pair in "LivenessOracle:$ORACLE" "Registry:$REGISTRY" "ProofPoolRouter:$ROUTER" "ProofPoolHook:$HOOK"; do
  name=${pair%%:*}; addr=${pair#*:}
  if [ -z "$addr" ]; then
    echo "  $name: not in the broadcast file"
    missing=$((missing + 1))
  elif has_code "$addr"; then
    echo "  $name has code at $addr"
  else
    echo "  $name has NO CODE at $addr — it did not deploy"
    failed=$((failed + 1))
  fi
done

echo

# Without this link every recordSwap reverts NotHook and no swap is ever
# discounted, which looks like "verification is broken" rather than a missing
# deploy step. It is the one call most likely to be the casualty of a partial run.
if [ -n "$REGISTRY" ] && [ -n "$HOOK" ]; then
  wired=$(cast call "$REGISTRY" "hook()(address)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || echo "")
  if [ "${wired,,}" = "${HOOK,,}" ]; then
    echo "  Registry.hook is wired to the hook"
  else
    echo "  Registry.hook is '$wired', expected $HOOK"
    echo "     fix with: cast send $REGISTRY 'setHook(address)' $HOOK \\"
    echo "                 --rpc-url \$SEPOLIA_RPC_URL --private-key \$PRIVATE_KEY"
    failed=$((failed + 1))
  fi
fi

# The hook's constructor arguments are immutable, so a mismatch here means the
# mined salt was computed against different addresses and the whole set is wrong.
if [ -n "$HOOK" ]; then
  hook_registry=$(cast call "$HOOK" "REGISTRY()(address)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || echo "")
  hook_router=$(cast call "$HOOK" "TRUSTED_ROUTER()(address)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || echo "")
  [ "${hook_registry,,}" = "${REGISTRY,,}" ] \
    && echo "  Hook points at the deployed Registry" \
    || { echo "  Hook.REGISTRY is '$hook_registry', expected $REGISTRY"; failed=$((failed + 1)); }
  [ "${hook_router,,}" = "${ROUTER,,}" ] \
    && echo "  Hook trusts the deployed router" \
    || { echo "  Hook.TRUSTED_ROUTER is '$hook_router', expected $ROUTER"; failed=$((failed + 1)); }
fi

echo

# --- Liquidity --------------------------------------------------------------
#
# The last transaction of the deploy adds the position. If it is the one that
# got dropped, everything above still passes and the pool exists — but it is
# empty, and every seeded swap reverts on the first tick. Worth its own check.
#
# PoolManager is a v4 singleton, but these demo ERC-20s are used by nothing
# else, so its balance of them is this project's liquidity.
POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543

if [ -n "${TOKEN_USDC:-}" ] && [ -n "${TOKEN_WBTC:-}" ]; then
  usdc_held=$(cast call "$TOKEN_USDC" "balanceOf(address)(uint256)" "$POOL_MANAGER" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  wbtc_held=$(cast call "$TOKEN_WBTC" "balanceOf(address)(uint256)" "$POOL_MANAGER" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')

  # Must track USDC_LIQUIDITY_AMOUNT / WBTC_LIQUIDITY_AMOUNT in DeployPool.s.sol.
  # Compared at half the expected figure: earlier pools on the same tokens push
  # it up, and getLiquidityForAmounts deposits slightly less than requested, so
  # an exact match would be wrong more often than right.
  usdc_min=250000000000 # 250,000 MyUSDC — half of the 500,000 seeded
  wbtc_min=250000000    # 2.5 MyWBTC     — half of the 5 seeded

  if [ "$(python3 -c "print(1 if $usdc_held >= $usdc_min and $wbtc_held >= $wbtc_min else 0)")" -eq 1 ]; then
    echo "  Pool holds $(python3 -c "print($usdc_held/10**6)") MyUSDC and $(python3 -c "print($wbtc_held/10**8)") MyWBTC"
  else
    echo "  Pool holds only $(python3 -c "print($usdc_held/10**6)") MyUSDC and $(python3 -c "print($wbtc_held/10**8)") MyWBTC"
    echo "     — far below the seeded 500,000 / 5. The liquidity transaction likely"
    echo "       did not land; seeded swaps would revert. Re-run the deploy with --resume."
    failed=$((failed + 1))
  fi
fi

echo
echo "=========================================================================="

if [ "$failed" -eq 0 ] && [ "$missing" -eq 0 ]; then
  cat <<SUMMARY
Deploy is complete and wired. Put these in the root .env:

  PROOFPOOL_ORACLE=$ORACLE
  PROOFPOOL_REGISTRY=$REGISTRY
  PROOFPOOL_ROUTER=$ROUTER
  PROOFPOOL_HOOK=$HOOK

and these in web/.env:

  NEXT_PUBLIC_ORACLE_ADDRESS=$ORACLE
  NEXT_PUBLIC_REGISTRY_ADDRESS=$REGISTRY
  NEXT_PUBLIC_ROUTER_ADDRESS=$ROUTER
  NEXT_PUBLIC_HOOK_ADDRESS=$HOOK
SUMMARY
  exit 0
fi

echo "$failed failed check(s), $missing transaction(s) with no receipt."
echo
echo "A transaction with no receipt was dropped and never remined — re-run"
echo "  forge script script/DeployPool.s.sol:DeployPool --rpc-url \$SEPOLIA_RPC_URL \\"
echo "    --private-key \$PRIVATE_KEY --broadcast --resume"
echo "to send just those, rather than deploying a whole new set."
exit 1
