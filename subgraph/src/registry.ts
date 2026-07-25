import {
  DiscountedSwapRecorded,
  HookUpdated,
  MaxSwapsUpdated,
} from "../generated/Registry/Registry"
import { SwapRecord, RegistryConfig } from "../generated/schema"

export function handleSwapRecorded(event: DiscountedSwapRecorded): void {
  let record = SwapRecord.load(event.params.digest)
  if (record == null) {
    record = new SwapRecord(event.params.digest)
  }
  record.usageCount = event.params.newCount
  record.save()
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
