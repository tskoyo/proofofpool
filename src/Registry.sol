// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LivenessAttestation, LivenessOracle} from "./LivenessOracle.sol";

/// @title Registry
/// @notice Decides whether a swapper is entitled to the discounted fee, and counts
///         how many discounted swaps each attestation has been used for.
/// @dev Split of responsibility: LivenessOracle answers "is this signature ours and
///      still fresh", Registry answers "has this attestation been used up". A
///      discount requires BOTH — the attestation must be unexpired AND under the
///      swap cap, so whichever limit is reached first ends it.
///
///      Nothing here records World nullifiers, so one human can hold attestations
///      for any number of addresses. That is a known, accepted gap; see README.md.
contract Registry {
    error NotOwner();
    error NotHook();
    error ZeroAddress();

    event HookUpdated(address indexed oldHook, address indexed newHook);
    event MaxSwapsUpdated(uint256 oldMaxSwaps, uint256 newMaxSwaps);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event DiscountedSwapRecorded(bytes32 indexed digest, uint256 newCount);

    /// @notice Verifies attestation signatures and expiry.
    LivenessOracle public immutable ORACLE;

    /// @notice Discounted swaps already taken, keyed by EIP-712 digest.
    /// @dev The digest commits to `subject`, so a count is inherently per-address.
    ///      A fresh attestation (new nonce) is a new digest and so a new allowance.
    mapping(bytes32 => uint256) public usageCount;

    /// @notice Discounted swaps allowed per attestation. Zero means uncapped.
    uint256 public maxSwaps;

    /// @notice The only address allowed to record swaps.
    /// @dev Set after deployment: the hook's CREATE2 address depends on this
    ///      contract's address, so the Registry has to exist first.
    address public hook;

    /// @notice May set the hook and change the swap cap.
    address public owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(LivenessOracle _oracle, uint256 _maxSwaps, address _owner) {
        if (address(_oracle) == address(0) || _owner == address(0)) revert ZeroAddress();
        ORACLE = _oracle;
        maxSwaps = _maxSwaps;
        owner = _owner;
    }

    /// @notice Whether `swapper` may take the discounted fee with this attestation.
    /// @dev Never reverts — an invalid attestation means "pay full fee", not
    ///      "revert the swap". The `subject == swapper` check is what stops a caller
    ///      presenting somebody else's valid attestation as their own.
    /// @return discounted True if the attestation is valid, belongs to `swapper`,
    ///         and still has swaps left.
    /// @return digest The attestation's digest, to pass back to `recordSwap`.
    function discountFor(LivenessAttestation calldata attestation, bytes calldata signature, address swapper)
        external
        view
        returns (bool discounted, bytes32 digest)
    {
        if (attestation.subject != swapper) return (false, bytes32(0));

        bool valid;
        (valid, digest) = ORACLE.verify(attestation, signature);
        if (!valid) return (false, digest);

        discounted = maxSwaps == 0 || usageCount[digest] < maxSwaps;
    }

    /// @notice Record that an attestation was used for a discounted swap.
    /// @dev Called from the hook's beforeSwap. If the swap later reverts, this
    ///      write reverts with it, so the count only ever reflects swaps that
    ///      actually settled.
    function recordSwap(bytes32 digest) external onlyHook {
        uint256 newCount = usageCount[digest] + 1;
        usageCount[digest] = newCount;
        emit DiscountedSwapRecorded(digest, newCount);
    }

    /// @notice Discounted swaps still available on an attestation.
    /// @dev Returns `type(uint256).max` when uncapped.
    function swapsRemaining(bytes32 digest) external view returns (uint256) {
        if (maxSwaps == 0) return type(uint256).max;
        uint256 used = usageCount[digest];
        return used >= maxSwaps ? 0 : maxSwaps - used;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroAddress();
        emit HookUpdated(hook, newHook);
        hook = newHook;
    }

    function setMaxSwaps(uint256 newMaxSwaps) external onlyOwner {
        emit MaxSwapsUpdated(maxSwaps, newMaxSwaps);
        maxSwaps = newMaxSwaps;
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }
}
