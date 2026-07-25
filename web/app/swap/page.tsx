"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Banner,
  Button,
  Card,
  Dialog,
  Icon,
  IconButton,
  Input,
  QuoteCompare,
  Select,
  Tabs,
} from "@/components/ds";
import { NetworkNotice, WalletButton } from "@/components/wallet-ui";
import { useWallet, TARGET_CHAIN } from "@/lib/wallet";
import { useVerificationStatus } from "@/lib/verification";
import { feeCost, useFeeTiers } from "@/lib/pool";
import { TOKEN_OPTIONS, counterpart, formatAmount, tokenBySymbol, type Token } from "@/lib/tokens";
import { formatUnits, parseUnits, useBalances } from "@/lib/erc20";
import { ROUTER_ADDRESS, useSwap } from "@/lib/swap";
import { applySlippage, applyVerifiedDiscount, useQuote } from "@/lib/quote";

/** Shows a token's on-chain balance, with an optional click-to-fill. */
function BalanceRow({
  token,
  balance,
  onMax,
}: {
  token: Token;
  balance: bigint | undefined;
  onMax?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 8,
        margin: "-2px 0 0",
        fontSize: "var(--text-caption)",
        color: "var(--text-tertiary)",
      }}
    >
      <span>
        Balance:{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {balance === undefined ? "—" : formatUnits(balance, token)}
        </span>{" "}
        {token.symbol}
      </span>
      {onMax && (
        <button
          type="button"
          onClick={onMax}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-caption)",
            fontWeight: 600,
            color: "var(--accent-primary)",
          }}
        >
          Max
        </button>
      )}
    </div>
  );
}

const SLIPPAGE_TABS = [
  { label: "0.1%", value: "0.1" },
  { label: "0.5%", value: "0.5" },
  { label: "1.0%", value: "1.0" },
  { label: "Custom", value: "custom" },
];

export default function SwapPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [payAmount, setPayAmount] = useState("100");
  const [paySymbol, setPaySymbol] = useState("USDC");

  const [slippageMode, setSlippageMode] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [deadline, setDeadline] = useState("30");

  const { address, status, connect, disconnect, switchToTargetChain, isConnected, isWrongChain } = useWallet();
  const { state: verificationState, isVerified } = useVerificationStatus(address);
  const { verifiedFee, unverifiedFee, verifiedLabel, unverifiedLabel, source: feeSource } = useFeeTiers();
  const { balances, refresh: refreshBalances } = useBalances(address);
  const { swap, stage, error: swapError, txHash, reset: resetSwap, isBusy } = useSwap();

  const payToken = tokenBySymbol(paySymbol);
  const receiveToken = counterpart(payToken);

  const payBalance = balances[payToken.symbol];
  const receiveBalance = balances[receiveToken.symbol];

  const amountNum = Number.parseFloat(payAmount);
  // Parsed in base units for the transaction; the float above is display only.
  const amountRaw = parseUnits(payAmount, payToken);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountRaw !== null && amountRaw > 0n;
  const insufficient = amountValid && payBalance !== undefined && amountRaw! > payBalance;
  const amountError = payAmount && !amountValid
    ? "Enter an amount greater than zero."
    : insufficient
      ? `More than your ${payToken.symbol} balance.`
      : undefined;


  // Both of these are exact: real fee constants from the hook, applied to the
  // amount the user typed. No price feed is involved, so nothing here is estimated.
  const standardCost = amountValid ? feeCost(amountNum, unverifiedFee) : Number.NaN;
  const verifiedCost = amountValid ? feeCost(amountNum, verifiedFee) : Number.NaN;
  const saving = amountValid ? standardCost - verifiedCost : Number.NaN;

  const rawSlippage = slippageMode === "custom" ? customSlippage : slippageMode;
  const slippageNum = Number.parseFloat(rawSlippage);
  const slippageValid = Number.isFinite(slippageNum) && slippageNum > 0 && slippageNum <= 50;

  const deadlineNum = Number.parseInt(deadline, 10);
  const deadlineValid = Number.isFinite(deadlineNum) && deadlineNum > 0 && deadlineNum <= 4320;
  const settingsValid = slippageValid && deadlineValid;

  const slippageError = !rawSlippage || slippageValid ? undefined : "Enter a percentage between 0 and 50.";
  const deadlineError =
    !deadline || deadlineValid ? undefined : "Enter a whole number of minutes, up to 4320 (3 days).";

  // The quote is always priced at the unverified tier — the quoter isn't the
  // trusted router, so the hook won't take an identity from it. For a verified
  // wallet the real output is higher, hence the discount applied for display.
  const { amountOut: quotedOut, state: quoteState } = useQuote(payToken, amountRaw);
  const expectedOut =
    quotedOut === null
      ? null
      : isVerified
        ? applyVerifiedDiscount(quotedOut, verifiedFee, unverifiedFee)
        : quotedOut;

  // Built from the raw quote rather than the discounted estimate: it's a strict
  // lower bound on what a verified wallet receives, so the floor stays valid
  // even though the displayed number is an approximation.
  const amountOutMinimum =
    quotedOut !== null && slippageValid ? applySlippage(quotedOut, slippageNum) : 0n;
  const hasNoFloor = amountOutMinimum === 0n;

  const canSwap =
    isConnected && !isWrongChain && settingsValid && amountValid && !insufficient && !isBusy && Boolean(ROUTER_ADDRESS);

  async function executeSwap() {
    if (!address || !amountRaw) return;
    const hash = await swap({
      account: address,
      tokenIn: payToken,
      amountIn: amountRaw,
      amountOutMinimum,
      deadlineMinutes: deadlineNum,
    });
    if (hash) {
      setConfirmOpen(false);
      void refreshBalances();
    }
  }

  function selectPayToken(symbol: string) {
    setPaySymbol(symbol);
  }

  function flipPair() {
    setPaySymbol(receiveToken.symbol);
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          padding: "20px 28px",
          flexWrap: "wrap",
        }}
      >
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 24, display: "block" }} />
        </Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <WalletButton
            status={status}
            address={address}
            verified={isVerified}
            onConnect={connect}
            onDisconnect={disconnect}
          />
          <IconButton
            name="settings"
            label="Transaction settings"
            active={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      <div
        style={{
          maxWidth: 440,
          margin: "40px auto",
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <NetworkNotice isWrongChain={isWrongChain} onSwitch={switchToTargetChain} />

        <Card>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 18 }}>Swap</div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
            <Input
              label="You pay"
              placeholder="0.00"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              error={amountError}
              style={{ flex: 1 }}
            />
            <Select
              label="Token"
              value={paySymbol}
              onChange={(e) => selectPayToken(e.target.value)}
              options={TOKEN_OPTIONS}
              style={{ width: 110 }}
            />
          </div>

          <BalanceRow
            token={payToken}
            balance={payBalance}
            onMax={payBalance !== undefined && payBalance > 0n
              ? () => setPayAmount(formatUnits(payBalance, payToken, payToken.decimals))
              : undefined}
          />

          <div style={{ display: "flex", justifyContent: "center", margin: "2px 0 10px" }}>
            <IconButton name="arrow-down" label="Flip the pair" onClick={flipPair} />
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
            <Input
              label="You receive"
              value={
                quoteState === "loading"
                  ? "…"
                  : expectedOut !== null
                    ? formatUnits(expectedOut, receiveToken)
                    : "—"
              }
              onChange={() => {}}
              style={{ flex: 1 }}
            />
            <Select
              label="Token"
              value={receiveToken.symbol}
              onChange={(e) => selectPayToken(counterpart(tokenBySymbol(e.target.value)).symbol)}
              options={TOKEN_OPTIONS}
              style={{ width: 110 }}
            />
          </div>

          <BalanceRow token={receiveToken} balance={receiveBalance} />

          <p
            style={{
              color: "var(--text-tertiary)",
              fontSize: "var(--text-caption)",
              margin: "8px 0 20px",
              lineHeight: 1.45,
            }}
          >
            {quoteState === "error" ? (
              <>Could not reach the quoter, so no minimum output is enforced on this swap.</>
            ) : isVerified && expectedOut !== null ? (
              <>
                Estimated from a live pool quote, adjusted for your {verifiedLabel} verified fee. The fee
                figures below are exact.
              </>
            ) : (
              <>Estimated from a live pool quote. The fee figures below are exact.</>
            )}
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: "var(--text-caption)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                color: "var(--text-tertiary)",
              }}
            >
              Fee on this swap
            </span>
            {feeSource === "chain" && (
              <span style={{ fontSize: "var(--text-caption)", color: "var(--accent-primary)" }}>live</span>
            )}
          </div>

          <QuoteCompare
            standard={{ fee: unverifiedLabel, amount: `${formatAmount(standardCost, payToken)} ${payToken.symbol}` }}
            verified={{ fee: verifiedLabel, amount: `${formatAmount(verifiedCost, payToken)} ${payToken.symbol}` }}
          />

          {amountValid && (
            <div
              style={{
                marginTop: 12,
                textAlign: "center",
                fontSize: "var(--text-body-s)",
                color: "var(--text-secondary)",
              }}
            >
              Verifying saves{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-primary)", fontWeight: 600 }}>
                {formatAmount(saving, payToken)} {payToken.symbol}
              </span>{" "}
              on this swap.
            </div>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              marginTop: 14,
              padding: "10px 4px 0",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-body-s)",
              color: "var(--text-tertiary)",
            }}
          >
            <span>Max slippage</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                {slippageValid ? `${rawSlippage}%` : "not set"}
              </span>
              <Icon name="settings" size={13} />
            </span>
          </button>

          {feeSource === "source-defaults" && (
            <Banner tone="info" title="Showing contract defaults" style={{ marginTop: 16 }}>
              Set NEXT_PUBLIC_HOOK_ADDRESS to read the fee tiers from the deployed hook instead of the values
              compiled into ProofPoolHook.sol.
            </Banner>
          )}

          {feeSource === "error" && (
            <Banner tone="warning" title="Could not read fee tiers" style={{ marginTop: 16 }}>
              The hook contract didn&rsquo;t respond. Check NEXT_PUBLIC_HOOK_ADDRESS and NEXT_PUBLIC_RPC_URL.
            </Banner>
          )}

          {isConnected && isVerified && (
            <Banner tone="success" title="Verified wallet" style={{ marginTop: 16 }}>
              This wallet is registered on-chain, so the pool charges it the {verifiedLabel} human rate.
            </Banner>
          )}

          {isConnected && !isVerified && verificationState !== "unconfigured" && (
            <Banner tone="warning" title="Unverified wallet" style={{ marginTop: 16 }}>
              You&rsquo;re paying the {unverifiedLabel} standard tier. Verify with World ID to unlock the human
              rate on every future swap.
            </Banner>
          )}

          {verificationState === "unconfigured" && (
            <Banner tone="info" title="Registry not configured" style={{ marginTop: 16 }}>
              Set NEXT_PUBLIC_REGISTRY_ADDRESS to read the real fee tier for the connected wallet.
            </Banner>
          )}

          {!ROUTER_ADDRESS && (
            <Banner tone="warning" title="Router not configured" style={{ marginTop: 16 }}>
              Set NEXT_PUBLIC_ROUTER_ADDRESS to the deployed ProofPoolRouter. Swaps are disabled without it —
              the hook only reads an identity forwarded by that contract.
            </Banner>
          )}

          {stage === "done" && txHash && (
            <Banner tone="success" title="Swap confirmed" style={{ marginTop: 16 }}>
              <a
                href={`${TARGET_CHAIN.blockExplorers?.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "inherit" }}
              >
                View on the block explorer
              </a>
            </Banner>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {!isConnected ? (
              <Button
                variant="accent"
                style={{ flex: 1 }}
                disabled={status === "connecting" || status === "loading"}
                onClick={connect}
              >
                {status === "unavailable"
                  ? "No wallet detected"
                  : status === "connecting"
                    ? "Check your wallet…"
                    : "Connect wallet"}
              </Button>
            ) : (
              <>
                {!isVerified && (
                  <Link href="/verify" style={{ flex: 1, textDecoration: "none" }}>
                    <Button variant="secondary" style={{ width: "100%" }}>
                      Verify with World ID
                    </Button>
                  </Link>
                )}
                <Button
                  variant="accent"
                  style={{ flex: 1 }}
                  disabled={!canSwap}
                  onClick={() => {
                    resetSwap();
                    setConfirmOpen(true);
                  }}
                >
                  Review swap
                </Button>
              </>
            )}
          </div>
        </Card>

        <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Transaction settings">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: "var(--text-body-s)", fontWeight: 500, color: "var(--text-secondary)" }}>
                Max slippage
              </span>
              <Tabs tabs={SLIPPAGE_TABS} value={slippageMode} onChange={setSlippageMode} />
              {slippageMode === "custom" && (
                <Input
                  placeholder="0.50"
                  value={customSlippage}
                  onChange={(e) => setCustomSlippage(e.target.value)}
                  suffix="%"
                  error={slippageError}
                />
              )}
              {slippageValid && slippageNum > 5 && (
                <span style={{ fontSize: "var(--text-caption)", color: "var(--status-warning)" }}>
                  High tolerance — you may receive noticeably less than quoted.
                </span>
              )}
              {slippageValid && slippageNum < 0.05 && (
                <span style={{ fontSize: "var(--text-caption)", color: "var(--status-warning)" }}>
                  Very tight — the swap will likely revert if the price moves at all.
                </span>
              )}
            </div>

            <Input
              label="Transaction deadline"
              placeholder="30"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              suffix="minutes"
              error={deadlineError}
            />

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="accent" size="s" disabled={!settingsValid} onClick={() => setSettingsOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm swap">
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
            Swapping {payAmount} {payToken.symbol} for {receiveToken.symbol} at the{" "}
            {isVerified ? `verified ${verifiedLabel}` : `standard ${unverifiedLabel}`} fee.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "12px 14px",
              marginBottom: 16,
              borderRadius: "var(--radius-m)",
              background: "var(--surface-sunken)",
              fontSize: "var(--text-body-s)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Fee</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {formatAmount(isVerified ? verifiedCost : standardCost, payToken)} {payToken.symbol}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Expected output</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {expectedOut !== null ? `${formatUnits(expectedOut, receiveToken)} ${receiveToken.symbol}` : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Minimum received</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {hasNoFloor ? "not enforced" : `${formatUnits(amountOutMinimum, receiveToken)} ${receiveToken.symbol}`}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Max slippage</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{rawSlippage}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Deadline</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{deadline} min</span>
            </div>
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)", margin: "0 0 12px" }}>
            Routed through ProofPoolRouter — the only router the hook accepts an identity from. Sending this
            swap any other way is priced at the {unverifiedLabel} tier even when verified.
          </p>

          {hasNoFloor && (
            <Banner tone="warning" title="No minimum output" style={{ marginBottom: 12 }}>
              No quote was available, so this swap accepts any output amount. Fine on testnet; never ship this
              to mainnet.
            </Banner>
          )}

          {swapError && (
            <Banner tone="warning" title="Swap failed" style={{ marginBottom: 12 }}>
              {swapError}
            </Banner>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <Button variant="secondary" size="s" disabled={isBusy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" size="s" disabled={!canSwap} onClick={() => void executeSwap()}>
              {stage === "approving" ? "Approving…" : stage === "swapping" ? "Swapping…" : "Confirm swap"}
            </Button>
          </div>
        </Dialog>
      </div>
    </>
  );
}
