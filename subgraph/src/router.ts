import { SwapExecuted } from "../generated/ProofPoolRouter/ProofPoolRouter"
import { Pool, Swap, TransactionPoolCursor } from "../generated/schema"
import {
  DEMO_CURRENCY0,
  DEMO_CURRENCY1,
  DEMO_POOL_ID,
} from "./constants"

function matchesRouterEvent(swap: Swap, event: SwapExecuted): boolean {
  if (swap.routerExecuted || !swap.swapper.equals(event.params.swapper)) {
    return false
  }

  let expectedTokenIn = swap.zeroForOne ? DEMO_CURRENCY0 : DEMO_CURRENCY1
  let expectedTokenOut = swap.zeroForOne ? DEMO_CURRENCY1 : DEMO_CURRENCY0
  return (
    expectedTokenIn.equals(event.params.tokenIn) &&
    expectedTokenOut.equals(event.params.tokenOut)
  )
}

// SwapPriced fires before SwapExecuted. Keep their hook-created IDs in an
// ordered transaction + pool queue, then enrich the matching ordinal here.
// Wallet and token checks prevent an unrelated hook swap in the transaction
// from being attached to this Router event.
export function handleSwapExecuted(event: SwapExecuted): void {
  let cursor = TransactionPoolCursor.load(event.transaction.hash.concat(DEMO_POOL_ID))
  let pool = Pool.load(DEMO_POOL_ID)
  if (cursor == null || pool == null) {
    return
  }

  let swapIds = cursor.swapIds
  for (let i = cursor.nextRouterOrdinal; i < swapIds.length; i++) {
    let swap = Swap.load(swapIds[i])
    if (swap != null && matchesRouterEvent(swap, event)) {
      swap.tokenIn = event.params.tokenIn
      swap.tokenOut = event.params.tokenOut
      swap.amountIn = event.params.amountIn
      swap.amountOut = event.params.amountOut
      swap.routerExecuted = true
      swap.save()

      cursor.nextRouterOrdinal = i + 1
      cursor.save()
      return
    }
  }
}
