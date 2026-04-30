import { describe, expect, it } from "vitest";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import {
  ROUTE_INTENTIONS,
  buildRouteIntentionCard,
  getRouteIntention,
} from "@/lib/route-intentions";
import { deriveWeights } from "@/lib/engine/edge-scorer";

describe("route intentions", () => {
  it("maps every session profile to a clear product intention", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const intention = getRouteIntention(profile);

      expect(intention.label.length).toBeGreaterThan(3);
      expect(intention.promise).toContain("TrailForge");
      expect(intention.engineBiases.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("makes recovery routes quieter and flatter than threshold work", () => {
    const recovery = PROFILES_BY_ID.get("running_recuperation")!;
    const threshold = PROFILES_BY_ID.get("running_seuil")!;

    const recoveryWeights = deriveWeights(recovery, false);
    const thresholdWeights = deriveWeights(threshold, false);

    expect(recoveryWeights.quietness).toBeGreaterThan(thresholdWeights.quietness);
    expect(recoveryWeights.elevation).toBeLessThan(thresholdWeights.elevation);
  });

  it("makes nature routes explicitly prefer natural ways", () => {
    const endurance = PROFILES_BY_ID.get("running_endurance")!;
    const card = buildRouteIntentionCard(endurance, true);

    expect(card.title).toBe(ROUTE_INTENTIONS.nature_escape.label);
    expect(card.biases.join(" ")).toContain("nature");
  });

  it("maps trail session type to nature escape intention", () => {
    const trail = PROFILES_BY_ID.get("running_trail")!;
    const intention = getRouteIntention(trail);

    expect(intention.id).toBe("nature_escape");
    expect(intention.weightMultipliers.nature).toBeGreaterThan(1);
  });

  it("gives trail running higher nature and lower surface (paved) weights than normal running endurance", () => {
    const trail = PROFILES_BY_ID.get("running_trail")!;
    const endurance = PROFILES_BY_ID.get("running_endurance")!;

    const trailWeights = deriveWeights(trail, false);
    const enduranceWeights = deriveWeights(endurance, false);

    expect(trailWeights.nature).toBeGreaterThan(enduranceWeights.nature);
    expect(trailWeights.surface).toBeLessThan(enduranceWeights.surface);
  });
});
