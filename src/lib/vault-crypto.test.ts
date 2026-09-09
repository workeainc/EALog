import { describe, expect, it } from "vitest";
import { createVaultMeta, decryptVaultValue, deriveVaultKey, encryptVaultValue, newVaultKdf, verifyVaultKey } from "./vault-crypto";

describe("vault crypto", () => {
  it("round-trips values without leaving plaintext in its envelope", async () => {
    const key = await deriveVaultKey("a sufficiently long master password", newVaultKdf());
    const secret = { site: "Example Portal", password: "fixture-secret-value", email: "private@example.test" };
    const envelope = await encryptVaultValue("user-a", "record-a", key, secret);
    expect(JSON.stringify(envelope)).not.toContain(secret.site);
    expect(JSON.stringify(envelope)).not.toContain(secret.password);
    expect(await decryptVaultValue("user-a", "record-a", key, envelope)).toEqual(secret);
  });

  it("uses a fresh IV and rejects wrong password or swapped record context", async () => {
    const kdf = newVaultKdf(); const key = await deriveVaultKey("a sufficiently long master password", kdf);
    const first = await encryptVaultValue("user-a", "record-a", key, { value: "one" }); const second = await encryptVaultValue("user-a", "record-a", key, { value: "two" });
    expect(first.iv).not.toBe(second.iv);
    await expect(decryptVaultValue("user-a", "record-b", key, first)).rejects.toThrow("Unable to unlock");
    const other = await deriveVaultKey("a different sufficiently long password", kdf);
    await expect(decryptVaultValue("user-a", "record-a", other, first)).rejects.toThrow("Unable to unlock");
  });

  it("creates a verifier that only the Master Password can unlock", async () => {
    const { meta } = await createVaultMeta("user-a", "a sufficiently long master password");
    await expect(verifyVaultKey("user-a", "a sufficiently long master password", { ...meta, createdAt: null, updatedAt: null })).resolves.toBeDefined();
    await expect(verifyVaultKey("user-a", "a different sufficiently long password", { ...meta, createdAt: null, updatedAt: null })).rejects.toThrow("Unable to unlock");
  });
});
