"use client";

import { useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";

const SVG_W = 340;
const SVG_H = 100;
const PAD = { top: 12, right: 8, bottom: 22, left: 38 };

export default function ElevationProfile() {
  const { currentRoute, scenicMode, setHoveredRouteProgress } = useAppStore();

  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverElev, setHoverElev] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Scenic = solid lime accent, performance = sage accent
  const accent = scenicMode ? "#A8D672" : "#7FB08A";

  const chart = useMemo(() => {
    if (!currentRoute) return null;

    const elevs = currentRoute.best.points
      .map((p) => p.elevation)
      .filter((e): e is number => typeof e === "number");

    if (elevs.length < 2) return null;

    const minElev = Math.min(...elevs);
    const maxElev = Math.max(...elevs);
    const elevRange = maxElev - minElev || 1;
    const innerW = SVG_W - PAD.left - PAD.right;
    const innerH = SVG_H - PAD.top - PAD.bottom;

    const pts = elevs.map((e, i) => ({
      x: PAD.left + (i / (elevs.length - 1)) * innerW,
      y: PAD.top + (1 - (e - minElev) / elevRange) * innerH,
      e,
    }));

    const areaPath = [
      `M ${pts[0].x} ${pts[0].y}`,
      ...pts.slice(1).map((p) => `L ${p.x} ${p.y}`),
      `L ${pts[pts.length - 1].x} ${PAD.top + innerH}`,
      `L ${pts[0].x} ${PAD.top + innerH}`,
      "Z",
    ].join(" ");

    const yTicks = [
      { val: minElev, y: PAD.top + innerH },
      { val: Math.round((minElev + maxElev) / 2), y: PAD.top + innerH / 2 },
      { val: maxElev, y: PAD.top },
    ];

    return { pts, areaPath, yTicks, minElev, maxElev, innerW, elevs };
  }, [currentRoute]);

  if (!currentRoute || !chart) return null;

  const { ascendM, descendM, distanceKm } = currentRoute.best;
  const polylinePoints = chart.pts.map((p) => `${p.x},${p.y}`).join(" ");
  const innerW = SVG_W - PAD.left - PAD.right;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W;
    const clampedX = Math.max(PAD.left, Math.min(PAD.left + innerW, svgX));
    setHoverX(clampedX);
    const progress = (clampedX - PAD.left) / innerW;
    const elevIdx = Math.round(progress * (chart.elevs.length - 1));
    setHoverElev(chart.elevs[Math.max(0, Math.min(chart.elevs.length - 1, elevIdx))]);
    setHoveredRouteProgress(Math.max(0, Math.min(1, progress)));
  };

  const handleMouseLeave = () => {
    setHoverX(null);
    setHoverElev(null);
    setHoveredRouteProgress(null);
  };

  return (
    <div
      style={{ padding: "16px 24px 20px" }}
      aria-label="Profil altimétrique"
    >
      <p
        style={{
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: "10px",
        }}
      >
        Profil altimétrique
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ width: "100%", overflow: "visible", cursor: "crosshair", display: "block" }}
        role="img"
        aria-label={`Profil altimétrique. D+ ${ascendM.toFixed(0)}m, D- ${descendM.toFixed(0)}m, distance ${distanceKm.toFixed(1)}km`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* TODO: SVG IDs "elev-fill-tf" and "chart-clip-tf" are hardcoded — if this
              component is ever rendered more than once on a page, IDs will conflict.
              Fix by generating a unique ID per instance (e.g. useId() from React 18). */}
        <defs>
          <linearGradient
            id="elev-fill-tf"
            x1="0" x2="0" y1="0" y2="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform={`translate(0, ${PAD.top}) scale(1, ${SVG_H - PAD.top - PAD.bottom})`}
          >
            <stop offset="0%" stopColor={accent} stopOpacity="0.30" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="chart-clip-tf">
            <rect
              x={PAD.left} y={PAD.top}
              width={SVG_W - PAD.left - PAD.right}
              height={SVG_H - PAD.top - PAD.bottom}
            />
          </clipPath>
        </defs>

        {/* Y-axis grid lines + labels */}
        {chart.yTicks.map(({ val, y }, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={y}
              x2={SVG_W - PAD.right} y2={y}
              stroke="rgba(30,43,34,0.8)"
              strokeWidth="1"
              strokeDasharray={i === 0 || i === chart.yTicks.length - 1 ? "0" : "3,3"}
            />
            <text
              x={PAD.left - 5} y={y + 3}
              textAnchor="end" fontSize="9"
              fill="#5C7363"
              fontFamily="var(--font-jetbrains), monospace"
            >
              {val.toFixed(0)}m
            </text>
          </g>
        ))}

        {/* X-axis distance labels */}
        {[0, 0.5, 1].map((frac) => {
          const x = PAD.left + frac * innerW;
          return (
            <text
              key={frac}
              x={x} y={SVG_H - 4}
              textAnchor="middle" fontSize="9"
              fill="#5C7363"
              fontFamily="var(--font-jetbrains), monospace"
            >
              {(frac * distanceKm).toFixed(1)}km
            </text>
          );
        })}

        {/* Filled area */}
        <path d={chart.areaPath} fill="url(#elev-fill-tf)" clipPath="url(#chart-clip-tf)" />

        {/* Elevation line */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Hover indicator */}
        {hoverX !== null && (() => {
          const progress = (hoverX - PAD.left) / innerW;
          const idx = Math.max(0, Math.min(chart.pts.length - 1, Math.round(progress * (chart.pts.length - 1))));
          const pt = chart.pts[idx];
          if (!pt) return null;
          const bubbleX = pt.x + 6 > SVG_W - 48 ? pt.x - 50 : pt.x + 6;
          const bubbleY = Math.max(pt.y - 18, PAD.top);
          return (
            <g>
              <line
                x1={hoverX} y1={PAD.top}
                x2={hoverX} y2={PAD.top + SVG_H - PAD.top - PAD.bottom}
                stroke={accent} strokeWidth="1"
                strokeDasharray="3,2" opacity="0.6"
              />
              <circle cx={pt.x} cy={pt.y} r="3.5" fill={accent} />
              <circle cx={pt.x} cy={pt.y} r="1.5" fill="var(--bg-deep)" />
              {hoverElev !== null && (
                <>
                  <rect x={bubbleX} y={bubbleY} width="44" height="14" rx="2" fill="#141C17" stroke={accent} strokeWidth="0.5" />
                  <text
                    x={bubbleX + 22} y={bubbleY + 10}
                    textAnchor="middle" fontSize="9"
                    fill={accent}
                    fontFamily="var(--font-jetbrains), monospace"
                    fontWeight="500"
                  >
                    {hoverElev.toFixed(0)}m
                  </text>
                </>
              )}
            </g>
          );
        })()}
      </svg>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          marginTop: "10px",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "var(--accent-lime)",
          }}
        >
          ↑ {ascendM.toFixed(0)} m
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "#f87171",
          }}
        >
          ↓ {descendM.toFixed(0)} m
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          min {chart.minElev.toFixed(0)}m
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          max {chart.maxElev.toFixed(0)}m
        </span>
      </div>
    </div>
  );
}
