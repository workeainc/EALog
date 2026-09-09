import type { VaultEnvelope, VaultKdf, VaultMeta, VaultRecord } from "../types/vault";

const encoder = new TextEncoder(); const decoder = new TextDecoder();
export const VAULT_SCHEMA_VERSION = 1 as const;
export const VAULT_KDF_ITERATIONS = 600_000;
const verifierText = "EA_LOG_VAULT_VERIFIER_V1";

const bytesToBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const aad = (uid: string, recordId: string) => encoder.encode(`ea-log:vault:v1:${uid}:${recordId}`);
export const newVaultKdf = (): VaultKdf => ({ name: "PBKDF2", hash: "SHA-256", iterations: VAULT_KDF_ITERATIONS, salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))) });

export async function deriveVaultKey(masterPassword: string, kdf: VaultKdf): Promise<CryptoKey> {
  if (masterPassword.length < 14) throw new Error("Use a Master Password with at least 14 characters.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(masterPassword), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: kdf.hash, salt: base64ToBytes(kdf.salt), iterations: kdf.iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptVaultValue(uid: string, recordId: string, key: CryptoKey, value: unknown): Promise<Pick<VaultEnvelope, "schemaVersion" | "iv" | "ciphertext">> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(uid, recordId), tagLength: 128 }, key, encoder.encode(JSON.stringify(value)));
  return { schemaVersion: VAULT_SCHEMA_VERSION, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptVaultValue<T>(uid: string, recordId: string, key: CryptoKey, envelope: Pick<VaultEnvelope, "schemaVersion" | "iv" | "ciphertext">): Promise<T> {
  if (envelope.schemaVersion !== VAULT_SCHEMA_VERSION) throw new Error("This Vault uses an unsupported encryption version.");
  try { const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: aad(uid, recordId), tagLength: 128 }, key, base64ToBytes(envelope.ciphertext)); return JSON.parse(decoder.decode(clear)) as T; } catch { throw new Error("Unable to unlock this Vault. Check your Master Password."); }
}

export async function createVaultMeta(uid: string, masterPassword: string): Promise<{ meta: Omit<VaultMeta, "createdAt" | "updatedAt">; key: CryptoKey }> {
  const kdf = newVaultKdf(); const key = await deriveVaultKey(masterPassword, kdf); const verifier = await encryptVaultValue(uid, "default", key, verifierText); return { key, meta: { schemaVersion: VAULT_SCHEMA_VERSION, kdf, verifier } };
}
export async function verifyVaultKey(uid: string, masterPassword: string, meta: VaultMeta): Promise<CryptoKey> { const key = await deriveVaultKey(masterPassword, meta.kdf); const value = await decryptVaultValue<string>(uid, "default", key, meta.verifier); if (value !== verifierText) throw new Error("Unable to unlock this Vault. Check your Master Password."); return key; }
export const isVaultRecord = (value: unknown): value is VaultRecord => { const record = value as Partial<VaultRecord>; return Boolean(record && typeof record.id === "string" && typeof record.category === "string" && record.fields && typeof record.fields === "object" && (record.projectId === null || typeof record.projectId === "string") && Number.isFinite(record.createdAt) && Number.isFinite(record.updatedAt)); };
