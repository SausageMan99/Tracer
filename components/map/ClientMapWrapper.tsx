"use client";

import dynamic from "next/dynamic";

/**
 * Client-side wrapper that lazy-loads `MapView` with SSR disabled.
 *
 * Mapbox GL JS accesses `window` and `document` at module import time,
 * which crashes Next.js server-side rendering. This wrapper uses
 * `next/dynamic` with `ssr: false` so Mapbox is only initialised in the browser.
 *
 * The loading fallback renders a grey placeholder matching the map container
 * dimensions to avoid layout shift when the map mounts.
 *
 * @component
 * @example
 * <ClientMapWrapper />
 */
// MapView uses mapbox-gl which accesses window/document at module level.
// This wrapper (a Client Component) is required by Next.js 15+ to use ssr: false.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <p className="text-gray-400 text-sm">Chargement de la carte…</p>
    </div>
  ),
});

export default MapView;
