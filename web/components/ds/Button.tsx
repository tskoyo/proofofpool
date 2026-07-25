"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

const sizes = {
  s: { padding: "8px 14px", fontSize: "var(--text-body-s)", gap: 6 },
  m: { padding: "11px 18px", fontSize: "var(--text-body-m)", gap: 8 },
  l: { padding: "14px 24px", fontSize: "var(--text-body-l)", gap: 8 },
} as const;

const variants = {
  primary: { background: "var(--ink-900)", color: "var(--paper-0)", border: "1px solid var(--ink-900)" },
  accent: { background: "var(--accent-primary)", color: "var(--paper-0)", border: "1px solid var(--accent-primary)" },
  secondary: { background: "var(--surface-card)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" },
  ghost: { background: "transparent", color: "var(--text-primary)", border: "1px solid transparent" },
} as const;

const hoverBackgrounds = {
  primary: "#2a2e33",
  accent: "var(--accent-primary-hover)",
  secondary: "var(--surface-sunken)",
  ghost: "var(--surface-sunken)",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
}

export function Button({
  variant = "primary",
  size = "m",
  disabled = false,
  icon,
  children,
  onClick,
  type = "button",
  style,
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const v = variants[variant] ?? variants.primary;
  const s = sizes[size] ?? sizes.m;
  const hoverBg = hoverBackgrounds[variant];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        padding: s.padding,
        fontSize: s.fontSize,
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-medium)" as CSSProperties["fontWeight"],
        borderRadius: "var(--radius-pill)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background var(--duration-fast) var(--ease-standard), transform var(--duration-fast)",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        ...v,
        background: hover && !disabled ? hoverBg : v.background,
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}
