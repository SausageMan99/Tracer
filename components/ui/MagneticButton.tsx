"use client";

import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { gsap } from "@/lib/gsap-setup";

interface MagneticButtonProps {
  href: string;
  children: ReactNode;
  primary?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function MagneticButton({
  href,
  children,
  primary = true,
  className,
  style,
}: MagneticButtonProps) {
  const buttonRef = useRef<HTMLAnchorElement>(null);
  const xTo = useRef<ReturnType<typeof gsap.quickTo> | null>(null);
  const yTo = useRef<ReturnType<typeof gsap.quickTo> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (!buttonRef.current) return;
    if (window.matchMedia("(hover: none)").matches) return;
    xTo.current = gsap.quickTo(buttonRef.current, "x", { duration: 0.4, ease: "power3.out" });
    yTo.current = gsap.quickTo(buttonRef.current, "y", { duration: 0.4, ease: "power3.out" });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!buttonRef.current || !xTo.current || !yTo.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    xTo.current(dx * 0.35);
    yTo.current(dy * 0.35);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!buttonRef.current) return;
    gsap.to(buttonRef.current, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.3)" });
    xTo.current = null;
    yTo.current = null;
  }, []);

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: primary ? "18px clamp(28px, 6vw, 48px)" : "14px clamp(20px, 4vw, 36px)",
    borderRadius: "var(--radius-control)",
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: "14px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    textDecoration: "none",
    transition: "background 0.3s, box-shadow 0.3s, border-color 0.3s",
    cursor: "pointer",
    willChange: "transform",
    ...(primary
      ? {
          background: "var(--accent-lime)",
          color: "var(--bg-deep)",
          border: "1px solid transparent",
        }
      : {
          background: "transparent",
          color: "var(--text-muted)",
          border: "1px solid var(--border)",
        }),
    ...style,
  };

  return (
    <Link
      ref={buttonRef}
      href={href}
      className={className}
      style={baseStyle}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </Link>
  );
}
