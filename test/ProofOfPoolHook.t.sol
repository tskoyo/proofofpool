// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {ProofPoolHook} from "../src/ProofPoolHook.sol";
import {ProofPoolRouter} from "../src/ProofPoolRouter.sol";
import {Registry} from "../src/Registry.sol";

/// @notice Core tests for the fee-split and trusted-router identity mechanism.
contract ProofPoolHookTest is Test, Deployers {
    bytes32 internal constant SWAP_EVENT_SIGNATURE =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    uint128 internal constant SWAP_AMOUNT = 1e12;

    ProofPoolHook hook;
    ProofPoolRouter proofPoolRouter;
    Registry registry;

    address attester = address(0xA77E5760);
    address verifiedUser = address(0xBEEF);
    address unverifiedUser = address(0xBAD);

    function setUp() public {
        // Deploy v4-core's PoolManager + test routers via the Deployers helper.
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        registry = new Registry(attester, "app_test", "verify-human");
        proofPoolRouter = new ProofPoolRouter(manager);

        // Mine a hook address whose low bits match our required permission flags.
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(manager), address(registry), address(proofPoolRouter))
        );

        hook = new ProofPoolHook{salt: salt}(manager, registry, address(proofPoolRouter));
        require(address(hook) == hookAddress, "hook address mismatch");

        // Register our test "human" address, as the backend attester would after
        // verifying a Selfie Check proof off-chain.
        vm.prank(attester);
        registry.registerVerifiedHuman(verifiedUser, uint256(keccak256("nullifier-1")));

        // Initialize the pool with the DYNAMIC_FEE_FLAG — required for fee
        // overrides to take effect, per Uniswap's docs. Skipping this is the
        // most common way to get this wrong.
        (key,) = initPoolAndAddLiquidity(currency0, currency1, hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

        _fundAndApprove(verifiedUser);
        _fundAndApprove(unverifiedUser);
    }

    /// @notice Verified swapper gets VERIFIED_FEE, unverified gets UNVERIFIED_FEE.
    function test_verifiedUserGetsLowFeeThroughTrustedRouter() public {
        MockERC20 tokenIn = MockERC20(Currency.unwrap(currency0));
        MockERC20 tokenOut = MockERC20(Currency.unwrap(currency1));
        uint256 inputBefore = tokenIn.balanceOf(verifiedUser);
        uint256 outputBefore = tokenOut.balanceOf(verifiedUser);

        vm.recordLogs();
        vm.prank(verifiedUser);
        uint256 amountOut = proofPoolRouter.exactInputSingle(_exactInputParams());

        assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
        assertEq(inputBefore - tokenIn.balanceOf(verifiedUser), SWAP_AMOUNT);
        assertEq(tokenOut.balanceOf(verifiedUser) - outputBefore, amountOut);
    }

    function test_unverifiedUserGetsHighFeeThroughTrustedRouter() public {
        vm.recordLogs();
        vm.prank(unverifiedUser);
        proofPoolRouter.exactInputSingle(_exactInputParams());

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    function test_verifiedUserCanSwapOneForZero() public {
        MockERC20 tokenIn = MockERC20(Currency.unwrap(currency1));
        MockERC20 tokenOut = MockERC20(Currency.unwrap(currency0));
        uint256 inputBefore = tokenIn.balanceOf(verifiedUser);
        uint256 outputBefore = tokenOut.balanceOf(verifiedUser);
        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.zeroForOne = false;
        params.sqrtPriceLimitX96 = MAX_PRICE_LIMIT;

        vm.recordLogs();
        vm.prank(verifiedUser);
        uint256 amountOut = proofPoolRouter.exactInputSingle(params);

        assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
        assertEq(inputBefore - tokenIn.balanceOf(verifiedUser), SWAP_AMOUNT);
        assertEq(tokenOut.balanceOf(verifiedUser) - outputBefore, amountOut);
    }

    function test_untrustedRouterCannotSpoofVerifiedUserWithHookData() public {
        vm.recordLogs();
        swap(key, true, -int256(uint256(SWAP_AMOUNT)), abi.encode(verifiedUser));

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    function test_untrustedRouterGetsHighFeeEvenIfRegistryMarksItVerified() public {
        vm.prank(attester);
        registry.registerVerifiedHuman(address(swapRouter), uint256(keccak256("router-nullifier")));

        vm.recordLogs();
        swap(key, true, -int256(uint256(SWAP_AMOUNT)), abi.encode(address(swapRouter)));

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    function test_routerRejectsExpiredSwap() public {
        vm.warp(100);
        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.deadline = 99;

        vm.prank(verifiedUser);
        vm.expectRevert(abi.encodeWithSelector(ProofPoolRouter.DeadlineExpired.selector, 99));
        proofPoolRouter.exactInputSingle(params);
    }

    function test_routerEnforcesMinimumOutput() public {
        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.amountOutMinimum = type(uint128).max;

        vm.prank(verifiedUser);
        vm.expectPartialRevert(ProofPoolRouter.TooLittleReceived.selector);
        proofPoolRouter.exactInputSingle(params);
    }

    function test_onlyPoolManagerCanCallRouterCallback() public {
        vm.expectRevert(ProofPoolRouter.NotPoolManager.selector);
        proofPoolRouter.unlockCallback("");
    }

    /// @notice A nullifier can't be replayed to verify a second address.
    function test_nullifierCannotBeReplayed() public {
        uint256 nullifier = uint256(keccak256("nullifier-1"));

        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(Registry.DuplicateNullifier.selector, nullifier));
        registry.registerVerifiedHuman(address(0xCAFE), nullifier);
    }

    /// @notice Only the backend attester can register a verified human.
    function test_onlyAttesterCanRegister() public {
        vm.expectRevert(Registry.NotAttester.selector);
        registry.registerVerifiedHuman(address(0xCAFE), uint256(keccak256("nullifier-2")));
    }

    function _fundAndApprove(address user) internal {
        MockERC20(Currency.unwrap(currency0)).mint(user, SWAP_AMOUNT * 10);
        MockERC20(Currency.unwrap(currency1)).mint(user, SWAP_AMOUNT * 10);

        vm.startPrank(user);
        MockERC20(Currency.unwrap(currency0)).approve(address(proofPoolRouter), type(uint256).max);
        MockERC20(Currency.unwrap(currency1)).approve(address(proofPoolRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _exactInputParams() internal view returns (ProofPoolRouter.ExactInputSingleParams memory) {
        return ProofPoolRouter.ExactInputSingleParams({
            key: key,
            zeroForOne: true,
            amountIn: SWAP_AMOUNT,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: MIN_PRICE_LIMIT,
            deadline: block.timestamp
        });
    }

    function _recordedSwapFee() internal returns (uint24 fee) {
        Vm.Log[] memory entries = vm.getRecordedLogs();

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter == address(manager) && entries[i].topics[0] == SWAP_EVENT_SIGNATURE) {
                (,,,,, fee) = abi.decode(entries[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }

        fail("PoolManager Swap event not found");
    }
}
