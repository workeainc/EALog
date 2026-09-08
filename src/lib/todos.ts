import type { Todo } from "../types/tracker";
import { toDateString } from "./date";

export const todoDateKey = (date = new Date()) => toDateString(date);

const priorityRank = { high: 0, medium: 1, low: 2 } as const;

export const sortTodos = (todos: Todo[]) =>
  [...todos].sort(
    (a, b) =>
      Number(a.status === "completed") - Number(b.status === "completed") ||
      priorityRank[a.priority] - priorityRank[b.priority] ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title),
  );

/** Merge independent Firestore query streams without rendering a Todo twice. */
export const mergeTodoStreams = (...streams: Todo[][]): Todo[] => {
  const byId = new Map<string, Todo>();
  for (const stream of streams) {
    for (const todo of stream) {
      const previous = byId.get(todo.id);
      byId.set(todo.id, {
        ...previous,
        ...todo,
        pendingSync: Boolean(previous?.pendingSync || todo.pendingSync),
      });
    }
  }
  return [...byId.values()];
};

export type TodoDayStats = {
  planned: number;
  completedFromPlan: number;
  completedOnDate: number;
  open: number;
  overdue: number;
  completionPercent: number;
};

export const buildTodoDayStats = (
  todos: Todo[],
  date: string,
): TodoDayStats => {
  const planned = todos.filter((todo) => todo.plannedDateString === date);
  const completedFromPlan = planned.filter(
    (todo) => todo.status === "completed",
  ).length;
  const completedOnDate = todos.filter(
    (todo) => todo.completedDateString === date,
  ).length;
  return {
    planned: planned.length,
    completedFromPlan,
    completedOnDate,
    open: planned.length - completedFromPlan,
    overdue: todos.filter(
      (todo) => todo.status === "open" && todo.plannedDateString < date,
    ).length,
    completionPercent: planned.length
      ? Math.round((completedFromPlan / planned.length) * 100)
      : 0,
  };
};

export const todosForProjectOnDate = (
  todos: Todo[],
  projectId: string,
  date: string,
) =>
  sortTodos(
    todos.filter(
      (todo) => todo.projectId === projectId && todo.plannedDateString === date,
    ),
  );
