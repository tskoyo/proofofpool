import { Fragment } from "react";

export interface StepIndicatorProps {
  steps: string[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: "var(--font-sans)" }}>
      {steps.map((s, i) => (
        <Fragment key={s}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 600,
                background:
                  i < current ? "var(--accent-primary)" : i === current ? "var(--ink-900)" : "var(--ink-100)",
                color: i <= current ? "var(--paper-0)" : "var(--text-tertiary)",
              }}
            >
              {i < current ? "✓" : i + 1}
            </div>
            <div
              style={{
                fontSize: "var(--text-caption)",
                color: i === current ? "var(--text-primary)" : "var(--text-tertiary)",
                whiteSpace: "nowrap",
              }}
            >
              {s}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 2,
                minWidth: 24,
                background: i < current ? "var(--accent-primary)" : "var(--ink-100)",
                margin: "0 8px 20px",
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
