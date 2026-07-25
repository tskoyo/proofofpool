// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice A backend-signed statement that `subject` passed a World Selfie Check.
/// @dev Deliberately does not carry the World nullifier. It would be public in
///      calldata on every swap, and nothing on-chain consumes it — see the Sybil
///      note in README.md for what that costs us.
struct LivenessAttestation {
    /// @dev The wallet the discount applies to. Checked against the swapper by Registry.
    address subject;
    /// @dev Unix seconds. Set by the server; this is the only revocation lever,
    ///      since a signature cannot be withdrawn once issued.
    uint256 validUntil;
    /// @dev Server-random. Distinguishes two attestations for the same subject and
    ///      expiry, so re-verifying grants a fresh swap allowance rather than
    ///      resuming the exhausted one.
    uint256 nonce;
}

/// @title LivenessOracle
/// @notice Verifies that an attestation was signed by our backend and hasn't expired.
/// @dev Selfie Check has no on-chain verifier (only Orb does, groupId = 1), so the
///      World proof is checked off-chain and this contract attests to that result.
///      The security of every discount reduces to `trustedSigner` not being
///      compromised — this is federated trust, not a zero-knowledge proof.
contract LivenessOracle is EIP712, Ownable {
    error NotOwner();
    error ZeroAddress();

    event TrustedSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("LivenessAttestation(address subject,uint256 validUntil,uint256 nonce)");

    /// @notice The backend key whose signature grants the discounted fee.
    /// @dev Rotating this invalidates every outstanding attestation at once, which
    ///      is the only bulk revocation available.
    address public trustedSigner;

    constructor(address _trustedSigner, address _owner) EIP712("ProofPool", "1") Ownable(_owner) {
        require(_trustedSigner != address(0) && _owner != address(0), ZeroAddress());
        trustedSigner = _trustedSigner;
    }

    /// @notice Check an attestation's signature and expiry.
    /// @dev Returns a flag rather than reverting: an unverified swapper must fall
    ///      through to the full fee, not have their swap reverted. `tryRecover` is
    ///      used for the same reason — `recover` reverts on a malformed signature.
    /// @return valid True only if the signature is the trusted signer's and the
    ///         attestation has not expired.
    /// @return digest The EIP-712 digest, used by Registry as the swap-count key.
    function verify(LivenessAttestation calldata attestation, bytes calldata signature)
        external
        view
        returns (bool valid, bytes32 digest)
    {
        digest = hashAttestation(attestation);

        if (block.timestamp > attestation.validUntil) {
            return (false, digest);
        }

        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        valid = err == ECDSA.RecoverError.NoError && recovered == trustedSigner;
    }

    /// @notice The EIP-712 digest for an attestation.
    /// @dev Exposed so the frontend can derive the same key this contract counts
    ///      against, without reimplementing the domain separator.
    function hashAttestation(LivenessAttestation calldata attestation) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, attestation.subject, attestation.validUntil, attestation.nonce))
        );
    }

    /// @notice The EIP-712 domain separator, for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function setTrustedSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), ZeroAddress());
        emit TrustedSignerUpdated(trustedSigner, newSigner);
        trustedSigner = newSigner;
    }
}
