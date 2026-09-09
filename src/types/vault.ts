import type { Timestamp } from "firebase/firestore";

/** Plaintext exists only while an unlocked VaultView is mounted in memory. */
export type VaultRecord = {
  id: string;
  category: string;
  fields: Record<string, string>;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Legacy manual entries stay readable; imports are encrypted workbooks. */
  kind?: "record" | "workbook";
  title?: string;
  sheets?: VaultSheet[];
};

export type VaultSheet = { id: string; name: string; headers: string[]; rows: Record<string, string>[] };

/** Firestore-safe envelope. It intentionally has no searchable plaintext metadata. */
export type VaultEnvelope = {
  schemaVersion: 1;
  iv: string;
  ciphertext: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  pendingSync?: boolean;
};

export type VaultKdf = { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
export type VaultMeta = { schemaVersion: 1; kdf: VaultKdf; verifier: Pick<VaultEnvelope, "schemaVersion" | "iv" | "ciphertext">; createdAt: Timestamp | null; updatedAt: Timestamp | null };
export type VaultImportSheet = { category: string; headers: string[]; rows: Record<string, string>[] };
