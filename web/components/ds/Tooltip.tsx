"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export interface TooltipProps {
  label: string;
  children?: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [show, setShow] = useState(false);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--ink-900)",
            color: "var(--paper-0)",
            fontSize: "var(--text-caption)",
            padding: "6px 10px",
            borderRadius: "var(--radius-s)",
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-m)",
            zIndex: 10,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
