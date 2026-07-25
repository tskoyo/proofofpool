import {
  DiscountedSwapRecorded,
  HookUpdated,
  MaxSwapsUpdated,
} from "../generated/Registry/Registry"
import {
  DiscountedSwapUse,
  SwapRecord,
  RegistryConfig,
} from "../generated/schema"

export function handleSwapRecorded(event: DiscountedSwapRecorded): void {
  let record = SwapRecord.load(event.params.digest)
  if (record == null) {
    record = new SwapRecord(event.params.digest)
  }
  record.usageCount = event.params.newCount
  record.save()

  let use = new DiscountedSwapUse(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  use.record = record.id
  use.digest = event.params.digest
  use.newCount = event.params.newCount
  use.transactionHash = event.transaction.hash
  use.blockNumber = event.block.number
  use.timestamp = event.block.timestamp
  use.save()
}

export function handleHookUpdated(event: HookUpdated): void {
  let config = RegistryConfig.load(event.address)
  if (config == null) {
    config = new RegistryConfig(event.address)
  }
  config.hook = event.params.newHook
  config.save()
}

export function handleMaxSwapsUpdated(event: MaxSwapsUpdated): void {
  let config = RegistryConfig.load(event.address)
  if (config == null) {
    config = new RegistryConfig(event.address)
  }
  config.maxSwaps = event.params.newMaxSwaps
  config.save()
}
