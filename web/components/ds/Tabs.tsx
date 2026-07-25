"use client";

import type { CSSProperties } from "react";

export interface TabItem {
  label: string;
  value: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
}

export function Tabs({ tabs, value, onChange }: TabsProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        background: "var(--surface-sunken)",
        padding: 4,
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange?.(t.value)}
          style={{
            padding: "8px 18px",
            borderRadius: "var(--radius-pill)",
            border: "none",
            cursor: "pointer",
            fontSize: "var(--text-body-s)",
            fontWeight: "var(--weight-medium)" as CSSProperties["fontWeight"],
            background: value === t.value ? "var(--surface-card)" : "transparent",
            color: value === t.value ? "var(--text-primary)" : "var(--text-tertiary)",
            boxShadow: value === t.value ? "var(--shadow-xs)" : "none",
            transition: "all var(--duration-fast)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
