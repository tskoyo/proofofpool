// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {ProofPoolHook} from "../src/ProofPoolHook.sol";
import {Registry} from "../src/Registry.sol";
import {MockWorldID} from "./mocks/MockWorldID.sol";

/// @notice Core tests for the fee-split mechanism. This is the minimum bar
///         before demo, per ENGINEERING.md section 5.
contract ProofPoolHookTest is Test, Deployers {
    ProofPoolHook hook;
    Registry registry;
    MockWorldID mockWorldId;

    address verifiedUser = address(0xBEEF);
    address unverifiedUser = address(0xBAD);

    function setUp() public {
        // Deploy v4-core's PoolManager + test routers via the Deployers helper.
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        mockWorldId = new MockWorldID();
        registry = new Registry(mockWorldId, "app_test", "verify-human");

        // Mine a hook address whose low bits match our required permission flags.
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(manager), address(registry))
        );

        hook = new ProofPoolHook{salt: salt}(manager, registry);
        require(address(hook) == hookAddress, "hook address mismatch");

        // Verify our test "human" address via the mock World ID (always accepts).
        uint256[8] memory emptyProof;
        registry.verifyAndRegister(
            verifiedUser,
            0,
            uint256(keccak256("nullifier-1")),
            emptyProof
        );

        // Initialize the pool with the DYNAMIC_FEE_FLAG — required for fee
        // overrides to take effect, per Uniswap's docs. Skipping this is the
        // most common way to get this wrong.
        (key, ) = initPool(
            currency0,
            currency1,
            hook,
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            SQRT_PRICE_1_1
        );
    }

    /// @notice Verified swapper gets VERIFIED_FEE, unverified gets UNVERIFIED_FEE.
    function test_feeAppliedByVerificationStatus() public view {
        assertTrue(registry.isVerifiedHuman(verifiedUser));
        assertFalse(registry.isVerifiedHuman(unverifiedUser));

        // Fee logic is read directly here; a full swap-level assertion also
        // requires wiring PoolSwapTest with vm.prank(verifiedUser) / (unverifiedUser)
        // as msg.sender — see the note on router-vs-sender in ENGINEERING.md
        // section 1.3 before wiring this up for real.
        assertEq(hook.VERIFIED_FEE(), 500);
        assertEq(hook.UNVERIFIED_FEE(), 3000);
    }

    /// @notice A nullifier can't be replayed to verify a second address.
    function test_nullifierCannotBeReplayed() public {
        uint256[8] memory emptyProof;
        uint256 nullifier = uint256(keccak256("nullifier-1"));

        vm.expectRevert(
            abi.encodeWithSelector(
                Registry.DuplicateNullifier.selector,
                nullifier
            )
        );
        registry.verifyAndRegister(address(0xCAFE), 0, nullifier, emptyProof);
    }

    /// @notice A pool initialized WITHOUT the dynamic fee flag should not honor
    ///         the hook's fee override — write this so the flag issue is caught
    ///         in CI, not discovered live during the demo.
    function test_poolWithoutDynamicFeeFlagRejectsOverride() public {
        initPool(
            currency0,
            currency1,
            hook,
            3000, // static fee, NOT LPFeeLibrary.DYNAMIC_FEE_FLAG
            SQRT_PRICE_1_1
        );

        // Any swap against staticFeeKey should use the static 3000 fee
        // regardless of verification status — the hook's override is ignored.
        // Full assertion requires executing a swap and reading the applied fee
        // from the emitted Swap event; stub left here as the next step for
        // whoever picks this test up.
    }

    /// @notice Sandwich simulation: two same-block swaps from an unverified
    ///         address around a victim swap. Assert attacker's net P&L is
    ///         negative or below a defined profitability threshold after fees.
    function test_sandwichUnprofitableForUnverifiedAttacker() public {
        // TODO: wire up front-run swap (unverified) -> victim swap (unverified
        // or verified) -> back-run swap (unverified), then assert attacker's
        // realized PnL after UNVERIFIED_FEE on both legs is <= 0.
        // This is the strongest demo beat per README.md — prioritize finishing
        // this test once the swap-level wiring from test_feeAppliedByVerificationStatus
        // is in place.
    }
}
