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
});
