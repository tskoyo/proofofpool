import type { CSSProperties, ChangeEvent } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  label?: string;
  value?: string;
  options: SelectOption[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  style?: CSSProperties;
}

export function Select({ label, value, options, onChange, style }: SelectProps) {
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
      <select
        value={value}
        onChange={onChange}
        style={{
          border: "1.5px solid var(--border-default)",
          borderRadius: "var(--radius-m)",
          padding: "11px 14px",
          fontSize: "var(--text-body-m)",
          fontFamily: "var(--font-sans)",
          color: "var(--text-primary)",
          background: "var(--surface-card)",
          outline: "none",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
