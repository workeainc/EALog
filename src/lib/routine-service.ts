import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import type { Routine, RoutineCategory, RoutineLog, RoutineStatus } from "../types/tracker";
const routinesRef = (uid: string) => collection(db, "users", uid, "routines");
const logsRef = (uid: string) => collection(db, "users", uid, "routine_logs");
const asRoutine = (id: string, value: any): Routine => ({ id, name: String(value.name || "Routine"), category: value.category || "personal", priority: ["critical", "high", "normal"].includes(value.priority) ? value.priority : "normal", time: value.time || "09:00", durationMinutes: Number(value.durationMinutes || 15), windowMinutes: Number(value.windowMinutes || 15), repeatDays: Array.isArray(value.repeatDays) ? value.repeatDays : [0,1,2,3,4,5,6], reminderMinutes: Number(value.reminderMinutes || 5), sessionBehavior: value.sessionBehavior === "pause" ? "pause" : "warn", strict: Boolean(value.strict), active: value.active !== false, effectiveDate: typeof value.effectiveDate === "string" ? value.effectiveDate : undefined, endDate: typeof value.endDate === "string" ? value.endDate : undefined, createdAt: value.createdAt || null, updatedAt: value.updatedAt || null });
export const subscribeToRoutines = (uid: string, callback: (items: Routine[]) => void, onError?: (error: Error) => void): Unsubscribe => onSnapshot(query(routinesRef(uid), orderBy("time")), snap => callback(snap.docs.map(item => asRoutine(item.id, item.data()))), onError);
export const subscribeToRoutineLogs = (uid: string, callback: (items: RoutineLog[]) => void, onError?: (error: Error) => void): Unsubscribe => onSnapshot(logsRef(uid), snap => callback(snap.docs.map(item => ({ id: item.id, ...item.data() } as RoutineLog))), onError);
export const saveRoutine = (uid: string, input: Omit<Routine, "id" | "createdAt" | "updatedAt">, id?: string) => setDoc(
  id ? doc(routinesRef(uid), id) : doc(routinesRef(uid)),
  { ...input, ...(id ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp() },
  { merge: true },
);
/** Write the default routine plan atomically, using stable ids to avoid duplicates. */
export const restoreRoutinePlan = (
  uid: string,
  items: Array<{ id: string; input: Omit<Routine, "id" | "createdAt" | "updatedAt">; exists?: boolean }>,
  existingRoutines: Routine[] = [],
  existingLogs: RoutineLog[] = [],
) => {
  const batch = writeBatch(db);
  let removed = 0;
  items.forEach(({ id, input, exists }) => {
    batch.set(doc(routinesRef(uid), id), {
      ...input,
      ...(exists ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    // Old restores used random document ids. Only collapse records that are
    // an exact match for this default plan item; unrelated custom routines
    // with a similar name remain untouched.
    const duplicates = existingRoutines.filter((routine) =>
      routine.id !== id &&
      routine.name === input.name &&
      routine.effectiveDate === input.effectiveDate &&
      routine.endDate === input.endDate,
    );
    duplicates.forEach((duplicate) => {
      existingLogs.filter((log) => log.routineId === duplicate.id).forEach((log) => {
        const targetId = `${id}-${log.dateString}`;
        const targetExists = existingLogs.some((current) => current.id === targetId);
        if (!targetExists) {
          const { id: _id, ...data } = log;
          batch.set(doc(logsRef(uid), targetId), { ...data, routineId: id }, { merge: true });
        }
        batch.delete(doc(logsRef(uid), log.id));
      });
      batch.delete(doc(routinesRef(uid), duplicate.id));
      removed += 1;
    });
  });
  return batch.commit().then(() => ({ removed }));
};
export const logRoutine = (uid: string, routineId: string, dateString: string, status: RoutineStatus, patch: Partial<RoutineLog> = {}) => setDoc(doc(logsRef(uid), `${routineId}-${dateString}`), {
  routineId,
  dateString,
  status,
  completedAt: status === "completed" ? serverTimestamp() : null,
  ...(status === "completed" ? { completionKind: patch.completionKind || "on_time" } : {}),
  statusChangedAt: serverTimestamp(),
  ...patch,
}, { merge: true });

/** Recover a past routine without moving it out of the day it was scheduled. */
export const completeRoutineLate = (uid: string, routineId: string, dateString: string, completedAt: Date, completionNote = "") =>
  logRoutine(uid, routineId, dateString, "completed", {
    completionKind: "late",
    completedAt: Timestamp.fromDate(completedAt),
    ...(completionNote.trim() ? { completionNote: completionNote.trim() } : {}),
  });
