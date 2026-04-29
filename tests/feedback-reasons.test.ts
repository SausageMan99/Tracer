import { describe, expect, it } from "vitest";
import { FEEDBACK_REASON_OPTIONS, isFeedbackReason } from "@/lib/feedback-reasons";

describe("feedback reasons", () => {
  it("keeps feedback reasons as a small server-safe whitelist", () => {
    expect(FEEDBACK_REASON_OPTIONS.length).toBeGreaterThanOrEqual(5);
    expect(FEEDBACK_REASON_OPTIONS.length).toBeLessThanOrEqual(8);
    expect(FEEDBACK_REASON_OPTIONS.every((option) => isFeedbackReason(option.code))).toBe(true);
  });

  it("rejects arbitrary free-text values to avoid PII collection", () => {
    expect(isFeedbackReason("too_much_busy_road")).toBe(true);
    expect(isFeedbackReason("call me at 06 12 34 56 78")).toBe(false);
    expect(isFeedbackReason("https://example.com/my-route")).toBe(false);
    expect(isFeedbackReason(42)).toBe(false);
  });
});
