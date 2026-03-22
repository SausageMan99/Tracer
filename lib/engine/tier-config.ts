// ── TierConfig: parameterized solver configuration per subscription tier ──────

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

export const FREE_TIER: TierConfig = {
  solverConfigs: [
    { beamWidth: 20, temperature: 0.25, seedBearing: 0 },
    { beamWidth: 20, temperature: 0.25, seedBearing: 180 },
  ],
  maxIterations: 800,
  earlyK: 2,
  lateK: 1,
  enableFullScenic: false,
  maxCandidates: 1,
  deduplicationMode: "distance",
};

export const PRO_TIER: TierConfig = {
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
