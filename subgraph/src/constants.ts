import { Address, Bytes } from "@graphprotocol/graph-ts"

export const DEMO_POOL_ID = Bytes.fromHexString(
  "0xb5490fe81d9106e211b846e99f7fc153c18841c809502c88d1c2d4da6209de86",
)
export const DEMO_CURRENCY0 = Address.fromString(
  "0x455f89677e869fbb096b53ce611ab1fb580c951f",
)
export const DEMO_CURRENCY1 = Address.fromString(
  "0x936dd0f62ea658f9f0e275fbc7324f5552dc2c91",
)
export const DYNAMIC_FEE_FLAG = 8388608
export const TICK_SPACING = 60
