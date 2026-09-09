import { describe, expect, it } from "vitest";
import { parseVaultImportFile } from "./vault-import";

describe("vault import", () => {
  it("uses the first CSV row as dynamic headers and makes duplicate headers unique", async () => {
    const file = new File(["Site,Email,Email,,Password\nPortal,me@example.test,backup@example.test,extra,secret"], "accounts.csv", { type: "text/csv" });
    const [sheet] = await parseVaultImportFile(file);
    expect(sheet.category).toBe("accounts");
    expect(sheet.headers).toEqual(["Site", "Email", "Email (2)", "Column 4", "Password"]);
    expect(sheet.rows).toEqual([{ Site: "Portal", Email: "me@example.test", "Email (2)": "backup@example.test", "Column 4": "extra", Password: "secret" }]);
  });

  it("rejects legacy workbook file formats instead of attempting unsafe parsing", async () => {
    const file = new File(["not a workbook"], "legacy.xls");
    await expect(parseVaultImportFile(file)).rejects.toThrow("CSV or .xlsx");
  });
});
