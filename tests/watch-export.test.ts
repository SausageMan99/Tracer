import { describe, expect, it } from "vitest";
import { buildWatchExportGuide, getWatchExportTargets } from "@/lib/watch-export";
import { PROFILES_BY_ID } from "@/lib/session-profiles";

describe("watch export guidance", () => {
  it("recommends the right export targets for a running route", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const targets = getWatchExportTargets(profile);

    expect(targets.map((target) => target.id)).toEqual(["garmin", "coros", "suunto", "strava"]);
  });

  it("recommends Wahoo before running watches for a road cycling route", () => {
    const profile = PROFILES_BY_ID.get("cycling_road_endurance")!;
    const targets = getWatchExportTargets(profile);

    expect(targets.map((target) => target.id).slice(0, 3)).toEqual(["garmin", "wahoo", "strava"]);
  });

  it("builds a short product-safe guide with one action per target", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const guide = buildWatchExportGuide(profile);

    expect(guide.title).toBe("Envoyer sur montre");
    expect(guide.description).toContain("Télécharge le GPX");
    expect(guide.targets).toHaveLength(4);
    expect(guide.targets[0]).toMatchObject({
      id: "garmin",
      label: "Garmin Connect",
      primaryAction: "Importer le GPX dans Garmin Connect, puis Envoyer vers l'appareil.",
    });
    expect(guide.targets.every((target) => target.primaryAction.length > 20)).toBe(true);
  });
});
