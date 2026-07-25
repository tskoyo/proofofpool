"use client";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
}

export function Switch({ checked = false, onChange, label }: SwitchProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
      }}
    >
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 38,
          height: 22,
          borderRadius: "var(--radius-pill)",
          background: checked ? "var(--accent-primary)" : "var(--ink-100)",
          position: "relative",
          transition: "background var(--duration-fast)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "var(--paper-0)",
            boxShadow: "var(--shadow-xs)",
            transition: "left var(--duration-fast) var(--ease-standard)",
          }}
        />
      </span>
      {label && <span style={{ fontSize: "var(--text-body-m)", color: "var(--text-primary)" }}>{label}</span>}
    </label>
  );
}
