/**
 * Web Worker entry point for client-side route generation.
 *
 * Runs the full V2 engine pipeline in a browser Worker context.
 * Uses browser-safe adapters: IndexedDBCache and ProxyFetcher.
 *
 * IMPORTANT: This file must NOT import anything that uses Node.js APIs
 * (no `fs`, `path`, `process`). All adapters must be the browser versions.
 */

import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";
import { IndexedDBCache } from "./adapters/indexeddb-cache";
import { ProxyFetcher } from "./adapters/proxy-fetcher";
import { haversineKm } from "./utils";
import { PROFILES_BY_ID } from "../session-profiles";
import { RouteGenerationError } from "../errors";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const cache = new IndexedDBCache(TTL_MS);
const fetcher = new ProxyFetcher();

const cancelledIds = new Set<string>();

type ProgressStage = Extract<WorkerResponse, { type: "progress" }>["stage"];

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "cancel") {
    cancelledIds.add(msg.id);
    return;
  }

  if (msg.type === "generate") {
    handleGenerate(msg.id, msg.params).catch((err: unknown) => {
      const errorMsg =
        err instanceof Error ? err.message : "Route generation failed";
      const code =
        err instanceof RouteGenerationError ? err.code : "UNKNOWN";
      const response: WorkerResponse = {
        type: "error",
        id: msg.id,
        code,
        message: errorMsg,
      };
      self.postMessage(response);
    });
  }
});

async function handleGenerate(
  id: string,
  params: {
    center: import("../types").Coordinate;
    targetDistanceKm: number;
    targetElevationM: number;
    profileId: string;
    tierConfig: import("./tier-config").TierConfig;
    scenicMode?: boolean;
  }
): Promise<void> {
  const { center, targetDistanceKm, targetElevationM, profileId, tierConfig, scenicMode } =
    params;

  const profile = PROFILES_BY_ID.get(profileId);
  if (!profile) {
    const response: WorkerResponse = {
      type: "error",
      id,
      code: "UNKNOWN",
      message: `Unknown profile: ${profileId}`,
    };
    self.postMessage(response);
    return;
  }

  // ── Stage 1: Build graph ────────────────────────────────────────────────────
  postProgress(id, "graph", 5);

  if (cancelledIds.has(id)) return;

  const { graph, scenicWayIds } = await buildGraph(
    center,
    targetDistanceKm,
    cache,
    fetcher
  );

  if (cancelledIds.has(id)) return;

  if (graph.nodes.size === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  postProgress(id, "graph", 25);

  // ── Stage 2: Find closest node ──────────────────────────────────────────────
  let closestNodeId = "";
  let closestDist = Infinity;
  for (const [nodeId, node] of graph.nodes) {
    const dist = haversineKm(center, { lat: node.lat, lng: node.lng });
    if (dist < closestDist) {
      closestDist = dist;
      closestNodeId = nodeId;
    }
  }

  if (!closestNodeId) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  // ── Stage 3: Score edges (elevation fetch) ─────────────────────────────────
  postProgress(id, "elevation", 35);

  if (cancelledIds.has(id)) return;

  const weights = deriveWeights(profile, scenicMode);
  const { nodeElevation } = await scoreEdges(
    graph,
    weights,
    profile,
    scenicWayIds,
    fetcher,
    tierConfig.enableFullScenic
  );

  if (cancelledIds.has(id)) return;

  postProgress(id, "scoring", 55);

  // ── Stage 4: Run solver ────────────────────────────────────────────────────
  postProgress(id, "solving", 60);

  if (cancelledIds.has(id)) return;

  const solverPaths = await solve(
    graph,
    closestNodeId,
    targetDistanceKm,
    targetElevationM,
    nodeElevation,
    tierConfig
  );

  if (cancelledIds.has(id)) return;

  if (solverPaths.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  postProgress(id, "solving", 80);

  // ── Stage 5: Post-process ──────────────────────────────────────────────────
  postProgress(id, "postprocess", 85);

  const candidates = await postProcess(
    solverPaths,
    graph,
    center,
    profile,
    targetDistanceKm,
    targetElevationM,
    nodeElevation,
    fetcher,
    tierConfig.maxCandidates
  );

  if (cancelledIds.has(id)) return;

  if (candidates.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  postProgress(id, "postprocess", 100);

  // ── Emit result ────────────────────────────────────────────────────────────
  const response: WorkerResponse = { type: "result", id, routes: candidates };
  self.postMessage(response);

  // Clean up cancel tracking for completed requests
  cancelledIds.delete(id);
}

function postProgress(
  id: string,
  stage: ProgressStage,
  percent: number
): void {
  const response: WorkerResponse = { type: "progress", id, stage, percent };
  self.postMessage(response);
}
