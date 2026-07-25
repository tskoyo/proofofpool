import type { CSSProperties, ReactNode } from "react";

export interface CardProps {
  children?: ReactNode;
  padding?: string;
  style?: CSSProperties;
}

export function Card({ children, padding = "24px", style }: CardProps) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-l)",
        boxShadow: "var(--shadow-s)",
        padding,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
