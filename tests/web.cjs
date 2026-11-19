const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const serve = require("./server.cjs");
const { PDFDocument } = require("../vendor/pdf-lib-1.17.1.min.js");
const results = [];
const output = path.resolve(__dirname, "../work/regression");
fs.mkdirSync(output, { recursive: true });

(async () => {
  const web = await serve(path.resolve(__dirname, "../dist"));
  const browser = await chromium.launch({
    channel: "msedge",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("favicon.ico"))
      failed.push(response.url());
  });
  const test = async (name, run) => {
    await run();
    results.push(name);
    console.log("PASS " + name);
  };
  try {
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    await test("clean web startup and lazy PDF dependencies", async () => {
      assert.deepEqual(await page.evaluate(() => Object.keys(seed)), [
        "config",
      ]);
      assert.equal(
        await page.evaluate(() => Services.library.entries.length),
        0,
      );
      assert.equal(await page.locator("#offlineEdition").count(), 1);
      assert.equal(
        await page
          .locator(
            "#offlineTemplate,#pdfReader,#pdfWorker,#embedded",
          )
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => typeof PDFLib), "undefined");
      assert.equal(
        await page.evaluate(() => document.documentElement.dir),
        "rtl",
      );
      assert(
        await page.evaluate(() => WebResources.styles().includes("@page")),
      );
    });
    await test("known test records are removed without deleting another archive", async () => {
      const isolated = await browser.newContext();
      try {
        const other = await isolated.newPage();
        await other.goto(web.url);
        await other.waitForFunction(() => startReady);
        const retained = await other.evaluate(async () => {
          const removed = {
            id: RemovedTestData.entryIds[0],
            kind: "draft",
            data: { recordId: RemovedTestData.recordIds[0] },
            signedFile: { dataUrl: "dummy-attachment" },
            configKey: "removed",
          };
          const keep = {
            id: "unrelated",
            kind: "draft",
            data: { recordId: "unrelated", buyer: "اختبار مستقل" },
            configKey: "keep",
          };
          await putDB("contractArchive", {
            entries: [removed, keep],
            configs: { removed: {}, keep: { marker: true } },
          });
          await putDB("draft", removed.data);
          await putDB("openWork", [removed.data, keep.data]);
          await removeTestArchives();
          const archive = await getDB("contractArchive");
          return {
            ids: archive.entries.map((entry) => entry.id),
            configs: Object.keys(archive.configs),
            draft: await getDB("draft"),
            open: (await getDB("openWork")).map((item) => item.recordId),
          };
        });
        assert.deepEqual(retained, {
          ids: ["unrelated"],
          configs: ["keep"],
          draft: null,
          open: ["unrelated"],
        });
      } finally {
        await isolated.close();
      }
    });
    if (await page.locator("#setupDialog").isVisible()) {
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupOrganizer").fill("اختبار");
      await page.locator("#setupPrefix").fill("Q");
      await page.locator("#setupForm button").click();
    }
    await page.locator("#workNew").click();
    await page.waitForFunction(() => !Services.home);
    await page.locator("#buyer").fill("مشتري تجريبي");
    await page.locator("#vin").fill("TESTVIN00000000001");
    await test("Arabic amounts, month anchors, and installment phases", async () => {
      const result = await page.evaluate(() => {
        Object.assign(d, {
          contractDate: "2026-11-12",
          contractTime: "10:30",
          manualContractDate: true,
          manualContractTime: true,
          car: "سيارة تجريبية",
          brand: "changan",
          total: "10000000",
          deposit: "2000000",
          depositDate: "2026-11-12",
          count: "8",
          payment: "1000000",
          firstDate: "2026-12-12",
          pages: [1],
          noWarranty: true,
        });
        buildInputs();
        render();
        saveDraft();
        const standard = calculate(d);
        const phased = calculate({
          ...d,
          phaseEnabled: true,
          phaseCount: "2",
          phasePayment: "500000",
          phaseSecondCount: "3",
          payment: "2000000",
        });
        const badCash = calculateCash({
          total: "1000", cashReceived: "100", contractDate: "2026-11-12",
          cashDueDate: "2027-02-29", cashSplit: true,
          cashPayments: [{ amount: "200", date: "2026-12-32" }],
        });
        const cashData = {
          total: "1000", deposit: "100", cashReceived: "100",
          cashPayments: [{ amount: "200", date: "2026-12-12" }],
          contractDate: "2026-11-12",
        };
        return {
          parsed: amount("٥٠٠٬٠٠٠"),
          invalid: Number.isNaN(amount("12x")),
          month: addMonths("2028-01-31", 1),
          nonLeapCentury: addMonths("2100-01-31", 1),
          earlyYear: addMonths("0099-12-31", 2),
          invalidDate: dateLabel("2027-02-29"),
          invalidAnchor: addMonths("2027-13-01", 1),
          dateOverflow: calculate({ ...d, firstDate: "9999-11-30" }).errors,
          invalidInstallment: calculate({ ...d, firstDate: "2027-02-29" }).errors,
          invalidPayment: calculate({ ...d, extras: [{amount: "1000", date: "2026-11-31"}] }).errors,
          invalidCash: badCash.errors,
          importedCashRemaining: calculate({ ...cashData, contractType: "cash" }).remaining,
          externalRemaining: calculate({ ...cashData, contractType: "external", cashSplit:true }).remaining,
          manualExchangeRemaining: calculate({ ...cashData, contractType: "exchange", exchangeManual:"1", cashSplit:true }).remaining,
          legacyCash: cashTerms({ contractType: "cash", deposit: "800", extras: [null, {amount:"200"}] }).cashReceived,
          last: standard.last,
          remaining: standard.remaining,
          phaseLast: phased.last,
          count: phased.count,
          errors: standard.errors,
          words: words(1000000),
        };
      });
      assert.equal(result.parsed, 500000);
      assert.equal(result.invalid, true);
      assert.equal(result.month, "2028-02-29");
      assert.equal(result.nonLeapCentury, "2100-02-28");
      assert.equal(result.earlyYear, "0100-02-28");
      assert.equal(result.invalidDate, "");
      assert.equal(result.invalidAnchor, "");
      assert(result.dateOverflow.some(error => error.includes("خارج النطاق")));
      assert(result.invalidInstallment.some(error => error.includes("أول قسط")));
      assert(result.invalidPayment.some(error => error.includes("الدفعات الإضافية")));
      assert(result.invalidCash.some(error => error.includes("تاريخ السداد")));
      assert.equal(result.importedCashRemaining, 700);
      assert.equal(result.externalRemaining, 900);
      assert.equal(result.manualExchangeRemaining, 900);
      assert.equal(result.legacyCash, "1000");
      assert.equal(result.last, 1000000);
      assert.equal(result.remaining, 8000000);
      assert.equal(result.phaseLast, 1000000);
      assert.equal(result.count, 6);
      assert.deepEqual(result.errors, []);
      assert.match(result.words, /مليون/);
    });
    await test("JSON contract export, import, and persistent drafts", async () => {
      assert(await page.evaluate(() => {
        const active = document.querySelector(".work-tile.active button.work-name");
        Workbench.paint();
        return !!active && active === document.querySelector(".work-tile.active button.work-name");
      }), "Refreshing the sidebar should preserve existing document controls");
      const event = page.waitForEvent("download");
      await page.locator(".work-tile.active").hover();
      await page.locator(".work-tile.active button[aria-label^='تصدير JSON']").click();
      const download = await event;
      const contract = JSON.parse(
        fs.readFileSync(await download.path(), "utf8"),
      );
      assert.equal(contract.format, "contracts-data");
      assert.equal(contract.data.buyer, "مشتري تجريبي");
      await page.locator("#workNew").click();
      await page.locator("#contractJSON").setInputFiles({
        name: "dummy.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(contract)),
      });
      await page.waitForFunction(() => d.buyer === "مشتري تجريبي");
      await page.evaluate(() => Services.flush());
      await page.reload();
      await page.waitForFunction(() => startReady);
      assert(
        await page.evaluate(() =>
          Services.library.entries.some(
            (entry) => entry.data.buyer === "مشتري تجريبي",
          ),
        ),
      );
      await page.evaluate(async () => {
        await Services.openEntry(
          Services.library.entries.find(
            (entry) => entry.data.buyer === "مشتري تجريبي",
          ),
        );
      });
    });
    await test("all four contract types preserve A4 and Arabic preview", async () => {
      for (const type of ["installment", "cash", "external", "exchange"]) {
        await page.evaluate((type) => {
          Object.assign(d, {
            contractType: type,
            cashReceived: "2000000",
            cashSplit: false,
            cashDueDate: "2026-12-12",
            oldCar: "مركبة تجريبية قديمة",
            oldVin: "TESTVIN00000000002",
            externalBuyer: "مشتري تجريبي",
            externalSeller: "بائع تجريبي",
            noWarranty: true,
            pages: [1],
          });
          App.scene = null;
          buildInputs();
          render();
        }, type);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.querySelectorAll("#pages img")].map((img) =>
              img.decode(),
            ),
          );
        });
        const dimensions = await page
          .locator("#pages .paper")
          .first()
          .evaluate((paper) => ({
            width: parseFloat(getComputedStyle(paper).width),
            height: parseFloat(getComputedStyle(paper).height),
            text: paper.textContent,
          }));
        assert(Math.abs(dimensions.width - 793.7) < 1);
        assert(Math.abs(dimensions.height - 1122.5) < 1);
        assert(dimensions.text.includes("تجريبي"));
        await page
          .locator("#pages .paper")
          .first()
          .screenshot({ path: path.join(output, `${type}.png`) });
      }
    });
    await test("web PDF export embeds external assets and preserves A4 pages", async () => {
      const bytes = await page.evaluate(async () => {
        d.contractType = "installment";
        App.scene = null;
        buildInputs();
        render();
        $("printSides").value = "simplex";
        const file = await ArchiveOutput.build(
          [{ id: "dummy", kind: "draft", data: SmartTables.snapshot(d) }],
          false,
        );
        return Array.from(new Uint8Array(await file.arrayBuffer()));
      });
      fs.writeFileSync(path.join(output, "contract.pdf"), Buffer.from(bytes));
      const pdf = await PDFDocument.load(Uint8Array.from(bytes));
      // The existing print plan emits two face copies, the schedule, and the company guide.
      assert.equal(pdf.getPageCount(), 4);
      assert(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 1);
      assert(Math.abs(pdf.getPage(0).getHeight() - 841.89) < 1);
      assert(bytes.length > 20000);
      const ink = await page.evaluate(async (bytes) => {
        const reader = await ArchiveOutput.reader();
        const pdf = await reader.getDocument({
          data: Uint8Array.from(bytes),
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise;
        const first = await pdf.getPage(1);
        const viewport = first.getViewport({ scale: 1.3 });
        const canvas = document.createElement("canvas");
        canvas.id = "pdfRegression";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText =
          "position:fixed;left:0;top:0;z-index:10000;background:white";
        document.body.append(canvas);
        await first.render({ canvasContext: canvas.getContext("2d"), viewport })
          .promise;
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let nonwhite = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220)
            nonwhite++;
        await pdf.destroy();
        return nonwhite / (canvas.width * canvas.height);
      }, bytes);
      assert(
        ink > 0.02,
        "Generated PDF must contain the rendered contract, not a blank image",
      );
      await page
        .locator("#pdfRegression")
        .screenshot({ path: path.join(output, "pdf-render.png") });
      await page
        .locator("#pdfRegression")
        .evaluate((canvas) => canvas.remove());
    });
    await test("printing and confirmed archive remain usable", async () => {
      await page.pdf({
        path: path.join(output, "browser-print.pdf"),
        preferCSSPageSize: true,
        printBackground: true,
      });
      await page.locator("#confirmPrinted").click();
      // Confirmation flushes IndexedDB before updating the archive; await that operation.
      await page.waitForFunction(() =>
        Services.library.entries.some((entry) => entry.kind === "printed"),
      );
      assert.equal(
        await page.evaluate(
          () =>
            Services.library.entries.filter((entry) => entry.kind === "printed")
              .length,
        ),
        1,
      );
      await page.evaluate(() => Services.showHome());
      await page.locator("#archiveSearch").fill("TESTVIN");
      assert(await page.locator("#printedArchive .archive-open").count());
      assert(await page.evaluate(() => {
        const button = $("printedArchive").querySelector(".archive-open");
        $("archiveSearch").value = "TESTVIN0";
        Archive.refresh();
        return !!button && button === $("printedArchive").querySelector(".archive-open");
      }), "Refining a search should keep the controls of unchanged rows");
      await page.locator("#archiveSearch").fill("");
    });
    await test("signed scans, private local attachment, and lazy PDF reader", async () => {
      const data = await page.evaluate(async () => {
        const entry = Services.library.entries.find(
          (entry) => entry.kind === "printed",
        );
        ContractFiles.open(entry);
        const source = await PDFLib.PDFDocument.create();
        source.addPage(PDFLib.PageSizes.A4);
        const file = new File([await source.save()], "dummy-signed.pdf", {
          type: "application/pdf",
        });
        Feedback.notice = async () => {};
        await ContractFiles.attach([file]);
        const blob = await ArchiveOutput.build([entry], false);
        const reader = await ArchiveOutput.reader();
        return {
          signed: !!Archive.signed(entry),
          bytes: blob.size,
          reader: !!reader.getDocument,
        };
      });
      assert(data.signed && data.reader && data.bytes > 0);
    });
    await test("letters, editable tables, and local design approval", async () => {
      await page.locator("#workLetter").click();
      await page.locator(".letter-options button").first().click();
      await page.waitForFunction(() => !!d.standaloneBook);
      assert(await page.locator("#bookFields").isVisible());
      await page.evaluate(async () => {
        await Services.createContract();
        await App.enter();
        App.create("table");
      });
      assert(await page.evaluate(() => App.selected()[0].type === "table"));
      await page.evaluate(async () => {
        await App.approve();
      });
      assert.equal(await page.evaluate(() => App.mode), "fill");
      assert(
        await page.evaluate(
          async () => !!(await getDB("beforeApprovalBackup")),
        ),
      );
      await page.reload();
      await page.waitForFunction(() => startReady);
      assert(
        await page.evaluate(() =>
          ContractTemplates.scoped(cfg.design).pages.some((page) =>
            page.nodes.some((node) => node.type === "table"),
          ),
        ),
      );
    });
    await test("editor undo, table merge/split, and rich-text sanitization", async () => {
      const result = await page.evaluate(async () => {
        await Services.createContract();
        await App.enter();
        App.create("text");
        const node = App.selected()[0];
        const id = node.id,
          original = node.x;
        App.property("x", original + 1);
        const moved = App.node(id).x;
        App.undo();
        const restored = App.node(id).x;
        App.create("table");
        const table = App.selected()[0].id;
        App.cells = [0, 1];
        App.tableAction("merge");
        const merged = App.node(table).html.includes('colspan="2"');
        App.cells = [0];
        App.tableAction("split");
        const split = !App.node(table).html.includes('colspan="2"');
        const markup = safeMarkup(
          '<script>bad()</script><b onclick="bad()">نص تجريبي</b>',
        );
        App.leave();
        return { original, moved, restored, merged, split, markup };
      });
      assert.equal(result.moved, result.original + 1);
      assert.equal(result.restored, result.original);
      assert(result.merged && result.split);
      assert.match(result.markup, /نص تجريبي/);
      assert(
        !result.markup.includes("script") && !result.markup.includes("onclick"),
      );
    });
    await test("simplex and duplex contract copies preserve print ordering", async () => {
      const result = await page.evaluate(() => {
        const papers = [1, 2, 3, 4, 5, 7, 9002].map((id) => {
          const paper = document.createElement("article");
          paper.dataset.page = id;
          return paper;
        });
        const data = { ...d, contractType: "installment", standaloneBook: "", noWarranty: false };
        const ids = (papers) =>
          papers.map((paper) =>
            paper.dataset.blank ? "blank" : Number(paper.dataset.page),
          );
        return {
          simplex: ids(PrintPlan.arrange(papers, data, false, "simplex", {})),
          duplex: ids(PrintPlan.arrange(papers, data, false, "duplex", {})),
          external: ids(
            PrintPlan.arrange(
              papers.filter((p) => ["1", "3"].includes(p.dataset.page)),
              { ...data, contractType: "external" },
              false,
              "duplex",
              {},
            ),
          ),
        };
      });
      assert.deepEqual(result.simplex, [1, 2, 1, 2, 3, 4, 5, 9002, 7]);
      assert.equal(result.duplex[result.duplex.indexOf(4) + 1], "blank");
      assert.equal(result.duplex[result.duplex.indexOf(5) + 1], 9002);
      assert.deepEqual(result.external, [1, "blank", 3, "blank"]);
    });
    await test("archive face-only printing survives mode changes and skips continuation pages", async () => {
      const result = await page.evaluate(async () => {
        const rows = ["test-a", "test-b"].map(number => ({data:{number}}));
        const preparedModes = [];
        const reruns = [];
        const originalRun = Archive.run;
        const originalPapers = ArchiveOutput.papers;
        const savedMode = $("printSides").value;
        const savedConfig = cfg.printSides;
        const parents = SmartTables.parents;
        const id = 40000000;
        const nodes = identifiers => identifiers.map(page => {
          const node = document.createElement("article");
          node.dataset.page = page;
          return node;
        });
        const pageIds = papers => papers.map(paper => Number(paper.dataset.page));
        try {
          ArchiveOutput.show("اختبار الطباعة", null);
          ArchiveOutput.rows = rows;
          ArchiveOutput.face = true;
          ArchiveOutput.printFrame = {};
          Archive.run = (selection, action) => reruns.push([selection.map(row => row.data.number), action]);
          $("archivePrintSides").value = "duplex";
          $("archivePrintSides").dispatchEvent(new Event("change"));
          $("viewPrint").click();
          ArchiveOutput.papers = (entry, face, printing, mode) => {
            preparedModes.push(mode);
            $("printSides").value = "simplex";
            const fragment = document.createDocumentFragment();
            const paper = document.createElement("article");
            paper.dataset.blank = "true";
            fragment.append(paper);
            return fragment;
          };
          const file = await ArchiveOutput.build(rows, true);
          const pdf = await PDFLib.PDFDocument.load(await file.arrayBuffer());
          SmartTables.parents = new Map([[id, 4]]);
          const book = {standaloneBook:"4"};
          const bookFace = pageIds(PrintPlan.arrange(nodes([4,id]), book, true, "simplex", {}));
          const bookFull = pageIds(PrintPlan.arrange(nodes([4,id]), book, false, "simplex", {}));
          SmartTables.parents = new Map([[id, 1]]);
          const contractFace = pageIds(PrintPlan.arrange(nodes([1,id]), {contractType:"installment"}, true, "simplex", {}));
          return {reruns, preparedModes, pdfPages:pdf.getPageCount(), bookFace, bookFull, contractFace};
        } finally {
          $("archiveViewer").close();
          ArchiveOutput.clearViewer();
          Archive.run = originalRun;
          ArchiveOutput.papers = originalPapers;
          $("printSides").value = savedMode;
          cfg.printSides = savedConfig;
          SmartTables.parents = parents;
        }
      });
      assert.deepEqual(result, {
        reruns:[[["test-a", "test-b"], "face"]],
        preparedModes:["duplex", "duplex"], pdfPages:3,
        bookFace:[4], bookFull:[4,40000000], contractFace:[1,1],
      });
    });
    await test("settings backup stays JSON and excludes archives", async () => {
      const backup = await page.evaluate(() => JSON.parse(settingsJSON()));
      assert.equal(backup.schemaVersion, 4);
      assert.equal(backup.archive, undefined);
      assert.equal(backup.layout.pin, undefined);
      assert.equal(backup.data.buyer, "");
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(
        { passed: results, pageErrors: errors, failedResponses: failed },
        null,
        2,
      ),
    );
    console.log(`PASS ${results.length} web regression groups`);
  } finally {
    await browser.close();
    web.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
