import type { Coordinate, RouteCandidate } from "../types";
import type { TierConfig } from "./solver-config";

export type WorkerRequest =
  | {
      type: "generate";
      id: string;
      params: {
        center: Coordinate;
        targetDistanceKm: number;
        targetElevationM: number;
        profileId: string;
        tierConfig: TierConfig;
        scenicMode?: boolean;
      };
    }
  | { type: "cancel"; id: string };

export type WorkerResponse =
  | {
      type: "progress";
      id: string;
      stage: "graph" | "elevation" | "scoring" | "solving" | "postprocess";
      percent: number;
    }
  | { type: "result"; id: string; routes: RouteCandidate[] }
  | { type: "error"; id: string; code: string; message: string };
