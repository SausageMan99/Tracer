/**
 * Global application state managed by Zustand.
 *
 * A single flat store holds all UI state: form inputs, route results,
 * map camera, and feature toggles. Keeping state flat avoids selector
 * boilerplate and makes the entire app state serialisable.
 *
 * The store is initialised with Paris as the default map centre and the
 * first session profile (running endurance) pre-selected.
 */
import { create } from "zustand";
import type { AppState, AppStatus, Coordinate, GeneratedRoute } from "./types";
import { SESSION_PROFILES, PROFILES_BY_ID } from "./session-profiles";
import { RouteWorkerClient } from "./engine/worker-client";
import { LIGHT_CONFIG } from "./engine/solver-config";

// ── Module-level worker client singleton ──────────────────────────────────────
// Worker instances are not serialisable, so this lives outside the store state.
let workerClient: RouteWorkerClient | null = null;
function getWorkerClient(): RouteWorkerClient {
  if (!workerClient) workerClient = new RouteWorkerClient();
  return workerClient;
}

/**
 * Full store interface: serialisable state from `AppState` plus all
 * action methods and additional UI state not in the API contract.
 */
interface AppStore extends AppState {
  /** Update the departure address input */
  setAddress: (address: string) => void;
  /** Change the active session profile and reset sliders to its defaults */
  setProfileId: (id: string) => void;
  /** Update the target distance slider value in km */
  setTargetDistance: (km: number) => void;
  /** Update the target elevation slider value in metres */
  setTargetElevation: (m: number) => void;
  /** Move the Mapbox camera centre (used after geolocation) */
  setMapCenter: (center: Coordinate) => void;
  /** Update the Mapbox zoom level */
  setMapZoom: (zoom: number) => void;
  /** Transition to loading state; clears any previous route and error */
  setLoading: () => void;
  /** Transition to success state and store the generated route */
  setSuccess: (route: GeneratedRoute) => void;
  /** Transition to error state with a display message */
  setError: (message: string) => void;
  /**
   * Switch the displayed candidate. Also updates `currentRoute.best` so
   * GPX export and all stats automatically reflect the selection.
   */
  setCandidateIndex: (index: number) => void;
  /** Full reset to initial state (clears address, profile, and route) */
  reset: () => void;
  /** Clear the current route but preserve address / profile / slider settings */
  clearRoute: () => void;
  /**
   * `true` = scenic mode (green accent, popularity boost active).
   * `false` = performance mode (blue accent, terrain/distance priority).
   */
  scenicMode: boolean;
  setScenicMode: (v: boolean) => void;
  /**
   * Fractional position (0–1) along the route, driven by ElevationProfile
   * mouse hover. Used to synchronise the crosshair dot on the Mapbox map.
   * `null` when the cursor is not over the elevation chart.
   */
  hoveredRouteProgress: number | null;
  setHoveredRouteProgress: (v: number | null) => void;
  /** Whether the IGN France SCAN 25 raster overlay is shown on the map */
  ignLayerVisible: boolean;
  /** Toggles `ignLayerVisible` between true and false */
  toggleIgnLayer: () => void;
  /** Whether the sidebar drawer is open (relevant on mobile) */
  sidebarOpen: boolean;
  /** Set sidebar open/closed state */
  setSidebarOpen: (open: boolean) => void;
  /** Toggle sidebar open/closed */
  toggleSidebar: () => void;
  /**
   * Real-time generation progress from the Web Worker.
   * `null` when not loading; populated with stage label and 0–100 percent
   * during client-side route generation.
   */
  generationProgress: { stage: string; percent: number } | null;
  /** Current user subscription tier — drives TierConfig selection */
  userTier: "free" | "pro";
  /**
   * Generate a route entirely client-side via the Web Worker.
   * Accepts a pre-geocoded coordinate (geocoding must happen in the main thread).
   */
  generateRouteClientSide: (center: Coordinate) => Promise<void>;
}

const defaultProfile = SESSION_PROFILES[0];

const initialState: AppState = {
  status: "idle" as AppStatus,
  errorMessage: null,
  currentRoute: null,
  candidateIndex: 0,
  mapCenter: { lat: 48.8566, lng: 2.3522 }, // Paris
  mapZoom: 12,
  selectedProfileId: defaultProfile.id,
  targetDistanceKm: defaultProfile.distanceRange.default,
  targetElevationM: defaultProfile.elevationRange.default,
  address: "",
};

/**
 * The single Zustand store instance for the application.
 *
 * @example
 * // In any Client Component
 * const { status, currentRoute, setLoading } = useAppStore();
 */
export const useAppStore = create<AppStore>((set, get) => ({
  ...initialState,
  scenicMode: false,
  hoveredRouteProgress: null,
  generationProgress: null,
  userTier: "free",

  setAddress: (address) => set({ address }),
  setProfileId: (selectedProfileId) => set({ selectedProfileId }),
  setTargetDistance: (targetDistanceKm) => set({ targetDistanceKm }),
  setTargetElevation: (targetElevationM) => set({ targetElevationM }),
  setMapCenter: (mapCenter) => set({ mapCenter }),
  setMapZoom: (mapZoom) => set({ mapZoom }),
  setLoading: () =>
    set({ status: "loading", errorMessage: null, currentRoute: null, candidateIndex: 0 }),
  setSuccess: (currentRoute) =>
    set({ status: "success", currentRoute, candidateIndex: 0 }),
  setError: (errorMessage) => set({ status: "error", errorMessage }),

  /** Switch to a different candidate — also updates currentRoute.best so
   *  GPX export and all stats reflect the selected variant automatically. */
  setCandidateIndex: (index) =>
    set((state) => {
      if (!state.currentRoute) return {};
      const candidate = state.currentRoute.candidates[index];
      if (!candidate) return {};
      return {
        candidateIndex: index,
        currentRoute: { ...state.currentRoute, best: candidate },
      };
    }),

  reset: () => set({ ...initialState, scenicMode: false, hoveredRouteProgress: null }),

  clearRoute: () =>
    set({ status: "idle", errorMessage: null, currentRoute: null, candidateIndex: 0, hoveredRouteProgress: null }),

  setScenicMode: (scenicMode) => set({ scenicMode }),
  setHoveredRouteProgress: (hoveredRouteProgress) => set({ hoveredRouteProgress }),

  ignLayerVisible: false,
  toggleIgnLayer: () => set((state) => ({ ignLayerVisible: !state.ignLayerVisible })),

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  generateRouteClientSide: async (center: Coordinate) => {
    const state = get();
    set({ status: "loading", generationProgress: null, errorMessage: null });
    try {
      const routes = await getWorkerClient().generate(
        {
          center,
          targetDistanceKm: state.targetDistanceKm,
          targetElevationM: state.targetElevationM,
          profileId: state.selectedProfileId,
          tierConfig: LIGHT_CONFIG,
          scenicMode: state.scenicMode,
        },
        (stage, percent) => set({ generationProgress: { stage, percent } })
      );
      if (routes.length === 0) throw new Error("No routes found");
      const profile = PROFILES_BY_ID.get(state.selectedProfileId)!;
      set({
        status: "success",
        currentRoute: {
          best: routes[0],
          candidates: routes,
          startCoordinate: center,
          profile,
        },
        candidateIndex: 0,
        generationProgress: null,
      });
    } catch (e) {
      set({
        status: "error",
        errorMessage: e instanceof Error ? e.message : "Route generation failed",
        generationProgress: null,
      });
    }
  },
}));
