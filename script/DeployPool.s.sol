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
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

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
///      REGISTRY_ATTESTER, TOKEN_USDC, TOKEN_WBTC.
///
///      `REGISTRY_ATTESTER` is the backend's public address — the only address
///      allowed to call `Registry.registerVerifiedHuman` after verifying a
///      Selfie Check proof off-chain (see web/ for that backend).
///
///      `TOKEN_USDC` / `TOKEN_WBTC` are the pair this pool trades; run
///      script/DeployTestTokens.s.sol first and use the addresses it prints.
///
///      Verify every address below against the source docs before a real
///      deployment — this file pins them as of the time this script was written.
contract DeployPool is Script {
    // --- Canonical Uniswap v4 deployment on Sepolia (chain id 11155111) ---
    IPoolManager constant POOL_MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    IPositionManager constant POSITION_MANAGER = IPositionManager(payable(0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4));
    IAllowanceTransfer constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @dev `new X{salt: ...}` inside a forge script is routed through this proxy
    ///      rather than deployed straight from the EOA, so the hook address must
    ///      be mined against it. Mining against msg.sender yields an address whose
    ///      flag bits don't match and PoolManager reverts HookAddressNotValid.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    int24 constant TICK_SPACING = 60;

    // Initial liquidity, in each token's own base units. Their ratio *is* the
    // pool's starting price — 10,000 MyUSDC against 0.1 MyWBTC implies
    // 1 MyWBTC = 100,000 MyUSDC — so changing one changes the opening price.
    uint256 constant USDC_LIQUIDITY_AMOUNT = 10_000e6; // MyUSDC, 6 decimals
    uint256 constant WBTC_LIQUIDITY_AMOUNT = 0.1e8; // MyWBTC, 8 decimals

    // Set in run() from TOKEN_USDC / TOKEN_WBTC, sorted as v4 requires.
    address token0;
    address token1;
    uint256 amount0;
    uint256 amount1;
    uint160 initialSqrtPriceX96;

    function run() external {
        string memory appId = vm.envString("WORLD_ID_APP_ID");
        string memory actionId = vm.envString("WORLD_ID_ACTION_ID");
        address attester = vm.envAddress("REGISTRY_ATTESTER");

        _configurePair(vm.envAddress("TOKEN_USDC"), vm.envAddress("TOKEN_WBTC"));

        vm.startBroadcast();

        Registry registry = new Registry(attester, appId, actionId);
        console2.log("Registry deployed at", address(registry));

        ProofPoolRouter router = new ProofPoolRouter(POOL_MANAGER);
        console2.log("ProofPoolRouter deployed at", address(router));

        ProofPoolHook hook = _deployHook(registry, router);
        console2.log("ProofPoolHook deployed at", address(hook));

        PoolKey memory key = _buildPoolKey(hook);
        POOL_MANAGER.initialize(key, initialSqrtPriceX96);
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
            CREATE2_DEPLOYER,
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(POOL_MANAGER), address(registry), address(router))
        );

        hook = new ProofPoolHook{salt: salt}(POOL_MANAGER, registry, address(router));
        require(address(hook) == predicted, "hook address mismatch");
    }

    /// @dev Sorts the pair by address (v4 requires currency0 < currency1), pairs
    ///      each token with its own seed amount, and derives the opening price
    ///      from their ratio so the pool starts exactly where the liquidity sits.
    function _configurePair(address usdc, address wbtc) internal {
        require(usdc != address(0) && wbtc != address(0), "token address is zero");
        require(usdc != wbtc, "TOKEN_USDC and TOKEN_WBTC are the same address");

        (token0, amount0, token1, amount1) = usdc < wbtc
            ? (usdc, USDC_LIQUIDITY_AMOUNT, wbtc, WBTC_LIQUIDITY_AMOUNT)
            : (wbtc, WBTC_LIQUIDITY_AMOUNT, usdc, USDC_LIQUIDITY_AMOUNT);

        // sqrtPriceX96 = sqrt(amount1 / amount0) * 2**96, rearranged to keep the
        // division inside the square root and avoid truncating to zero.
        initialSqrtPriceX96 = uint160(FixedPointMathLib.sqrt((amount1 << 192) / amount0));

        console2.log("currency0", token0, amount0);
        console2.log("currency1", token1, amount1);
        console2.log("initial sqrtPriceX96", initialSqrtPriceX96);
    }

    function _buildPoolKey(ProofPoolHook hook) internal view returns (PoolKey memory) {
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

        (uint256 amount0Desired, uint256 amount1Desired) = (amount0, amount1);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            initialSqrtPriceX96,
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
