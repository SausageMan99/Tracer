"use client";

import { useEffect, useRef, type RefObject } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useAppStore } from "@/lib/store";
import type { GeneratedRoute, RouteCandidate } from "@/lib/types";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_LINESTRING: GeoJSON.Feature = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [] },
  properties: {},
};

const EMPTY_POINT: GeoJSON.Feature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: {},
};

const DRAW_DURATION_MS = 1400;

function cleanupRouteArtifacts(
  rafRef: RefObject<number | null>,
  markerRef: RefObject<mapboxgl.Marker | null>
) {
  const rafId = rafRef.current;
  const marker = markerRef.current;
  if (rafId) cancelAnimationFrame(rafId);
  marker?.remove();
}

// ── Slope → color expression (Mapbox data-driven) ────────────────────────────

const SLOPE_COLOR_EXPR = [
  "interpolate",
  ["linear"],
  ["get", "slope"],
  -8,  "#15803d",
  -3,  "#22c55e",
  -0.5,"#86efac",
   0.5,"#cbd5e1",
   4,  "#fde047",
   7,  "#fb923c",
  10,  "#ef4444",
  14,  "#7f1d1d",
] as unknown as mapboxgl.Expression;

// ── Haversine (meters) ────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Build slope-coloured segment FeatureCollection ───────────────────────────

function buildSegmentCollection(candidate: RouteCandidate): GeoJSON.FeatureCollection {
  const pts = candidate.points;
  if (pts.length < 2) return EMPTY_COLLECTION;

  const rawSlopes: number[] = pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    const distM = haversineM(a.lat, a.lng, b.lat, b.lng);
    const elevDiff = (b.elevation ?? 0) - (a.elevation ?? 0);
    return distM > 0.5 ? (elevDiff / distM) * 100 : 0;
  });

  const slopes = rawSlopes.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(rawSlopes.length - 1, i + 1);
    const slice = rawSlopes.slice(lo, hi + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });

  const features: GeoJSON.Feature[] = pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
      },
      properties: { slope: Math.max(-20, Math.min(20, slopes[i])) },
    };
  });

  return { type: "FeatureCollection", features };
}

// ── Create an arrow image via canvas ─────────────────────────────────────────

function createArrowImage(): { width: number; height: number; data: Uint8Array } {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  // Arrow pointing right (east = 0° in Mapbox; will rotate to follow line)
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(8, 16);
  ctx.lineTo(24, 16);
  ctx.moveTo(18, 10);
  ctx.lineTo(24, 16);
  ctx.lineTo(18, 22);
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(imageData.data) };
}

// ── Layer initialisation ──────────────────────────────────────────────────────

function ensureLayers(map: mapboxgl.Map) {
  if (map.getSource("route-full")) return; // Already initialised

  // ── Full geometry source (smooth road-following line) ─────────────────────
  map.addSource("route-full", { type: "geojson", data: EMPTY_LINESTRING });

  map.addLayer({
    id: "route-line-casing",
    type: "line",
    source: "route-full",
    layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
    paint: { "line-color": "#0f172a", "line-width": 7, "line-opacity": 0.5 },
  });

  map.addLayer({
    id: "route-full-base",
    type: "line",
    source: "route-full",
    layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
    paint: { "line-color": "#94A3B8", "line-width": 4, "line-opacity": 0.4 },
  });

  // ── Slope-coloured route segments ────────────────────────────────────────
  map.addSource("route", { type: "geojson", data: EMPTY_COLLECTION });

  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
    paint: {
      "line-color": SLOPE_COLOR_EXPR,
      "line-width": 4,
      "line-opacity": 0.97,
    },
  });

  // ── Arrow symbols on the route (separate LineString source) ─────────────
  map.addSource("route-arrow", { type: "geojson", data: EMPTY_LINESTRING });

  // Add custom arrow image
  try {
    const arrowImage = createArrowImage();
    if (!map.hasImage("tracer-arrow")) {
      map.addImage("tracer-arrow", arrowImage);
    }
  } catch { /* canvas not available (SSR) */ }

  map.addLayer({
    id: "route-arrows",
    type: "symbol",
    source: "route-arrow",
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 100,
      "icon-image": "tracer-arrow",
      "icon-size": 0.85,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      visibility: "none",
    },
  });

  // ── Hover position point ─────────────────────────────────────────────────
  map.addSource("hover-point", { type: "geojson", data: EMPTY_POINT });

  map.addLayer({
    id: "hover-point-outer",
    type: "circle",
    source: "hover-point",
    paint: {
      "circle-radius": 9,
      "circle-color": "#ffffff",
      "circle-opacity": 0.9,
    },
    layout: { visibility: "none" },
  });

  map.addLayer({
    id: "hover-point-inner",
    type: "circle",
    source: "hover-point",
    paint: {
      "circle-radius": 5,
      "circle-color": "#7FB08A",
    },
    layout: { visibility: "none" },
  });
}

// ── Progressive draw animation ────────────────────────────────────────────────

function animateDraw(
  map: mapboxgl.Map,
  segmentCollection: GeoJSON.FeatureCollection,
  fullCoordinates: [number, number][],
  rafRef: React.MutableRefObject<number>
) {
  const features = segmentCollection.features;
  const total = features.length;
  const totalCoords = fullCoordinates.length;
  if (total === 0) return;

  let startTime: number | null = null;

  const frame = (timestamp: number) => {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const t = Math.min(elapsed / DRAW_DURATION_MS, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);

    // Slope-coloured segments (subsampled)
    const count = Math.max(1, Math.ceil(eased * total));
    const partial: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features.slice(0, count),
    };
    const source = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(partial);

    // Full smooth geometry (all original coordinates)
    const coordCount = Math.max(2, Math.ceil(eased * totalCoords));
    const fullSource = map.getSource("route-full") as mapboxgl.GeoJSONSource | undefined;
    fullSource?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: fullCoordinates.slice(0, coordCount) },
      properties: {},
    });

    if (t < 1) {
      rafRef.current = requestAnimationFrame(frame);
    }
  };

  rafRef.current = requestAnimationFrame(frame);
}

// ── Apply / clear a route on the map ─────────────────────────────────────────

function applyRoute(
  map: mapboxgl.Map,
  markerRef: React.MutableRefObject<mapboxgl.Marker | null>,
  rafRef: React.MutableRefObject<number>,
  currentRoute: GeneratedRoute | null,
  scenicMode: boolean
) {
  if (!map.isStyleLoaded()) return;

  ensureLayers(map);

  const routeSource = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
  const arrowSource = map.getSource("route-arrow") as mapboxgl.GeoJSONSource | undefined;
  const fullSource = map.getSource("route-full") as mapboxgl.GeoJSONSource | undefined;

  // Cancel any running animation
  if (rafRef.current) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }

  markerRef.current?.remove();
  markerRef.current = null;

  if (!currentRoute) {
    routeSource?.setData(EMPTY_COLLECTION);
    arrowSource?.setData(EMPTY_LINESTRING);
    fullSource?.setData(EMPTY_LINESTRING);
    map.setLayoutProperty("route-line", "visibility", "none");
    map.setLayoutProperty("route-line-casing", "visibility", "none");
    map.setLayoutProperty("route-full-base", "visibility", "none");
    map.setLayoutProperty("route-arrows", "visibility", "none");
    return;
  }

  // ── Route colour: slope gradient always on top, base changes with mode ──
  map.setPaintProperty("route-line", "line-color", SLOPE_COLOR_EXPR);
  map.setPaintProperty("route-full-base", "line-color", scenicMode ? "#A8D672" : "#94A3B8");

  map.setLayoutProperty("route-line", "visibility", "visible");
  map.setLayoutProperty("route-line-casing", "visibility", "visible");
  map.setLayoutProperty("route-full-base", "visibility", "visible");
  map.setLayoutProperty("route-arrows", "visibility", "visible");

  // ── Set full data immediately (ensures route is visible even if animation fails)
  const segCollection = buildSegmentCollection(currentRoute.best);

  fullSource?.setData({
    type: "Feature",
    geometry: currentRoute.best.geometry,
    properties: {},
  });

  routeSource?.setData(segCollection);

  arrowSource?.setData({
    type: "Feature",
    geometry: currentRoute.best.geometry,
    properties: {},
  });

  // ── Animated draw (progressive reveal on top of the static data) ────────
  animateDraw(map, segCollection, currentRoute.best.geometry.coordinates, rafRef);

  // ── Start marker ──────────────────────────────────────────────────────────
  const markerColor = scenicMode ? "#A8D672" : "#7FB08A";
  markerRef.current = new mapboxgl.Marker({ color: markerColor, scale: 1.2 })
    .setLngLat([currentRoute.startCoordinate.lng, currentRoute.startCoordinate.lat])
    .setPopup(new mapboxgl.Popup({ offset: 25 }).setText("Point de départ"))
    .addTo(map);

  // ── Fit bounds ────────────────────────────────────────────────────────────
  const coords = currentRoute.best.geometry.coordinates;
  if (coords.length > 0) {
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new mapboxgl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
  }
}

// ── Update hover point on map ─────────────────────────────────────────────────

function updateHoverPoint(
  map: mapboxgl.Map,
  currentRoute: GeneratedRoute | null,
  progress: number | null,
  scenicMode: boolean
) {
  if (!map.isStyleLoaded() || !map.getSource("hover-point")) return;

  const hoverOuterSource = map.getSource("hover-point") as mapboxgl.GeoJSONSource | undefined;
  const visible = progress !== null && currentRoute !== null;

  const outerVis = visible ? "visible" : "none";
  try {
    map.setLayoutProperty("hover-point-outer", "visibility", outerVis);
    map.setLayoutProperty("hover-point-inner", "visibility", outerVis);
  } catch { /* layer may not exist yet */ }

  if (!visible || !currentRoute || progress === null) return;

  const coords = currentRoute.best.geometry.coordinates;
  const idx = Math.max(0, Math.min(coords.length - 1, Math.round(progress * (coords.length - 1))));
  const coord = coords[idx] as [number, number];

  hoverOuterSource?.setData({
    type: "Feature",
    geometry: { type: "Point", coordinates: coord },
    properties: {},
  });

  // Update inner dot color to match mode
  const innerColor = scenicMode ? "#A8D672" : "#7FB08A";
  try {
    map.setPaintProperty("hover-point-inner", "circle-color", innerColor);
  } catch { /* ok */ }
}

// ── Duration formatter ────────────────────────────────────────────────────────
// TODO: This function is identical to the one in RouteResult.tsx — extract to
// a shared lib/format.ts util to avoid drift between the two implementations.

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m} min`;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Interactive Mapbox GL JS map that displays the generated route and heatmap.
 *
 * Responsibilities:
 * - Initialises the Mapbox map on mount (style: outdoors-v12, Paris default centre)
 * - Manages 6 GeoJSON sources and layers: route casing, base, slope-coloured
 *   segments, direction arrows, hover point outer/inner
 * - Animates route drawing with an ease-out cubic over 1400ms
 * - Switches between PERFORMANCE (slope gradient) and SCENIC (solid green) colours
 * - Synchronises the hover crosshair with ElevationProfile mouse events via Zustand
 * - Adds/removes the Strava heatmap raster layer below road labels
 * - Displays a frosted-glass stats overlay (distance, D+, duration) when a route exists
 *
 * Must be rendered with SSR disabled (loaded via `ClientMapWrapper`).
 *
 * @component
 * @example
 * // Not used directly — always loaded via ClientMapWrapper
 * import ClientMapWrapper from "@/components/map/ClientMapWrapper";
 * <ClientMapWrapper />
 */
export default function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const rafRef = useRef<number>(0);

  const { currentRoute, scenicMode, hoveredRouteProgress, status, mapCenter, mapZoom } = useAppStore();

  // ── Initialise map once ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const storeState = useAppStore.getState();
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [storeState.mapCenter.lng, storeState.mapCenter.lat],
      zoom: storeState.mapZoom,
    });
    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }),
      "top-right"
    );

    const onLoad = () => {
      ensureLayers(map);
      const state = useAppStore.getState();
      applyRoute(map, markerRef, rafRef, state.currentRoute, state.scenicMode);
    };

    if (map.isStyleLoaded()) {
      onLoad();
    } else {
      map.once("load", onLoad);
    }

    return () => {
      cleanupRouteArtifacts(rafRef, markerRef);
      // Mapbox GL's map.remove() aborts in-flight fetch requests via AbortController.
      // These fire unhandled rejection events ("signal is aborted without reason")
      // that Next.js dev overlay picks up. Temporarily swallow them during teardown.
      const swallowAbort = (e: PromiseRejectionEvent) => {
        if (e.reason?.name === "AbortError") e.preventDefault();
      };
      window.addEventListener("unhandledrejection", swallowAbort);
      try { map.remove(); } catch { /* AbortError expected during StrictMode remount */ }
      // Remove the listener asynchronously so it catches the microtask rejections
      setTimeout(() => window.removeEventListener("unhandledrejection", swallowAbort), 0);
      mapRef.current = null;
    };
  }, []); // mount-only effect: map is initialised once and torn down on unmount

  // ── Re-render when route or scenic mode changes ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) {
      applyRoute(map, markerRef, rafRef, currentRoute, scenicMode);
    } else {
      // Style not ready yet — defer until it loads
      const onStyleLoad = () => applyRoute(map, markerRef, rafRef, currentRoute, scenicMode);
      map.once("load", onStyleLoad);
      return () => { map.off("load", onStyleLoad); };
    }
  }, [currentRoute, scenicMode]);

  // ── Hover sync: ElevationProfile → map marker ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateHoverPoint(map, currentRoute, hoveredRouteProgress, scenicMode);
  }, [hoveredRouteProgress, currentRoute, scenicMode]);

  // ── Fly to mapCenter when it changes (geolocation / address selection) ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCenter) return;
    if (currentRoute) return; // fitBounds handles post-generation
    map.flyTo({ center: [mapCenter.lng, mapCenter.lat], zoom: mapZoom ?? 13, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCenter]);

  // ── Stats overlay data ────────────────────────────────────────────────────
  const best = currentRoute?.best;

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        role="application"
        aria-label="Carte interactive du parcours généré"
      />

      {/* ── Loading overlay — pulsing radar while generating ──────────── */}
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Dark scrim */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(8,12,10,0.35)",
            }}
          />
          {/* Radar pulse rings */}
          <div style={{ position: "relative", width: 120, height: 120 }}>
            <div
              className="map-radar-ring"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "2px solid var(--accent-lime)",
                opacity: 0,
              }}
            />
            <div
              className="map-radar-ring map-radar-ring-delay"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "2px solid var(--accent-lime)",
                opacity: 0,
              }}
            />
            {/* Center dot */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--accent-lime)",
                boxShadow: "0 0 16px rgba(168,214,114,0.6)",
              }}
            />
          </div>
          {/* Label */}
          <p
            style={{
              position: "absolute",
              bottom: "25%",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "var(--accent-lime)",
              opacity: 0.9,
            }}
          >
            Génération en cours
          </p>
        </div>
      )}

      {/* ── Stats overlay (bottom-left, shown when route exists) ─────────── */}
      {best && (
        <div
          className="absolute left-4 z-10 pointer-events-none bottom-20 md:bottom-8"
          aria-label="Statistiques du parcours"
        >
          <div
            style={{
              backdropFilter: "blur(16px)",
              background: "rgba(8,12,10,0.82)",
              border: "1px solid rgba(30,43,34,0.9)",
              borderRadius: "var(--radius-control)",
              padding: "10px 16px",
              display: "flex",
              gap: "20px",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(92,115,99,0.9)", fontWeight: 600 }}>Distance</span>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 500, color: "#E8EDE9" }}>{best.distanceKm.toFixed(1)} km</span>
            </div>
            <div style={{ width: "1px", background: "rgba(30,43,34,0.9)", alignSelf: "stretch" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(92,115,99,0.9)", fontWeight: 600 }}>D+</span>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 500, color: "#A8D672" }}>{best.ascendM.toFixed(0)} m</span>
            </div>
            <div style={{ width: "1px", background: "rgba(30,43,34,0.9)", alignSelf: "stretch" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(92,115,99,0.9)", fontWeight: 600 }}>Durée est.</span>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 500, color: "#E8EDE9" }}>{formatDuration(best.durationSeconds)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
