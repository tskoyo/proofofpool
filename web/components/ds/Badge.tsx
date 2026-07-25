import type { CSSProperties, ReactNode } from "react";

const tones = {
  neutral: { bg: "var(--ink-100)", fg: "var(--ink-700)" },
  success: { bg: "var(--status-success-soft)", fg: "var(--green-700)" },
  warning: { bg: "var(--status-warning-soft)", fg: "var(--amber-600)" },
  error: { bg: "var(--status-error-soft)", fg: "var(--red-600)" },
  accent: { bg: "var(--accent-primary-soft)", fg: "var(--green-700)" },
} as const;

export type BadgeTone = keyof typeof tones;

export interface BadgeProps {
  tone?: BadgeTone;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Badge({ tone = "neutral", children, style }: BadgeProps) {
  const t = tones[tone] ?? tones.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        background: t.bg,
        color: t.fg,
        fontSize: "var(--text-caption)",
        fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
        fontFamily: "var(--font-sans)",
        letterSpacing: "var(--tracking-wide)",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
