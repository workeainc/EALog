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

const noteTypes = ["important", "message", "information", "status", "decision"] as const;
const notesRef = (uid: string) => collection(db, "users", uid, "notes");
const cleanTitle = (value: string) => {
  const result = value.trim().replace(/\s+/g, " ");
  if (!result || result.length > 160) throw new Error("Note title must be between 1 and 160 characters.");
  return result;
};
const cleanContent = (value: string) => {
  const result = value.trim();
  if (result.length > 5000) throw new Error("Note content must be at most 5,000 characters.");
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

export const hashNoteSourceText = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().replace(/\s+/g, " "))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
/** Same selected note context cannot create a duplicate task; other selections remain valid. */
export const convertNoteToTask = async (uid: string, note: ProjectNote, input: { title: string; priority: TodoPriority; plannedDateString: string; sourceText: string }) => {
  const hash = await hashNoteSourceText(input.sourceText);
  const taskRef = doc(collection(db, "users", uid, "todos"), `note-${note.id}-${hash}`);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(taskRef);
    if (snapshot.exists()) throw new Error("A task already exists for this selected note text.");
    transaction.set(taskRef, {
      title: cleanTitle(input.title), projectId: note.projectId, plannedDateString: toDateString(new Date(`${input.plannedDateString}T12:00:00`)),
      status: "open", priority: input.priority, sortOrder: Date.now(), completedAt: null, completedDateString: null,
      sourceNoteId: note.id, sourceTextHash: hash, sourceNoteTitle: note.title,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMutationId: crypto.randomUUID(),
    });
  });
  return taskRef.id;
};
