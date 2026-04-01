// ── Solver configurations — no subscription tiers, just complexity levels ──────

export interface SolverConfig {
  readonly beamWidth: number;
  readonly temperature: number;
  readonly seedBearing: number;
}

export interface TierConfig {
  readonly solverConfigs: readonly SolverConfig[];
  readonly maxIterations: number;
  readonly earlyK: number;
  readonly lateK: number;
  readonly enableFullScenic: boolean;
  readonly maxCandidates: number;
  readonly deduplicationMode: "distance" | "jaccard";
}

/**
 * Light config — runs in the browser Web Worker.
 * Used for routes ≤ 25 km and ≤ 600 m D+.
 */
export const LIGHT_CONFIG: TierConfig = {
  solverConfigs: [
    { beamWidth: 30, temperature: 0.25, seedBearing: 0 },
    { beamWidth: 30, temperature: 0.25, seedBearing: 180 },
  ],
  maxIterations: 800,
  earlyK: 2,
  lateK: 1,
  enableFullScenic: true,
  maxCandidates: 2,
  deduplicationMode: "jaccard",
};

/**
 * Full config — runs server-side.
 * Used for heavy routes (> 25 km or > 600 m D+).
 */
export const FULL_CONFIG: TierConfig = {
  solverConfigs: [
    { beamWidth: 60, temperature: 0.2,  seedBearing: 0 },
    { beamWidth: 40, temperature: 0.3,  seedBearing: 72 },
    { beamWidth: 80, temperature: 0.15, seedBearing: 144 },
    { beamWidth: 50, temperature: 0.25, seedBearing: 216 },
    { beamWidth: 70, temperature: 0.2,  seedBearing: 288 },
  ],
  maxIterations: 2000,
  earlyK: 3,
  lateK: 2,
  enableFullScenic: true,
  maxCandidates: 6,
  deduplicationMode: "jaccard",
};
