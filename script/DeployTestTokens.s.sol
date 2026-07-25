// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Deploys the two demo ERC-20s the ProofPool pool trades, and mints a
///         large balance to the deployer. Run this before DeployPool and pass
///         the two addresses it prints as TOKEN0/TOKEN1.
///
///   forge script script/DeployTestTokens.s.sol:DeployTestTokens \
///     --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast -vvvv
///
/// @dev These mirror the decimals of the assets they stand in for (USDC 6,
///      WBTC 8) so the pool math and UI formatting behave like the real pair.
///      `MockERC20.mint` is public and unrestricted, so demo wallets can be
///      topped up afterwards without redeploying:
///
///        cast send <token> "mint(address,uint256)" <wallet> <amount> \
///          --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
contract DeployTestTokens is Script {
    uint8 constant USDC_DECIMALS = 6;
    uint8 constant WBTC_DECIMALS = 8;

    /// @dev Deliberately far more than any demo needs — running dry mid-demo is
    ///      worse than an oversized number in a block explorer.
    uint256 constant USDC_MINT = 10_000_000 * 10 ** USDC_DECIMALS; // 10,000,000 MyUSDC
    uint256 constant WBTC_MINT = 1_000 * 10 ** WBTC_DECIMALS; // 1,000 MyWBTC

    function run() external {
        vm.startBroadcast();

        address deployer = msg.sender;

        MockERC20 usdc = new MockERC20("MyUSDC", "MyUSDC", USDC_DECIMALS);
        MockERC20 wbtc = new MockERC20("MyWBTC", "MyWBTC", WBTC_DECIMALS);

        usdc.mint(deployer, USDC_MINT);
        wbtc.mint(deployer, WBTC_MINT);

        vm.stopBroadcast();

        console2.log("MyUSDC deployed at", address(usdc));
        console2.log("MyWBTC deployed at", address(wbtc));
        console2.log("Minted to", deployer);
        console2.log("  MyUSDC (6dp):", USDC_MINT);
        console2.log("  MyWBTC (8dp):", WBTC_MINT);

        // DeployPool sorts these itself (v4 requires currency0 < currency1), so
        // set them by name — order doesn't matter here.
        console2.log("Set in the root .env:");
        console2.log("  TOKEN_USDC=", address(usdc));
        console2.log("  TOKEN_WBTC=", address(wbtc));
    }
}
