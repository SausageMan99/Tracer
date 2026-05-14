import type { NormalizedRequestResultV3, UserRouteRequestV3 } from './types';

const MIN_PHASE_1_DISTANCE_KM = 5;
const MAX_PHASE_1_DISTANCE_KM = 15;

export function normalizeRequestV3(request: UserRouteRequestV3): NormalizedRequestResultV3 {
  const sport = request.sport ?? request.activity;

  if (sport !== 'running') {
    return {
      status: 'refused',
      outcome: {
        type: 'refused',
        reason: 'unsupported sport for engine V3 phase 1',
        details: ['Phase 1 accepts running requests only.'],
      },
    };
  }

  if (!['trail', 'nature_urbaine', 'boucle_simple'].includes(request.mode)) {
    return {
      status: 'refused',
      outcome: {
        type: 'refused',
        reason: 'unsupported mode for engine V3 phase 1',
        details: ['Supported modes: trail, nature_urbaine, boucle_simple.'],
      },
    };
  }

  if (request.loop === false) {
    return {
      status: 'refused',
      outcome: {
        type: 'refused',
        reason: 'unsupported loop setting for engine V3 phase 1',
        details: ['Phase 1 accepts loop routes only.'],
      },
    };
  }

  if (!isValidStart(request.start)) {
    return {
      status: 'refused',
      outcome: {
        type: 'refused',
        reason: 'invalid start coordinates for engine V3 phase 1',
        details: ['Expected finite latitude in [-90, 90] and finite longitude in [-180, 180].'],
      },
    };
  }

  if (
    !Number.isFinite(request.targetDistanceKm) ||
    request.targetDistanceKm < MIN_PHASE_1_DISTANCE_KM ||
    request.targetDistanceKm > MAX_PHASE_1_DISTANCE_KM
  ) {
    return {
      status: 'refused',
      outcome: {
        type: 'refused',
        reason: `unsupported distance for engine V3 phase 1: expected ${MIN_PHASE_1_DISTANCE_KM}-${MAX_PHASE_1_DISTANCE_KM} km`,
      },
    };
  }

  return {
    status: 'accepted',
    request: {
      start: { lat: request.start.lat, lng: request.start.lng },
      targetDistanceKm: request.targetDistanceKm,
      sport,
      mode: request.mode,
      loop: true,
    },
  };
}

function isValidStart(start: UserRouteRequestV3['start']): boolean {
  return (
    Number.isFinite(start.lat) &&
    start.lat >= -90 &&
    start.lat <= 90 &&
    Number.isFinite(start.lng) &&
    start.lng >= -180 &&
    start.lng <= 180
  );
}
