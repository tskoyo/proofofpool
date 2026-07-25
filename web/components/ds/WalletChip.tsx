"use client";

import type { CSSProperties } from "react";
import { Icon } from "./Icon";

function truncate(addr: string) {
  return addr && addr.length > 10 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
}

export interface WalletChipProps {
  address: string;
  verified?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function WalletChip({ address, verified = false, onClick, style }: WalletChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px 8px 8px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border-default)",
        background: "var(--surface-card)",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-body-s)",
        ...style,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "linear-gradient(135deg,var(--green-500),var(--blue-500))",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--text-primary)" }}>{truncate(address)}</span>
      {verified && <Icon name="shield-check" size={14} style={{ color: "var(--accent-primary)" }} />}
    </button>
  );
}
