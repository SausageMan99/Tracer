"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SnapPoint = "peek" | "half" | "full";

const SNAP_RATIOS: Record<SnapPoint, number> = {
  peek: 0.1,
  half: 0.5,
  full: 0.9,
};

const SNAP_ORDER: SnapPoint[] = ["peek", "half", "full"];

/**
 * Returns the translateY value (in px) that positions the sheet at a given snap.
 * translateY(0) = fully open (top of sheet aligned with top of snap area).
 * translateY(viewportHeight) = completely hidden below fold.
 */
function translateForSnap(snap: SnapPoint, viewportHeight: number): number {
  return viewportHeight * (1 - SNAP_RATIOS[snap]);
}

/**
 * Finds the nearest snap point for a given translateY value.
 */
function nearestSnap(translateY: number, viewportHeight: number): SnapPoint {
  let best: SnapPoint = "half";
  let bestDist = Infinity;
  for (const snap of SNAP_ORDER) {
    const dist = Math.abs(translateY - translateForSnap(snap, viewportHeight));
    if (dist < bestDist) {
      bestDist = dist;
      best = snap;
    }
  }
  return best;
}

interface BottomSheetProps {
  children: ReactNode;
  defaultSnap?: SnapPoint;
}

/**
 * Draggable bottom sheet with 3 snap points: peek (10%), half (50%), full (90%).
 * Designed for mobile and tablet. Uses touch events for native-feel drag.
 */
export default function BottomSheet({
  children,
  defaultSnap = "half",
}: BottomSheetProps) {
  const [snap, setSnap] = useState<SnapPoint>(defaultSnap);
  const [dragging, setDragging] = useState(false);
  const [currentY, setCurrentY] = useState<number | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const dragStartTranslate = useRef<number>(0);
  const velocityTracker = useRef<{ t: number; y: number }[]>([]);

  // Recalculate on viewport resize
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 800,
  );

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const snappedTranslate = translateForSnap(snap, viewportHeight);
  const translateY = dragging && currentY !== null ? currentY : snappedTranslate;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragStartY.current = e.touches[0].clientY;
      dragStartTranslate.current =
        dragging && currentY !== null ? currentY : snappedTranslate;
      velocityTracker.current = [
        { t: performance.now(), y: e.touches[0].clientY },
      ];
      setDragging(true);
      setCurrentY(dragStartTranslate.current);
    },
    [dragging, currentY, snappedTranslate],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragging) return;
      const touch = e.touches[0];
      const delta = touch.clientY - dragStartY.current;
      const newY = Math.max(
        translateForSnap("full", viewportHeight),
        Math.min(
          translateForSnap("peek", viewportHeight),
          dragStartTranslate.current + delta,
        ),
      );
      setCurrentY(newY);
      velocityTracker.current.push({ t: performance.now(), y: touch.clientY });
      // Keep only last 100ms of samples
      const cutoff = performance.now() - 100;
      velocityTracker.current = velocityTracker.current.filter(
        (s) => s.t >= cutoff,
      );
    },
    [dragging, viewportHeight],
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragging || currentY === null) return;

    // Compute velocity from recent samples (px/ms)
    const samples = velocityTracker.current;
    let velocityPxMs = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) {
        velocityPxMs = (last.y - first.y) / dt;
      }
    }

    // If flicking fast enough, jump one snap up/down
    const FLICK_THRESHOLD = 0.5; // px/ms
    const currentSnap = nearestSnap(currentY, viewportHeight);
    const currentIndex = SNAP_ORDER.indexOf(currentSnap);

    let targetSnap: SnapPoint;
    if (velocityPxMs > FLICK_THRESHOLD && currentIndex > 0) {
      // Flicking downward → go to lower snap
      targetSnap = SNAP_ORDER[currentIndex - 1];
    } else if (velocityPxMs < -FLICK_THRESHOLD && currentIndex < SNAP_ORDER.length - 1) {
      // Flicking upward → go to higher snap
      targetSnap = SNAP_ORDER[currentIndex + 1];
    } else {
      targetSnap = nearestSnap(currentY, viewportHeight);
    }

    setSnap(targetSnap);
    setDragging(false);
    setCurrentY(null);
    velocityTracker.current = [];
  }, [dragging, currentY, viewportHeight]);

  const sheetHeight = viewportHeight * SNAP_RATIOS.full;
  const isScrollable = snap === "full" && !dragging;

  return (
    <div
      ref={sheetRef}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: `${sheetHeight}px`,
        transform: `translateY(${translateY}px)`,
        transition: dragging
          ? "none"
          : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        background: "var(--app-bg-surface, #0D1410)",
        borderTop: "1px solid var(--app-border, #2A3D30)",
        borderRadius: "16px 16px 0 0",
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
        willChange: "transform",
      }}
      aria-label="Panneau de configuration du parcours"
    >
      {/* Drag handle */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flexShrink: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "12px 0 8px",
          cursor: "grab",
          touchAction: "none",
        }}
        aria-hidden="true"
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: "var(--app-border, #2A3D30)",
          }}
        />
      </div>

      {/* Scrollable content area */}
      <div
        style={{
          flex: 1,
          overflowY: isScrollable ? "auto" : "hidden",
          // Prevent content scroll from triggering sheet drag when at full snap
          touchAction: isScrollable ? "pan-y" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
