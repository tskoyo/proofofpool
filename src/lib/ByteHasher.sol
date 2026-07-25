// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ByteHasher
/// @notice Hashes bytes to a field element usable by World ID's proof system.
/// @dev Standard helper from World's own examples — the >> 8 shift ensures the
///      result fits within the SNARK scalar field (~254 bits).
library ByteHasher {
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
}
