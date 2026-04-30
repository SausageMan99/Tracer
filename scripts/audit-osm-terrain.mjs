#!/usr/bin/env node

const HIGHWAY_FILTER = [
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'track',
  'path',
  'cycleway',
  'bridleway',
  'footway',
  'pedestrian',
  'living_street',
];

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway']);
const ASPHALT_SURFACES = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'paving_stones']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'unpaved', 'compacted', 'fine_gravel', 'gravel', 'sand']);
const SCENIC_TAGS = [
  ['natural', /^(wood|forest|grassland|heath|scrub|wetland)$/],
  ['landuse', /^(forest|wood|recreation_ground)$/],
  ['leisure', /^(nature_reserve|park)$/],
  ['boundary', /^protected_area$/],
  ['route', /^hiking$/],
];

function parseArgs(argv) {
  const args = { radiusKm: 1.8, distanceKm: 10, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lat') args.lat = Number(argv[++i]);
    else if (arg === '--lng' || arg === '--lon') args.lng = Number(argv[++i]);
    else if (arg === '--address') args.address = argv[++i];
    else if (arg === '--radius-km') args.radiusKm = Number(argv[++i]);
    else if (arg === '--distance-km') args.distanceKm = Number(argv[++i]);
    else if (arg === '--fixture') args.fixture = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage:
  npm run audit:osm -- --address "7 Rue des Pommiers, 14210 Tourville-sur-Odon"
  npm run audit:osm -- --lat 49.141 --lng -0.504 --radius-km 1.8 --json

Options:
  --address <text>     Geocode an address with Nominatim
  --lat <number>       Latitude when not using --address
  --lng <number>       Longitude when not using --address
  --radius-km <number> OSM audit radius, default 1.8
  --json               Print machine-readable JSON
  --fixture <file>     Read Overpass JSON from a local fixture instead of fetching`;
}

async function geocode(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TrailForge/0.1 contact:clement.dubosq@wanadoo.fr' },
  });
  if (!res.ok) throw new Error(`Nominatim failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error(`No geocoding result for: ${address}`);
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
}

async function fetchOverpass(center, radiusKm) {
  const radiusM = Math.round(radiusKm * 1000);
  const highwayRegex = HIGHWAY_FILTER.join('|');
  const query = `[out:json][timeout:30];(
way["highway"~"^(${highwayRegex})$"]["access"!~"^(private|no)$"]["foot"!="no"](around:${radiusM},${center.lat},${center.lng});
nwr["natural"~"^(wood|forest|grassland|heath|scrub|wetland)$"](around:${radiusM},${center.lat},${center.lng});
nwr["landuse"~"^(forest|wood|recreation_ground)$"](around:${radiusM},${center.lat},${center.lng});
nwr["leisure"~"^(nature_reserve|park)$"](around:${radiusM},${center.lat},${center.lng});
nwr["boundary"="protected_area"](around:${radiusM},${center.lat},${center.lng});
(._;>;);
);out body qt;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TrailForge/0.1 contact:clement.dubosq@wanadoo.fr',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Overpass failed: HTTP ${res.status}`);
  return res.json();
}

function isScenic(tags = {}) {
  return SCENIC_TAGS.some(([key, re]) => tags[key] != null && re.test(tags[key]));
}

function ratio(value, total) {
  return total === 0 ? 0 : Number((value / total).toFixed(3));
}

function classifyTrailPotential(metrics) {
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.2) return 'low';
  if (metrics.pathLikeEdgeRatio >= 0.35 || metrics.naturalAreaSignal >= 0.3) return 'high';
  return 'medium';
}

function classifyConfidence(metrics) {
  if (metrics.totalWays === 0) return 'low';
  if (metrics.unknownSurfaceRatio >= 0.5 && metrics.pathLikeEdgeRatio >= 0.4) return 'medium';
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.15) return 'high';
  if (metrics.surfaceTaggedRatio >= 0.65) return 'high';
  return 'medium';
}

function buildWarnings(metrics) {
  const warnings = [];
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.15) {
    warnings.push('Zone probablement trop routière pour promettre une vraie boucle trail.');
  }
  if (metrics.unknownSurfaceRatio >= 0.5 && metrics.pathLikeEdgeRatio >= 0.4) {
    warnings.push('Beaucoup de chemins existent mais les surfaces OSM sont peu renseignées.');
  }
  if (metrics.pathLikeEdgeRatio < 0.2 && metrics.scenicEdgeRatio >= 0.25) {
    warnings.push('Des zones naturelles sont visibles, mais peu de chemins routables sont taggés.');
  }
  return warnings;
}

function audit(elements) {
  const ways = elements.filter((el) => el.type === 'way');
  const routableWays = ways.filter((way) => way.tags?.highway != null);
  const totalWays = routableWays.length;
  const pathLike = routableWays.filter((way) => PATH_LIKE_HIGHWAYS.has(way.tags.highway)).length;
  const surfaceTagged = routableWays.filter((way) => way.tags.surface != null).length;
  const unknownSurface = totalWays - surfaceTagged;
  const asphalt = routableWays.filter((way) => ASPHALT_SURFACES.has(way.tags.surface ?? '')).length;
  const naturalSurface = routableWays.filter((way) => NATURAL_SURFACES.has(way.tags.surface ?? '')).length;
  const scenicWays = ways.filter((way) => isScenic(way.tags)).length;
  const scenicRoutableWays = routableWays.filter((way) => isScenic(way.tags) || way.tags.route === 'hiking').length;

  const metrics = {
    totalWays,
    totalOsmWays: ways.length,
    pathLikeWayRatio: ratio(pathLike, totalWays),
    surfaceTaggedRatio: ratio(surfaceTagged, totalWays),
    unknownSurfaceRatio: ratio(unknownSurface, totalWays),
    asphaltRatio: ratio(asphalt, totalWays),
    naturalSurfaceRatio: ratio(naturalSurface, totalWays),
    scenicEdgeRatio: ratio(scenicRoutableWays, totalWays),
    naturalAreaSignal: ratio(scenicWays + naturalSurface, Math.max(ways.length, 1)),
  };

  // Keep aliases close to lib/engine/terrain-audit.ts naming.
  metrics.pathLikeEdgeRatio = metrics.pathLikeWayRatio;

  return {
    confidence: classifyConfidence(metrics),
    trailPotential: classifyTrailPotential(metrics),
    metrics,
    warnings: buildWarnings(metrics),
  };
}

function printHuman(report, context) {
  console.log(`TrailForge OSM terrain audit`);
  console.log(`Zone: ${context.label ?? `${context.lat}, ${context.lng}`}`);
  console.log(`Rayon: ${context.radiusKm} km`);
  console.log(`Potentiel trail: ${report.trailPotential}`);
  console.log(`Confiance donnée: ${report.confidence}`);
  console.log(`Ways routables: ${report.metrics.totalWays}`);
  console.log(`Chemins path/track/footway: ${(report.metrics.pathLikeWayRatio * 100).toFixed(1)}%`);
  console.log(`Surfaces renseignées: ${(report.metrics.surfaceTaggedRatio * 100).toFixed(1)}%`);
  console.log(`Asphalte: ${(report.metrics.asphaltRatio * 100).toFixed(1)}%`);
  console.log(`Signal naturel/scenic: ${(report.metrics.naturalAreaSignal * 100).toFixed(1)}%`);
  if (report.warnings.length > 0) {
    console.log(`Warnings:`);
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  let center;
  if (args.address) center = await geocode(args.address);
  else if (Number.isFinite(args.lat) && Number.isFinite(args.lng)) center = { lat: args.lat, lng: args.lng };
  else throw new Error('Provide either --address or both --lat and --lng.');

  const data = args.fixture
    ? JSON.parse((await import('node:fs')).readFileSync(args.fixture, 'utf8'))
    : await fetchOverpass(center, args.radiusKm);
  const report = audit(data.elements ?? []);

  const output = { center, radiusKm: args.radiusKm, ...report };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else printHuman(report, { ...center, radiusKm: args.radiusKm });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
