import { BigInt } from "@graphprotocol/graph-ts"
import { SwapPriced } from "../generated/ProofPoolHook/ProofPoolHook"
import { Swap, Swapper } from "../generated/schema"

export function handleSwapPriced(event: SwapPriced): void {
  let swapperId = event.params.swapper
  let swapper = Swapper.load(swapperId)
  if (swapper == null) {
    swapper = new Swapper(swapperId)
    swapper.totalSwaps = BigInt.zero()
    swapper.verifiedSwaps = BigInt.zero()
  }
  swapper.totalSwaps = swapper.totalSwaps.plus(BigInt.fromI32(1))
  if (event.params.verified) {
    swapper.verifiedSwaps = swapper.verifiedSwaps.plus(BigInt.fromI32(1))
  }
  swapper.save()

  let id = event.transaction.hash.concatI32(event.logIndex.toI32())
  let swap = new Swap(id)
  swap.swapper = swapperId
  swap.verified = event.params.verified
  swap.feeApplied = event.params.feeApplied
  swap.amountSpecified = event.params.amountSpecified
  swap.blockNumber = event.block.number
  swap.timestamp = event.block.timestamp
  swap.transactionHash = event.transaction.hash
  swap.save()
}
