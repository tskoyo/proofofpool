"use client";

import type { CSSProperties } from "react";
import {
  ArrowDown,
  ArrowLeft,
  CircleCheckBig,
  Info,
  ScanFace,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";

// The design system addresses icons by their kebab-case Lucide name. Upstream it
// resolved them at runtime through the Lucide CDN (`data-lucide` + createIcons()),
// which mutates the DOM out from under React. We resolve the same names against
// lucide-react instead: identical glyphs, no DOM surgery, and it tree-shakes.
const registry = {
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "check-circle-2": CircleCheckBig,
  info: Info,
  "scan-face": ScanFace,
  settings: Settings,
  "shield-check": ShieldCheck,
  "alert-triangle": TriangleAlert,
  wallet: Wallet,
} as const;

export type IconName = keyof typeof registry;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, style }: IconProps) {
  const Glyph = registry[name];
  if (!Glyph) return null;

  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      style={{ display: "inline-flex", color: "currentColor", ...style }}
    />
  );
}
