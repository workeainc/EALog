import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import { decryptVaultValue, encryptVaultValue, isVaultRecord } from "./vault-crypto";
import type { VaultEnvelope, VaultMeta, VaultRecord } from "../types/vault";

const metaRef = (uid: string) => doc(db, "users", uid, "vault_meta", "default");
const itemsRef = (uid: string) => collection(db, "users", uid, "vault_items");
const asMeta = (data: Record<string, unknown>): VaultMeta | null => {
  const kdf = data.kdf as VaultMeta["kdf"] | undefined; const verifier = data.verifier as VaultMeta["verifier"] | undefined;
  return data.schemaVersion === 1 && kdf?.name === "PBKDF2" && kdf.hash === "SHA-256" && Number.isFinite(kdf.iterations) && typeof kdf.salt === "string" && verifier?.schemaVersion === 1 && typeof verifier.iv === "string" && typeof verifier.ciphertext === "string" ? { schemaVersion: 1, kdf, verifier, createdAt: (data.createdAt as VaultMeta["createdAt"]) || null, updatedAt: (data.updatedAt as VaultMeta["updatedAt"]) || null } : null;
};
const asEnvelope = (data: Record<string, unknown>, pendingSync: boolean): VaultEnvelope | null => data.schemaVersion === 1 && typeof data.iv === "string" && typeof data.ciphertext === "string" ? { schemaVersion: 1, iv: data.iv, ciphertext: data.ciphertext, createdAt: (data.createdAt as VaultEnvelope["createdAt"]) || null, updatedAt: (data.updatedAt as VaultEnvelope["updatedAt"]) || null, pendingSync } : null;

export async function getVaultMeta(uid: string) { const snapshot = await getDoc(metaRef(uid)); return snapshot.exists() ? asMeta(snapshot.data()) : null; }
export const saveVaultMeta = (uid: string, meta: Omit<VaultMeta, "createdAt" | "updatedAt">) => setDoc(metaRef(uid), { ...meta, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const subscribeToVaultEnvelopes = (uid: string, callback: (items: Array<{ id: string; envelope: VaultEnvelope }>) => void): Unsubscribe => onSnapshot(query(itemsRef(uid), orderBy("updatedAt", "desc")), { includeMetadataChanges: true }, (snapshot) => callback(snapshot.docs.flatMap((item) => { const envelope = asEnvelope(item.data(), item.metadata.hasPendingWrites); return envelope ? [{ id: item.id, envelope }] : []; })));
export async function decryptVaultRecords(uid: string, key: CryptoKey, items: Array<{ id: string; envelope: VaultEnvelope }>): Promise<VaultRecord[]> { const decrypted = await Promise.all(items.map(async ({ id, envelope }) => { const value = await decryptVaultValue<unknown>(uid, id, key, envelope); if (!isVaultRecord(value) || value.id !== id) throw new Error("A Vault record could not be verified."); return value; })); return decrypted.sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveVaultRecord(uid: string, key: CryptoKey, record: VaultRecord) { const envelope = await encryptVaultValue(uid, record.id, key, record); await setDoc(doc(itemsRef(uid), record.id), { ...envelope, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }); }
export const deleteVaultRecord = (uid: string, id: string) => deleteDoc(doc(itemsRef(uid), id));
export const newVaultRecordId = () => crypto.randomUUID();
