const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..");
const context = vm.createContext({
  Archive: { config: () => null },
  ContractTemplates: { find: () => null },
  URL: { createObjectURL: () => "" },
  document: { createElement: () => ({ click() {} }) },
  setTimeout() {},
});
for (const file of ["contract-math.js", "excel-export.js"]) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), "utf8"), context);
}
const sheet = vm.runInContext(`
  let worksheet;
  ExcelExport.zip = files => { worksheet = files["xl/worksheets/sheet1.xml"]; };
  ExcelExport.save(["10,000,000", "١٠٬٠٠٠٬٠٠٠", "۱۰.۰۰۰.۰۰۰", "0", "invalid"].map(total => ({
    data: { total, contractType: "cash", cashReceived: "2000000" },
  })));
  worksheet;
`, context);
const numeric = (cell, value) => assert(sheet.includes('<c r="' + cell + '" t="n"><v>' + value + '</v></c>'));
for (const row of [2, 3, 4]) {
  numeric("F" + row, 10000000);
  numeric("G" + row, 8000000);
}
numeric("F5", 0);
for (const cell of ["F6", "G6"]) {
  assert(sheet.includes('<c r="' + cell + '" t="inlineStr"><is><t></t></is></c>'));
}
console.log("PASS Excel amounts in Latin, Arabic and Persian digits, zero, and invalid cells");
