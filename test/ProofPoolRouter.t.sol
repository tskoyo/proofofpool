// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LivenessAttestation} from "../src/LivenessOracle.sol";
import {ProofPoolRouter} from "../src/ProofPoolRouter.sol";

contract RouterPoolManagerStub {
    BalanceDelta internal configuredDelta;
    bytes public lastHookData;
    Currency public lastSyncedCurrency;
    Currency public lastTakenCurrency;
    address public lastRecipient;
    uint256 public lastTakenAmount;
    uint256 public settleCalls;

    function setDelta(int128 amount0, int128 amount1) external {
        configuredDelta = toBalanceDelta(amount0, amount1);
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey calldata, SwapParams calldata, bytes calldata hookData) external returns (BalanceDelta) {
        lastHookData = hookData;
        return configuredDelta;
    }

    function sync(Currency currency) external {
        lastSyncedCurrency = currency;
    }

    function take(Currency currency, address to, uint256 amount) external {
        lastTakenCurrency = currency;
        lastRecipient = to;
        lastTakenAmount = amount;
    }

    function settle() external returns (uint256) {
        settleCalls++;
        return 0;
    }
}

contract NoReturnToken {
    function transferFrom(address, address, uint256) external {}
}

contract FalseReturnToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract MalformedReturnToken {
    fallback(bytes calldata) external returns (bytes memory) {
        return hex"01";
    }
}

contract ProofPoolRouterTest is Test {
    uint128 internal constant AMOUNT_IN = 100;
    uint128 internal constant AMOUNT_OUT = 75;

    RouterPoolManagerStub internal manager;
    ProofPoolRouter internal router;
    NoReturnToken internal token0;
    NoReturnToken internal token1;
    address internal swapper = address(0xCAFE);

    function setUp() public {
        manager = new RouterPoolManagerStub();
        router = new ProofPoolRouter(IPoolManager(address(manager)));
        token0 = new NoReturnToken();
        token1 = new NoReturnToken();
        manager.setDelta(-int128(AMOUNT_IN), int128(AMOUNT_OUT));
    }

    function test_constructorRejectsZeroPoolManager() public {
        vm.expectRevert(ProofPoolRouter.InvalidPoolManager.selector);
        new ProofPoolRouter(IPoolManager(address(0)));
    }

    function test_exactInputRejectsZeroAmount() public {
        ProofPoolRouter.ExactInputSingleParams memory params = _params();
        params.amountIn = 0;

        vm.prank(swapper);
        vm.expectRevert(ProofPoolRouter.InvalidAmount.selector);
        router.exactInputSingle(params, _emptyAttestation(), "");
    }

    function test_exactInputRejectsNativeCurrencyOnEitherSide() public {
        ProofPoolRouter.ExactInputSingleParams memory params = _params();
        params.key.currency0 = Currency.wrap(address(0));

        vm.prank(swapper);
        vm.expectRevert(ProofPoolRouter.NativeCurrencyUnsupported.selector);
        router.exactInputSingle(params, _emptyAttestation(), "");

        params = _params();
        params.key.currency1 = Currency.wrap(address(0));

        vm.prank(swapper);
        vm.expectRevert(ProofPoolRouter.NativeCurrencyUnsupported.selector);
        router.exactInputSingle(params, _emptyAttestation(), "");
    }

    function test_emptySignatureBindsAddressOnlyHookDataAndSettlesSwap() public {
        vm.prank(swapper);
        uint256 amountOut = router.exactInputSingle(_params(), _emptyAttestation(), "");

        assertEq(amountOut, AMOUNT_OUT);
        assertEq(manager.lastHookData(), abi.encode(swapper));
        assertEq(Currency.unwrap(manager.lastSyncedCurrency()), address(token0));
        assertEq(Currency.unwrap(manager.lastTakenCurrency()), address(token1));
        assertEq(manager.lastRecipient(), swapper);
        assertEq(manager.lastTakenAmount(), AMOUNT_OUT);
        assertEq(manager.settleCalls(), 1);
    }

    function test_signatureIncludesCallerAttestationAndSignatureInHookData() public {
        LivenessAttestation memory attestation =
            LivenessAttestation({subject: swapper, validUntil: block.timestamp + 1 hours, nonce: 7});
        bytes memory signature = hex"123456";

        vm.prank(swapper);
        router.exactInputSingle(_params(), attestation, signature);

        (address decodedSwapper, LivenessAttestation memory decodedAttestation, bytes memory decodedSignature) =
            abi.decode(manager.lastHookData(), (address, LivenessAttestation, bytes));
        assertEq(decodedSwapper, swapper);
        assertEq(decodedAttestation.subject, attestation.subject);
        assertEq(decodedAttestation.validUntil, attestation.validUntil);
        assertEq(decodedAttestation.nonce, attestation.nonce);
        assertEq(decodedSignature, signature);
    }

    function test_oneForZeroUsesOppositeCurrencies() public {
        manager.setDelta(int128(AMOUNT_OUT), -int128(AMOUNT_IN));
        ProofPoolRouter.ExactInputSingleParams memory params = _params();
        params.zeroForOne = false;

        vm.prank(swapper);
        uint256 amountOut = router.exactInputSingle(params, _emptyAttestation(), "");

        assertEq(amountOut, AMOUNT_OUT);
        assertEq(Currency.unwrap(manager.lastSyncedCurrency()), address(token1));
        assertEq(Currency.unwrap(manager.lastTakenCurrency()), address(token0));
    }

    function test_callbackRejectsNonnegativeInputDelta() public {
        manager.setDelta(0, int128(AMOUNT_OUT));

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(ProofPoolRouter.UnexpectedSwapDelta.selector, int128(0), int128(AMOUNT_OUT))
        );
        router.unlockCallback(_callbackData(_params()));
    }

    function test_callbackRejectsNonpositiveOutputDelta() public {
        manager.setDelta(-int128(AMOUNT_IN), 0);

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(ProofPoolRouter.UnexpectedSwapDelta.selector, -int128(AMOUNT_IN), int128(0))
        );
        router.unlockCallback(_callbackData(_params()));
    }

    function test_callbackRejectsInputGreaterThanRequested() public {
        manager.setDelta(-int128(AMOUNT_IN + 1), int128(AMOUNT_OUT));

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofPoolRouter.UnexpectedSwapDelta.selector, -int128(AMOUNT_IN + 1), int128(AMOUNT_OUT)
            )
        );
        router.unlockCallback(_callbackData(_params()));
    }

    function test_callbackRejectsTokenReturningFalse() public {
        FalseReturnToken falseToken = new FalseReturnToken();
        ProofPoolRouter.ExactInputSingleParams memory params = _params();
        params.key.currency0 = Currency.wrap(address(falseToken));

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofPoolRouter.TransferFromFailed.selector, address(falseToken), swapper, uint256(AMOUNT_IN)
            )
        );
        router.unlockCallback(_callbackData(params));
    }

    function test_callbackRejectsMalformedTokenReturnData() public {
        MalformedReturnToken malformedToken = new MalformedReturnToken();
        ProofPoolRouter.ExactInputSingleParams memory params = _params();
        params.key.currency0 = Currency.wrap(address(malformedToken));

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofPoolRouter.TransferFromFailed.selector, address(malformedToken), swapper, uint256(AMOUNT_IN)
            )
        );
        router.unlockCallback(_callbackData(params));
    }

    function _params() internal view returns (ProofPoolRouter.ExactInputSingleParams memory) {
        return ProofPoolRouter.ExactInputSingleParams({
            key: PoolKey({
                currency0: Currency.wrap(address(token0)),
                currency1: Currency.wrap(address(token1)),
                fee: 0,
                tickSpacing: 1,
                hooks: IHooks(address(0))
            }),
            zeroForOne: true,
            amountIn: AMOUNT_IN,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 1,
            deadline: block.timestamp
        });
    }

    function _callbackData(ProofPoolRouter.ExactInputSingleParams memory params) internal view returns (bytes memory) {
        return
            abi.encode(ProofPoolRouter.CallbackData({swapper: swapper, hookData: abi.encode(swapper), params: params}));
    }

    function _emptyAttestation() internal pure returns (LivenessAttestation memory) {
        return LivenessAttestation({subject: address(0), validUntil: 0, nonce: 0});
    }
}
