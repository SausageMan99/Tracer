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
import { SESSION_PROFILES } from "./session-profiles";

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
}

const defaultProfile = SESSION_PROFILES.find((profile) => profile.id === "running_trail") ?? SESSION_PROFILES[0];

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
export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  scenicMode: false,
  hoveredRouteProgress: null,

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
}));
