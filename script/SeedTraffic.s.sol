// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {SeedBase} from "./SeedBase.sol";
import {ProofPoolRouter} from "../src/ProofPoolRouter.sol";
import {Registry} from "../src/Registry.sol";
import {LivenessAttestation, LivenessOracle} from "../src/LivenessOracle.sol";

/// @notice Runs one tick of synthetic demo traffic: every seed wallet does
///         whatever its archetype does at this tick.
///
///   forge script script/SeedTraffic.s.sol:SeedTraffic --sig "run(uint256)" 7 \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast
///
/// @dev Driven by script/seed-traffic.sh, which loops the tick number and sleeps
///      between runs. The sleeping is the point: a forge script broadcasts its
///      whole batch into a couple of consecutive blocks, and a history where
///      every swap shares a timestamp makes cadence analysis meaningless — which
///      is most of what the agent is supposed to reason about.
///
///      Attestations are signed here with the attester key directly. Seed
///      wallets never touch World: the backend's job is to decide *whether* to
///      sign, and that decision is not what this script is exercising. The
///      contracts cannot tell the difference, because a real attestation is also
///      just an EIP-712 signature from this key.
contract SeedTraffic is SeedBase {
    error NoActiveWallets();

    /// @dev Swap sizes, in basis points of the archetype's base amount.
    uint256 constant WHALE_SIZE_BPS = 200_000; // 20x
    uint256 constant RETAIL_MIN_BPS = 5_000; // 0.5x
    uint256 constant RETAIL_SPREAD_BPS = 25_000; // up to 3x

    /// @dev Fallback burn depth when Registry.maxSwaps is 0 (uncapped), where
    ///      "spend the whole allowance" would otherwise mean an unbounded loop.
    uint256 constant UNCAPPED_BURN_SWAPS = 4;

    /// @dev Gas per swap, measured from the Foundry gas report (median 205k for
    ///      exactInputSingle) plus intrinsic cost and headroom. Only used by
    ///      plan() to price a run before it is paid for.
    uint256 constant GAS_PER_SWAP = 260_000;

    ProofPoolRouter router;
    Registry registry;
    LivenessOracle oracle;
    uint256 attesterKey;
    uint256 burnCap;
    PoolKey poolKey;

    uint256 verifiedSwaps;
    uint256 unverifiedSwaps;

    /// @dev Set by plan(): dispatch runs identically but no transaction is sent.
    ///      Sharing _act between the estimate and the real run is the point — an
    ///      estimate computed by a separate code path drifts from what runs.
    bool counting;

    /// @dev Swaps per wallet, filled during plan(). Archetypes are wildly
    ///      uneven — a bot swaps every tick, retail roughly every third — so the
    ///      busiest wallet is what per-wallet gas funding has to cover.
    mapping(uint256 walletIndex => uint256 swaps) plannedSwaps;

    function run(uint256 tick) external {
        _configure();

        console2.log("Tick", tick, "epoch", _currentEpoch());

        uint256 count = _walletCount();
        for (uint256 i = 0; i < count; i++) {
            _act(i, tick);
        }

        console2.log("  verified swaps:  ", verifiedSwaps);
        console2.log("  unverified swaps:", unverifiedSwaps);
    }

    /// @notice Counts what a full run would cost, without sending anything.
    ///
    ///   forge script script/SeedTraffic.s.sol:SeedTraffic --sig "plan(uint256)" 50 \
    ///     --rpc-url $SEPOLIA_RPC_URL
    ///
    /// @dev Deliberately not `view` — it walks the same dispatch as run().
    function plan(uint256 ticks) external {
        _configure();
        counting = true;

        uint256 count = _walletCount();
        for (uint256 tick = 0; tick < ticks; tick++) {
            for (uint256 i = 0; i < count; i++) {
                _act(i, tick);
            }
        }

        uint256 total = verifiedSwaps + unverifiedSwaps;

        uint256 busiest;
        for (uint256 i = 0; i < count; i++) {
            if (plannedSwaps[i] > busiest) busiest = plannedSwaps[i];
            // Per-wallet, so the shell can fund each for what it will actually
            // do. Archetypes differ by ~3x, and funding everyone at the bot's
            // rate would over-allocate scarce testnet ETH several times over.
            console2.log(string.concat("PLAN_WALLET_GAS ", vm.toString(i)), plannedSwaps[i] * GAS_PER_SWAP);
        }

        // Machine-readable for seed-traffic.sh, which turns these into an ETH
        // figure at the live gas price and asks before spending it.
        console2.log("PLAN_TICKS", ticks);
        console2.log("PLAN_WALLETS", count);
        console2.log("PLAN_VERIFIED", verifiedSwaps);
        console2.log("PLAN_UNVERIFIED", unverifiedSwaps);
        console2.log("PLAN_SWAPS", total);
        console2.log("PLAN_GAS", total * GAS_PER_SWAP);
        console2.log("PLAN_BUSIEST_WALLET_SWAPS", busiest);
        console2.log("PLAN_GAS_PER_WALLET", busiest * GAS_PER_SWAP);
    }

    function _configure() internal {
        _configurePair();

        router = ProofPoolRouter(vm.envAddress("PROOFPOOL_ROUTER"));
        registry = Registry(vm.envAddress("PROOFPOOL_REGISTRY"));
        oracle = LivenessOracle(vm.envAddress("PROOFPOOL_ORACLE"));
        attesterKey = vm.envUint("ATTESTER_PRIVATE_KEY");
        poolKey = _poolKey();

        // Burners and overlappers spend a whole allowance in one go, so with a
        // large maxSwaps they alone dominate the cost of a run. Capped
        // separately: the history needs an allowance visibly draining, not a
        // faithful reproduction of whatever the cap happens to be set to.
        uint256 maxSwaps = registry.maxSwaps();
        uint256 requested = vm.envOr("SEED_BURN_CAP", UNCAPPED_BURN_SWAPS);
        burnCap = (maxSwaps == 0 || requested < maxSwaps) ? requested : maxSwaps;
    }

    function _act(uint256 i, uint256 tick) internal {
        Archetype archetype = _archetypeOf(i);
        uint256 epoch = _currentEpoch();

        if (archetype == Archetype.Bot) {
            // Every tick, same size, same wallet, no attestation. The regularity
            // is the whole point — this is the cadence the agent should flag.
            _swapUnverified(i, tick, 10_000);
        } else if (archetype == Archetype.Whale) {
            if ((tick + i) % 5 != 0) return;
            if (_rand(i, tick, "whale-verified") % 2 == 0) {
                _swapVerified(i, tick, epoch, WHALE_SIZE_BPS, 1);
            } else {
                _swapUnverified(i, tick, WHALE_SIZE_BPS);
            }
        } else if (archetype == Archetype.Burner) {
            if ((tick + i) % 8 == 0) {
                // Spends the allowance in one go rather than pacing it, then
                // keeps trading at the full fee. Re-firing inside the same epoch
                // rebuilds the same digest, so the allowance stays spent —
                // which is exactly what production does.
                _swapVerified(i, tick, epoch, 10_000, burnCap);
                _swapUnverified(i, tick, 10_000);
            } else if (_rand(i, tick, "burner-idle") % 100 < 35) {
                _swapUnverified(i, tick, 10_000);
            }
        } else if (archetype == Archetype.Overlapper) {
            if ((tick + i) % 8 != 0) return;
            // The documented 2x burst, reproduced rather than faked: an
            // attestation expires two epochs out, so the one minted last epoch
            // is still live alongside this epoch's. Two digests, two allowances.
            _swapVerified(i, tick, epoch, 10_000, burnCap);
            if (epoch > 0) {
                _swapVerified(i, tick, epoch - 1, 10_000, burnCap);
            }
        } else {
            if (_rand(i, tick, "retail-active") % 100 >= 40) return;
            uint256 bps = RETAIL_MIN_BPS + (_rand(i, tick, "retail-size") % RETAIL_SPREAD_BPS);
            if (_rand(i, tick, "retail-verified") % 2 == 0) {
                _swapVerified(i, tick, epoch, bps, 1);
            } else {
                _swapUnverified(i, tick, bps);
            }
        }
    }

    function _swapUnverified(uint256 i, uint256 tick, uint256 bps) internal {
        LivenessAttestation memory none = LivenessAttestation({subject: address(0), validUntil: 0, nonce: 0});
        _execute(i, tick, bps, none, "");
        unverifiedSwaps++;
    }

    /// @dev `swaps` back-to-back swaps against the attestation this wallet holds
    ///      for `epoch`, which is what makes the allowance visibly drain in the
    ///      indexed history. The attestation is derived, never invented: one
    ///      wallet gets one digest per epoch, as the backend would issue.
    function _swapVerified(uint256 i, uint256 tick, uint256 epoch, uint256 bps, uint256 swaps) internal {
        LivenessAttestation memory attestation = LivenessAttestation({
            subject: _walletAddress(i), validUntil: _attestationValidUntil(epoch), nonce: _attestationNonce(i, epoch)
        });

        bytes memory signature;
        if (!counting) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, oracle.hashAttestation(attestation));
            signature = abi.encodePacked(r, s, v);
        }

        for (uint256 n = 0; n < swaps; n++) {
            _execute(i, tick + n, bps, attestation, signature);
            verifiedSwaps++;
        }
    }

    function _execute(
        uint256 i,
        uint256 tick,
        uint256 bps,
        LivenessAttestation memory attestation,
        bytes memory signature
    ) internal {
        // plan() walks the same dispatch to count swaps; there is nothing to
        // send, and no RPC round trip to spend on a free-tier key.
        if (counting) {
            plannedSwaps[i]++;
            return;
        }

        bool zeroForOne = _zeroForOne(i, tick);

        ProofPoolRouter.ExactInputSingleParams memory params = ProofPoolRouter.ExactInputSingleParams({
            key: poolKey,
            zeroForOne: zeroForOne,
            amountIn: _amountIn(zeroForOne, bps),
            // No slippage floor: a seeded swap that reverts on a price move
            // leaves a hole in the history, which is worse than a bad fill on
            // testnet tokens nobody values.
            amountOutMinimum: 0,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            deadline: block.timestamp + 1 hours
        });

        vm.broadcast(_walletKey(i));
        router.exactInputSingle(params, attestation, signature);
    }
}
