// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";

import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {ProofPoolHook} from "../src/ProofPoolHook.sol";
import {ProofPoolRouter} from "../src/ProofPoolRouter.sol";
import {Registry} from "../src/Registry.sol";

/// @notice Deploys Registry + ProofPoolRouter + ProofPoolHook, initializes a
///         WETH/USDC v4 pool with a dynamic fee, and seeds it with initial
///         liquidity — all on Ethereum Sepolia. Run with:
///
///   forge script script/DeployPool.s.sol:DeployPool \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv
///
/// @dev Required env vars: PRIVATE_KEY, WORLD_ID_APP_ID, WORLD_ID_ACTION_ID,
///      REGISTRY_ATTESTER. `REGISTRY_ATTESTER` is the backend's public address —
///      the only address allowed to call `Registry.registerVerifiedHuman` after
///      verifying a Selfie Check proof off-chain (see web/ for that backend).
///      Verify every address below against the source docs before a real
///      deployment — this file pins them as of the time this script was written.
contract DeployPool is Script {
    // --- Canonical Uniswap v4 deployment on Sepolia (chain id 11155111) ---
    IPoolManager constant POOL_MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    IPositionManager constant POSITION_MANAGER = IPositionManager(payable(0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4));
    IAllowanceTransfer constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    // --- Sepolia test tokens ---
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    int24 constant TICK_SPACING = 60;
    // Illustrative starting price: 1 WETH = 3000 USDC. Adjust to the real
    // market price at deploy time if it matters for your demo.
    uint160 constant INITIAL_SQRT_PRICE_X96 = 1446501726624926496477173928747177;

    // How much of each token to seed as initial liquidity. WETH has 18
    // decimals, USDC has 6.
    uint256 constant WETH_LIQUIDITY_AMOUNT = 0.01 ether;
    uint256 constant USDC_LIQUIDITY_AMOUNT = 30e6;

    function run() external {
        string memory appId = vm.envString("WORLD_ID_APP_ID");
        string memory actionId = vm.envString("WORLD_ID_ACTION_ID");
        address attester = vm.envAddress("REGISTRY_ATTESTER");

        vm.startBroadcast();

        Registry registry = new Registry(attester, appId, actionId);
        console2.log("Registry deployed at", address(registry));

        ProofPoolRouter router = new ProofPoolRouter(POOL_MANAGER);
        console2.log("ProofPoolRouter deployed at", address(router));

        ProofPoolHook hook = _deployHook(registry, router);
        console2.log("ProofPoolHook deployed at", address(hook));

        PoolKey memory key = _buildPoolKey(hook);
        POOL_MANAGER.initialize(key, INITIAL_SQRT_PRICE_X96);
        console2.log("Pool initialized");

        _addLiquidity(key);
        console2.log("Initial liquidity added");

        vm.stopBroadcast();
    }

    /// @dev Mines a CREATE2 salt so the deployed hook address encodes the
    ///      beforeSwap/afterSwap permission flags, then deploys via that salt.
    function _deployHook(Registry registry, ProofPoolRouter router) internal returns (ProofPoolHook hook) {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(
            msg.sender,
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(POOL_MANAGER), address(registry), address(router))
        );

        hook = new ProofPoolHook{salt: salt}(POOL_MANAGER, registry, address(router));
        require(address(hook) == predicted, "hook address mismatch");
    }

    /// @dev WETH/USDC sorted by address so currency0 < currency1, as v4 requires.
    function _buildPoolKey(ProofPoolHook hook) internal pure returns (PoolKey memory) {
        (address token0, address token1) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);

        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
    }

    function _addLiquidity(PoolKey memory key) internal {
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);

        (uint256 amount0Desired, uint256 amount1Desired) = Currency.unwrap(key.currency0) == WETH
            ? (WETH_LIQUIDITY_AMOUNT, USDC_LIQUIDITY_AMOUNT)
            : (USDC_LIQUIDITY_AMOUNT, WETH_LIQUIDITY_AMOUNT);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            INITIAL_SQRT_PRICE_X96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0Desired,
            amount1Desired
        );

        _approveForPositionManager(Currency.unwrap(key.currency0));
        _approveForPositionManager(Currency.unwrap(key.currency1));

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            tickLower,
            tickUpper,
            liquidity,
            amount0Desired, // amount0Max
            amount1Desired, // amount1Max
            msg.sender, // recipient
            bytes("") // hookData
        );
        params[1] = abi.encode(key.currency0, key.currency1);

        POSITION_MANAGER.modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);
    }

    /// @dev v4's PositionManager pulls funds via Permit2, so tokens must be
    ///      approved to Permit2 first, then Permit2 given allowance for
    ///      PositionManager to spend on our behalf.
    function _approveForPositionManager(address token) internal {
        IERC20(token).approve(address(PERMIT2), type(uint256).max);
        PERMIT2.approve(token, address(POSITION_MANAGER), type(uint160).max, type(uint48).max);
    }
}
