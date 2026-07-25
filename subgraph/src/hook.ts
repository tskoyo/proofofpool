import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { SwapPriced } from "../generated/ProofPoolHook/ProofPoolHook"
import {
  Pool,
  Swap,
  Swapper,
  SwapRecord,
  TransactionPoolCursor,
} from "../generated/schema"
import {
  DEMO_CURRENCY0,
  DEMO_CURRENCY1,
  DEMO_POOL_ID,
  DYNAMIC_FEE_FLAG,
  TICK_SPACING,
} from "./constants"

function loadOrCreatePool(event: SwapPriced): Pool {
  let pool = Pool.load(event.params.poolId)
  if (pool == null) {
    pool = new Pool(event.params.poolId)
    pool.hook = event.address

    // PoolManager indexing is intentionally deferred. Seed only the pool whose
    // complete PoolKey is known from this deployment; never invent metadata for
    // another pool that may use the same hook.
    if (event.params.poolId.equals(DEMO_POOL_ID)) {
      pool.currency0 = DEMO_CURRENCY0
      pool.currency1 = DEMO_CURRENCY1
      pool.fee = DYNAMIC_FEE_FLAG
      pool.tickSpacing = TICK_SPACING
    }

    pool.totalSwaps = BigInt.zero()
    pool.verifiedSwaps = BigInt.zero()
    pool.unverifiedSwaps = BigInt.zero()
    pool.verifiedVolume0 = BigInt.zero()
    pool.verifiedVolume1 = BigInt.zero()
    pool.unverifiedVolume0 = BigInt.zero()
    pool.unverifiedVolume1 = BigInt.zero()

    pool.save()
  }
  return pool
}

// Mirrors ProofPoolHook._recordDemoStats so the indexed totals and the
// contract's own can be compared. Volume is the requested exact-input amount,
// attributed to whichever currency was paid in.
function recordPoolAggregates(pool: Pool, event: SwapPriced): void {
  pool.totalSwaps = pool.totalSwaps.plus(BigInt.fromI32(1))
  if (event.params.verified) {
    pool.verifiedSwaps = pool.verifiedSwaps.plus(BigInt.fromI32(1))
  } else {
    pool.unverifiedSwaps = pool.unverifiedSwaps.plus(BigInt.fromI32(1))
  }

  // A positive amountSpecified is exact-output: the number is an amount of the
  // token coming out, so it does not belong in an input-volume total.
  if (event.params.amountSpecified.ge(BigInt.zero())) {
    pool.save()
    return
  }

  let inputAmount = event.params.amountSpecified.neg()
  if (event.params.verified) {
    if (event.params.zeroForOne) {
      pool.verifiedVolume0 = pool.verifiedVolume0.plus(inputAmount)
    } else {
      pool.verifiedVolume1 = pool.verifiedVolume1.plus(inputAmount)
    }
  } else if (event.params.zeroForOne) {
    pool.unverifiedVolume0 = pool.unverifiedVolume0.plus(inputAmount)
  } else {
    pool.unverifiedVolume1 = pool.unverifiedVolume1.plus(inputAmount)
  }

  pool.save()
}

function queueSwap(transactionHash: Bytes, poolId: Bytes, swapId: Bytes): void {
  let cursorId = transactionHash.concat(poolId)
  let cursor = TransactionPoolCursor.load(cursorId)
  if (cursor == null) {
    cursor = new TransactionPoolCursor(cursorId)
    cursor.swapIds = new Array<Bytes>()
    cursor.nextRouterOrdinal = 0
  }

  let swapIds = cursor.swapIds
  swapIds.push(swapId)
  cursor.swapIds = swapIds
  cursor.save()
}

export function handleSwapPriced(event: SwapPriced): void {
  let pool = loadOrCreatePool(event)
  recordPoolAggregates(pool, event)

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
  swap.pool = pool.id
  swap.swapper = swapperId
  swap.verified = event.params.verified
  swap.feeApplied = event.params.feeApplied
  swap.zeroForOne = event.params.zeroForOne
  swap.amountSpecified = event.params.amountSpecified
  swap.digest = event.params.digest
  swap.routerExecuted = false

  let usageRecord = SwapRecord.load(event.params.digest)
  if (usageRecord != null) {
    swap.usageRecord = usageRecord.id
  }

  swap.blockNumber = event.block.number
  swap.timestamp = event.block.timestamp
  swap.transactionHash = event.transaction.hash
  swap.save()

  queueSwap(event.transaction.hash, pool.id, swap.id)
}
