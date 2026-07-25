"use client";

import type { CSSProperties, ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children?: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,23,26,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: "var(--font-sans)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-card)",
          borderRadius: "var(--radius-l)",
          boxShadow: "var(--shadow-l)",
          padding: "24px",
          width: 360,
          maxWidth: "90vw",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-heading-m)",
              fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--text-tertiary)",
              fontSize: 20,
            }}
          >
            {"×"}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
