const ArchiveOutput = {
  entry: null,
  file: null,
  url: "",
  // Document rendering uses the archived company and template for this entry.
  // Restore the live form before yielding to any input, storage or image event.
  papers(entry, face, printing = false, mode = PrintPlan.mode()) {
    const live = {
      cfg,
      d,
      ctx,
      entries: Schedule.entries,
      errors: Services.formulaErrors,
      tableParents: new Map(SmartTables.parents),
    };
    try {
      const issued = Archive.issued(entry);
      if (entry.snapshot) throw Error("استخدم نسخة الإصدار المحفوظة.");
      const config = Archive.config(entry);
      if (issued && !config?.design) throw Error("لا توجد نسخة أصلية محفوظة لهذا العقد.");
      cfg = clone(config);
      d = normalizeData(entry.data);
      if (printing && !issued && !entry.configKey)
        Services.stamp(d);
      // Before cash templates existed, “cash” was an archive tag on the
      // installment form. Reprints must use the form captured at that time.
      if (
        (entry.configKey || entry.config) &&
        cfg.design &&
        !cfg.design.cashTemplate &&
        entry.data.contractType === "cash" &&
        entry.data.cashReceived == null
      ) {
        d.contractType = "installment";
      }
      const scene = ContractTemplates.scoped(cfg.design || App.scene);
      const transferKey = d.contractType + "TransferLetter";
      if (entry.kind !== "draft" && TransferLetter.paymentContract(d) &&
          !Object.hasOwn(entry.data, transferKey)) {
        d[transferKey] = !!scene.transferLetter && !d.skipTransferLetter;
      }
      const savedDesign = issued || entry.configKey || entry.config?.design;
      if (!savedDesign) Services.upgradeScene(scene);
      const { papers } = App.documentPages(
        scene,
        false,
        (id) => (face ? id === (d.standaloneBook ? Number(d.standaloneBook) : 1) : Schedule.enabled(id)),
        !!savedDesign,
      );
      if (!papers.childElementCount)
        throw Error("لم تُحدّد صفحات للعقد " + d.number);
      if (printing)
        papers.replaceChildren(
          ...PrintPlan.arrange(
            papers.children,
            d,
            face,
            issued ? cfg.printSides || mode : mode,
            scene,
          ),
        );
      return papers;
    } finally {
      SmartTables.parents = live.tableParents;
      cfg = live.cfg;
      d = live.d;
      ctx = live.ctx;
      Schedule.entries = live.entries;
      Services.formulaErrors = live.errors;
    }
  },
  clearViewer() {
    $("archiveViewBody").replaceChildren();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.entry = null;
    this.file = null;
    this.printFrame = null;
    this.rows = [];
    this.face = false;
  },
  show(title, entry) {
    this.clearViewer();
    $("archivePrintSides").disabled = !!entry && Archive.issued(entry);
    $("archivePrintSides").value = Archive.config(entry || {})?.printSides || PrintPlan.mode();
    $("archivePrintSides").onchange = (e) => {
      $("printSides").value = e.target.value;
      cfg.printSides = e.target.value;
      this.printFrame = null;
      scheduleConfig();
    };
    this.entry = entry;
    this.rows = entry ? [entry] : [];
    $("viewTitle").textContent = title;
    $("viewEdit").hidden = !entry || Archive.issued(entry) || !!Archive.signed(entry);
    $("viewCopy").hidden = !entry;
    $("viewEdit").textContent =
      entry?.kind === "draft" ? "إكمال العقد" : "فتح للتعديل";
    if (!$("archiveViewer").open) $("archiveViewer").showModal();
  },
  async view(entry) {
    const signed = Archive.signed(entry);
    const title =
      (entry.data.externalSeller || entry.data.buyer || "عقد") +
      " · " +
      entry.data.number;
    if (signed || entry.snapshot) {
      const file = await this.build([entry], false);
      this.show(title + (signed ? " · النسخة الموقّعة" : ""), entry);
      this.displayPDF(file);
    } else if (Archive.issued(entry) && !Archive.config(entry)?.design) {
      this.show(title, entry);
      $("archiveViewBody").textContent = "النسخة الأصلية لهذا العقد غير محفوظة؛ يمكنك تصدير بيانات العقد فقط.";
    } else {
      const pages = this.papers(entry, false);
      this.show(title, entry);
      $("archiveViewBody").append(pages);
      const fit = Math.min(
        1,
        ($("archiveViewBody").clientWidth - 32) / (210 * MM),
      );
      for (const paper of $("archiveViewBody").children) paper.style.zoom = fit;
    }
  },
  async raster(paper, styles = WebResources.styles()) {
    await WebResources.embedImages(paper);
    // The browser shapes Arabic text and draws the same styled nodes as preview.
    const w = 210 * MM,
      h = 297 * MM,
      scale = 2.4;
    const root = document.createElement("div");
    const style = document.createElement("style");
    style.textContent =
      styles +
      ".paper{margin:0!important;box-shadow:none!important;zoom:1!important;display:block!important}.blank-image{visibility:hidden}";
    root.append(style, paper);
    const xhtml = new XMLSerializer().serializeToString(root);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      Math.round(w * scale) +
      '" height="' +
      Math.round(h * scale) +
      '" viewBox="0 0 ' +
      w +
      " " +
      h +
      '"><foreignObject width="100%" height="100%">' +
      xhtml +
      "</foreignObject></svg>";
    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.96),
    );
    if (!blob) throw Error("تعذّر تجهيز صفحة PDF.");
    return blob.arrayBuffer();
  },
  async appendPapers(pdf, papers, styles) {
    for (const paper of Array.from(papers)) {
      const page = pdf.addPage(PDFLib.PageSizes.A4);
      if (paper.dataset.blank) continue;
      const image = await pdf.embedJpg(await this.raster(paper, styles));
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
  },
  async snapshot(candidate) {
    const { papers, config, styles, data } = candidate;
    if (!papers?.length || !config) throw Error("تعذر التقاط نسخة الإصدار؛ أعد طباعة العقد.");
    await WebResources.pdf();
    const pdf = await PDFLib.PDFDocument.create();
    const faceId = data.standaloneBook || "1";
    const facePages = papers.flatMap((paper, index) => paper.dataset.page === faceId ? [index] : []);
    await this.appendPapers(pdf, papers.map(paper => paper.cloneNode(true)), styles);
    const blob = new Blob([await pdf.save()], { type: "application/pdf" });
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { config, pdf: url, facePages };
  },
  async appendSigned(pdf, url, face, facePages = [0]) {
    if (face && !facePages.length) throw Error("لم يُحفظ وجه هذا العقد ضمن نسخة الإصدار.");
    if (url.startsWith("data:application/pdf")) {
      const original = await PDFLib.PDFDocument.load(url);
      const pages = await pdf.copyPages(
        original,
        face ? facePages : original.getPageIndices(),
      );
      for (const page of pages) pdf.addPage(page);
    } else {
      const image = url.startsWith("data:image/png")
        ? await pdf.embedPng(url)
        : await pdf.embedJpg(url);
      const page = pdf.addPage(PDFLib.PageSizes.A4);
      const { width, height } = image.scaleToFit(
        page.getWidth(),
        page.getHeight(),
      );
      page.drawImage(image, {
        x: (page.getWidth() - width) / 2,
        y: (page.getHeight() - height) / 2,
        width,
        height,
      });
    }
  },
  async build(rows, face) {
    const mode = PrintPlan.mode();
    if (rows.length === 1 && !face) {
      const url = Archive.signed(rows[0]) || rows[0].snapshot?.pdf || "";
      if (url.startsWith("data:application/pdf"))
        return (await fetch(url)).blob();
    }
    await WebResources.pdf();
    const pdf = await PDFLib.PDFDocument.create();
    for (const [index, entry] of rows.entries()) {
      $("archiveStatus").textContent =
        "تجهيز العقد " + (index + 1) + " من " + rows.length + "…";
      try {
        if (index && mode === "duplex" && pdf.getPageCount() % 2)
          pdf.addPage(PDFLib.PageSizes.A4);
        const signed = Archive.signed(entry);
        if (signed) await this.appendSigned(pdf, signed, face);
        else if (entry.snapshot)
          await this.appendSigned(pdf, entry.snapshot.pdf, face, entry.snapshot.facePages);
        else await this.appendPapers(pdf, this.papers(entry, face, true, mode).children);
      } catch (error) {
        throw Error("العقد " + entry.data.number + " · " + error.message);
      }
    }
    $("archiveStatus").textContent = "";
    return new Blob([await pdf.save()], { type: "application/pdf" });
  },
  name(rows) {
    return rows.length === 1
      ? "عقد-" +
          String(rows[0].data.number).replace(/[<>:"/\\|?*]/g, "-") +
          ".pdf"
      : "العقود-المحددة.pdf";
  },
  async output(rows, action) {
    const face = action === "face" || action === "downloadFace";
    if (action.startsWith("download"))
      return download(
        this.name(rows),
        await this.build(rows, face),
        "application/pdf",
      );
    this.show(
      face ? "طباعة وجه العقود المحدّدة" : "طباعة العقود",
      rows.length === 1 ? rows[0] : null,
    );
    this.rows = rows;
    this.face = face;
    await this.printSheets(rows, face);
  },
  displayPDF(blob) {
    this.file = blob;
    this.url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.title = $("viewTitle").textContent;
    frame.src = this.url;
    $("archiveViewBody").replaceChildren(frame);
  },
  async reader() {
    if (!this.readerLoad) {
      this.readerLoad = import(
        WebResources.url("assets/vendor/pdfjs-4.10.38.mjs")
      )
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = WebResources.url("assets/vendor/pdfjs-worker-4.10.38.mjs");
          return lib;
        })
        .catch((e) => {
          this.readerLoad = null;
          throw e;
        });
    }
    return this.readerLoad;
  },
  async signedSheets(doc, url, face, facePages = [0]) {
    if (face && !facePages.length) throw Error("لم يُحفظ وجه هذا العقد ضمن نسخة الإصدار.");
    const add = (src) => {
      const sheet = doc.createElement("article"),
        img = doc.createElement("img");
      sheet.className = "paper signed-sheet";
      img.src = src;
      sheet.append(img);
      doc.body.append(sheet);
    };
    if (!url.startsWith("data:application/pdf")) return add(url);
    const lib = await this.reader();
    const pdf = await lib.getDocument({
      data: await (await fetch(url)).arrayBuffer(),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      const pages = face ? facePages : Array.from({ length: pdf.numPages }, (_, i) => i);
      for (const index of pages) {
        const page = await pdf.getPage(index + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(1850 / base.width, 2620 / base.height),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          intent: "print",
        }).promise;
        add(canvas.toDataURL("image/jpeg", 0.96));
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
  },
  async printSheets(rows, face) {
    const mode = PrintPlan.mode();
    const frame = document.createElement("iframe");
    frame.title = $("viewTitle").textContent;
    $("archiveViewBody").replaceChildren(frame);
    const doc = frame.contentDocument;
    doc.documentElement.lang = "ar";
    doc.documentElement.dir = "rtl";
    const style = doc.createElement("style");
    style.textContent =
      WebResources.styles() +
      "html,body{height:auto;overflow:auto}body{display:block;padding:12px;background:#dce3e2}.paper{display:block;margin:0 auto 12px}.signed-sheet img{display:block;width:100%;height:100%;object-fit:contain}.blank-image{visibility:hidden}@media print{html,body{margin:0!important;padding:0!important}.paper{translate:none!important;margin:0!important}}";
    doc.head.append(style);
    for (const entry of rows) {
      if (mode === "duplex" && doc.body.children.length % 2) {
        const blank = doc.createElement("article");
        blank.className = "paper print-blank";
        doc.body.append(blank);
      }
      const signed = Archive.signed(entry);
      if (signed) await this.signedSheets(doc, signed, face);
      else if (entry.snapshot)
        await this.signedSheets(doc, entry.snapshot.pdf, face, entry.snapshot.facePages);
      else doc.body.append(this.papers(entry, face, true, mode));
    }
    await Promise.all([...doc.images].map((img) => img.decode()));
    await WebResources.loadDocumentFont(doc);
    await doc.fonts.ready;
    if (!frame.isConnected || PrintPlan.mode() !== mode) return;
    this.printFrame = frame;
    this.printFile();
  },
  printFile() {
    if (this.printFrame) {
      this.printFrame.contentWindow.focus();
      this.printFrame.contentWindow.print();
    }
  },
  downloadFile() {
    if (this.file)
      download(
        this.entry ? this.name([this.entry]) : "العقود-المحددة.pdf",
        this.file,
        "application/pdf",
      );
  },
};
