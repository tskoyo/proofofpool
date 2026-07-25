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
import {LivenessAttestation, LivenessOracle} from "../src/LivenessOracle.sol";

/// @notice Tests for the fee split, the trusted-router identity binding, and the
///         two limits on a liveness attestation (expiry AND swap cap).
contract ProofPoolHookTest is Test, Deployers {
    bytes32 internal constant SWAP_EVENT_SIGNATURE =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    uint128 internal constant SWAP_AMOUNT = 1e12;
    uint256 internal constant MAX_SWAPS = 3;

    ProofPoolHook hook;
    ProofPoolRouter proofPoolRouter;
    Registry registry;
    LivenessOracle oracle;

    uint256 signerKey = 0xA11CE;
    uint256 wrongSignerKey = 0xB0B;
    address signer;
    address owner = address(0x0DDBA11);
    address verifiedUser = address(0xBEEF);
    address unverifiedUser = address(0xBAD);

    function setUp() public {
        signer = vm.addr(signerKey);

        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        oracle = new LivenessOracle(signer, owner);
        registry = new Registry(oracle, MAX_SWAPS, owner);
        proofPoolRouter = new ProofPoolRouter(manager);

        // Only beforeSwap is implemented now, so the mined address encodes one flag.
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(manager), address(registry), address(proofPoolRouter))
        );

        hook = new ProofPoolHook{salt: salt}(manager, registry, address(proofPoolRouter));
        require(address(hook) == hookAddress, "hook address mismatch");

        // The hook's address depends on the registry's, so this can only be wired
        // up after both exist.
        vm.prank(owner);
        registry.setHook(address(hook));

        (key,) = initPoolAndAddLiquidity(currency0, currency1, hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

        _fundAndApprove(verifiedUser);
        _fundAndApprove(unverifiedUser);
    }

    // --- Pricing -----------------------------------------------------------

    function test_validAttestationGetsLowFeeAndCountsOneSwap() public {
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);
        bytes32 digest = oracle.hashAttestation(attestation);

        vm.recordLogs();
        _swap(verifiedUser, attestation, signature);

        assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
        assertEq(registry.usageCount(digest), 1);
        assertEq(registry.swapsRemaining(digest), MAX_SWAPS - 1);
    }

    function test_noAttestationGetsHighFee() public {
        vm.recordLogs();
        _swapUnverified(unverifiedUser);

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    /// @notice An expired attestation must not revert the swap — it just loses the discount.
    function test_expiredAttestationFallsBackToHighFeeWithoutReverting() public {
        vm.warp(1_000_000);
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 2 hours);

        vm.recordLogs();
        _swap(verifiedUser, attestation, signature);

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
        assertEq(registry.usageCount(oracle.hashAttestation(attestation)), 0);
    }

    /// @notice The AND boundary: still valid in time, but the swap cap is spent.
    function test_discountStopsAtMaxSwaps() public {
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);
        bytes32 digest = oracle.hashAttestation(attestation);

        for (uint256 i = 0; i < MAX_SWAPS; i++) {
            vm.recordLogs();
            _swap(verifiedUser, attestation, signature);
            assertEq(_recordedSwapFee(), hook.VERIFIED_FEE(), "within cap should be discounted");
        }

        assertEq(registry.usageCount(digest), MAX_SWAPS);
        assertEq(registry.swapsRemaining(digest), 0);

        vm.recordLogs();
        _swap(verifiedUser, attestation, signature);
        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE(), "past cap should pay full fee");
        assertEq(registry.usageCount(digest), MAX_SWAPS, "count must not grow past the cap");
    }

    function test_maxSwapsZeroMeansUncapped() public {
        vm.prank(owner);
        registry.setMaxSwaps(0);

        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        for (uint256 i = 0; i < MAX_SWAPS + 2; i++) {
            vm.recordLogs();
            _swap(verifiedUser, attestation, signature);
            assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
        }

        assertEq(registry.swapsRemaining(oracle.hashAttestation(attestation)), type(uint256).max);
    }

    /// @notice A fresh attestation (new nonce) is a new digest, so a new allowance.
    function test_newAttestationResetsTheAllowance() public {
        (LivenessAttestation memory first, bytes memory firstSig) = _attest(verifiedUser, block.timestamp + 1 hours);
        for (uint256 i = 0; i < MAX_SWAPS; i++) {
            _swap(verifiedUser, first, firstSig);
        }

        LivenessAttestation memory second =
            LivenessAttestation({subject: verifiedUser, validUntil: block.timestamp + 1 hours, nonce: 999});
        bytes memory secondSig = _sign(signerKey, second);

        vm.recordLogs();
        _swap(verifiedUser, second, secondSig);
        assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
    }

    // --- Forgery and misuse ------------------------------------------------

    function test_signatureFromWrongSignerGetsHighFee() public {
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: verifiedUser, validUntil: block.timestamp + 1 hours, nonce: 1});
        bytes memory signature = _sign(wrongSignerKey, attestation);

        vm.recordLogs();
        _swap(verifiedUser, attestation, signature);

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    /// @notice Garbage in the signature field must not revert the swap.
    function test_malformedSignatureGetsHighFeeWithoutReverting() public {
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: verifiedUser, validUntil: block.timestamp + 1 hours, nonce: 1});

        vm.recordLogs();
        _swap(verifiedUser, attestation, hex"deadbeef");

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    /// @notice Someone else's valid attestation must not discount your swap.
    function test_attestationForAnotherSubjectGetsHighFee() public {
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.recordLogs();
        _swap(unverifiedUser, attestation, signature);

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
        assertEq(registry.usageCount(oracle.hashAttestation(attestation)), 0);
    }

    /// @notice Hook data is only trusted from the router that sets it to msg.sender.
    function test_untrustedRouterCannotSpoofVerifiedUserWithHookData() public {
        vm.recordLogs();
        swap(key, true, -int256(uint256(SWAP_AMOUNT)), abi.encode(verifiedUser));

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    /// @notice Even a genuinely signed attestation is ignored off the trusted router.
    function test_untrustedRouterCannotUseValidAttestation() public {
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.recordLogs();
        swap(key, true, -int256(uint256(SWAP_AMOUNT)), abi.encode(verifiedUser, attestation, signature));

        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
        assertEq(registry.usageCount(oracle.hashAttestation(attestation)), 0);
    }

    // --- Access control ----------------------------------------------------

    function test_onlyHookCanRecordSwap() public {
        vm.expectRevert(Registry.NotHook.selector);
        registry.recordSwap(keccak256("digest"));
    }

    function test_onlyOwnerCanConfigureRegistry() public {
        vm.expectRevert(Registry.NotOwner.selector);
        registry.setMaxSwaps(10);

        vm.expectRevert(Registry.NotOwner.selector);
        registry.setHook(address(0xDEAD));
    }

    function test_onlyOwnerCanRotateTrustedSigner() public {
        vm.expectRevert(LivenessOracle.NotOwner.selector);
        oracle.setTrustedSigner(address(0xDEAD));
    }

    /// @notice Rotating the signer is the bulk revocation lever: every outstanding
    ///         attestation stops working immediately.
    function test_rotatingSignerInvalidatesOutstandingAttestations() public {
        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.prank(owner);
        oracle.setTrustedSigner(vm.addr(wrongSignerKey));

        vm.recordLogs();
        _swap(verifiedUser, attestation, signature);
        assertEq(_recordedSwapFee(), hook.UNVERIFIED_FEE());
    }

    // --- Router behaviour --------------------------------------------------

    function test_routerRejectsExpiredSwap() public {
        vm.warp(100);
        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.deadline = 99;

        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.prank(verifiedUser);
        vm.expectRevert(abi.encodeWithSelector(ProofPoolRouter.DeadlineExpired.selector, 99));
        proofPoolRouter.exactInputSingle(params, attestation, signature);
    }

    function test_routerEnforcesMinimumOutput() public {
        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.amountOutMinimum = type(uint128).max;

        vm.prank(verifiedUser);
        vm.expectPartialRevert(ProofPoolRouter.TooLittleReceived.selector);
        proofPoolRouter.exactInputSingle(params, _emptyAttestation(), "");
    }

    function test_onlyPoolManagerCanCallRouterCallback() public {
        vm.expectRevert(ProofPoolRouter.NotPoolManager.selector);
        proofPoolRouter.unlockCallback("");
    }

    function test_verifiedUserCanSwapOneForZero() public {
        MockERC20 tokenIn = MockERC20(Currency.unwrap(currency1));
        MockERC20 tokenOut = MockERC20(Currency.unwrap(currency0));
        uint256 inputBefore = tokenIn.balanceOf(verifiedUser);
        uint256 outputBefore = tokenOut.balanceOf(verifiedUser);

        ProofPoolRouter.ExactInputSingleParams memory params = _exactInputParams();
        params.zeroForOne = false;
        params.sqrtPriceLimitX96 = MAX_PRICE_LIMIT;

        (LivenessAttestation memory attestation, bytes memory signature) = _attest(verifiedUser, block.timestamp + 1 hours);

        vm.recordLogs();
        vm.prank(verifiedUser);
        uint256 amountOut = proofPoolRouter.exactInputSingle(params, attestation, signature);

        assertEq(_recordedSwapFee(), hook.VERIFIED_FEE());
        assertEq(inputBefore - tokenIn.balanceOf(verifiedUser), SWAP_AMOUNT);
        assertEq(tokenOut.balanceOf(verifiedUser) - outputBefore, amountOut);
    }

    // --- Helpers -----------------------------------------------------------

    function _attest(address subject, uint256 validUntil)
        internal
        view
        returns (LivenessAttestation memory attestation, bytes memory signature)
    {
        attestation = LivenessAttestation({subject: subject, validUntil: validUntil, nonce: 1});
        signature = _sign(signerKey, attestation);
    }

    function _sign(uint256 key_, LivenessAttestation memory attestation) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key_, oracle.hashAttestation(attestation));
        return abi.encodePacked(r, s, v);
    }

    function _emptyAttestation() internal pure returns (LivenessAttestation memory) {
        return LivenessAttestation({subject: address(0), validUntil: 0, nonce: 0});
    }

    function _swap(address user, LivenessAttestation memory attestation, bytes memory signature) internal {
        vm.prank(user);
        proofPoolRouter.exactInputSingle(_exactInputParams(), attestation, signature);
    }

    function _swapUnverified(address user) internal {
        vm.prank(user);
        proofPoolRouter.exactInputSingle(_exactInputParams(), _emptyAttestation(), "");
    }

    function _fundAndApprove(address user) internal {
        MockERC20(Currency.unwrap(currency0)).mint(user, SWAP_AMOUNT * 100);
        MockERC20(Currency.unwrap(currency1)).mint(user, SWAP_AMOUNT * 100);

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
