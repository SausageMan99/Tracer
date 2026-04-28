"use client";

/**
 * SmoothScrollProvider — Lenis dependency removed.
 * This component is no longer used in layout.tsx but kept as a passthrough
 * in case it is referenced elsewhere.
 */
export default function SmoothScrollProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
