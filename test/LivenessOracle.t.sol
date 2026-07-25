// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LivenessAttestation, LivenessOracle} from "../src/LivenessOracle.sol";

contract LivenessOracleTest is Test {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 internal signerKey = 0xA11CE;
    address internal signer;
    address internal owner = address(0xBEEF);
    LivenessOracle internal oracle;

    function setUp() public {
        signer = vm.addr(signerKey);
        oracle = new LivenessOracle(signer, owner);
    }

    function test_constructorStoresConfiguration() public view {
        assertEq(oracle.trustedSigner(), signer);
        assertEq(oracle.owner(), owner);
    }

    function test_constructorRejectsZeroSignerOrOwner() public {
        vm.expectRevert(LivenessOracle.ZeroAddress.selector);
        new LivenessOracle(address(0), owner);

        vm.expectRevert(LivenessOracle.ZeroAddress.selector);
        new LivenessOracle(signer, address(0));
    }

    function test_validUntilIsInclusive() public {
        vm.warp(1_000);
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: address(0xCAFE), validUntil: block.timestamp, nonce: 7});

        (bool valid, bytes32 digest) = oracle.verify(attestation, _sign(attestation));

        assertTrue(valid);
        assertEq(digest, oracle.hashAttestation(attestation));
    }

    function test_expiredAttestationReturnsItsDigest() public {
        vm.warp(1_001);
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: address(0xCAFE), validUntil: 1_000, nonce: 7});

        (bool valid, bytes32 digest) = oracle.verify(attestation, hex"deadbeef");

        assertFalse(valid);
        assertEq(digest, oracle.hashAttestation(attestation));
    }

    function test_hashAndDomainSeparatorMatchEip712Encoding() public view {
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: address(0xCAFE), validUntil: 12_345, nonce: 7});
        bytes32 expectedDomain = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("ProofPool"), keccak256("1"), block.chainid, address(oracle))
        );
        bytes32 structHash = keccak256(
            abi.encode(oracle.ATTESTATION_TYPEHASH(), attestation.subject, attestation.validUntil, attestation.nonce)
        );

        assertEq(oracle.domainSeparator(), expectedDomain);
        assertEq(
            oracle.hashAttestation(attestation), keccak256(abi.encodePacked("\x19\x01", expectedDomain, structHash))
        );
    }

    function test_ownerCanRotateSigner() public {
        address newSigner = vm.addr(0xB0B);

        vm.expectEmit(true, true, false, false, address(oracle));
        emit LivenessOracle.TrustedSignerUpdated(signer, newSigner);
        vm.prank(owner);
        oracle.setTrustedSigner(newSigner);

        assertEq(oracle.trustedSigner(), newSigner);
    }

    function test_setTrustedSignerRejectsUnauthorizedAndZeroAddress() public {
        vm.expectRevert(LivenessOracle.NotOwner.selector);
        oracle.setTrustedSigner(address(0x1234));

        vm.prank(owner);
        vm.expectRevert(LivenessOracle.ZeroAddress.selector);
        oracle.setTrustedSigner(address(0));
    }

    function test_ownerHandoffRevokesPreviousOwner() public {
        address newOwner = address(0xABCD);

        vm.expectEmit(true, true, false, false, address(oracle));
        emit LivenessOracle.OwnerUpdated(owner, newOwner);
        vm.prank(owner);
        oracle.setOwner(newOwner);

        assertEq(oracle.owner(), newOwner);

        vm.prank(owner);
        vm.expectRevert(LivenessOracle.NotOwner.selector);
        oracle.setTrustedSigner(address(0x1234));

        vm.prank(newOwner);
        oracle.setTrustedSigner(address(0x1234));
        assertEq(oracle.trustedSigner(), address(0x1234));
    }

    function test_setOwnerRejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(LivenessOracle.ZeroAddress.selector);
        oracle.setOwner(address(0));
    }

    function _sign(LivenessAttestation memory attestation) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, oracle.hashAttestation(attestation));
        return abi.encodePacked(r, s, v);
    }
}
