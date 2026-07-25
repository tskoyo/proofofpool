// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWorldID
/// @notice Interface for the WorldID Router contract, used to verify zero-knowledge proofs.
/// @dev This matches the canonical interface from worldcoin/world-id-contracts.
///      Do not reimplement proof verification — always call the deployed router.
interface IWorldID {
    /// @notice Reverts if the zero-knowledge proof is invalid.
    /// @param root The root of the Merkle tree (returned by the JS widget).
    /// @param groupId The group ID of the Semaphore group (1 = orb-verified humans).
    /// @param signalHash A keccak256 hash of the Semaphore signal, truncated to fit a field element.
    /// @param nullifierHash The nullifier hash for this proof, preventing double-verification.
    /// @param externalNullifierHash A keccak256 hash of the app ID and action ID, truncated to fit a field element.
    /// @param proof The zero-knowledge proof, encoded as an array of 8 uint256s.
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
