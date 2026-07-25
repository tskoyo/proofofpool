import type { CSSProperties, ReactNode } from "react";

export interface Quote {
  fee: string;
  amount: string;
}

export interface QuoteCompareProps {
  standard: Quote;
  verified: Quote;
}

function QuoteRow({
  label,
  tone,
  fee,
  amount,
  badge,
}: {
  label: string;
  tone: "standard" | "verified";
  fee: string;
  amount: string;
  badge?: ReactNode;
}) {
  const isVerified = tone === "verified";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 16px",
        borderRadius: "var(--radius-m)",
        background: isVerified ? "var(--accent-primary-soft)" : "var(--surface-sunken)",
        border: "1px solid " + (isVerified ? "var(--green-500)" : "var(--border-subtle)"),
      }}
    >
      <div>
        <div
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-wide)",
            color: isVerified ? "var(--green-700)" : "var(--text-tertiary)",
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-heading-s)",
            fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
            color: "var(--text-primary)",
          }}
        >
          {amount}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "var(--text-body-s)", color: "var(--text-secondary)" }}>{fee} fee</div>
        {badge}
      </div>
    </div>
  );
}

export function QuoteCompare({ standard, verified }: QuoteCompareProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: "var(--font-sans)" }}>
      <QuoteRow label="Standard rate" tone="standard" fee={standard.fee} amount={standard.amount} />
      <QuoteRow label="World ID verified" tone="verified" fee={verified.fee} amount={verified.amount} />
    </div>
  );
}
