"use client";

import { useState } from "react";
import Link from "next/link";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { RpContext } from "@worldcoin/idkit-core";
import { Badge, Button, Card, Icon, Input, StepIndicator, WalletChip } from "@/components/ds";

const APP_ID = process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}`;
const ACTION = process.env.NEXT_PUBLIC_WLD_ACTION as string;
const RP_ID = process.env.NEXT_PUBLIC_WLD_RP_ID as `rp_${string}`;

const STEPS = ["Connect", "Scan", "Confirm"];

export default function VerifyPage() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);

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
      <Link href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 26 }} />
      </Link>

      <StepIndicator steps={STEPS} current={step} />

      <Card style={{ width: "100%", textAlign: "center", padding: "40px 28px" }}>
        {step === 0 && (
          <>
            <Icon name="wallet" size={36} style={{ color: "var(--text-primary)", margin: "0 auto 20px" }} />
            <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>Connect your wallet</div>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 28 }}>
              ProofPool registers your verification on-chain, tied to this wallet address.
            </p>
            <Input
              label="Wallet address to verify"
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={{ marginBottom: 20, textAlign: "left" }}
            />
            <Button variant="accent" style={{ width: "100%" }} disabled={!address} onClick={() => setStep(1)}>
              Connect wallet
            </Button>
          </>
        )}

        {step === 1 && (
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
            {error && (
              <p style={{ color: "var(--status-error)", fontSize: 13, marginBottom: 0 }}>{error}</p>
            )}
          </>
        )}

        {step === 2 && (
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
        )}
      </Card>

      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          preset={selfieCheckLegacy({ signal: address })}
          handleVerify={async (result) => {
            if (result.protocol_version !== "3.0") {
              throw new Error(`unexpected protocol version: ${result.protocol_version}`);
            }
            const selfie = result.responses.find((r) => r.identifier === "selfie");
            if (!selfie) throw new Error("no selfie credential in response");

            const res = await fetch("/api/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                signal: address,
                idkitResponse: {
                  proof: selfie.proof,
                  merkle_root: selfie.merkle_root,
                  nullifier_hash: selfie.nullifier,
                  verification_level: selfie.identifier,
                },
              }),
            });

            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? "verification failed");
            }
          }}
          onSuccess={() => {
            setError(null);
            setStep(2);
          }}
          onError={(errorCode) => setError(`Verification failed: ${errorCode}`)}
        />
      )}
    </div>
  );
}
