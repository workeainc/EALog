import { describe, expect, it } from "vitest";
import { buildTodoDayStats, sortTodos } from "./todos";
import { toDateString } from "./date";
import type { Todo } from "../types/tracker";

const task = (changes: Partial<Todo>): Todo => ({
  id: "task",
  title: "Task",
  projectId: "alpha",
  plannedDateString: "2026-09-09",
  status: "open",
  priority: "medium",
  sortOrder: 1,
  completedAt: null,
  completedDateString: null,
  createdAt: null,
  updatedAt: null,
  lastMutationId: "test",
  ...changes,
});

describe("Todo statistics", () => {
  it("keeps planned work on its original day after a later completion", () => {
    const todos = [
      task({ id: "a", status: "completed", completedDateString: "2026-09-10" }),
      task({ id: "b", title: "Next", plannedDateString: "2026-09-10" }),
    ];
    expect(buildTodoDayStats(todos, "2026-09-09")).toMatchObject({
      planned: 1,
      completedFromPlan: 1,
      completedOnDate: 0,
      open: 0,
    });
    expect(buildTodoDayStats(todos, "2026-09-10")).toMatchObject({
      planned: 1,
      completedFromPlan: 0,
      completedOnDate: 1,
      open: 1,
    });
  });

  it("counts earlier open tasks as overdue without moving them", () => {
    const todos = [
      task({ id: "old", plannedDateString: "2026-09-07" }),
      task({
        id: "done",
        plannedDateString: "2026-09-08",
        status: "completed",
      }),
    ];
    expect(buildTodoDayStats(todos, "2026-09-09")).toMatchObject({
      planned: 0,
      completedFromPlan: 0,
      overdue: 1,
      completionPercent: 0,
    });
  });

  it("sorts open high-priority work before completed work", () => {
    const sorted = sortTodos([
      task({ id: "complete", status: "completed", priority: "high" }),
      task({ id: "low", priority: "low" }),
      task({ id: "high", priority: "high" }),
    ]);
    expect(sorted.map((todo) => todo.id)).toEqual(["high", "low", "complete"]);
  });

  it("rejects invalid dates rather than creating an invalid calendar key", () => {
    expect(() => toDateString(new Date("not a date"))).toThrow("Invalid date");
  });
});
