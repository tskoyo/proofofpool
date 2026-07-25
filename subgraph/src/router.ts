import { SwapExecuted } from "../generated/ProofPoolRouter/ProofPoolRouter"
import { Swap } from "../generated/schema"

// SwapPriced (hook) and SwapExecuted (router) fire in the same transaction —
// the hook's beforeSwap runs inside the router's unlock callback. The Swap
// entity is keyed by tx hash + the hook's log index, so find it by scanning
// this transaction's logs for the one the hook handler already created.
export function handleSwapExecuted(event: SwapExecuted): void {
  let txHash = event.transaction.hash
  let receipt = event.receipt
  if (receipt == null) {
    return
  }

  for (let i = 0; i < receipt.logs.length; i++) {
    let log = receipt.logs[i]
    let id = txHash.concatI32(log.logIndex.toI32())
    let swap = Swap.load(id)
    if (swap != null) {
      swap.tokenIn = event.params.tokenIn
      swap.tokenOut = event.params.tokenOut
      swap.amountIn = event.params.amountIn
      swap.amountOut = event.params.amountOut
      swap.save()
      return
    }
  }
}
