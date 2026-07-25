// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ProofPoolHook} from "../src/ProofPoolHook.sol";
import {ProofPoolRouter} from "../src/ProofPoolRouter.sol";
import {Registry} from "../src/Registry.sol";
import {LivenessOracle} from "../src/LivenessOracle.sol";
import {SeedTraffic} from "../script/SeedTraffic.s.sol";
import {SeedBase} from "../script/SeedBase.sol";

/// @notice Exercises the demo-traffic seeder against a real pool.
///
/// @dev The seeder spends testnet ETH across two dozen EOAs and takes twenty
///      minutes to run, so "did it compile" is not enough confidence. These
///      tests run the same archetype dispatch, attestation signing, and swap
///      construction the Sepolia run will, just against a local pool.
///
///      What this cannot cover: gas funding (a test contract has no faucet) and
///      timestamp spread (ticks are separate forge invocations on Sepolia,
///      sequential calls here).
contract SeedTrafficTest is Test, Deployers {
    error HookAddressMismatch(address expected, address actual);

    bytes32 internal constant SWAP_PRICED_SIGNATURE =
        keccak256("SwapPriced(bytes32,address,bool,uint24,bool,int256,bytes32)");

    uint256 internal constant WALLET_COUNT = 12;
    uint256 internal constant MAX_SWAPS = 3;
    uint256 internal constant EPOCH_SECONDS = 120;

    /// @dev Pinned, and set into the environment in setUp. `forge test` loads the
    ///      repo's .env, so without this the suite derives whatever SEED_MNEMONIC
    ///      the developer happens to have set for real seeding — funding one set
    ///      of wallets while the seeder trades from another. Safe to use the
    ///      public test mnemonic here: nothing local is exposed to sweeper bots.
    string internal constant TEST_MNEMONIC = "test test test test test test test test test test test junk";

    ProofPoolHook hook;
    ProofPoolRouter proofPoolRouter;
    Registry registry;
    LivenessOracle oracle;
    SeedTraffic seeder;

    uint256 signerKey = 0xA11CE;
    address owner = address(0x0DDBA11);

    function setUp() public {
        // Attestation nonces and expiries are derived from an epoch grid, and
        // the overlapper needs a *previous* epoch to still be live. At the
        // default test timestamp of 1 there is no epoch 0 to look back on.
        vm.warp(1_000_000);

        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        oracle = new LivenessOracle(vm.addr(signerKey), owner);
        registry = new Registry(oracle, MAX_SWAPS, owner);
        proofPoolRouter = new ProofPoolRouter(manager);

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(ProofPoolHook).creationCode,
            abi.encode(address(manager), address(registry), address(proofPoolRouter))
        );
        hook = new ProofPoolHook{salt: salt}(manager, registry, address(proofPoolRouter));
        require(address(hook) == hookAddress, HookAddressMismatch(hookAddress, address(hook)));

        vm.prank(owner);
        registry.setHook(address(hook));

        (key,) = initPoolAndAddLiquidity(currency0, currency1, hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);
        _addFullRangeLiquidity();

        _configureSeedEnvironment();
        _fundSeedWallets();

        seeder = new SeedTraffic();
    }

    /// @dev Deployers seeds a narrow band around the opening price. DeployPool
    ///      seeds the full usable range, so without this the test pool runs out
    ///      of liquidity after a handful of swaps and every later one reverts
    ///      PriceLimitAlreadyExceeded — a failure the Sepolia pool would not have.
    function _addFullRangeLiquidity() internal {
        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    /// @dev The seeder reads its whole configuration from the environment, so
    ///      pointing it at this local deployment is just a matter of setting it.
    function _configureSeedEnvironment() internal {
        vm.setEnv("TOKEN_USDC", vm.toString(Currency.unwrap(currency0)));
        vm.setEnv("TOKEN_WBTC", vm.toString(Currency.unwrap(currency1)));
        vm.setEnv("PROOFPOOL_HOOK", vm.toString(address(hook)));
        vm.setEnv("PROOFPOOL_ROUTER", vm.toString(address(proofPoolRouter)));
        vm.setEnv("PROOFPOOL_REGISTRY", vm.toString(address(registry)));
        vm.setEnv("PROOFPOOL_ORACLE", vm.toString(address(oracle)));
        vm.setEnv("ATTESTER_PRIVATE_KEY", vm.toString(signerKey));
        vm.setEnv("SEED_MNEMONIC", TEST_MNEMONIC);
        vm.setEnv("SEED_WALLET_COUNT", vm.toString(WALLET_COUNT));
        vm.setEnv("SEED_EPOCH_SECONDS", vm.toString(EPOCH_SECONDS));
        vm.setEnv("SEED_BURN_CAP", vm.toString(MAX_SWAPS));

        // Deployers' currencies are 18 decimals; the demo pair is 6 and 8. Scale
        // the base swap up so a seeded swap is not dust against this liquidity.
        vm.setEnv("SEED_BASE_USDC", vm.toString(uint256(1e15)));
        vm.setEnv("SEED_BASE_WBTC", vm.toString(uint256(1e15)));
    }

    /// @dev Stands in for SeedWallets, which cannot run here: it funds gas by
    ///      broadcasting value transfers from an EOA that a test does not have.
    function _fundSeedWallets() internal {
        for (uint256 i = 0; i < WALLET_COUNT; i++) {
            address wallet = _seedWallet(i);
            vm.deal(wallet, 10 ether);

            MockERC20(Currency.unwrap(currency0)).mint(wallet, 1_000_000e18);
            MockERC20(Currency.unwrap(currency1)).mint(wallet, 1_000_000e18);

            vm.startPrank(wallet);
            MockERC20(Currency.unwrap(currency0)).approve(address(proofPoolRouter), type(uint256).max);
            MockERC20(Currency.unwrap(currency1)).approve(address(proofPoolRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _seedWallet(uint256 index) internal pure returns (address) {
        return vm.addr(vm.deriveKey(TEST_MNEMONIC, uint32(index + 1)));
    }

    // --- Tests -------------------------------------------------------------

    /// @notice The whole point of the history: both fee tiers have to appear, or
    ///         the dashboard has nothing to compare.
    function test_seedingProducesBothVerifiedAndUnverifiedSwaps() public {
        vm.recordLogs();
        for (uint256 tick = 0; tick < 8; tick++) {
            seeder.run(tick);
        }

        (uint256 verified, uint256 unverified) = _countPricedSwaps();

        assertGt(verified, 0, "no discounted swaps were seeded");
        assertGt(unverified, 0, "no full-fee swaps were seeded");
    }

    /// @notice A seeded "verified" swap must actually price at the low fee. If
    ///         the attestation were malformed the swap would still succeed, just
    ///         at the full tier, and the history would silently be all one tier.
    function test_seededAttestationsActuallyEarnTheDiscount() public {
        vm.recordLogs();
        seeder.run(0);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        uint256 discounted;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            (bool isVerified, uint24 fee,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (!isVerified) continue;
            assertEq(fee, hook.VERIFIED_FEE(), "verified swap priced at the wrong tier");
            discounted++;
        }

        assertGt(discounted, 0, "tick 0 produced no discounted swaps");
    }

    /// @notice Burners exist to make the cap visible in the indexed history: an
    ///         attestation has to be seen draining, not just used once.
    function test_burnerArchetypeExhaustsItsAllowance() public {
        // Wallet 6 is a Burner, and (tick + 6) % 8 == 0 puts it on its verify
        // tick at tick 2. See SeedBase._archetypeOf.
        vm.recordLogs();
        seeder.run(2);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        address burner = _seedWallet(6);
        uint256 discounted;
        uint256 fullFee;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            if (address(uint160(uint256(entries[i].topics[2]))) != burner) continue;
            (bool isVerified,,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (isVerified) discounted++;
            else fullFee++;
        }

        assertEq(discounted, MAX_SWAPS, "burner should spend exactly its allowance at the low fee");
        assertGt(fullFee, 0, "burner should keep trading at the full fee once spent");
    }

    /// @notice Seeded attestations must obey the same epoch rule the backend
    ///         does: one digest per wallet per epoch. A seeder that minted a
    ///         fresh nonce on every firing would write history production
    ///         refuses to issue — a wallet verifying over and over inside one
    ///         epoch — and the agent would report that artifact as a finding.
    function test_reverifyingInsideOneEpochDoesNotRefillTheAllowance() public {
        address burner = _seedWallet(6);

        // Wallet 6 fires at ticks 2 and 10; no time passes between them here, so
        // both fall in the same epoch and must share one exhausted allowance.
        vm.recordLogs();
        seeder.run(2);
        assertEq(_discountedFor(burner), MAX_SWAPS, "first firing should spend the allowance");

        vm.recordLogs();
        seeder.run(10);
        assertEq(_discountedFor(burner), 0, "same epoch must not grant a second allowance");
    }

    /// @notice ...and crossing an epoch boundary must issue a fresh one, or the
    ///         seeded history would show verification dying out over the run.
    function test_crossingAnEpochGrantsAFreshAllowance() public {
        address burner = _seedWallet(6);

        vm.recordLogs();
        seeder.run(2);
        assertEq(_discountedFor(burner), MAX_SWAPS, "first firing should spend the allowance");

        vm.warp(block.timestamp + EPOCH_SECONDS);

        vm.recordLogs();
        seeder.run(10);
        assertEq(_discountedFor(burner), MAX_SWAPS, "a new epoch should mean a new allowance");
    }

    /// @notice The 2x burst documented in README.md, planted deliberately so the
    ///         agent can be shown surfacing it.
    function test_overlapperTakesTwiceTheCap() public {
        // Wallet 10 is an Overlapper; (tick + 10) % 8 == 0 first holds at tick 6.
        vm.recordLogs();
        seeder.run(6);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        address overlapper = _seedWallet(10);
        uint256 discounted;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            if (address(uint160(uint256(entries[i].topics[2]))) != overlapper) continue;
            (bool isVerified,,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (isVerified) discounted++;
        }

        assertEq(discounted, MAX_SWAPS * 2, "overlapper should hold two live allowances");
    }

    /// @notice Bots are the cadence signal — they must appear on every tick, or
    ///         there is no regularity for the agent to detect.
    function test_botArchetypeTradesEveryTick() public {
        address bot = _seedWallet(0);

        for (uint256 tick = 0; tick < 4; tick++) {
            vm.recordLogs();
            seeder.run(tick);

            Vm.Log[] memory entries = vm.getRecordedLogs();
            bool traded;

            for (uint256 i = 0; i < entries.length; i++) {
                if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
                if (address(uint160(uint256(entries[i].topics[2]))) != bot) continue;
                (bool isVerified,,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
                assertFalse(isVerified, "bots are never verified");
                traded = true;
            }

            assertTrue(traded, "bot skipped a tick");
        }
    }

    /// @notice Direction has to alternate, or a few hundred one-way swaps walk
    ///         the price far enough to distort every fee number in the history.
    function test_directionAlternatesSoPriceDoesNotDrift() public {
        uint256 zeroForOneCount;
        uint256 oneForZeroCount;

        vm.recordLogs();
        for (uint256 tick = 0; tick < 8; tick++) {
            seeder.run(tick);
        }

        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            (,, bool zeroForOne,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (zeroForOne) zeroForOneCount++;
            else oneForZeroCount++;
        }

        assertGt(zeroForOneCount, 0, "no swaps in one direction");
        assertGt(oneForZeroCount, 0, "no swaps in the other direction");

        // Not exact parity — archetypes fire on different schedules — but a
        // wild imbalance means _zeroForOne stopped alternating.
        uint256 total = zeroForOneCount + oneForZeroCount;
        assertLt(zeroForOneCount * 100 / total, 75, "flow is lopsided; price will drift");
        assertGt(zeroForOneCount * 100 / total, 25, "flow is lopsided; price will drift");
    }

    /// @dev Discounted swaps attributed to `swapper` in the logs recorded so far.
    function _discountedFor(address swapper) internal returns (uint256 discounted) {
        Vm.Log[] memory entries = vm.getRecordedLogs();

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            if (address(uint160(uint256(entries[i].topics[2]))) != swapper) continue;
            (bool isVerified,,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (isVerified) discounted++;
        }
    }

    function _countPricedSwaps() internal returns (uint256 verified, uint256 unverified) {
        Vm.Log[] memory entries = vm.getRecordedLogs();

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != SWAP_PRICED_SIGNATURE) continue;
            (bool isVerified,,,) = abi.decode(entries[i].data, (bool, uint24, bool, int256));
            if (isVerified) verified++;
            else unverified++;
        }
    }
}
