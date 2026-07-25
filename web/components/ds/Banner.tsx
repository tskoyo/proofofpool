import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const tones = {
  info: { bg: "var(--blue-100)", fg: "var(--blue-700)", icon: "info" as IconName },
  success: { bg: "var(--status-success-soft)", fg: "var(--green-700)", icon: "check-circle-2" as IconName },
  warning: { bg: "var(--status-warning-soft)", fg: "var(--amber-600)", icon: "alert-triangle" as IconName },
} as const;

export type BannerTone = keyof typeof tones;

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Banner({ tone = "info", title, children, style }: BannerProps) {
  const t = tones[tone] ?? tones.info;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--radius-m)",
        background: t.bg,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <Icon name={t.icon} size={18} style={{ color: t.fg, flexShrink: 0, marginTop: 2 }} />
      <div>
        {title && (
          <div
            style={{
              fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
              color: t.fg,
              fontSize: "var(--text-body-m)",
              marginBottom: 2,
            }}
          >
            {title}
          </div>
        )}
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--text-body-s)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
