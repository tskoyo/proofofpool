#!/usr/bin/env bash
#
# Deploys Registry + ProofPoolRouter + ProofPoolHook to Sepolia, initializes the
# WETH/USDC pool and seeds it with liquidity.
#
#   ./script/deploy-sepolia.sh
#
# Everything is read from the root .env (see .env.example). The pre-flight checks
# below exist because each of these failures is either expensive or unrecoverable
# once broadcast.

set -euo pipefail
cd "$(dirname "$0")/.."

# Must match the *_LIQUIDITY_AMOUNT constants in DeployPool.s.sol.
USDC_NEEDED=500000000000 # 500,000 MyUSDC (6dp)
WBTC_NEEDED=500000000    # 5 MyWBTC       (8dp)

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v forge >/dev/null || fail "forge not found — install Foundry"
command -v cast  >/dev/null || fail "cast not found — install Foundry"

[ -f .env ] || fail "no .env in the repo root — copy .env.example and fill it in"
set -a; source .env; set +a

for var in PRIVATE_KEY SEPOLIA_RPC_URL TRUSTED_SIGNER CONTRACTS_OWNER MAX_SWAPS TOKEN_USDC TOKEN_WBTC; do
  [ -n "${!var:-}" ] || fail "$var is not set in .env"
done

# --- Pre-flight -------------------------------------------------------------

# TRUSTED_SIGNER must be the address of the key the backend signs attestations
# with, or every attestation fails signature recovery and nobody is ever
# discounted. Recoverable via setTrustedSigner, but only by the owner.
if [ -f web/.env ]; then
  attester_key=$(grep -E '^ATTESTER_PRIVATE_KEY=.' web/.env | head -1 | cut -d= -f2- || true)
  if [ -n "${attester_key:-}" ]; then
    derived=$(cast wallet address --private-key "$attester_key")
    if [ "${derived,,}" != "${TRUSTED_SIGNER,,}" ]; then
      fail "TRUSTED_SIGNER ($TRUSTED_SIGNER) is not the address of web/.env's
       ATTESTER_PRIVATE_KEY ($derived). Every attestation would fail signature
       recovery and no swap would ever be discounted."
    fi
    echo "  trusted signer matches web/.env ($derived)"
  else
    echo "  note: web/.env has no ATTESTER_PRIVATE_KEY yet — cannot cross-check TRUSTED_SIGNER"
  fi
fi

deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "  deployer: $deployer"

# The script calls registry.setHook() inline only when the owner is the
# deployer; otherwise it prints a manual step that is easy to miss.
if [ "${CONTRACTS_OWNER,,}" != "${deployer,,}" ]; then
  echo "  NOTE: CONTRACTS_OWNER ($CONTRACTS_OWNER) is not the deployer."
  echo "        You must call registry.setHook(<hook>) as the owner after this run,"
  echo "        or no swap can ever take the discount."
fi

balance=$(cast balance "$deployer" --rpc-url "$SEPOLIA_RPC_URL")
[ "$balance" != "0" ] || fail "deployer has no Sepolia ETH"
echo "  balance:  $(cast from-wei "$balance") ETH"

# The script seeds liquidity by transferring from the deployer, so a missing
# token balance reverts partway through — after the contracts are already live.
check_token() {
  local token=$1 needed=$2 label=$3 decimals=$4
  local have human_have human_needed
  have=$(cast call "$token" "balanceOf(address)(uint256)" "$deployer" --rpc-url "$SEPOLIA_RPC_URL" | awk '{print $1}')
  if [ "$(echo "$have < $needed" | bc)" -eq 1 ]; then
    human_have=$(echo "scale=$decimals; $have / (10 ^ $decimals)" | bc)
    human_needed=$(echo "scale=$decimals; $needed / (10 ^ $decimals)" | bc)
    fail "deployer holds $human_have $label but the deploy seeds liquidity with
       $human_needed $label. Top up, or lower the *_LIQUIDITY_AMOUNT constants
       in DeployPool.s.sol."
  fi
  echo "  $label balance sufficient"
}

check_token "$TOKEN_USDC" "$USDC_NEEDED" MyUSDC 6
check_token "$TOKEN_WBTC" "$WBTC_NEEDED" MyWBTC 8

# --- Deploy -----------------------------------------------------------------

echo
echo "Deploying to Sepolia..."

# A slow or flaky RPC times out waiting for receipts even though the
# transactions landed. Re-running from scratch would deploy a second set of
# contracts and leave the first orphaned; `forge script --resume` reads the
# broadcast file, finds what already confirmed, and continues from there. That
# is the correct recovery, so try it automatically before giving up.
#
# ETH_RPC_TIMEOUT gives a slow free-tier endpoint room before the first attempt
# gives up at all.
export ETH_RPC_TIMEOUT="${ETH_RPC_TIMEOUT:-120}"

deploy() {
  forge script script/DeployPool.s.sol:DeployPool \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    ${ETHERSCAN_API_KEY:+--verify} \
    "$@" \
    -vvvv
}

if ! deploy; then
  echo
  echo "Deploy did not complete. Retrying with --resume, which picks up the"
  echo "transactions that already confirmed rather than deploying a second set."
  echo
  sleep 10
  deploy --resume || fail "resume failed too. Inspect broadcast/DeployPool.s.sol/11155111/
       to see what confirmed before re-running anything — a fresh run deploys a
       whole new set of contracts and orphans the first."
fi

cat <<'NEXT'

Deployed. The four addresses logged above go in TWO places.

1. web/.env — for the app:

  NEXT_PUBLIC_ORACLE_ADDRESS=<LivenessOracle>
  NEXT_PUBLIC_REGISTRY_ADDRESS=<Registry>
  NEXT_PUBLIC_HOOK_ADDRESS=<ProofPoolHook>
  NEXT_PUBLIC_ROUTER_ADDRESS=<ProofPoolRouter>
  NEXT_PUBLIC_RPC_URL=<your Sepolia RPC>

2. The root .env — for script/seed-traffic.sh, which cannot read web/.env:

  PROOFPOOL_ORACLE=<LivenessOracle>
  PROOFPOOL_REGISTRY=<Registry>
  PROOFPOOL_HOOK=<ProofPoolHook>
  PROOFPOOL_ROUTER=<ProofPoolRouter>

The oracle address is part of the EIP-712 domain, so getting it wrong produces
signatures the contract rejects. The attester key only signs and never sends a
transaction, so it does NOT need to be funded.

The hook address is part of the PoolKey, so this is a brand new pool: any older
attestation is dead, and any traffic seeded against the previous deployment sits
in a pool nothing will query. The web app reads the hook from
NEXT_PUBLIC_HOOK_ADDRESS, so there is no source file to edit.

Then seed the demo history:

  ./script/seed-traffic.sh --dry-run     # price it first
NEXT
