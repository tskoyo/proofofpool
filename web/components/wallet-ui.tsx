"use client";

import { Banner, Button, WalletChip } from "@/components/ds";
import { TARGET_CHAIN, type WalletStatus } from "@/lib/wallet";

interface WalletButtonProps {
  status: WalletStatus;
  address: string | null;
  verified?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Renders whichever wallet affordance the current connection state calls for.
 * Returns null while `status` is "loading" so the server and client agree on the
 * first paint — the provider isn't known until after mount.
 */
export function WalletButton({ status, address, verified, onConnect, onDisconnect }: WalletButtonProps) {
  if (status === "loading") return null;

  if (status === "unavailable") {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer noopener"
        style={{ textDecoration: "none" }}
      >
        <Button variant="secondary" size="s">
          Install a wallet
        </Button>
      </a>
    );
  }

  if (status === "connected" && address) {
    return <WalletChip address={address} verified={verified} onClick={onDisconnect} />;
  }

  return (
    <Button variant="secondary" size="s" disabled={status === "connecting"} onClick={onConnect}>
      {status === "connecting" ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}

interface NetworkNoticeProps {
  isWrongChain: boolean;
  onSwitch: () => void;
  style?: React.CSSProperties;
}

export function NetworkNotice({ isWrongChain, onSwitch, style }: NetworkNoticeProps) {
  if (!isWrongChain) return null;

  return (
    <Banner tone="warning" title={`Wrong network`} style={style}>
      ProofPool is deployed on {TARGET_CHAIN.name}. Switch networks to read your fee tier and verify.
      <div style={{ marginTop: 10 }}>
        <Button variant="secondary" size="s" onClick={onSwitch}>
          Switch to {TARGET_CHAIN.name}
        </Button>
      </div>
    </Banner>
  );
}
