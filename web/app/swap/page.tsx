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
  WalletChip,
} from "@/components/ds";

// Demo address for the widget shell. Wiring this to a real wallet connector and
// reading `Registry.isVerifiedHuman` on-chain is deliberately out of scope here —
// this page ports the design system's swap kit, not the chain plumbing.
const DEMO_ADDRESS = "0x8f3aE21cC9F0b2a19c21";

function Topbar({ verified }: { verified: boolean }) {
  return (
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
        <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 24 }} />
      </Link>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <WalletChip address={DEMO_ADDRESS} verified={verified} />
        <IconButton name="settings" label="Settings" />
      </div>
    </div>
  );
}

export default function SwapPage() {
  const [verified, setVerified] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const receiveAmount = verified ? "0.0312" : "0.0309";

  return (
    <>
      <Topbar verified={verified} />

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

          {!verified && (
            <Banner tone="warning" title="Unverified wallet" style={{ marginTop: 16 }}>
              You&rsquo;re paying the standard fee tier. Verify with World ID to unlock the human rate on every
              future swap.
            </Banner>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {!verified && (
              <Link href="/verify" style={{ flex: 1, textDecoration: "none" }}>
                <Button variant="secondary" style={{ width: "100%" }}>
                  Verify with World ID
                </Button>
              </Link>
            )}
            <Button variant="accent" style={{ flex: 1 }} onClick={() => setConfirmOpen(true)}>
              Review swap
            </Button>
          </div>
        </Card>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm swap">
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
            Swap 100 USDC for {receiveAmount} ETH at the {verified ? "verified 0.05%" : "standard 0.30%"} fee.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="s" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" size="s" onClick={() => setConfirmOpen(false)}>
              Confirm swap
            </Button>
          </div>
        </Dialog>

        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "var(--text-tertiary)",
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          Toggle: simulate verified wallet
        </label>
      </div>
    </>
  );
}
