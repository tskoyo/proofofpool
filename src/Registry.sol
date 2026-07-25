// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWorldID} from "./interfaces/IWorldID.sol";
import {ByteHasher} from "./lib/ByteHasher.sol";

/// @title Registry
/// @notice Verifies a wallet belongs to a unique human via World ID, and exposes
///         a simple boolean check that ProofPoolHook reads on every swap.
/// @dev One human = one nullifier = one registered address, forever. There is no
///      way to re-verify or revoke; see DESIGN.md for why this is a known limitation,
///      not an oversight.
contract Registry {
    using ByteHasher for bytes;

    error DuplicateNullifier(uint256 nullifierHash);

    event HumanVerified(address indexed account, uint256 indexed nullifierHash);

    /// @dev The World ID instance (router) that verifies proofs.
    IWorldID internal immutable WORLD_ID;

    /// @dev The World ID app ID, obtained from the World Developer Portal.
    uint256 internal immutable EXTERNAL_NULLIFIER_HASH;

    /// @dev The World ID group ID. `1` for orb-verified humans.
    ///      Confirm this constant against current World docs before deploy —
    ///      it's the kind of thing that silently changes between SDK versions.
    uint256 internal constant GROUP_ID = 1;

    /// @dev Tracks which World ID nullifiers have already been used, so the same
    ///      human can't verify twice under a different address.
    mapping(uint256 => bool) internal nullifierHashes;

    /// @dev Tracks which addresses have completed verification. This is the
    ///      value the hook actually reads.
    mapping(address => bool) public isVerifiedHuman;

    /// @param _worldId The address of the WorldIDRouter contract on this chain.
    /// @param _appId Your World ID app ID from the Developer Portal.
    /// @param _actionId The action ID configured for this app (e.g. "verify-human").
    constructor(
        IWorldID _worldId,
        string memory _appId,
        string memory _actionId
    ) {
        WORLD_ID = _worldId;
        EXTERNAL_NULLIFIER_HASH = abi
            .encodePacked(abi.encodePacked(_appId).hashToField(), _actionId)
            .hashToField();
    }

    /// @notice Verify a World ID proof and register `signal` as a verified human.
    /// @dev `signal` should be the address that will be swapping — this binds
    ///      the proof to a specific address so it can't be replayed elsewhere.
    /// @param signal The address being verified (typically msg.sender).
    /// @param root The root of the Merkle tree, from the ZK proof.
    /// @param nullifierHash The nullifier hash for this proof, preventing double-registration.
    /// @param proof The zero-knowledge proof from IDKit.
    function verifyAndRegister(
        address signal,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        if (nullifierHashes[nullifierHash])
            revert DuplicateNullifier(nullifierHash);

        WORLD_ID.verifyProof(
            root,
            GROUP_ID,
            abi.encodePacked(signal).hashToField(),
            nullifierHash,
            EXTERNAL_NULLIFIER_HASH,
            proof
        );

        nullifierHashes[nullifierHash] = true;
        isVerifiedHuman[signal] = true;

        emit HumanVerified(signal, nullifierHash);
    }
}
