import type { WorkerRequest, WorkerResponse } from "./worker-types";
import type { RouteCandidate, Coordinate } from "../types";
import type { TierConfig } from "./tier-config";

type ProgressCallback = (stage: string, percent: number) => void;

/**
 * Client-side wrapper around the route generation Web Worker.
 *
 * Manages the Worker lifecycle, serialises requests, deserialises responses,
 * and exposes a simple async `generate()` interface. Only one Worker instance
 * is created per `RouteWorkerClient` (lazy, on first call).
 *
 * Cancel semantics: calling `generate()` while a previous request is still
 * in-flight automatically sends a cancel message for the previous request ID.
 * The Worker discards progress for cancelled IDs.
 */
export class RouteWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
    }
    return this.worker;
  }

  async generate(
    params: {
      center: Coordinate;
      targetDistanceKm: number;
      targetElevationM: number;
      profileId: string;
      tierConfig: TierConfig;
      scenicMode?: boolean;
    },
    onProgress?: ProgressCallback
  ): Promise<RouteCandidate[]> {
    const id = String(++this.requestId);
    const worker = this.getWorker();

    // Cancel previous request if one exists
    if (this.requestId > 1) {
      const cancelMsg: WorkerRequest = {
        type: "cancel",
        id: String(this.requestId - 1),
      };
      worker.postMessage(cancelMsg);
    }

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.id !== id) return;

        if (msg.type === "progress") {
          onProgress?.(msg.stage, msg.percent);
        } else if (msg.type === "result") {
          worker.removeEventListener("message", handler);
          resolve(msg.routes);
        } else if (msg.type === "error") {
          worker.removeEventListener("message", handler);
          reject(new Error(msg.message));
        }
      };

      worker.addEventListener("message", handler);
      const request: WorkerRequest = { type: "generate", id, params };
      worker.postMessage(request);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
