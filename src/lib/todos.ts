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

export type TodoDayStats = {
  planned: number;
  completed: number;
  open: number;
  overdue: number;
  completionPercent: number;
};

export const buildTodoDayStats = (
  todos: Todo[],
  date: string,
): TodoDayStats => {
  const planned = todos.filter((todo) => todo.plannedDateString === date);
  const completed = planned.filter(
    (todo) => todo.status === "completed",
  ).length;
  return {
    planned: planned.length,
    completed,
    open: planned.length - completed,
    overdue: todos.filter(
      (todo) => todo.status === "open" && todo.plannedDateString < date,
    ).length,
    completionPercent: planned.length
      ? Math.round((completed / planned.length) * 100)
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
