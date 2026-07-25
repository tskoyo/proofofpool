// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {SeedBase} from "./SeedBase.sol";

/// @notice One-time setup for the demo-traffic wallets: mint each one both demo
///         tokens and approve the ProofPool router.
///
///   forge script script/SeedWallets.s.sol:SeedWallets \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast
///
/// @dev Run once after a deploy, before SeedTraffic. Safe to re-run: wallets
///      already holding tokens and allowance are skipped.
///
///      Gas funding is NOT done here. Value sent from inside a forge script
///      leaves the script contract's balance during simulation, not the
///      broadcasting EOA's, so a naive `wallet.call{value: x}` fails or funds
///      from the wrong place. script/seed-traffic.sh sends the ETH with
///      `cast send` from PRIVATE_KEY instead, which is unambiguous and
///      resumable, and calls `walletList()` below to know where to send it.
///
///      Every seed wallet is a separate EOA because the hook prices
///      `msg.sender` at the router — there is no way to fake N distinct
///      swappers from one account, which is why gas is the binding constraint.
contract SeedWallets is SeedBase {
    /// @dev MockERC20.mint is public and unrestricted, so wallets mint their own
    ///      tokens instead of the deployer transferring to each. Saves a
    ///      transaction per wallet per token and cannot drain the deployer.
    uint256 constant USDC_MINT_PER_WALLET = 100_000e6; // 100,000 MyUSDC
    uint256 constant WBTC_MINT_PER_WALLET = 10e8; // 10 MyWBTC

    /// @notice Prints the seed wallet addresses for the shell to fund.
    /// @dev Derivation lives here alone. Re-deriving the same mnemonic in bash
    ///      would be a second implementation of it, and a path mismatch would
    ///      quietly send the ETH to addresses that never swap.
    function walletList() external view {
        uint256 count = _walletCount();
        for (uint256 i = 0; i < count; i++) {
            console2.log(
                string.concat("WALLET ", vm.toString(i), " ", _archetypeName(_archetypeOf(i))), _walletAddress(i)
            );
        }
    }

    function run() external {
        _configurePair();

        address router = vm.envAddress("PROOFPOOL_ROUTER");
        uint256 count = _walletCount();

        console2.log("Preparing", count, "wallets");
        console2.log("  router:", router);

        uint256 prepared;
        uint256 skipped;

        for (uint256 i = 0; i < count; i++) {
            uint256 walletKey = _walletKey(i);
            address wallet = vm.addr(walletKey);

            // Broadcast from the wallet itself, so it needs its own gas. Skip
            // rather than revert: reverting would abort the whole run over one
            // wallet, and the shell reports what it funded anyway. A wallet that
            // is genuinely short surfaces at the tick it first tries to trade.
            if (wallet.balance == 0) {
                console2.log(string.concat("  [", vm.toString(i), "] SKIPPED, no gas"), wallet);
                skipped++;
                continue;
            }

            bool needsTokens = IERC20(token0).balanceOf(wallet) == 0;
            bool needsAllowance = IERC20(token0).allowance(wallet, router) == 0;
            if (!needsTokens && !needsAllowance) continue;

            vm.startBroadcast(walletKey);

            if (needsTokens) {
                _mint(token0, wallet);
                _mint(token1, wallet);
            }

            if (needsAllowance) {
                IERC20(token0).approve(router, type(uint256).max);
                IERC20(token1).approve(router, type(uint256).max);
            }

            vm.stopBroadcast();
            prepared++;
        }

        console2.log("Wallets prepared this run:", prepared);
        if (skipped > 0) {
            console2.log("Wallets skipped for lack of gas:", skipped);
        }
    }

    /// @dev Amount depends on which sorted slot the token landed in, since the
    ///      two demo tokens have different decimals.
    function _mint(address token, address to) internal {
        uint256 amount = token == vm.envAddress("TOKEN_USDC") ? USDC_MINT_PER_WALLET : WBTC_MINT_PER_WALLET;
        (bool ok,) = token.call(abi.encodeWithSignature("mint(address,uint256)", to, amount));
        require(ok, "mint failed - is this a MockERC20?");
    }
}
