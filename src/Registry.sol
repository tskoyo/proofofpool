// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Registry
/// @notice Records which wallets belong to a unique human, per a World Selfie Check
///         verification, and exposes a simple boolean check that ProofPoolHook reads
///         on every swap.
/// @dev Selfie Check proofs (World ID 3.0 Face proofs) are verified off-chain by our
///      backend against World's `/api/v2/verify/{app_id}` endpoint — there is no
///      on-chain `groupId` for Face proofs, only for Orb (groupId = 1). The backend's
///      `attester` key is the thing this contract trusts; it attests "this nullifier
///      passed off-chain verification" instead of the contract checking a ZK proof
///      itself. One human = one nullifier = one registered address, forever. There is
///      no way to re-verify or revoke; see DESIGN.md for why this is a known
///      limitation, not an oversight.
contract Registry {
    error DuplicateNullifier(uint256 nullifierHash);
    error NotAttester();

    event HumanVerified(address indexed account, uint256 indexed nullifierHash);
    event AttesterUpdated(address indexed oldAttester, address indexed newAttester);

    /// @dev The backend key allowed to attest that a Selfie Check proof verified
    ///      successfully off-chain. Compromise of this key lets an attacker register
    ///      arbitrary addresses as verified — keep it server-only, rotate if leaked.
    address public attester;

    /// @dev The World ID app ID, obtained from the World Developer Portal. Kept for
    ///      reference/off-chain tooling; not used in any on-chain check.
    string public appId;

    /// @dev The World ID action ID configured for this app. Same caveat as `appId`.
    string public actionId;

    /// @dev Tracks which World ID nullifiers have already been used, so the same
    ///      human can't verify twice under a different address.
    mapping(uint256 => bool) public nullifierHashes;

    /// @dev Tracks which addresses have completed verification. This is the
    ///      value the hook actually reads.
    mapping(address => bool) public isVerifiedHuman;

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    /// @param _attester Backend address allowed to attest verified Selfie Check proofs.
    /// @param _appId Your World ID app ID from the Developer Portal.
    /// @param _actionId The action ID configured for this app (e.g. "verify-human").
    constructor(address _attester, string memory _appId, string memory _actionId) {
        attester = _attester;
        appId = _appId;
        actionId = _actionId;
    }

    /// @notice Register `signal` as a verified human, after the backend has verified
    ///         their Selfie Check proof off-chain via World's verify endpoint.
    /// @dev `signal` should be the address that will be swapping — this binds
    ///      the verification to a specific address so it can't be replayed elsewhere.
    /// @param signal The address being verified (typically the user's wallet).
    /// @param nullifierHash The nullifier hash from the verified World ID proof,
    ///        preventing double-registration by the same human.
    function registerVerifiedHuman(address signal, uint256 nullifierHash) external onlyAttester {
        if (nullifierHashes[nullifierHash]) {
            revert DuplicateNullifier(nullifierHash);
        }

        nullifierHashes[nullifierHash] = true;
        isVerifiedHuman[signal] = true;

        emit HumanVerified(signal, nullifierHash);
    }

    /// @notice Rotate the attester key, e.g. if the backend's signing key is replaced.
    function setAttester(address newAttester) external onlyAttester {
        emit AttesterUpdated(attester, newAttester);
        attester = newAttester;
    }
}
