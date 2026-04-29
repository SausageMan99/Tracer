import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/feedback/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    rating: "negative",
    reasons: ["too_much_busy_road"],
    sessionType: "endurance",
    sport: "running",
    requestedDistanceKm: 10,
    actualDistanceKm: 8.8,
    actualElevationM: 70,
    algorithmicScore: 0.68,
    ...overrides,
  };
}

describe("POST /api/feedback", () => {
  it("accepts whitelisted reason codes", async () => {
    const response = await POST(makeRequest(validPayload()) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("rejects arbitrary free-text feedback reasons", async () => {
    const response = await POST(makeRequest(validPayload({ reasons: ["my email is user@example.com"] })) as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });
});
