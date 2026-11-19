const ExcelExport = {
  zip(files) {
    const enc = new TextEncoder(),
      local = [],
      central = [];
    let offset = 0;
    const u16 = (v, n, x) => v.setUint16(n, x, true),
      u32 = (v, n, x) => v.setUint32(n, x >>> 0, true);
    for (const [name, text] of Object.entries(files)) {
      const bytes = enc.encode(text),
        filename = enc.encode(name);
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let j = 0; j < 8; j++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      const h = new Uint8Array(30 + filename.length),
        v = new DataView(h.buffer);
      u32(v, 0, 0x04034b50);
      u16(v, 4, 20);
      u32(v, 14, crc);
      u32(v, 18, bytes.length);
      u32(v, 22, bytes.length);
      u16(v, 26, filename.length);
      h.set(filename, 30);
      local.push(h, bytes);
      const c = new Uint8Array(46 + filename.length),
        cv = new DataView(c.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u32(cv, 16, crc);
      u32(cv, 20, bytes.length);
      u32(cv, 24, bytes.length);
      u16(cv, 28, filename.length);
      u32(cv, 42, offset);
      c.set(filename, 46);
      central.push(c);
      offset += h.length + bytes.length;
    }
    const end = new Uint8Array(22),
      e = new DataView(end.buffer);
    u32(e, 0, 0x06054b50);
    u16(e, 8, central.length);
    u16(e, 10, central.length);
    u32(
      e,
      12,
      central.reduce((n, c) => n + c.length, 0),
    );
    u32(e, 16, offset);
    return new Blob([...local, ...central, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  },
  save(entries) {
    const rows = [
      [
        "النوع",
        "اسم الزبون",
        "العدد",
        "التاريخ",
        "الشركة",
        "المبلغ",
        "المتبقي",
        "موقع",
        "الحالة",
      ],
      ...entries.map((e) => [
        e.data.standaloneBook ? e.data.bookTitle : ContractTemplates.find(e.data.templateId, Archive.config(e)?.design)?.name || e.data.contractType,
        e.data.buyer,
        e.data.number,
        e.data.contractDate,
        Archive.config(e)?.companies?.find((c) => c.id === e.data.companyId)?.name || "",
        amount(e.data.total),
        calculate(e.data).remaining,
        e.signedFile || e.data.signedFile ? "نعم" : "لا",
        e.kind === "printed" ? "مطبوع" : "معلق",
      ]),
    ];
    const xml = (s) =>
      String(s ?? "").replace(
        /[<>&"']/g,
        (c) =>
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
          })[c],
      );
    const sheet =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><cols><col min="1" max="9" width="24" customWidth="1"/></cols><sheetData>' +
      rows
        .map(
          (row, i) =>
            '<row r="' +
            (i + 1) +
            '">' +
            row
              .map(
                (value, j) =>
                  '<c r="' +
                  String.fromCharCode(65 + j) +
                  (i + 1) +
                  '" ' +
                  (Number.isFinite(value)
                    ? 't="n"><v>' + value + "</v>"
                    : 't="inlineStr"><is><t>' + xml(typeof value === "number" ? "" : value) + "</t></is>") +
                  "</c>",
              )
              .join("") +
            "</row>",
        )
        .join("") +
      '</sheetData><autoFilter ref="A1:I' +
      rows.length +
      '"/></worksheet>';
    const files = {
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml":
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الكشف" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": sheet,
    };
    const url = URL.createObjectURL(this.zip(files)),
      a = document.createElement("a");
    a.href = url;
    a.download = "كشف.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};
