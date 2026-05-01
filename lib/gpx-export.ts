import type { GeneratedRoute } from "./types";

/**
 * Generates a GPX 1.1 XML string from a generated route.
 *
 * The output is compatible with Garmin Connect, Wahoo ELEMNT, Suunto,
 * and Komoot. Compatibility requirements met:
 * - `<time>` tag on every `<trkpt>` (required by Garmin and Wahoo)
 * - Full geometry coordinates for accurate distance in external tools
 * - Valid `xsi:schemaLocation` pointing to the official GPX 1.1 XSD
 * - `<type>` tag on `<trk>` for sport categorisation
 *
 * Times are synthetic: the generation timestamp is used as the start time,
 * and subsequent timestamps are spaced uniformly to match `durationSeconds`.
 * This produces a valid file that device apps can import and display.
 *
 * @param route - The generated route (uses `route.best` and `route.profile`)
 * @returns GPX 1.1 XML string, UTF-8 encoded
 *
 * @example
 * const gpx = generateGPX(route);
 * // '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" ...'
 */
export function generateGPX(route: GeneratedRoute): string {
  const { best, profile } = route;
  const coords = best.geometry.coordinates; // [lng, lat][] — full path
  const now = new Date();
  const msPerPoint =
    coords.length > 1 ? (best.durationSeconds * 1000) / (coords.length - 1) : 0;

  const trkpts = coords
    .map((coord, i) => {
      const time = new Date(now.getTime() + i * msPerPoint);
      const elevation = best.points[i]?.elevation;
      const eleTag = Number.isFinite(elevation)
        ? `        <ele>${elevation!.toFixed(1)}</ele>\n`
        : "";

      return (
        `      <trkpt lat="${coord[1].toFixed(7)}" lon="${coord[0].toFixed(7)}">\n` +
        eleTag +
        `        <time>${time.toISOString()}</time>\n` +
        `      </trkpt>`
      );
    })
    .join("\n");

  const qualityExtensions = buildQualityExtensions(best.quality);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"
  creator="TrailForge"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:trailforge="https://trailforge.app/gpx/extensions/1"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(profile.name)} - ${best.distanceKm.toFixed(1)}km</name>
    <desc>Généré par TrailForge. Sport: ${escapeXml(profile.sport)}. D+: ${best.ascendM.toFixed(0)}m</desc>
    <keywords>TrailForge,GPX,${escapeXml(profile.sport)}</keywords>
    <time>${now.toISOString()}</time>${qualityExtensions}
  </metadata>
  <trk>
    <name>${escapeXml(profile.name)}</name>
    <type>${escapeXml(profile.sport)}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Triggers a browser file download for a generated route as a GPX file.
 *
 * Creates a temporary `<a>` element with an object URL, programmatically
 * clicks it, then immediately revokes the URL to free memory. The download
 * filename includes the profile ID and current timestamp for uniqueness.
 *
 * Must be called in a browser context (uses `document`, `URL.createObjectURL`).
 *
 * @param route - The generated route to export
 *
 * @example
 * // Triggered by the "Exporter en GPX" button in RouteResult
 * downloadGPX(currentRoute);
 * // → browser downloads "tracer-running_endurance-1708776000000.gpx"
 */
export function downloadGPX(route: GeneratedRoute): void {
  const gpx = generateGPX(route);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tracer-${route.profile.id}-${Date.now()}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildQualityExtensions(quality: GeneratedRoute["best"]["quality"]): string {
  if (!quality) return "";

  const warnings = quality.warnings ?? [];
  const warningTags = warnings
    .map((warning) => `        <trailforge:warning>${escapeXml(warning)}</trailforge:warning>`)
    .join("\n");

  return `
    <extensions>
      <trailforge:quality>
        <trailforge:productionScore>${formatMetric(quality.productionScore)}</trailforge:productionScore>
        <trailforge:loopClosureKm>${formatMetric(quality.loopGapKm)}</trailforge:loopClosureKm>
        <trailforge:busyRoadRatio>${formatMetric(quality.busyRoadRatio)}</trailforge:busyRoadRatio>
        <trailforge:trailRatio>${formatMetric(quality.trailRatio)}</trailforge:trailRatio>
        <trailforge:naturalWayRatio>${formatMetric(quality.naturalWayRatio ?? quality.trailRatio)}</trailforge:naturalWayRatio>
        <trailforge:pavedRatio>${formatMetric(quality.pavedRatio)}</trailforge:pavedRatio>
        <trailforge:scenicPavedRatio>${formatMetric(quality.scenicPavedRatio)}</trailforge:scenicPavedRatio>${warningTags ? `\n${warningTags}` : ""}
      </trailforge:quality>
    </extensions>`;
}

function formatMetric(value: number | undefined): string {
  return Number.isFinite(value) ? value!.toFixed(2) : "0.00";
}

/**
 * Escapes a string for safe inclusion in XML attribute values and text content.
 *
 * Handles the five predefined XML entities: `&`, `<`, `>`, `"`, `'`.
 * Required because profile names and sport identifiers may contain
 * characters that would break the XML structure.
 *
 * @param str - Raw string to escape
 * @returns XML-safe string with entities replaced
 *
 * @example
 * escapeXml('Vélo <Route> & D+')
 * // → 'Vélo &lt;Route&gt; &amp; D+'
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
