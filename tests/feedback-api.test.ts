import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rm, readFile } from "fs/promises";
import * as path from "path";

// The route module uses module-level state (knownFeedbackIds, rateLimiter).
// We test via actual HTTP-like calls by importing the handlers directly.

const DATA_DIR = path.join(process.cwd(), ".data-test-feedback");
const FEEDBACKS_FILE = path.join(DATA_DIR, "feedbacks.jsonl");

// ── Override module constants before import ──────────────────────────────────
// We can't easily override consts in the route module, so we test the core
// logic (JSONL format, no IP, pagination, dedup) by exercising the route
// handlers through NextRequest/NextResponse.

// Instead, we test the file helpers and validation logic in isolation, and
// do a lightweight integration test via the exported handlers.

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFeedbackBody(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    rating: "positive",
    sessionType: "endurance",
    sport: "running",
    mode: "PERFORMANCE",
    requestedDistanceKm: 10,
    requestedElevationM: 200,
    actualDistanceKm: 9.8,
    actualElevationM: 195,
    algorithmicScore: 0.85,
    distanceErrorPct: 2,
    elevationErrorPct: 3,
    ...overrides,
  };
}

// We need to test the actual route handlers. Since they use module-level
// state and hardcoded paths, we import them and build NextRequest objects.
// The .data directory is used by the production route, so tests will write
// to it. We clean up after.

const ACTUAL_FEEDBACKS_FILE = path.join(process.cwd(), ".data", "feedbacks.jsonl");

// Clean up any test data from previous runs
beforeEach(async () => {
  try {
    await rm(ACTUAL_FEEDBACKS_FILE, { force: true });
  } catch {
    // file may not exist
  }
});

afterAll(async () => {
  try {
    await rm(ACTUAL_FEEDBACKS_FILE, { force: true });
  } catch {
    // ignore
  }
});

// ── Dynamic import to reset module state per describe block ──────────────────

async function importRoute() {
  // Each call gets the cached module — module-level state persists.
  // This is acceptable for our sequential tests.
  const mod = await import("@/app/api/feedback/route");
  return mod;
}

function makeRequest(
  method: string,
  body?: Record<string, unknown>,
  params?: Record<string, string>,
  headers?: Record<string, string>,
): Request {
  const url = new URL("http://localhost:3000/api/feedback");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
      ...headers,
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new Request(url.toString(), init);
}

// NextRequest wraps Request — we use the Next.js constructor
async function makeNextRequest(
  method: string,
  body?: Record<string, unknown>,
  params?: Record<string, string>,
  headers?: Record<string, string>,
) {
  const { NextRequest } = await import("next/server");
  const req = makeRequest(method, body, params, headers);
  return new NextRequest(req);
}

describe("Feedback API", () => {
  describe("POST /api/feedback", () => {
    it("stores feedback in JSONL format without IP", async () => {
      const { POST } = await importRoute();
      const body = makeFeedbackBody();
      const req = await makeNextRequest("POST", body);

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify file is JSONL (one JSON object per line)
      const raw = await readFile(ACTUAL_FEEDBACKS_FILE, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);

      const stored = JSON.parse(lines[0]);
      expect(stored.id).toBe(body.id);
      expect(stored.rating).toBe("positive");
      expect(stored.timestamp).toBeTypeOf("number");

      // GDPR: no IP stored
      expect(stored.ip).toBeUndefined();
    });

    it("rejects invalid feedback with 400", async () => {
      const { POST } = await importRoute();
      const req = await makeNextRequest("POST", { id: "x" }); // missing required fields

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns duplicate: true for same feedback ID", async () => {
      const { POST } = await importRoute();
      const body = makeFeedbackBody({ id: "dedup-test-id" });

      const req1 = await makeNextRequest("POST", body);
      const res1 = await POST(req1);
      expect((await res1.json()).success).toBe(true);

      const req2 = await makeNextRequest("POST", body);
      const res2 = await POST(req2);
      const json2 = await res2.json();

      expect(json2.success).toBe(true);
      expect(json2.duplicate).toBe(true);

      // Verify only one entry in file
      const raw = await readFile(ACTUAL_FEEDBACKS_FILE, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const matchingLines = lines.filter((l) => {
        const obj = JSON.parse(l);
        return obj.id === "dedup-test-id";
      });
      expect(matchingLines).toHaveLength(1);
    });

    it("rejects malformed JSON body with 400", async () => {
      const { NextRequest } = await import("next/server");
      const { POST } = await importRoute();

      const req = new NextRequest(
        new Request("http://localhost:3000/api/feedback", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "127.0.0.2",
          },
          body: "not-json",
        }),
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/feedback", () => {
    it("returns 401 without admin secret", async () => {
      const { GET } = await importRoute();
      const req = await makeNextRequest("GET", undefined, {});

      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns paginated results", async () => {
      const { POST, GET } = await importRoute();
      const originalSecret = process.env.ADMIN_SECRET;
      process.env.ADMIN_SECRET = "test-secret-123";

      try {
        // Insert 3 feedbacks
        for (let i = 0; i < 3; i++) {
          const body = makeFeedbackBody({ id: `paginate-${i}` });
          const req = await makeNextRequest("POST", body);
          await POST(req);
        }

        // Get page 1, limit 2
        const req = await makeNextRequest("GET", undefined, {
          page: "1",
          limit: "2",
          secret: "test-secret-123",
        });
        const res = await GET(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.feedbacks).toHaveLength(2);
        expect(json.page).toBe(1);
        expect(json.limit).toBe(2);
        expect(json.total).toBeGreaterThanOrEqual(3);

        // Get page 2
        const req2 = await makeNextRequest("GET", undefined, {
          page: "2",
          limit: "2",
          secret: "test-secret-123",
        });
        const res2 = await GET(req2);
        const json2 = await res2.json();

        expect(json2.feedbacks.length).toBeGreaterThanOrEqual(1);
        expect(json2.page).toBe(2);
      } finally {
        process.env.ADMIN_SECRET = originalSecret;
      }
    });

    it("clamps limit to MAX_PAGE_LIMIT (500)", async () => {
      const { GET } = await importRoute();
      const originalSecret = process.env.ADMIN_SECRET;
      process.env.ADMIN_SECRET = "test-secret-123";

      try {
        const req = await makeNextRequest("GET", undefined, {
          limit: "9999",
          secret: "test-secret-123",
        });
        const res = await GET(req);
        const json = await res.json();

        expect(json.limit).toBe(500);
      } finally {
        process.env.ADMIN_SECRET = originalSecret;
      }
    });

    it("handles invalid page/limit params gracefully", async () => {
      const { GET } = await importRoute();
      const originalSecret = process.env.ADMIN_SECRET;
      process.env.ADMIN_SECRET = "test-secret-123";

      try {
        const req = await makeNextRequest("GET", undefined, {
          page: "abc",
          limit: "xyz",
          secret: "test-secret-123",
        });
        const res = await GET(req);
        const json = await res.json();

        // Should fall back to defaults, not NaN
        expect(json.page).toBe(1);
        expect(json.limit).toBe(100);
        expect(json.success).toBe(true);
      } finally {
        process.env.ADMIN_SECRET = originalSecret;
      }
    });

    it("accepts Bearer token in Authorization header", async () => {
      const { GET } = await importRoute();
      const originalSecret = process.env.ADMIN_SECRET;
      process.env.ADMIN_SECRET = "bearer-test-secret";

      try {
        const req = await makeNextRequest(
          "GET",
          undefined,
          {},
          { authorization: "Bearer bearer-test-secret" },
        );
        const res = await GET(req);
        expect(res.status).toBe(200);
      } finally {
        process.env.ADMIN_SECRET = originalSecret;
      }
    });
  });
});
