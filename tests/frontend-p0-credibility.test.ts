import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const source = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("TrailForge front-end P0 credibility copy", () => {
  it("removes prototype and builder jargon from the app UI source", () => {
    const appSources = [
      "components/sidebar/SessionForm.tsx",
      "components/sidebar/RouteResult.tsx",
      "components/sidebar/FeedbackButtons.tsx",
      "components/app/AppNav.tsx",
    ].map(source).join("\n");

    expect(appSources).not.toMatch(/phase 1|Phase 1|promesse magique|signal terrain|santé de (?:la )?boucle|terrain décide|Atelier trail|Modifier le brief/);
    expect(appSources).toContain("Boucle trail courte");
    expect(appSources).toContain("Crée une boucle trail GPX autour de ton départ.");
    expect(appSources).toContain("Paramètres");
    expect(appSources).toContain("Style de sortie");
    expect(appSources).toContain("Préférence terrain");
    expect(appSources).toContain("Trace plus fiable");
    expect(appSources).toContain("Plus sauvage");
    expect(appSources).toContain("Fiabilité");
    expect(appSources).toContain("Part de sentiers");
    expect(appSources).toContain("À vérifier avant de partir");
  });

  it("keeps pre-generation guidance compact and action-oriented", () => {
    const sessionForm = source("components/sidebar/SessionForm.tsx");

    expect(sessionForm).toContain("TrailForge cherche une boucle GPX courte autour de ton départ. La fiabilité sera affichée avant export.");
    expect(sessionForm).not.toContain("Avant génération");
    expect(sessionForm).toContain("Chercher une boucle");
  });
});

describe("TrailForge front-end P0 result hierarchy", () => {
  it("places verdict and GPX actions before detailed route explanation and feedback", () => {
    const routeResult = source("components/sidebar/RouteResult.tsx");

    const verdict = routeResult.indexOf("Boucle exploitable");
    const gpx = routeResult.indexOf("Télécharger GPX");
    const details = routeResult.indexOf("Pourquoi ce tracé");
    const feedback = routeResult.indexOf("Retour terrain");
    const waitlist = routeResult.indexOf("Tu veux être prévenu quand la génération s’améliore dans ta zone ?");

    expect(verdict).toBeGreaterThan(-1);
    expect(gpx).toBeGreaterThan(verdict);
    expect(details).toBeGreaterThan(gpx);
    expect(feedback).toBeGreaterThan(details);
    expect(waitlist).toBeGreaterThan(feedback);
  });

  it("shows route-generation errors with corrective actions but no automatic regeneration", () => {
    const sessionForm = source("components/sidebar/SessionForm.tsx");

    expect(sessionForm).toContain("Pas de boucle fiable trouvée");
    expect(sessionForm).toContain("Réduire le D+");
    expect(sessionForm).toContain("Allonger un peu");
    expect(sessionForm).toContain("Changer le départ");
    expect(sessionForm).toContain("Prioriser trace fiable");
    expect(sessionForm).not.toMatch(/Réduire le D\+[\s\S]{0,240}handleGenerate\(/);
  });
});

describe("TrailForge front-end P0 route legend", () => {
  it("explains slope-coloured route lines without claiming surface encoding", () => {
    const mapView = source("components/map/MapView.tsx");

    expect(mapView).toContain("plat / roulant");
    expect(mapView).toContain("montée modérée");
    expect(mapView).toContain("montée raide");
    expect(mapView).toContain("Couleurs de pente");
    expect(mapView).not.toContain("surface inconnue");
  });
});
