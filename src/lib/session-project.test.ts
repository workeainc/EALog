import { describe, expect, it } from "vitest";
import {
  assertWorkLogMatchesActiveSession,
  projectIdFromActiveSession,
} from "./session-project";

describe("active session project invariant", () => {
  const active = { projectId: "alphapuls" };

  it("uses only the active session project id", () => {
    expect(projectIdFromActiveSession(active)).toBe("alphapuls");
  });

  it("allows a work log that preserves the active project", () => {
    expect(() =>
      assertWorkLogMatchesActiveSession(active, { projectId: "alphapuls" }),
    ).not.toThrow();
  });

  it("rejects a stale selected-project work log", () => {
    expect(() =>
      assertWorkLogMatchesActiveSession(active, { projectId: "ea-log" }),
    ).toThrow("Project mismatch");
  });
});
