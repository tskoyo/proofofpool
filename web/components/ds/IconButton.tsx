"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface IconButtonProps {
  name: IconName;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  label: string;
  style?: CSSProperties;
}

export function IconButton({ name, size = 18, active = false, onClick, label, style }: IconButtonProps) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: "var(--radius-pill)",
        border: "1px solid " + (active ? "var(--ink-900)" : "var(--border-default)"),
        background: hover ? "var(--surface-sunken)" : active ? "var(--ink-900)" : "var(--surface-card)",
        color: active ? "var(--paper-0)" : "var(--text-primary)",
        cursor: "pointer",
        transition: "background var(--duration-fast)",
        ...style,
      }}
    >
      <Icon name={name} size={size} />
    </button>
  );
}
