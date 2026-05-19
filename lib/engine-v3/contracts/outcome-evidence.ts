export type ProductVerdictV3 =
  | 'good_route'
  | 'acceptable_adjusted'
  | 'honest_refusal'
  | 'fake_success'
  | 'engine_failure';

export interface OutcomeEvidenceV3 {
  missionId: string;
  selectedCandidateId: string | null;
  productOutcome: 'generated' | 'adjusted' | 'refused';
  primaryReason: string;
  userFacingSummary: string;
  reasons: string[];
  compromises: string[];
  hardGateFailures: string[];
  benchmarkEvidence: {
    commandSucceeded?: boolean;
    productVerdict: ProductVerdictV3;
  };
  exportPolicy: {
    geoJsonAvailable: boolean;
    gpxAvailable: boolean;
    emptyOnRefusal: boolean;
  };
  surfaceEvidence: {
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    pavedKm: number;
    naturalDwellKm: number;
  } | null;
}
