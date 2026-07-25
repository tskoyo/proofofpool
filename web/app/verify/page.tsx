"use client";

import { useState } from "react";
import Link from "next/link";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { RpContext } from "@worldcoin/idkit-core";
import { Badge, Banner, Button, Card, Icon, StepIndicator, WalletChip } from "@/components/ds";
import { NetworkNotice } from "@/components/wallet-ui";
import { useWallet } from "@/lib/wallet";
import { useVerificationStatus } from "@/lib/verification";
import { useAttestation } from "@/lib/attestation";
import { deserializeAttestation } from "@/lib/attestation-types";

const APP_ID = process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}`;
const ACTION = process.env.NEXT_PUBLIC_WLD_ACTION as string;
const RP_ID = process.env.NEXT_PUBLIC_WLD_RP_ID as `rp_${string}`;

const STEPS = ["Connect", "Scan", "Confirm"];

export default function VerifyPage() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);

  const { address, status, error: walletError, connect, disconnect, switchToTargetChain, isConnected, isWrongChain } =
    useWallet();
  const { state: verificationState, isVerified, refresh } = useVerificationStatus(address);
  const { setAttestation } = useAttestation();

  async function fetchRpContext(): Promise<RpContext> {
    const res = await fetch("/api/rp-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: ACTION }),
    }).then((r) => r.json());

    return {
      rp_id: RP_ID,
      nonce: res.nonce,
      created_at: res.created_at,
      expires_at: res.expires_at,
      signature: res.sig,
    };
  }

  async function openWorldApp() {
    setError(null);
    try {
      setRpContext(await fetchRpContext());
      setOpen(true);
    } catch {
      setError("Could not reach the signing endpoint. Check the server configuration.");
    }
  }

  function changeWallet() {
    disconnect();
    setStep(0);
    setError(null);
  }

  return (
    <div
      style={{
        maxWidth: 440,
        margin: "56px auto",
        padding: "0 16px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        alignItems: "center",
      }}
    >
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-tertiary)",
            textDecoration: "none",
            fontSize: "var(--text-body-s)",
            fontWeight: 500,
          }}
        >
          <Icon name="arrow-left" size={15} />
          Back
        </Link>
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 26, display: "block" }} />
        </Link>
        <span style={{ width: 52 }} />
      </div>

      <StepIndicator steps={STEPS} current={step} />

      <Card style={{ width: "100%", textAlign: "center", padding: "40px 28px" }}>
        {step === 0 && (
          <>
            <Icon name="wallet" size={36} style={{ color: "var(--text-primary)", margin: "0 auto 20px" }} />
            <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>Connect your wallet</div>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>
              ProofPool registers your verification on-chain, tied to the wallet you connect here.
            </p>

            {!isConnected && (
              <>
                {status === "unavailable" ? (
                  <>
                    <Banner tone="warning" title="No wallet detected" style={{ textAlign: "left" }}>
                      This browser has no injected wallet. Install one, then reload this page.
                    </Banner>
                    <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ textDecoration: "none", display: "block", marginTop: 20 }}
                    >
                      <Button variant="accent" style={{ width: "100%" }}>
                        Install a wallet
                      </Button>
                    </a>
                  </>
                ) : (
                  <Button
                    variant="accent"
                    style={{ width: "100%" }}
                    disabled={status === "connecting" || status === "loading"}
                    onClick={connect}
                  >
                    {status === "connecting" ? "Check your wallet…" : "Connect wallet"}
                  </Button>
                )}
                {walletError && (
                  <p style={{ color: "var(--status-error)", fontSize: 13, margin: "16px 0 0" }}>{walletError}</p>
                )}
              </>
            )}

            {isConnected && address && (
              <>
                <WalletChip address={address} verified={isVerified} style={{ margin: "0 auto 20px" }} />

                <NetworkNotice
                  isWrongChain={isWrongChain}
                  onSwitch={switchToTargetChain}
                  style={{ textAlign: "left", marginBottom: 20 }}
                />

                {isVerified ? (
                  <>
                    <Banner tone="success" title="Already verified" style={{ textAlign: "left" }}>
                      This wallet is registered on-chain and already pays the 0.05% fee.
                    </Banner>
                    <Link href="/swap" style={{ textDecoration: "none", display: "block", marginTop: 20 }}>
                      <Button variant="accent" style={{ width: "100%" }}>
                        Start swapping
                      </Button>
                    </Link>
                  </>
                ) : (
                  <Button
                    variant="accent"
                    style={{ width: "100%" }}
                    disabled={isWrongChain}
                    onClick={() => setStep(1)}
                  >
                    Continue
                  </Button>
                )}

                <Button variant="ghost" size="s" style={{ marginTop: 12 }} onClick={changeWallet}>
                  Use a different wallet
                </Button>
              </>
            )}
          </>
        )}

        {step === 1 && address && (
          <>
            <Icon name="scan-face" size={36} style={{ color: "var(--text-primary)", margin: "0 auto 20px" }} />
            <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>Verify with World ID</div>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
              Complete a Selfie Check in the World App. This proves you&rsquo;re a unique human &mdash; it never
              links your identity to your wallet.
            </p>
            <WalletChip address={address} style={{ margin: "0 auto 24px" }} />
            <Button variant="accent" style={{ width: "100%" }} onClick={openWorldApp}>
              Open World App
            </Button>
            {error && <p style={{ color: "var(--status-error)", fontSize: 13, margin: "16px 0 0" }}>{error}</p>}
            <Button variant="ghost" size="s" style={{ marginTop: 12 }} onClick={() => setStep(0)}>
              Back
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            {isVerified ? (
              <>
                <Icon
                  name="check-circle-2"
                  size={40}
                  style={{ color: "var(--accent-primary)", margin: "0 auto 20px" }}
                />
                <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>You&rsquo;re verified</div>
                <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
                  Your wallet is registered as human-verified on-chain.
                </p>
                <Badge tone="success">0.05% fee unlocked</Badge>
                <Link href="/swap" style={{ textDecoration: "none", display: "block", marginTop: 24 }}>
                  <Button variant="accent" style={{ width: "100%" }}>
                    Start swapping
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Icon name="scan-face" size={36} style={{ color: "var(--text-primary)", margin: "0 auto 20px" }} />
                <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>Proof accepted</div>
                <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
                  Your Selfie Check passed and your wallet now holds a signed attestation. Nothing was written
                  on-chain &mdash; the discount applies when you present it on a swap.
                </p>
                <Button
                  variant="accent"
                  style={{ width: "100%" }}
                  disabled={verificationState === "checking"}
                  onClick={() => void refresh()}
                >
                  {verificationState === "checking" ? "Checking…" : "Check on-chain status"}
                </Button>
                {verificationState === "unconfigured" && (
                  <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: "16px 0 0" }}>
                    NEXT_PUBLIC_REGISTRY_ADDRESS isn&rsquo;t set, so status can&rsquo;t be read from the contract.
                  </p>
                )}
                {verificationState === "error" && (
                  <p style={{ color: "var(--status-error)", fontSize: 13, margin: "16px 0 0" }}>
                    Could not reach the registry contract. Check NEXT_PUBLIC_RPC_URL.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </Card>

      {rpContext && address && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          preset={selfieCheckLegacy({ signal: address })}
          handleVerify={async (result) => {
            // Forward the IDKit result untouched — it is already the exact body
            // /api/v4/verify expects, and its fields are public inputs of the
            // proof. `signal` travels alongside it so the server can check the
            // proof's own signal_hash against the address being registered.
            const res = await fetch("/api/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signal: address, result }),
            });

            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              const reason = body.error ?? "verification failed";
              setError(reason);
              throw new Error(reason);
            }

            // The proof is exchanged for a signed attestation the wallet carries
            // to the pool. Nothing was written on-chain here — the discount only
            // materialises when this is presented on a swap.
            const body = await res.json();
            if (!body.attested) {
              const reason = body.reason ?? "server did not issue an attestation";
              setError(reason);
              throw new Error(reason);
            }

            setAttestation({
              attestation: deserializeAttestation(body.attestation),
              signature: body.signature,
            });
          }}
          onSuccess={() => {
            setError(null);
            setStep(2);
            void refresh();
          }}
          // A rejection from /api/verify already set a specific reason; IDKit
          // then reports a generic code, so don't let it overwrite the detail.
          onError={(errorCode) => setError((prev) => prev ?? `Verification failed: ${errorCode}`)}
        />
      )}
    </div>
  );
}
