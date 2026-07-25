// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {LivenessAttestation} from "./LivenessOracle.sol";

/// @title ProofPoolRouter
/// @notice Minimal exact-input router that binds the identity seen by a
///         ProofPoolHook to the wallet that pays for and receives the swap.
/// @dev This MVP router supports ERC-20 pairs only. The caller supplies an
///      attestation but never an identity: the hook data always carries
///      `msg.sender`, so an attestation issued to somebody else fails the
///      subject check in Registry rather than granting them a discount.
contract ProofPoolRouter is IUnlockCallback {
    error DeadlineExpired(uint256 deadline);
    error InvalidAmount();
    error InvalidPoolManager();
    error NativeCurrencyUnsupported();
    error NotPoolManager();
    error TooLittleReceived(uint256 minimum, uint256 received);
    error TransferFromFailed(address token, address payer, uint256 amount);
    error UnexpectedSwapDelta(int128 inputDelta, int128 outputDelta);

    event SwapExecuted(
        address indexed swapper, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut
    );

    struct ExactInputSingleParams {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
        uint256 deadline;
    }

    struct CallbackData {
        address swapper;
        bytes hookData;
        ExactInputSingleParams params;
    }

    IPoolManager public immutable POOL_MANAGER;

    constructor(IPoolManager poolManager) {
        require(address(poolManager) != address(0), InvalidPoolManager());
        POOL_MANAGER = poolManager;
    }

    /// @notice Swap an exact amount of one ERC-20 for the other pool currency.
    /// @dev `msg.sender` is always the identity, payer, and recipient.
    /// @param attestation Backend-signed proof of liveness. Ignored when
    ///        `signature` is empty, which is how an unverified swap is made.
    /// @param signature The trusted signer's signature over `attestation`.
    function exactInputSingle(
        ExactInputSingleParams calldata params,
        LivenessAttestation calldata attestation,
        bytes calldata signature
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= params.deadline, DeadlineExpired(params.deadline));
        require(params.amountIn != 0, InvalidAmount());
        require(
            Currency.unwrap(params.key.currency0) != address(0) && Currency.unwrap(params.key.currency1) != address(0),
            NativeCurrencyUnsupported()
        );

        // Without a signature there is nothing for the hook to verify, so send the
        // identity alone and save the caller the attestation calldata.
        bytes memory hookData;

        if (signature.length == 0) {
            hookData = abi.encode(msg.sender);
        } else {
            hookData = abi.encode(msg.sender, attestation, signature);
        }

        bytes memory result =
            POOL_MANAGER.unlock(abi.encode(CallbackData({swapper: msg.sender, hookData: hookData, params: params})));
        (uint256 amountIn, uint256 received) = abi.decode(result, (uint256, uint256));

        require(received >= params.amountOutMinimum, TooLittleReceived(params.amountOutMinimum, received));

        Currency currencyIn = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency currencyOut = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        emit SwapExecuted(msg.sender, Currency.unwrap(currencyIn), Currency.unwrap(currencyOut), amountIn, received);

        return received;
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), NotPoolManager());

        CallbackData memory data = abi.decode(rawData, (CallbackData));
        ExactInputSingleParams memory params = data.params;

        BalanceDelta delta = POOL_MANAGER.swap(
            params.key,
            SwapParams({
                zeroForOne: params.zeroForOne,
                amountSpecified: -int256(uint256(params.amountIn)),
                sqrtPriceLimitX96: params.sqrtPriceLimitX96
            }),
            data.hookData
        );

        int128 inputDelta = params.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
        require(inputDelta < 0 && outputDelta > 0, UnexpectedSwapDelta(inputDelta, outputDelta));

        // Safe because the sign checks above establish both values are positive.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountIn = uint256(-int256(inputDelta));
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountOut = uint256(int256(outputDelta));
        require(amountIn <= params.amountIn, UnexpectedSwapDelta(inputDelta, outputDelta));

        Currency currencyIn = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        Currency currencyOut = params.zeroForOne ? params.key.currency1 : params.key.currency0;

        _settle(currencyIn, data.swapper, amountIn);
        POOL_MANAGER.take(currencyOut, data.swapper, amountOut);

        return abi.encode(amountIn, amountOut);
    }

    function _settle(Currency currency, address payer, uint256 amount) private {
        address token = Currency.unwrap(currency);

        POOL_MANAGER.sync(currency);
        (bool success, bytes memory returnData) =
            token.call(abi.encodeCall(IERC20Minimal.transferFrom, (payer, address(POOL_MANAGER), amount)));

        bool transferSucceeded =
            success && (returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))));
        require(transferSucceeded, TransferFromFailed(token, payer, amount));

        POOL_MANAGER.settle();
    }
}
