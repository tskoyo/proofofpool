"use client";

import { useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { RpContext } from "@worldcoin/idkit-core";

const APP_ID = process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}`;
const ACTION = process.env.NEXT_PUBLIC_WLD_ACTION as string;
const RP_ID = process.env.NEXT_PUBLIC_WLD_RP_ID as `rp_${string}`;

export default function Home() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<string | null>(null);
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

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif", maxWidth: 480 }}>
      <h1>ProofPool — Selfie Check</h1>
      <p>Verify you&apos;re a unique human to unlock the low swap fee.</p>

      <input
        placeholder="Wallet address to verify"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 12 }}
      />

      <button
        disabled={!address}
        onClick={async () => {
          setRpContext(await fetchRpContext());
          setOpen(true);
        }}
        style={{ padding: "8px 16px" }}
      >
        Verify with Selfie Check
      </button>

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

            setStatus("Verifying on-chain...");
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
          onSuccess={() => setStatus("Verified! You now get the low swap fee.")}
          onError={(errorCode) => setStatus(`Verification failed: ${errorCode}`)}
        />
      )}

      {status && <p>{status}</p>}
    </main>
  );
}
