"use client";

import Link from "next/link";
import { type ReactNode, type CSSProperties } from "react";

interface MagneticButtonProps {
  href: string;
  children: ReactNode;
  primary?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Button component — magnetic GSAP effect removed (GSAP dependency dropped).
 * Renders as a styled Link. Will be restyled in Task 16 landing rewrite.
 */
export default function MagneticButton({
  href,
  children,
  primary = true,
  className,
  style,
}: MagneticButtonProps) {
  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: primary ? "18px clamp(28px, 6vw, 48px)" : "14px clamp(20px, 4vw, 36px)",
    borderRadius: "2px",
    fontFamily: "var(--font-ui), sans-serif",
    fontSize: "14px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    textDecoration: "none",
    transition: "background 0.3s, box-shadow 0.3s, border-color 0.3s",
    cursor: "pointer",
    ...(primary
      ? {
          background: "var(--app-accent-lime)",
          color: "var(--app-bg-deep)",
          border: "1px solid transparent",
        }
      : {
          background: "transparent",
          color: "var(--app-text-muted)",
          border: "1px solid var(--app-border)",
        }),
    ...style,
  };

  return (
    <Link href={href} className={className} style={baseStyle}>
      {children}
    </Link>
  );
}
