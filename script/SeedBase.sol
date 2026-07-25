// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @notice Shared configuration for the demo-traffic scripts.
/// @dev The seeded history is what the subgraph indexes and the Pool Guardian
///      agent reasons over. It is synthetic testnet traffic and must be
///      described that way — the point is to plant behaviour the agent can then
///      be shown finding, not to imply organic usage. See README.md.
///
///      Everything here is derived deterministically from the mnemonic and a
///      tick number, so a run can be repeated or extended without producing a
///      different-looking history.
abstract contract SeedBase is Script {
    error IdenticalTokenAddresses();
    error ZeroTokenAddress();
    error TooFewWallets(uint256 count, uint256 minimum);

    /// @dev Must match DeployPool.s.sol, or the PoolKey addresses a pool that
    ///      was never initialized.
    int24 constant TICK_SPACING = 60;

    /// @dev Enough wallets for the archetype buckets below to each get one.
    uint256 constant MIN_WALLETS = 12;

    /// @notice Behavioural profiles planted in the history.
    /// @dev These exist so the agent has something to find. A few hundred
    ///      identical swaps from identical wallets would index fine and give the
    ///      dashboard nothing to say.
    enum Archetype {
        /// @dev Unverified, fixed size, every tick. The cadence signal.
        Bot,
        /// @dev Large and sporadic. Skews volume without skewing swap count.
        Whale,
        /// @dev Verifies, spends the whole allowance immediately, then keeps
        ///      swapping at the full fee. Shows the cap biting.
        Burner,
        /// @dev Verifies in consecutive windows to hold two live attestations
        ///      at once and take up to 2x maxSwaps. This is the documented
        ///      burst in README.md, planted so the agent can surface it.
        Overlapper,
        /// @dev Irregular size and timing, sometimes verified. The long tail.
        Retail
    }

    address token0;
    address token1;

    /// @dev Base swap size per token, in that token's own base units, sized at
    ///      roughly 0.1% of the seeded liquidity so a few hundred swaps do not
    ///      walk the price somewhere absurd. Direction alternates per wallet
    ///      (see _zeroForOne) which is what actually keeps it mean-reverting.
    ///
    ///      Override both together if you change the pool's liquidity depth:
    ///      their ratio has to track the opening price, or one direction moves
    ///      the pool much further than the other and the history skews.
    uint256 constant DEFAULT_USDC_BASE_SWAP = 10e6; // 10 MyUSDC (6dp)
    uint256 constant DEFAULT_WBTC_BASE_SWAP = 1e4; // 0.0001 MyWBTC (8dp), same value at 1 WBTC = 100k USDC

    function _configurePair() internal {
        address usdc = vm.envAddress("TOKEN_USDC");
        address wbtc = vm.envAddress("TOKEN_WBTC");
        require(usdc != address(0) && wbtc != address(0), ZeroTokenAddress());
        require(usdc != wbtc, IdenticalTokenAddresses());

        // v4 requires currency0 < currency1. DeployPool sorts the same way, so
        // this reproduces the deployed pool's key rather than a sibling of it.
        (token0, token1) = usdc < wbtc ? (usdc, wbtc) : (wbtc, usdc);
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(vm.envAddress("PROOFPOOL_HOOK"))
        });
    }

    function _walletCount() internal view returns (uint256 count) {
        count = vm.envOr("SEED_WALLET_COUNT", uint256(24));
        require(count >= MIN_WALLETS, TooFewWallets(count, MIN_WALLETS));
    }

    /// @dev Throwaway testnet wallets derived from a mnemonic, so every script
    ///      run addresses the same set without storing a key list anywhere.
    ///
    ///      The default is Foundry's public test mnemonic, which is correct for
    ///      the test suite and unusable against a live testnet: those addresses
    ///      are watched by sweeper bots, and gas sent to them is drained within
    ///      seconds. script/seed-traffic.sh refuses to run without an explicit
    ///      SEED_MNEMONIC for exactly that reason.
    function _walletKey(uint256 index) internal view returns (uint256) {
        string memory mnemonic =
            vm.envOr("SEED_MNEMONIC", string("test test test test test test test test test test test junk"));
        // Offset past index 0, which is the default deployer on most local
        // setups and is likely to be the funding account here too.
        // forge-lint: disable-next-line(unsafe-cheatcode,unsafe-typecast)
        return vm.deriveKey(mnemonic, uint32(index + 1));
    }

    function _walletAddress(uint256 index) internal view returns (address) {
        return vm.addr(_walletKey(index));
    }

    /// @dev Fixed buckets rather than a random draw: the mix has to be the same
    ///      on every run, and each archetype has to actually appear.
    function _archetypeOf(uint256 index) internal pure returns (Archetype) {
        if (index < 4) return Archetype.Bot;
        if (index < 6) return Archetype.Whale;
        if (index < 10) return Archetype.Burner;
        if (index < 12) return Archetype.Overlapper;
        return Archetype.Retail;
    }

    function _archetypeName(Archetype a) internal pure returns (string memory) {
        if (a == Archetype.Bot) return "bot";
        if (a == Archetype.Whale) return "whale";
        if (a == Archetype.Burner) return "burner";
        if (a == Archetype.Overlapper) return "overlapper";
        return "retail";
    }

    /// @dev Deterministic per (wallet, tick, tag) so a re-run reproduces the
    ///      same history instead of a differently-shaped one.
    function _rand(uint256 index, uint256 tick, string memory tag) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(index, tick, tag)));
    }

    // --- Attestation epochs -------------------------------------------------
    //
    // These mirror web/lib/challenge.ts. The backend derives an attestation's
    // nonce from HMAC(world nullifier, epoch) and its expiry from the epoch
    // grid, which caps a wallet at ONE attestation — hence one allowance — per
    // epoch. A seeder that minted a fresh nonce whenever it felt like it would
    // write history the production backend refuses to issue, and the agent
    // would end up reporting artifacts of this script as findings.
    //
    // The seed wallet index stands in for the nullifier: one wallet, one
    // "human", which is all that is needed to reproduce the shape.

    /// @dev Deliberately short by default. Production runs hour-long epochs, but
    ///      a seeding run lasts twenty minutes — at 3600s every wallet would get
    ///      exactly one attestation for the entire history. Shortening the epoch
    ///      compresses time instead of breaking the rules: every property the
    ///      agent might reason about stays true, there are just more cycles in
    ///      the window. Set ATTESTATION_TTL_SECONDS to match while seeding.
    function _epochSeconds() internal view returns (uint256) {
        return vm.envOr("SEED_EPOCH_SECONDS", uint256(120));
    }

    function _currentEpoch() internal view returns (uint256) {
        return block.timestamp / _epochSeconds();
    }

    /// @dev One digest per (wallet, epoch), exactly as the backend produces.
    ///      Re-deriving it inside the same epoch rebuilds the same attestation
    ///      and therefore resumes the same partly-spent allowance.
    function _attestationNonce(uint256 index, uint256 epoch) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("proofpool-seed-nullifier", index, epoch)));
    }

    /// @dev Two epochs out, matching attestationValidUntil in challenge.ts. This
    ///      is what makes the documented 2x burst reproducible: an attestation
    ///      from epoch E-1 is still live during epoch E.
    function _attestationValidUntil(uint256 epoch) internal view returns (uint256) {
        return (epoch + 2) * _epochSeconds();
    }

    /// @dev Alternating rather than random: each wallet flips direction on every
    ///      tick it trades, so its own flow nets out and the pool price stays
    ///      near where the liquidity was seeded. Random directions drift.
    function _zeroForOne(uint256 index, uint256 tick) internal pure returns (bool) {
        return (index + tick) % 2 == 0;
    }

    /// @dev Swap size in the input token's own base units. `bps` scales the base
    ///      amount — 10_000 is 1x.
    function _amountIn(bool zeroForOne, uint256 bps) internal view returns (uint128) {
        address inputToken = zeroForOne ? token0 : token1;
        // token0/token1 are the sorted pair; recover which one is which by
        // comparing against the configured USDC address.
        uint256 base = inputToken == vm.envAddress("TOKEN_USDC")
            ? vm.envOr("SEED_BASE_USDC", DEFAULT_USDC_BASE_SWAP)
            : vm.envOr("SEED_BASE_WBTC", DEFAULT_WBTC_BASE_SWAP);
        return uint128((base * bps) / 10_000);
    }
}
