// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {LivenessAttestation} from "./LivenessOracle.sol";
import {Registry} from "./Registry.sol";

/// @title ProofPoolHook
/// @notice A Uniswap v4 hook that charges verified-human swappers a low fee and
///         everyone else a higher one. The premium collected from unverified flow
///         accrues to LPs through v4's standard fee accounting.
/// @dev This is the entire mechanism. It does not detect bots or sandwich
///      patterns — it prices one boolean.
contract ProofPoolHook is BaseHook {
    using LPFeeLibrary for uint24;
    using PoolIdLibrary for PoolKey;

    error InvalidTrustedRouter();
    error InvalidRegistry();

    /// @notice Fee applied to verified-human swappers, in v4 fee units (100 = 0.01%).
    uint24 public constant VERIFIED_FEE = 500; // 0.05%

    /// @notice Fee applied to everyone else.
    uint24 public constant UNVERIFIED_FEE = 3000; // 0.30%

    /// @dev Hook data carrying only an address and no attestation. Anything of this
    ///      length is treated as an unverified swap rather than decoded further.
    uint256 private constant ADDRESS_ONLY_HOOK_DATA_LENGTH = 32;

    /// @notice Tracks attestation validity and how many discounted swaps remain.
    Registry public immutable REGISTRY;

    /// @notice The only router allowed to identify the wallet behind a swap.
    address public immutable TRUSTED_ROUTER;

    /// @notice Emitted for every swap this hook prices, discounted or not.
    /// @param poolId Pool the swap ran against. One hook deployment can serve
    ///        several pools, so consumers must filter on this rather than assume.
    /// @param swapper Wallet the fee was priced for. Only meaningful when the swap
    ///        came through TRUSTED_ROUTER; otherwise it is the calling router,
    ///        which is also why such a swap is never verified.
    /// @param zeroForOne Swap direction, needed to know which currency
    ///        `amountSpecified` refers to.
    /// @param amountSpecified The requested amount as seen before the swap:
    ///        negative is exact-input, positive exact-output. Settled amounts are
    ///        not known here — join to PoolManager's own Swap event for those.
    /// @param digest Attestation that paid for the discount, or zero when
    ///        unverified. Joins this swap to Registry.DiscountedSwapRecorded.
    event SwapPriced(
        PoolId indexed poolId,
        address indexed swapper,
        bool verified,
        uint24 feeApplied,
        bool zeroForOne,
        int256 amountSpecified,
        bytes32 digest
    );

    constructor(IPoolManager _poolManager, Registry _registry, address _trustedRouter) BaseHook(_poolManager) {
        require(_trustedRouter != address(0), InvalidTrustedRouter());
        require(address(_registry) != address(0), InvalidRegistry());
        REGISTRY = _registry;
        TRUSTED_ROUTER = _trustedRouter;
    }

    /// @dev Only beforeSwap is active. Pricing, recording and the SwapPriced event
    ///      all happen there: afterSwap would have to verify the attestation a
    ///      second time to know what it priced, and the event's `amountSpecified`
    ///      is identical in both callbacks, so nothing is gained by waiting.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Prices the swap and consumes one of the attestation's discounted swaps.
    ///      Not `view` — recording the usage is a state write, which is the whole
    ///      point of the swap cap.
    ///
    ///      The pool MUST be initialized with LPFeeLibrary.DYNAMIC_FEE_FLAG set in
    ///      PoolKey.fee, or this override is silently ignored by PoolManager.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        (address swapper, bool verified, bytes32 digest) = _priceSwap(sender, hookData);

        if (verified) {
            REGISTRY.recordSwap(digest);
        }

        uint24 fee = UNVERIFIED_FEE;
        if (verified) {
            fee = VERIFIED_FEE;
        }
        emit SwapPriced(key.toId(), swapper, verified, fee, params.zeroForOne, params.amountSpecified, digest);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev Hook data is an identity claim, so it is ignored unless it arrived
    ///      through the router that binds the claim to its caller and payer.
    ///      An absent or invalid attestation prices at the full fee; it never
    ///      reverts, so an unverified swap still goes through.
    function _priceSwap(address sender, bytes calldata hookData)
        internal
        view
        returns (address swapper, bool verified, bytes32 digest)
    {
        if (sender != TRUSTED_ROUTER || hookData.length < ADDRESS_ONLY_HOOK_DATA_LENGTH) {
            return (sender, false, bytes32(0));
        }

        if (hookData.length == ADDRESS_ONLY_HOOK_DATA_LENGTH) {
            return (abi.decode(hookData, (address)), false, bytes32(0));
        }

        LivenessAttestation memory attestation;
        bytes memory signature;
        (swapper, attestation, signature) = abi.decode(hookData, (address, LivenessAttestation, bytes));

        // Unrequired due to existance of trusted Router
        //if (swapper == address(0)) return (sender, false, bytes32(0));

        (verified, digest) = REGISTRY.discountFor(attestation, signature, swapper);
    }
}
