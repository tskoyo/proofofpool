#!/usr/bin/env bash
#
# Sends demo tokens from the deployer to another wallet — for funding a second
# wallet so you can demo verified vs unverified pricing side by side.
#
#   ./script/send-tokens.sh                          # prompts for everything
#   ./script/send-tokens.sh 0xRecipient 250          # 250 MyUSDC
#   ./script/send-tokens.sh 0xRecipient 0.05 wbtc    # 0.05 MyWBTC
#
# Reads TOKEN_USDC / TOKEN_WBTC, PRIVATE_KEY and SEPOLIA_RPC_URL from the root
# .env. Decimals and symbol are read from the token contract rather than
# hardcoded, so this stays correct if the pair is redeployed.
#
# Note: MockERC20.mint is public and unrestricted, so you can also create tokens
# out of thin air instead of spending the deployer's balance:
#
#   cast send $TOKEN_USDC "mint(address,uint256)" <wallet> <baseUnits> \
#     --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY

set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v cast >/dev/null || fail "cast not found — install Foundry"
[ -f .env ] || fail "no .env in the repo root"
set -a; source .env; set +a

for var in PRIVATE_KEY SEPOLIA_RPC_URL TOKEN_USDC TOKEN_WBTC; do
  [ -n "${!var:-}" ] || fail "$var is not set in .env"
done

RECIPIENT=${1:-}
AMOUNT=${2:-}
WHICH=${3:-usdc}

[ -n "$RECIPIENT" ] || read -rp "Recipient address: " RECIPIENT
[ -n "$AMOUNT" ]    || read -rp "Amount (whole tokens): " AMOUNT

[[ "$RECIPIENT" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "'$RECIPIENT' is not a 20-byte address"
[[ "$AMOUNT" =~ ^[0-9]+(\.[0-9]+)?$ ]]    || fail "'$AMOUNT' is not a positive number"

case "${WHICH,,}" in
  usdc) TOKEN=$TOKEN_USDC ;;
  wbtc) TOKEN=$TOKEN_WBTC ;;
  *)    fail "unknown token '$WHICH' — use 'usdc' or 'wbtc'" ;;
esac

SENDER=$(cast wallet address --private-key "$PRIVATE_KEY")
SYMBOL=$(cast call "$TOKEN" "symbol()(string)" --rpc-url "$SEPOLIA_RPC_URL" | tr -d '"')
DECIMALS=$(cast call "$TOKEN" "decimals()(uint8)" --rpc-url "$SEPOLIA_RPC_URL" | awk '{print $1}')

# Decimal, not float — 0.1 in binary floating point is not 0.1, and rounding a
# token amount is not an acceptable outcome.
RAW=$(python3 -c "from decimal import Decimal; print(int(Decimal('$AMOUNT') * (10 ** $DECIMALS)))")
[ "$RAW" != "0" ] || fail "$AMOUNT $SYMBOL rounds to 0 base units at $DECIMALS decimals"

BALANCE=$(cast call "$TOKEN" "balanceOf(address)(uint256)" "$SENDER" --rpc-url "$SEPOLIA_RPC_URL" | awk '{print $1}')
if [ "$(echo "$BALANCE < $RAW" | bc)" -eq 1 ]; then
  HUMAN=$(python3 -c "from decimal import Decimal; print(Decimal('$BALANCE') / (10 ** $DECIMALS))")
  fail "sender holds $HUMAN $SYMBOL, needs $AMOUNT"
fi

echo "  from:   $SENDER"
echo "  to:     $RECIPIENT"
echo "  amount: $AMOUNT $SYMBOL ($RAW base units, $DECIMALS decimals)"
read -rp "Send? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

cast send "$TOKEN" "transfer(address,uint256)" "$RECIPIENT" "$RAW" \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY"

NEW=$(cast call "$TOKEN" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$SEPOLIA_RPC_URL" | awk '{print $1}')
echo "Recipient now holds $(python3 -c "from decimal import Decimal; print(Decimal('$NEW') / (10 ** $DECIMALS))") $SYMBOL"
