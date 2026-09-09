import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { toDateString } from "./date";
import type { ProjectId, Todo, TodoPriority } from "../types/tracker";

const todosRef = (uid: string) => collection(db, "users", uid, "todos");
const priorities = ["low", "medium", "high"] as const;
const dateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const cleanTitle = (value: unknown) => {
  const title =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 240)
    throw new Error("Task title must be between 1 and 240 characters.");
  return title;
};
const mutationId = () => crypto.randomUUID();
const asTodo = (
  id: string,
  data: Record<string, any>,
  pendingSync = false,
): Todo => ({
  id,
  title: cleanTitle(data.title),
  projectId:
    typeof data.projectId === "string" && data.projectId
      ? data.projectId
      : null,
  plannedDateString: dateKey(data.plannedDateString)
    ? data.plannedDateString
    : toDateString(),
  status: data.status === "completed" ? "completed" : "open",
  priority: priorities.includes(data.priority) ? data.priority : "medium",
  sortOrder: Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : 0,
  completedAt: data.completedAt || null,
  completedDateString: dateKey(data.completedDateString)
    ? data.completedDateString
    : null,
  createdAt: data.createdAt || null,
  updatedAt: data.updatedAt || null,
  lastMutationId:
    typeof data.lastMutationId === "string" ? data.lastMutationId : "",
  sourceNoteId: typeof data.sourceNoteId === "string" ? data.sourceNoteId : null,
  sourceTextHash: typeof data.sourceTextHash === "string" ? data.sourceTextHash : null,
  sourceNoteTitle: typeof data.sourceNoteTitle === "string" ? data.sourceNoteTitle : null,
  pendingSync,
});

const subscribe = (
  source: ReturnType<typeof query>,
  callback: (todos: Todo[]) => void,
): Unsubscribe =>
  onSnapshot(source, { includeMetadataChanges: true }, (snapshot) =>
    callback(
      snapshot.docs.map((item) =>
        asTodo(
          item.id,
          item.data() as Record<string, any>,
          item.metadata.hasPendingWrites,
        ),
      ),
    ),
  );

/** Tasks planned for a date range. This powers plan completion. */
export const subscribeToTodosPlannedForRange = (
  uid: string,
  from: string,
  to: string,
  callback: (todos: Todo[]) => void,
) =>
  subscribe(
    query(
      todosRef(uid),
      where("plannedDateString", ">=", from),
      where("plannedDateString", "<=", to),
      orderBy("plannedDateString", "asc"),
      orderBy("sortOrder", "asc"),
    ),
    callback,
  );

/** Every unresolved historical task, independent of the visible planned range. */
export const subscribeToOpenOverdueTodos = (
  uid: string,
  today: string,
  callback: (todos: Todo[]) => void,
) =>
  subscribe(
    query(
      todosRef(uid),
      where("status", "==", "open"),
      where("plannedDateString", "<", today),
      orderBy("plannedDateString", "asc"),
      orderBy("sortOrder", "asc"),
    ),
    callback,
  );

/** Open tasks for session completion; no date window so a project task never disappears from End Session. */
export const subscribeToOpenTodos = (
  uid: string,
  callback: (todos: Todo[]) => void,
) => subscribe(query(todosRef(uid), where("status", "==", "open")), callback);

/** Tasks actually completed in a date range. This powers real productivity metrics. */
export const subscribeToTodosCompletedForRange = (
  uid: string,
  from: string,
  to: string,
  callback: (todos: Todo[]) => void,
) =>
  subscribe(
    query(
      todosRef(uid),
      where("completedDateString", ">=", from),
      where("completedDateString", "<=", to),
      orderBy("completedDateString", "asc"),
      orderBy("sortOrder", "asc"),
    ),
    callback,
  );

export async function createTodo(
  uid: string,
  input: {
    title: string;
    projectId?: ProjectId | null;
    plannedDateString: string;
    priority?: TodoPriority;
    sortOrder?: number;
  },
): Promise<void> {
  if (!dateKey(input.plannedDateString))
    throw new Error("Choose a valid planned date.");
  await setDoc(doc(todosRef(uid)), {
    title: cleanTitle(input.title),
    projectId: input.projectId || null,
    plannedDateString: input.plannedDateString,
    status: "open",
    priority: priorities.includes(input.priority || "medium")
      ? input.priority || "medium"
      : "medium",
    sortOrder: Number.isFinite(input.sortOrder)
      ? Number(input.sortOrder)
      : Date.now(),
    completedAt: null,
    completedDateString: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMutationId: mutationId(),
  });
}

export async function updateTodo(
  uid: string,
  todoId: string,
  patch: Partial<
    Pick<
      Todo,
      "title" | "projectId" | "plannedDateString" | "priority" | "sortOrder"
    >
  >,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    lastMutationId: mutationId(),
  };
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.projectId !== undefined) data.projectId = patch.projectId || null;
  if (patch.plannedDateString !== undefined) {
    if (!dateKey(patch.plannedDateString))
      throw new Error("Choose a valid planned date.");
    data.plannedDateString = patch.plannedDateString;
  }
  if (patch.priority !== undefined) {
    if (!priorities.includes(patch.priority))
      throw new Error("Choose a valid priority.");
    data.priority = patch.priority;
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder))
    data.sortOrder = patch.sortOrder;
  await setDoc(doc(todosRef(uid), todoId), data, { merge: true });
}

export const toggleTodoComplete = (
  uid: string,
  todoId: string,
  completed: boolean,
  now = new Date(),
) =>
  setDoc(
    doc(todosRef(uid), todoId),
    {
      status: completed ? "completed" : "open",
      completedAt: completed ? serverTimestamp() : null,
      completedDateString: completed ? toDateString(now) : null,
      updatedAt: serverTimestamp(),
      lastMutationId: mutationId(),
    },
    { merge: true },
  );

export const deleteTodo = (uid: string, todoId: string) =>
  deleteDoc(doc(todosRef(uid), todoId));
