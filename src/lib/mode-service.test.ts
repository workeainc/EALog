import { describe, expect, it } from "vitest";
import { effectiveAppMode } from "./mode-service";

describe("effectiveAppMode", () => {
  it("only activates vacation within its inclusive planned date range", () => {
    const mode = { mode: "vacation" as const, vacationStartDate: "2026-09-15", vacationEndDate: "2026-09-20" };
    expect(effectiveAppMode(mode, "2026-09-14")).toBe("workday");
    expect(effectiveAppMode(mode, "2026-09-15")).toBe("vacation");
    expect(effectiveAppMode(mode, "2026-09-20")).toBe("vacation");
    expect(effectiveAppMode(mode, "2026-09-21")).toBe("workday");
  });

  it("returns to workday after a timed break expires", () => {
    expect(effectiveAppMode({ mode: "break", breakExpectedEndAt: "2026-09-10T10:00:00.000Z" }, "2026-09-10", Date.parse("2026-09-10T10:01:00.000Z"))).toBe("workday");
  });
});
