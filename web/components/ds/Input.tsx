"use client";

import { useState } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";

export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  suffix?: ReactNode;
  error?: string;
  style?: CSSProperties;
}

export function Input({ label, placeholder, value, onChange, suffix, error, style }: InputProps) {
  const [focus, setFocus] = useState(false);

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-sans)", ...style }}>
      {label && (
        <span
          style={{
            fontSize: "var(--text-body-s)",
            color: "var(--text-secondary)",
            fontWeight: "var(--weight-medium)" as CSSProperties["fontWeight"],
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          border:
            "1.5px solid " +
            (error ? "var(--status-error)" : focus ? "var(--ink-900)" : "var(--border-default)"),
          borderRadius: "var(--radius-m)",
          background: "var(--surface-card)",
          padding: "11px 14px",
          transition: "border var(--duration-fast)",
        }}
      >
        <input
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            border: "none",
            outline: "none",
            flex: 1,
            minWidth: 0,
            fontSize: "var(--text-body-m)",
            fontFamily: "var(--font-mono)",
            color: "var(--text-primary)",
            background: "transparent",
          }}
        />
        {suffix && (
          <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-body-s)" }}>{suffix}</span>
        )}
      </div>
      {error && <span style={{ fontSize: "var(--text-caption)", color: "var(--status-error)" }}>{error}</span>}
    </label>
  );
}
