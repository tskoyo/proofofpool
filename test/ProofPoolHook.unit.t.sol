// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ProofPoolHook} from "../src/ProofPoolHook.sol";
import {LivenessAttestation, LivenessOracle} from "../src/LivenessOracle.sol";
import {Registry} from "../src/Registry.sol";

contract ProofPoolHookHarness is ProofPoolHook {
    constructor(IPoolManager manager, Registry registry, address trustedRouter)
        ProofPoolHook(manager, registry, trustedRouter)
    {}

    function validateHookAddress(BaseHook) internal pure override {}

    function priceSwap(address sender, bytes calldata hookData)
        external
        view
        returns (address swapper, bool verified, bytes32 digest)
    {
        return _priceSwap(sender, hookData);
    }
}

contract ProofPoolHookUnitTest is Test {
    address internal owner = address(0xBEEF);
    address internal trustedRouter = address(0x1234);
    IPoolManager internal manager = IPoolManager(address(0x5678));
    Registry internal registry;

    function setUp() public {
        LivenessOracle oracle = new LivenessOracle(vm.addr(0xA11CE), owner);
        registry = new Registry(oracle, 3, owner);
    }

    function test_constructorStoresDependencies() public {
        ProofPoolHookHarness hook = new ProofPoolHookHarness(manager, registry, trustedRouter);

        assertEq(address(hook.poolManager()), address(manager));
        assertEq(address(hook.REGISTRY()), address(registry));
        assertEq(hook.TRUSTED_ROUTER(), trustedRouter);
    }

    function test_constructorRejectsZeroTrustedRouter() public {
        vm.expectRevert(ProofPoolHook.InvalidTrustedRouter.selector);
        new ProofPoolHookHarness(manager, registry, address(0));
    }

    function test_constructorRejectsZeroRegistry() public {
        vm.expectRevert(ProofPoolHook.InvalidRegistry.selector);
        new ProofPoolHookHarness(manager, Registry(address(0)), trustedRouter);
    }

    function test_permissionsEnableOnlyBeforeSwap() public {
        ProofPoolHookHarness hook = new ProofPoolHookHarness(manager, registry, trustedRouter);
        Hooks.Permissions memory permissions = hook.getHookPermissions();

        assertTrue(permissions.beforeSwap);
        assertFalse(permissions.beforeInitialize);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.afterSwap);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
    }

    function test_shortHookDataFromTrustedRouterIsUnverified() public {
        ProofPoolHookHarness hook = new ProofPoolHookHarness(manager, registry, trustedRouter);

        (address swapper, bool verified, bytes32 digest) = hook.priceSwap(trustedRouter, hex"1234");

        assertEq(swapper, trustedRouter);
        assertFalse(verified);
        assertEq(digest, bytes32(0));
    }

    function test_addressOnlyHookDataDecodesSwapperButDoesNotVerify() public {
        ProofPoolHookHarness hook = new ProofPoolHookHarness(manager, registry, trustedRouter);
        address claimedSwapper = address(0xCAFE);

        (address swapper, bool verified, bytes32 digest) = hook.priceSwap(trustedRouter, abi.encode(claimedSwapper));

        assertEq(swapper, claimedSwapper);
        assertFalse(verified);
        assertEq(digest, bytes32(0));
    }
}
