// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {Registry} from "./Registry.sol";

/// @title ProofPoolHook
/// @notice A Uniswap v4 hook that charges verified-human swappers a low fee and
///         unverified addresses a higher fee. The premium collected from
///         unverified flow accrues to LPs through v4's standard fee accounting.
/// @dev This is the entire mechanism. It does not detect bots or sandwich
///      patterns — it prices one boolean. See DESIGN.md for what this does
///      and does not claim to solve.
contract ProofPoolHook is BaseHook {
    using LPFeeLibrary for uint24;

    error InvalidTrustedRouter();

    /// @notice Fee applied to swaps from verified-human addresses, in v4 fee units (100 = 0.01%).
    uint24 public constant VERIFIED_FEE = 500; // 0.05%

    /// @notice Fee applied to swaps from unverified addresses.
    uint24 public constant UNVERIFIED_FEE = 3000; // 0.30%

    /// @notice The registry this hook checks to determine verification status.
    Registry public immutable REGISTRY;

    /// @notice The only router allowed to identify the wallet behind a swap.
    address public immutable TRUSTED_ROUTER;

    event SwapPriced(address indexed swapper, bool verified, uint24 feeApplied, int256 amountSpecified);

    constructor(IPoolManager _poolManager, Registry _registry, address _trustedRouter) BaseHook(_poolManager) {
        if (_trustedRouter == address(0)) revert InvalidTrustedRouter();
        REGISTRY = _registry;
        TRUSTED_ROUTER = _trustedRouter;
    }

    /// @dev Declares which v4 callbacks this hook implements. Only beforeSwap
    ///      (to override the fee) and afterSwap (to emit pricing data for the
    ///      subgraph) are active — everything else is a no-op.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Overrides the swap fee based on the swapper's verification status.
    ///      The pool MUST be initialized with LPFeeLibrary.DYNAMIC_FEE_FLAG set
    ///      in PoolKey.fee, or this override is silently ignored by PoolManager.
    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        (, bool verified) = _verificationStatus(sender, hookData);
        uint24 fee = verified ? VERIFIED_FEE : UNVERIFIED_FEE;

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev Emits the pricing decision and the swap's requested amount.
    function _afterSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        (address swapper, bool verified) = _verificationStatus(sender, hookData);
        uint24 fee = verified ? VERIFIED_FEE : UNVERIFIED_FEE;

        emit SwapPriced(swapper, verified, fee, params.amountSpecified);

        return (BaseHook.afterSwap.selector, 0);
    }

    /// @dev Hook data is an identity claim, so it is ignored unless it came
    ///      through the router that binds the claim to its caller and payer.
    function _verificationStatus(address sender, bytes calldata hookData)
        internal
        view
        returns (address swapper, bool verified)
    {
        if (sender != TRUSTED_ROUTER || hookData.length != 32) {
            return (sender, false);
        }

        swapper = abi.decode(hookData, (address));
        verified = swapper != address(0) && REGISTRY.isVerifiedHuman(swapper);
    }
}
