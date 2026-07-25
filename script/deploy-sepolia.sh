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
USDC_NEEDED=10000000000 # 10,000 MyUSDC (6dp)
WBTC_NEEDED=10000000    # 0.1 MyWBTC   (8dp)

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v forge >/dev/null || fail "forge not found — install Foundry"
command -v cast  >/dev/null || fail "cast not found — install Foundry"

[ -f .env ] || fail "no .env in the repo root — copy .env.example and fill it in"
set -a; source .env; set +a

for var in PRIVATE_KEY SEPOLIA_RPC_URL REGISTRY_ATTESTER WORLD_ID_APP_ID WORLD_ID_ACTION_ID TOKEN_USDC TOKEN_WBTC; do
  [ -n "${!var:-}" ] || fail "$var is not set in .env"
done

# --- Pre-flight -------------------------------------------------------------

# Registry.setAttester is itself onlyAttester, so deploying with an attester
# address nobody holds the key for permanently bricks registration. Catch the
# mismatch here rather than after broadcasting.
if [ -f web/.env ]; then
  attester_key=$(grep -E '^ATTESTER_PRIVATE_KEY=.' web/.env | head -1 | cut -d= -f2- || true)
  if [ -n "${attester_key:-}" ]; then
    derived=$(cast wallet address --private-key "$attester_key")
    if [ "${derived,,}" != "${REGISTRY_ATTESTER,,}" ]; then
      fail "REGISTRY_ATTESTER ($REGISTRY_ATTESTER) is not the address of web/.env's
       ATTESTER_PRIVATE_KEY ($derived). Registration would revert NotAttester,
       and setAttester could never fix it."
    fi
    echo "  attester matches web/.env ($derived)"
  else
    echo "  note: web/.env has no ATTESTER_PRIVATE_KEY yet — cannot cross-check REGISTRY_ATTESTER"
  fi
fi

deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "  deployer: $deployer"

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

forge script script/DeployPool.s.sol:DeployPool \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  ${ETHERSCAN_API_KEY:+--verify} \
  -vvvv

cat <<'NEXT'

Deployed. Copy the addresses logged above into web/.env:

  REGISTRY_ADDRESS=<Registry>
  NEXT_PUBLIC_REGISTRY_ADDRESS=<Registry>     # same value
  NEXT_PUBLIC_HOOK_ADDRESS=<ProofPoolHook>
  RPC_URL=<your Sepolia RPC>
  NEXT_PUBLIC_RPC_URL=<your Sepolia RPC>

Then fund the attester address with Sepolia ETH — it pays gas for every
registerVerifiedHuman call, and registrations fail silently without it.
NEXT
