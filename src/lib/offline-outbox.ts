/** A small, per-user IndexedDB outbox. Payloads must be structured-cloneable. */
export type OutboxStatus = "pending" | "failed" | "sent" | "conflict";
export interface OutboxCommand {
    operationId: string; uid: string; entityId: string;
    type: "start" | "pause" | "resume" | "stop"; payload: unknown;
    createdAt: number; attempts: number; status: OutboxStatus; error?: string;
}
const DB_NAME = "ea-log-outbox"; const STORE = "commands"; const VERSION = 1;
function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable; offline changes cannot be stored safely."));
        const request = indexedDB.open(DB_NAME, VERSION);
        request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: "operationId" }); store.createIndex("by_uid_created", ["uid", "createdAt"]); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
}
export async function enqueue(command: Omit<OutboxCommand, "attempts" | "status"> & Partial<Pick<OutboxCommand, "attempts" | "status">>): Promise<OutboxCommand> {
    const value = { ...command, attempts: command.attempts ?? 0, status: command.status ?? "pending" } as OutboxCommand;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE); const get = store.get(value.operationId);
        // Keep the original payload/order if a retry re-enqueues the same id.
        get.onsuccess = () => { if (!get.result) store.add(value); };
        tx.oncomplete = () => resolve((get.result as OutboxCommand | undefined) ?? value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
}
export async function listForUser(uid: string): Promise<OutboxCommand[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => { const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll(); request.onsuccess = () => resolve((request.result as OutboxCommand[]).filter((command) => command.uid === uid).sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId))); request.onerror = () => reject(request.error); });
}
export async function listReady(uid: string): Promise<OutboxCommand[]> { return (await listForUser(uid)).filter((command) => command.status === "pending" || command.status === "failed"); }
async function patch(operationId: string, changes: Partial<OutboxCommand>, incrementAttempt = false): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE); const get = store.get(operationId); get.onsuccess = () => { const current = get.result as OutboxCommand | undefined; if (current) store.put({ ...current, ...changes, attempts: current.attempts + (incrementAttempt ? 1 : 0) }); }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
export const markSent = (operationId: string) => patch(operationId, { status: "sent", error: undefined }, true);
export const markFailed = (operationId: string, error: string, conflict = false) => patch(operationId, { status: conflict ? "conflict" : "failed", error }, true);
export const retry = (operationId: string) => patch(operationId, { status: "pending", error: undefined });
export async function clearUser(uid: string): Promise<void> { const commands = await listForUser(uid); const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE); commands.forEach((command) => store.delete(command.operationId)); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
