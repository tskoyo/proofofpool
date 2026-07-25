// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LivenessAttestation, LivenessOracle} from "../src/LivenessOracle.sol";
import {Registry} from "../src/Registry.sol";

contract RegistryTest is Test {
    uint256 internal constant MAX_SWAPS = 2;

    uint256 internal signerKey = 0xA11CE;
    address internal signer;
    address internal owner = address(0xBEEF);
    address internal subject = address(0xCAFE);
    LivenessOracle internal oracle;
    Registry internal registry;

    function setUp() public {
        signer = vm.addr(signerKey);
        oracle = new LivenessOracle(signer, owner);
        registry = new Registry(oracle, MAX_SWAPS, owner);
    }

    function test_constructorStoresConfiguration() public view {
        assertEq(address(registry.ORACLE()), address(oracle));
        assertEq(registry.maxSwaps(), MAX_SWAPS);
        assertEq(registry.owner(), owner);
    }

    function test_constructorRejectsZeroOracleOrOwner() public {
        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(LivenessOracle(address(0)), MAX_SWAPS, owner);

        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(oracle, MAX_SWAPS, address(0));
    }

    function test_discountForReturnsZeroDigestWhenSubjectDoesNotMatch() public view {
        LivenessAttestation memory attestation = _attestation();

        (bool discounted, bytes32 digest) = registry.discountFor(attestation, _sign(attestation), address(0xDEAD));

        assertFalse(discounted);
        assertEq(digest, bytes32(0));
    }

    function test_discountForReturnsDigestForInvalidSignature() public view {
        LivenessAttestation memory attestation = _attestation();

        (bool discounted, bytes32 digest) = registry.discountFor(attestation, hex"deadbeef", subject);

        assertFalse(discounted);
        assertEq(digest, oracle.hashAttestation(attestation));
    }

    function test_recordSwapTracksUsageAndRemainingAllowance() public {
        bytes32 digest = keccak256("attestation");
        vm.prank(owner);
        registry.setHook(address(this));

        vm.expectEmit(true, false, false, true, address(registry));
        emit Registry.DiscountedSwapRecorded(digest, 1);
        registry.recordSwap(digest);

        assertEq(registry.usageCount(digest), 1);
        assertEq(registry.swapsRemaining(digest), 1);

        registry.recordSwap(digest);
        assertEq(registry.swapsRemaining(digest), 0);

        registry.recordSwap(digest);
        assertEq(registry.swapsRemaining(digest), 0);
    }

    function test_onlyConfiguredHookCanRecordSwap() public {
        vm.prank(owner);
        registry.setHook(address(0x1234));

        vm.expectRevert(Registry.NotHook.selector);
        registry.recordSwap(keccak256("attestation"));
    }

    function test_ownerCanUpdateHookAndSwapCap() public {
        address newHook = address(0x1234);

        vm.expectEmit(true, true, false, false, address(registry));
        emit Registry.HookUpdated(address(0), newHook);
        vm.prank(owner);
        registry.setHook(newHook);

        vm.expectEmit(false, false, false, true, address(registry));
        emit Registry.MaxSwapsUpdated(MAX_SWAPS, 9);
        vm.prank(owner);
        registry.setMaxSwaps(9);

        assertEq(registry.hook(), newHook);
        assertEq(registry.maxSwaps(), 9);
    }

    function test_configurationRejectsUnauthorizedAndZeroHook() public {
        vm.expectRevert(Registry.NotOwner.selector);
        registry.setMaxSwaps(9);

        vm.prank(owner);
        vm.expectRevert(Registry.ZeroAddress.selector);
        registry.setHook(address(0));
    }

    function test_ownerHandoffRevokesPreviousOwner() public {
        address newOwner = address(0xABCD);

        vm.expectEmit(true, true, false, false, address(registry));
        emit Registry.OwnerUpdated(owner, newOwner);
        vm.prank(owner);
        registry.setOwner(newOwner);

        assertEq(registry.owner(), newOwner);

        vm.prank(owner);
        vm.expectRevert(Registry.NotOwner.selector);
        registry.setMaxSwaps(10);

        vm.prank(newOwner);
        registry.setMaxSwaps(10);
        assertEq(registry.maxSwaps(), 10);
    }

    function test_setOwnerRejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(Registry.ZeroAddress.selector);
        registry.setOwner(address(0));
    }

    function test_uncappedRegistryReportsMaximumRemaining() public {
        vm.prank(owner);
        registry.setMaxSwaps(0);

        assertEq(registry.swapsRemaining(keccak256("unused")), type(uint256).max);
    }

    function _attestation() internal view returns (LivenessAttestation memory) {
        return LivenessAttestation({subject: subject, validUntil: block.timestamp + 1 hours, nonce: 7});
    }

    function _sign(LivenessAttestation memory attestation) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, oracle.hashAttestation(attestation));
        return abi.encodePacked(r, s, v);
    }
}
