// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWorldID} from "../../src/interfaces/IWorldID.sol";

/// @notice Test-only mock. Always accepts proofs unless `shouldRevert` is set.
///         Never deploy this — it exists so we can test Registry/hook logic
///         without generating real World ID ZK proofs in Foundry.
contract MockWorldID is IWorldID {
    bool public shouldRevert;

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function verifyProof(uint256, uint256, uint256, uint256, uint256, uint256[8] calldata) external view override {
        require(!shouldRevert, "MockWorldID: proof rejected");
    }
}
