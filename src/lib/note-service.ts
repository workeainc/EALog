import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  deleteDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { toDateString } from "./date";
import type { NoteType, ProjectNote, TodoPriority } from "../types/tracker";

const noteTypes = ["important", "message", "information", "status"] as const;
const notesRef = (uid: string) => collection(db, "users", uid, "notes");
const cleanTitle = (value: string) => {
  const result = value.trim().replace(/\s+/g, " ");
  if (!result || result.length > 160) throw new Error("Note title must be between 1 and 160 characters.");
  return result;
};
const cleanContent = (value: string) => {
  const result = value.trim();
  if (!result || result.length > 5000) throw new Error("Note content must be between 1 and 5,000 characters.");
  return result;
};
const asNote = (id: string, data: Record<string, unknown>, pendingSync = false): ProjectNote => ({
  id,
  projectId: typeof data.projectId === "string" ? data.projectId : "",
  title: cleanTitle(typeof data.title === "string" ? data.title : "Untitled note"),
  content: typeof data.content === "string" ? data.content : "",
  type: noteTypes.includes(data.type as NoteType) ? data.type as NoteType : "information",
  pinned: Boolean(data.pinned),
  state: data.state === "archived" ? "archived" : "active",
  convertedTaskId: typeof data.convertedTaskId === "string" ? data.convertedTaskId : null,
  createdAt: (data.createdAt as ProjectNote["createdAt"]) || null,
  updatedAt: (data.updatedAt as ProjectNote["updatedAt"]) || null,
  pendingSync,
});

export const subscribeToNotes = (uid: string, callback: (notes: ProjectNote[]) => void): Unsubscribe =>
  onSnapshot(query(notesRef(uid), orderBy("updatedAt", "desc")), { includeMetadataChanges: true }, (snapshot) => {
    callback(snapshot.docs.map((item) => asNote(item.id, item.data(), item.metadata.hasPendingWrites)).sort((a, b) => Number(b.pinned) - Number(a.pinned)));
  });

export const createNote = (uid: string, input: { projectId: string; title: string; content: string; type: NoteType; pinned?: boolean }) =>
  setDoc(doc(notesRef(uid)), {
    projectId: input.projectId,
    title: cleanTitle(input.title),
    content: cleanContent(input.content),
    type: noteTypes.includes(input.type) ? input.type : "information",
    pinned: Boolean(input.pinned),
    state: "active",
    convertedTaskId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateNote = (uid: string, noteId: string, patch: Partial<Pick<ProjectNote, "title" | "content" | "type" | "pinned" | "state">>) => {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.content !== undefined) data.content = cleanContent(patch.content);
  if (patch.type !== undefined && noteTypes.includes(patch.type)) data.type = patch.type;
  if (patch.pinned !== undefined) data.pinned = patch.pinned;
  if (patch.state !== undefined) data.state = patch.state;
  return setDoc(doc(notesRef(uid), noteId), data, { merge: true });
};

export const deleteNote = (uid: string, noteId: string) => deleteDoc(doc(notesRef(uid), noteId));

/** Atomic task creation and linking prevents a note being converted twice. */
export const convertNoteToTask = async (uid: string, note: ProjectNote, input: { title: string; priority: TodoPriority; plannedDateString: string }) => {
  const noteRef = doc(notesRef(uid), note.id);
  const taskRef = doc(collection(db, "users", uid, "todos"));
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(noteRef);
    if (!snapshot.exists()) throw new Error("This note no longer exists.");
    if (snapshot.data().convertedTaskId) throw new Error("This note is already linked to a task.");
    transaction.set(taskRef, {
      title: cleanTitle(input.title), projectId: note.projectId, plannedDateString: toDateString(new Date(`${input.plannedDateString}T12:00:00`)),
      status: "open", priority: input.priority, sortOrder: Date.now(), completedAt: null, completedDateString: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMutationId: crypto.randomUUID(),
    });
    transaction.update(noteRef, { convertedTaskId: taskRef.id, updatedAt: serverTimestamp() });
  });
  return taskRef.id;
};
