import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
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

  it("parses an Office-style XLSX workbook with shared strings", async () => {
    const file = new File([zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="Accounts" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Site</t></si><si><t>Password</t></si><si><t>Example</t></si><si><t>secret</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'),
    })], "accounts.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const [sheet] = await parseVaultImportFile(file);
    expect(sheet.category).toBe("Accounts");
    expect(sheet.rows).toEqual([{ Site: "Example", Password: "secret" }]);
  });

  it("supports Office workbooks that use an absolute worksheet relationship", async () => {
    const file = new File([zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="Absolute" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Site</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Portal</t></is></c></row></sheetData></worksheet>'),
    })], "absolute.xlsx");
    const [sheet] = await parseVaultImportFile(file);
    expect(sheet.rows).toEqual([{ Site: "Portal" }]);
  });
});
