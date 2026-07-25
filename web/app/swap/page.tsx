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
import { useWallet } from "@/lib/wallet";
import { useVerificationStatus } from "@/lib/verification";

const SLIPPAGE_TABS = [
  { label: "0.1%", value: "0.1" },
  { label: "0.5%", value: "0.5" },
  { label: "1.0%", value: "1.0" },
  { label: "Custom", value: "custom" },
];

export default function SwapPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [slippageMode, setSlippageMode] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [deadline, setDeadline] = useState("30");

  const { address, status, connect, disconnect, switchToTargetChain, isConnected, isWrongChain } = useWallet();
  const { state: verificationState, isVerified } = useVerificationStatus(address);

  const rawSlippage = slippageMode === "custom" ? customSlippage : slippageMode;
  const slippageNum = Number.parseFloat(rawSlippage);
  const slippageValid = Number.isFinite(slippageNum) && slippageNum > 0 && slippageNum <= 50;

  const deadlineNum = Number.parseInt(deadline, 10);
  const deadlineValid = Number.isFinite(deadlineNum) && deadlineNum > 0 && deadlineNum <= 4320;

  const settingsValid = slippageValid && deadlineValid;

  const slippageError = !rawSlippage
    ? undefined
    : slippageValid
      ? undefined
      : "Enter a percentage between 0 and 50.";

  const deadlineError = !deadline
    ? undefined
    : deadlineValid
      ? undefined
      : "Enter a whole number of minutes, up to 4320 (3 days).";

  // The fee tier the pool would actually charge this wallet. Unconnected wallets
  // see the standard tier, because that's what an unregistered address pays.
  const receiveAmount = isVerified ? "0.0312" : "0.0309";

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

          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <Input label="You pay" value="100.00" onChange={() => {}} style={{ flex: 1 }} />
            <Select
              label="Token"
              value="usdc"
              onChange={() => {}}
              options={[
                { label: "USDC", value: "usdc" },
                { label: "ETH", value: "eth" },
              ]}
              style={{ width: 110 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "center", margin: "2px 0 10px" }}>
            <Icon name="arrow-down" size={18} style={{ color: "var(--text-tertiary)" }} />
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <Input label="You receive" value={receiveAmount} onChange={() => {}} style={{ flex: 1 }} />
            <Select
              label="Token"
              value="eth"
              onChange={() => {}}
              options={[
                { label: "ETH", value: "eth" },
                { label: "USDC", value: "usdc" },
              ]}
              style={{ width: 110 }}
            />
          </div>

          <QuoteCompare
            standard={{ fee: "0.30%", amount: "0.0309 ETH" }}
            verified={{ fee: "0.05%", amount: "0.0312 ETH" }}
          />

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              marginTop: 12,
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

          {isConnected && isVerified && (
            <Banner tone="success" title="Verified wallet" style={{ marginTop: 16 }}>
              This wallet is registered on-chain, so the pool charges it the 0.05% human rate.
            </Banner>
          )}

          {isConnected && !isVerified && verificationState !== "unconfigured" && (
            <Banner tone="warning" title="Unverified wallet" style={{ marginTop: 16 }}>
              You&rsquo;re paying the standard fee tier. Verify with World ID to unlock the human rate on every
              future swap.
            </Banner>
          )}

          {verificationState === "unconfigured" && (
            <Banner tone="info" title="Registry not configured" style={{ marginTop: 16 }}>
              Set NEXT_PUBLIC_REGISTRY_ADDRESS to read the real fee tier for the connected wallet.
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
                  disabled={isWrongChain || !settingsValid}
                  onClick={() => setConfirmOpen(true)}
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
              <span
                style={{
                  fontSize: "var(--text-body-s)",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                }}
              >
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
              <Button
                variant="accent"
                size="s"
                disabled={!settingsValid}
                onClick={() => setSettingsOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm swap">
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
            Swap 100 USDC for {receiveAmount} ETH at the {isVerified ? "verified 0.05%" : "standard 0.30%"} fee.
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
              <span style={{ color: "var(--text-tertiary)" }}>Max slippage</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{rawSlippage}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Deadline</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{deadline} min</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="s" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" size="s" onClick={() => setConfirmOpen(false)}>
              Confirm swap
            </Button>
          </div>
        </Dialog>
      </div>
    </>
  );
}
