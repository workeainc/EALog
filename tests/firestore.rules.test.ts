import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFile } from "node:fs/promises";

let testEnv: RulesTestEnvironment;
const projectId = "ea-log-rules-test";
const ownerId = "owner-user";
const otherId = "other-user";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8088,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

describe("Firestore owner rules", () => {
  it("allows a signed-in owner to create and read their Todo", async () => {
    const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
    const todo = doc(ownerDb, `users/${ownerId}/todos/todo-1`);
    await assertSucceeds(
      setDoc(todo, {
        title: "Finish project dashboard",
        projectId: "ea-log",
        plannedDateString: "2026-09-09",
        status: "open",
        priority: "high",
        sortOrder: 1,
        completedAt: null,
        completedDateString: null,
      }),
    );
    await assertSucceeds(getDoc(todo));
  });

  it("denies a different signed-in user access to another owner’s Todo", async () => {
    const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
    await assertSucceeds(
      setDoc(doc(ownerDb, `users/${ownerId}/todos/private-todo`), {
        title: "Private task",
        plannedDateString: "2026-09-09",
        status: "open",
        priority: "medium",
        sortOrder: 2,
      }),
    );
    const otherDb = testEnv.authenticatedContext(otherId).firestore();
    await assertFails(
      getDoc(doc(otherDb, `users/${ownerId}/todos/private-todo`)),
    );
    await assertFails(
      setDoc(doc(otherDb, `users/${ownerId}/todos/foreign-write`), {
        title: "Should not write",
      }),
    );
  });

  it("denies unauthenticated reads and writes", async () => {
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(anonymousDb, `users/${ownerId}/todos/private-todo`)),
    );
    await assertFails(
      setDoc(doc(anonymousDb, `users/${ownerId}/todos/no-auth`), {
        title: "Should not write",
      }),
    );
  });

  it("keeps Vault metadata and encrypted items owner-only", async () => {
    const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
    const meta = doc(ownerDb, `users/${ownerId}/vault_meta/default`);
    const item = doc(ownerDb, `users/${ownerId}/vault_items/vault-item-1`);
    await assertSucceeds(setDoc(meta, { schemaVersion: 1, kdf: { name: "PBKDF2" }, verifier: { ciphertext: "encrypted" } }));
    await assertSucceeds(setDoc(item, { schemaVersion: 1, iv: "nonce", ciphertext: "encrypted" }));
    const otherDb = testEnv.authenticatedContext(otherId).firestore();
    await assertFails(getDoc(doc(otherDb, `users/${ownerId}/vault_meta/default`)));
    await assertFails(getDoc(doc(otherDb, `users/${ownerId}/vault_items/vault-item-1`)));
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymousDb, `users/${ownerId}/vault_items/vault-item-1`)));
  });
});
