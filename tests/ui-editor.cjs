const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const serve = require("./server.cjs");
const output = path.resolve(__dirname, "../work/ui-verification");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const web = await serve(process.env.CONTRACT_TEST_BUILD || path.resolve(__dirname, "../dist"), {sampleFaces: !process.env.CONTRACT_TEST_BUILD});
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  const errors = [],
    results = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const test = async (name, fn) => {
    await fn();
    results.push(name);
    console.log("PASS " + name);
  };
  try {
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    if (await page.locator("#setupDialog").isVisible()) {
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupOrganizer").fill("اختبار تجريبي");
      await page.locator("#setupTitle").fill("موظف العقود");
      await page.locator("#setupForm button").click();
    }
    await test("right sidebar reflows the complete home, then only the fill area", async () => {
      const result = await page.evaluate(async () => {
        const rect = (id) => $(id).getBoundingClientRect().toJSON();
        const home = rect("homeScreen");
        $("workspaceToggle").click();
        const closed = rect("homeScreen");
        $("workspaceToggle").click();
        await Services.createContract();
        const canvas = rect("canvas"),
          form = rect("fillPanel");
        $("workspaceToggle").click();
        return {
          home,
          closed,
          canvas,
          form,
          canvasClosed: rect("canvas"),
          formClosed: rect("fillPanel"),
        };
      });
      assert(result.closed.width > result.home.width + 200);
      assert(Math.abs(result.canvas.width - result.canvasClosed.width) < 1);
      assert(result.formClosed.width > result.form.width + 200);
      await page.evaluate(() => $("workspaceToggle").click());
    });
    await test("Soul theme tiles persist, keep controls legible and preserve the document", async () => {
      const snapshot = () => page.evaluate(() => {
        const paper = document.querySelector(".paper");
        const node = paper.querySelector('.scene-node[data-type="text"]');
        const s = getComputedStyle(node);
        return [s.fontFamily, s.fontSize, s.lineHeight, s.color, node.style.cssText,
          getComputedStyle(paper).backgroundColor];
      });
      const before = await snapshot();
      await page.locator("#themeToggle").click();
      const panel = page.locator("#appearanceSettings");
      const tiles = panel.locator(".theme-tile");
      assert.deepEqual(await tiles.allTextContents(), [
        "Pure White", "Pure Black", "Silver", "Midnight", "Forest", "Plum",
        "Cloud", "Sand", "Graphite", "Deep Ocean", "Ember", "Aurora",
        "Porcelain", "Neon Ink", "Rose",
      ]);
      assert.equal(await panel.locator('input[type="range"]').count(), 1);
      const colors = [], tabs = [];
      for (const tile of await tiles.all()) {
        const id = await tile.locator("input").getAttribute("value");
        await tile.click();
        assert(await tile.locator("input").isChecked(), id);
        const contrast = await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d");
          const luminance = color => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
              .map(channel => channel.toString(16).padStart(2, "0")).join("");
            return UIPreferences.luminance("#" + rgb);
          };
          const selections = ["#toolbar", "#buyer", "#companySelect", "#closeSettings", "#tab-appearance", "#workbench",
            "#pageRail .page-item.active button"];
          return selections.map(selector => {
            const element = document.querySelector(selector);
            const {backgroundColor} = getComputedStyle(element);
            const {color} = getComputedStyle(element.matches(".page-item button") ? element.querySelector("small") : element);
            const foreground = luminance(color), background = luminance(backgroundColor);
            return {selector, backgroundColor, ratio:(Math.max(foreground, background) + .05) /
              (Math.min(foreground, background) + .05)};
          });
        });
        colors.push(contrast[0].backgroundColor);
        assert.equal(contrast.find(result => result.selector === "#buyer").backgroundColor, "rgb(248, 250, 252)");
        tabs.push(await page.locator('#buyer').evaluate(el => getComputedStyle(
          el.closest('label').querySelector('.entry-tab-fill')).fill));
        for (const {selector, ratio} of contrast) assert(ratio >= 4.5, id + " " + selector + " contrast " + ratio);
        assert.deepEqual(await snapshot(), before, id);
      }
      assert.equal(new Set(colors).size, 14); // Cloud and Pure White share white keys.
      assert(new Set(tabs).size > 1);
      await panel.locator("#ui-fontSize").fill("22");
      assert.deepEqual(await snapshot(), before);
      assert.equal(await page.locator("#buyer").evaluate(el => getComputedStyle(el).fontWeight), "700");
      await page.getByText("Plum", {exact:true}).click();
      await page.keyboard.press("ArrowLeft");
      assert.equal(await panel.locator('input[name="ui-theme"]:checked').count(), 1);
      const selected = await panel.locator('input[name="ui-theme"]:checked').inputValue();
      assert.notEqual(selected, "plum");
      await page.locator("#closeSettings").click();
      await page.reload();
      await page.waitForFunction(() => startReady);
      const preferences = await page.evaluate(() => UIPreferences.value);
      assert.deepEqual(preferences, {version:2, theme:selected, fontSize:22});
    });
    await test("offline download preserves fill layout and light field interiors", async () => {
      const snapshot = p => p.evaluate(() => {
        const fill = $("fillPanel").getBoundingClientRect();
        const box = el => {
          const rect = el.getBoundingClientRect();
          return [rect.left - fill.left, rect.top - fill.top, rect.width, rect.height].map(value => Math.round(value));
        };
        const fields = ["buyer", "buyerIdDate", "car", "total"].map(id => {
          const control = $(id);
          const label = control.closest("label");
          const value = label.querySelector(".date-text") || control;
          const style = getComputedStyle(value);
          return {box:box(label), framed:!!label.querySelector(".entry-frame"),
            ink:style.color, background:style.backgroundColor, font:style.fontFamily, size:style.fontSize};
        });
        return {fields, fill:box($("fillPanel")), payment:box($("paymentCard")), theme:UIPreferences.value};
      });
      const previous = await page.evaluate(() => ({
        appearance:{...UIPreferences.value}, fill:clone(cfg.design.fillAppearance),
      }));
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contract-fill-parity-"));
      const offline = await browser.newPage({viewport:page.viewportSize(), deviceScaleFactor:2});
      try {
        await page.evaluate(async () => {
          UIPreferences.set("theme", "deep-ocean");
          UIPreferences.set("fontSize", 20);
          await Services.createContract();
          const fields = cfg.design.fillAppearance[FillDesigner.scope()];
          (fields.buyer ||= {}).ink = "#154a30";
          (fields.buyerIdDate ||= {}).ink = "#67357c";
          document.activeElement.blur();
          FillDesigner.apply();
          await document.fonts.ready;
        });
        const online = await snapshot(page);
        assert(online.fields.every(field => field.framed && field.background === "rgb(248, 250, 252)"));
        assert.deepEqual(online.fields.map(field => field.ink), [
          "rgb(21, 74, 48)", "rgb(103, 53, 124)", "rgb(17, 17, 17)", "rgb(17, 17, 17)",
        ]);
        const download = page.waitForEvent("download");
        await page.locator("#offlineEdition").click();
        const file = path.join(temp, "contracts.html");
        await (await download).saveAs(file);
        await offline.addInitScript(() => {
          localStorage.setItem("contract-ui-v1", JSON.stringify({ version:2, theme:"cloud", fontSize:12 }));
          localStorage.setItem("contract-offline-ui-v1", JSON.stringify({
            appearanceId:"previous-download", version:2, theme:"cloud", fontSize:12,
          }));
        });
        await offline.context().setOffline(true);
        await offline.goto(pathToFileURL(file).href);
        await offline.waitForFunction(() => startReady);
        if (await offline.locator("#setupDialog").isVisible()) {
          await offline.locator("#setupBranch").fill("الدورة");
          await offline.locator("#setupOrganizer").fill("اختبار تجريبي");
          await offline.locator("#setupTitle").fill("موظف العقود");
          await offline.locator("#setupForm button").click();
          await offline.locator("#setupDialog").waitFor({state:"hidden"});
        }
        await offline.locator(".offline-home button").first().click();
        await offline.waitForFunction(() => !Services.home && !Workbench.switching);
        const exported = await offline.evaluate(() => JSON.parse(ContractFiles.pack(d)));
        assert.equal(exported.origin,"offline");
        assert.match(exported.data.number,/^[0-9]+-F$/);
        await offline.evaluate(async () => {
          document.activeElement.blur();
          await document.fonts.ready;
        });
        assert.deepEqual(await snapshot(offline), online);
        const typography = p => p.evaluate(() => {
          const paper = $("canvas").querySelector(".paper");
          const sample = document.createElement("div");
          sample.className = "scene-node";
          sample.textContent = "يتعهد الطرف الثاني بتسديد المبلغ المتبقي 12345 ضمن المدة المحددة";
          sample.style.cssText = "width:40mm;font-size:18px;line-height:1.2;white-space:normal";
          paper.append(sample);
          try {
            const range = document.createRange();
            const lines = [];
            let previousY;
            for (let i = 0; i < sample.textContent.length; i++) {
              range.setStart(sample.firstChild, i);
              range.setEnd(sample.firstChild, i + 1);
              const y = range.getBoundingClientRect().top;
              if (y !== previousY) lines.push(i);
              previousY = y;
            }
            return {lines, family:getComputedStyle(sample).fontFamily,
              loaded:[...document.fonts].some(f => f.family.includes("Alyamama") && f.status === "loaded"),
              embedded:WebResources.styles().includes("data:font/ttf;base64,")};
          } finally { sample.remove(); }
        });
        const layout = await typography(page);
        assert(layout.loaded && layout.embedded && layout.family.includes("Alyamama"));
        assert(layout.lines.length > 1);
        assert.deepEqual(await typography(offline), layout);
        const book = p => p.evaluate(async () => {
          await Workbench.start(4);
          document.activeElement.blur();
          await document.fonts.ready;
          return [...$("bookFields").querySelectorAll("label.entry-field")].map(label => {
            const control = label.querySelector("input,select,textarea");
            const {width,height} = label.getBoundingClientRect();
            const {color,backgroundColor,fontSize} = getComputedStyle(control);
            return {width,height,color,backgroundColor,fontSize};
          });
        });
        const onlineBook = await book(page);
        assert(onlineBook.length > 1 && onlineBook.every(field => field.color === "rgb(17, 17, 17)"));
        assert.deepEqual(await book(offline), onlineBook);
      } finally {
        await offline.close();
        const file = path.join(temp, "contracts.html");
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(temp);
        await page.evaluate(previous => {
          cfg.design.fillAppearance = previous.fill;
          UIPreferences.set("theme", previous.appearance.theme);
          UIPreferences.set("fontSize", previous.appearance.fontSize);
          FillDesigner.apply();
        }, previous);
      }
    });
    await test("letter type switching retains shared data and each custom body", async () => {
      const result = await page.evaluate(async () => {
        await Workbench.start(4);
        d.buyer = "زبون اختبار";
        d.bookBody = "نص التخويل";
        cfg.letterTemplates ||= [];
        cfg.letterTemplates.push({
          id: 12098,
          name: "كتاب اختبار",
          body: "نص خاص",
        });
        Workbench.switchBook(12098);
        d.bookBody = "تعديل النص الخاص";
        Workbench.switchBook(0);
        const transfer = App.displayPages.map((p) => p.id);
        Workbench.switchBook(4);
        const body = d.bookBody;
        Workbench.switchBook(12098);
        return {
          type: $("bookType").value,
          contractHidden: $("archiveContractType").closest("label").hidden,
          buyer: d.buyer,
          body,
          customBody: d.bookBody,
          transfer,
          pages: App.displayPages.map((p) => p.id),
        };
      });
      assert.equal(result.type, "12098");
      assert(result.contractHidden);
      assert.equal(result.buyer, "زبون اختبار");
      assert.equal(result.body, "نص التخويل");
      assert.equal(result.customBody, "تعديل النص الخاص");
      assert.deepEqual(result.transfer, [0]);
      assert.deepEqual(result.pages, [12098]);
    });
    await test("full-width field underline, opacity scope and property toggles", async () => {
      const result = await page.evaluate(async () => {
        await Services.createContract();
        await App.enter();
        App.page = 1;
        App.current().nodes = [];
        const n = App.create("text");
        Object.assign(n, {
          x: 25,
          y: 30,
          w: 100,
          h: 18,
          html: "اختبار التسطير",
          fontSize: 24,
        });
        App.render();
        App.format("underline");
        const s = getComputedStyle(App.element(n.id), "::after"),
          line = s.borderBottomStyle,
          left = s.left,
          right = s.right;
        const hidden = document
          .querySelector('[data-prop="opacity"]')
          .closest("label").hidden;
        BoxAppearance.buttons.fill.parentElement.querySelector("input").click();
        const fill = n.fill;
        BoxAppearance.buttons.fill.parentElement.querySelector("input").click();
        const disabled = n.fillEnabled === false && n.fill === fill;
        BoxAppearance.buttons.fill.parentElement.querySelector("input").click();
        return {
          id: n.id,
          line,
          left,
          right,
          hidden,
          disabled,
          retained: n.fill === fill,
        };
      });
      assert.equal(result.line, "solid");
      assert.equal(result.left, "0px");
      assert.equal(result.right, "0px");
      assert(result.hidden && result.disabled && result.retained);
      await page.locator('[data-color-key="color"]').click();
      await page.locator('#boxColorPalette input[type="range"]').fill("75");
      const preview = await page.evaluate(() => ({
        value: getComputedStyle(App.element(App.selected()[0].id)).color,
        stored: App.selected()[0].color,
        direction: getComputedStyle(
          document.querySelector('#boxColorPalette input[type="range"]'),
        ).direction,
      }));
      assert.match(preview.value, /0\.75/);
      assert.equal(preview.direction, "ltr");
      await page.locator(".palette-apply").click();
      assert.match(await page.evaluate(() => App.selected()[0].color), /0\.75/);
      await page.locator('[data-color-key="fill"]').click();
      await page.locator('#boxColorPalette input[type="range"]').fill("100");
      await page.locator(".palette-cancel").click();
      assert.notEqual(
        await page.evaluate(() => App.selected()[0].fill),
        "rgba(255,255,255,0)",
      );
      await page.screenshot({ path: path.join(output, "editor-colors.png") });
    });
    await test("fixed tables: real pointer resize, cell styles, visual-right insertion, row deletion and undo", async () => {
      await page.evaluate(() => {
        App.page = 1;
        const n = App.create("table");
        Object.assign(n, {
          x: 25,
          y: 65,
          w: 125,
          h: 35,
          direction: "rtl",
          html: "<table><tbody><tr><td>أ</td><td>ب</td></tr><tr><td>{{buyer}}</td><td>د</td></tr></tbody></table>",
        });
        delete n.liveTable;
        delete n.tableSetup;
        App.render();
        App.action("tableMode");
      });
      assert((await page.locator(".table-pick").count()) >= 4);
      const handle = page.locator(".table-resize.column").first();
      const bounds = await handle.boundingBox();
      const before = await page.evaluate(() => App.selected()[0].w);
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width / 2 - 12,
        bounds.y + bounds.height / 2,
        { steps: 5 },
      );
      await page.mouse.up();
      assert((await page.evaluate(() => App.selected()[0].w)) > before + 1);
      await page.evaluate(() => {
        TableTools.select("column", 0);
        App.cells = [0];
        TableTools.style("backgroundColor", "#f8e9c2");
        TableTools.style("color", "#553300");
        TableTools.style("fontSize", "25px");
      });
      const styles = await page.evaluate(() => {
        const c = App.element(App.selected()[0].id).querySelectorAll("td");
        return [
          c[0].style.backgroundColor,
          c[0].style.fontSize,
          c[1].style.fontSize,
        ];
      });
      assert.equal(styles[0], "rgb(248, 233, 194)");
      assert.equal(styles[1], "25px");
      assert.equal(styles[2], "");
      await page.evaluate(async () => {
        TableTools.select("column", 0);
        await TableTools.structure("insertColumn");
      });
      assert.deepEqual(
        await page.evaluate(() =>
          [...App.element(App.selected()[0].id).querySelector("tr").cells].map(
            (c) => c.textContent,
          ),
        ),
        ["", "أ", "ب"],
      );
      await page.evaluate(async () => {
        TableTools.select("row", 1);
        await TableTools.structure("insertRow");
      });
      assert.equal(
        await page.evaluate(
          () => App.element(App.selected()[0].id).querySelectorAll("tr").length,
        ),
        3,
      );
      await page.evaluate(() => {
        TableTools.select("row", 1);
        void TableTools.structure("deleteRow");
      });
      await page
        .locator(".table-confirm button")
        .filter({ hasText: "حذف" })
        .click();
      await page.waitForFunction(
        () =>
          App.element(App.selected()[0].id).querySelectorAll("tr").length === 2,
      );
      assert.equal(
        await page.evaluate(
          () => App.element(App.selected()[0].id).querySelectorAll("tr").length,
        ),
        2,
      );
      await page.evaluate(() => App.undo());
      assert.equal(
        await page.evaluate(
          () => App.element(App.selected()[0].id).querySelectorAll("tr").length,
        ),
        3,
      );
      await page.evaluate(() => {
        App.action("tableMode");
        TableTools.select("row", 0);
      });
      const rowHandle = page.locator(".table-resize.row").first();
      await rowHandle.focus();
      const oldHeight = await page.evaluate(() => App.selected()[0].h);
      await page.keyboard.press("ArrowDown");
      assert((await page.evaluate(() => App.selected()[0].h)) > oldHeight);
      await page.screenshot({ path: path.join(output, "editor-table.png") });
      await page.evaluate(async () => {
        await App.approve();
        await App.enter();
        const n = App.current().nodes.find((n) => n.type === "table");
        App.selection = new Set([n.id]);
        App.render();
      });
      assert(
        await page.evaluate(() => App.selected()[0].html.includes("25px") && App.selected()[0].html.includes("{{buyer}}") && !App.selected()[0].html.includes("data:image")),
      );
    });
    await test("fillable table dimensions and cell styles survive model regeneration", async () => {
      const result = await page.evaluate(() => {
        const n = App.create("table");
        n.x = 20;
        n.y = 110;
        n.w = 140;
        n.h = 35;
        n.direction = "ltr";
        n.liveTable = {
          columns: ["trim", "price"],
          widths: { trim: 10, price: 10 },
          initialRows: 2,
          rowHeight: 9,
          direction: "ltr",
          numbered: false,
          total: false,
          style: "grid",
        };
        App.render();
        App.tableId = n.id;
        App.cells = [2];
        TableTools.style("color", "#123456");
        TableTools.style("fontSize", "23px");
        TableTools.resize("column", 0, 60);
        TableTools.resize("row", 1, 17);
        App.render();
        const table = App.element(n.id).querySelector("table");
        return {
          color: table.rows[1].cells[0].style.color,
          size: table.rows[1].cells[0].style.fontSize,
          widths: n.liveTable.widths,
          heights: n.liveTable.rowHeights,
          direction: getComputedStyle(table).direction,
        };
      });
      assert.equal(result.color, "rgb(18, 52, 86)");
      assert.equal(result.size, "23px");
      assert.equal(result.direction, "ltr");
      assert.equal(result.widths.trim, 60);
      assert.equal(result.heights[1], 17);
    });
    await test("fillable columns insert visually right of RTL numbering and retain entered values", async () => {
      await page.evaluate(async () => {
        const n = App.selected()[0];
        n.liveTable.direction = "rtl";
        n.liveTable.numbered = true;
        const recovered = SmartTables.model({...n,w:null});
        if(!(recovered.w>0 && recovered.w<=210) || /NaN|Infinity/.test(recovered.html))throw Error("Invalid recovered table width");
        App.render();
        App.tableId = n.id;
        TableTools.select("column", 0);
        d.tableData ||= {};
        d.tableData[n.id] = [{ trim: "محفوظ", price: 1000 }];
        await TableTools.structure("insertColumn");
      });
      await page
        .getByRole("combobox", { name: "العمود الجديد", exact: true })
        .selectOption("model");
      await page
        .getByRole("button", { name: "إضافة العمود", exact: true })
        .click();
      assert.deepEqual(
        await page.evaluate(() =>
          SmartTables.keys(App.selected()[0].liveTable),
        ),
        ["model", "serial", "trim", "price"],
      );
      await page.evaluate(() => {
        TableTools.select("column", 0);
        void TableTools.structure("deleteColumn");
      });
      await page
        .locator(".table-confirm")
        .getByRole("button", { name: "حذف", exact: true })
        .click();
      await page.waitForFunction(
        () => !App.selected()[0].liveTable.columns.includes("model"),
      );
      assert.equal(
        await page.evaluate(() => d.tableData[App.selected()[0].id][0].trim),
        "محفوظ",
      );
    });
    await test("authorized editor changes reach A4 PDF and approval persistence", async () => {
      await page.evaluate(async () => {
        const n = App.selected()[0];
        d.tableData ||= {};
        d.tableData[n.id] = [
          { trim: "مركبة اختبار", price: 1000 },
          { trim: "مركبة ثانية", price: 2000 },
        ];
        await App.approve();
        d.pages = [1];
        d.noWarranty = true;
        cfg.printSides = "simplex";
        render();
      });
      const bytes = await page.evaluate(async () => {
        const blob = await ArchiveOutput.build(
          [{ id: "ui-dummy", kind: "draft", data: SmartTables.snapshot(d) }],
          true,
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
      fs.writeFileSync(
        path.join(output, "edited-document.pdf"),
        Buffer.from(bytes),
      );
      const ink = await page.evaluate(async (bytes) => {
        const reader = await ArchiveOutput.reader();
        const pdf = await reader.getDocument({
          data: Uint8Array.from(bytes),
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise;
        const first = await pdf.getPage(1);
        const viewport = first.getViewport({ scale: 1.5 });
        const c = document.createElement("canvas");
        c.id = "uiPdfPreview";
        c.width = viewport.width;
        c.height = viewport.height;
        c.style.cssText =
          "position:fixed;inset:0;z-index:10000;background:white";
        document.body.append(c);
        await first.render({ canvasContext: c.getContext("2d"), viewport })
          .promise;
        return {
          pages: pdf.numPages,
          width: first.view[2],
          height: first.view[3],
        };
      }, bytes);
      assert(Math.abs(ink.width - 595) < 2);
      assert(Math.abs(ink.height - 842) < 2);
      await page
        .locator("#uiPdfPreview")
        .screenshot({ path: path.join(output, "edited-pdf-render.png") });
      await page.locator("#uiPdfPreview").evaluate((n) => n.remove());
    });
    await test("archive dialogs preserve document typography; shape opacity and all alpha controls", async () => {
      const same = await page.evaluate(() => {
        const node = document.querySelector('.scene-node[data-type="text"]');
        const before = getComputedStyle(
          node.querySelector(".node-content"),
        ).font;
        const dialog = document.createElement("dialog");
        dialog.className = "app-ui";
        const paper = node.closest(".paper").cloneNode(true);
        dialog.append(paper);
        document.body.append(dialog);
        dialog.showModal();
        const after = getComputedStyle(
          paper.querySelector(
            '[data-node="' + node.dataset.node + '"] .node-content',
          ),
        ).font;
        dialog.remove();
        return { before, after };
      });
      assert.equal(same.before, same.after);
      const values = await page.evaluate(async () => {
        await App.enter();
        const n = App.create("shape", "ellipse");
        App.render();
        const input = document.querySelector('[data-prop="opacity"]');
        const hidden = input.closest("label").hidden;
        input.value = 0.25;
        input.dispatchEvent(new Event("input"));
        const preview = App.element(n.id).style.opacity;
        input.dispatchEvent(new Event("change"));
        const stored = n.opacity;
        const alpha = {};
        for (const key of ["color", "fill", "stroke", "decorationColor"]) {
          BoxAppearance.open(key, BoxAppearance.buttons[key]);
          const range = BoxAppearance.popup.querySelector("[type=range]");
          range.value = 40;
          range.dispatchEvent(new Event("input"));
          BoxAppearance.apply();
          alpha[key] = BoxAppearance.parse(n[key]).alpha;
        }
        return { hidden, preview, stored, alpha };
      });
      assert(!values.hidden);
      assert.equal(values.preview, "0.25");
      assert.equal(values.stored, 0.25);
      assert.deepEqual(Object.values(values.alpha), [0.4, 0.4, 0.4, 0.4]);
      await page.evaluate(() => App.leave());
    });
    await test("keyboard settings focus", async () => {
      await page.evaluate(() => Workspace.open("appearance"));
      await page.locator("#closeSettings").focus();
      await page.keyboard.press("Shift+Tab");
      assert(await page.evaluate(() => $("settingsDrawer").contains(document.activeElement)));
      await page.keyboard.press("Escape");
      assert(await page.locator("#settingsDrawer").isHidden());
    });
    await test("responsive light/dark and large-font controls remain reachable", async () => {
      await page.evaluate(async () => {
        await Services.createContract();
      });
      for (const [width, height] of [
        [1440, 1000],
        [1024, 768],
        [768, 1024],
        [390, 844],
      ])
        for (const size of [12, 22]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(
            (size) => UIPreferences.set("fontSize", size),
            size,
          );
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            `page overflow ${width}/${size}`,
          );
          await page.locator("#buyer").scrollIntoViewIfNeeded();
          await page.locator("#buyer").fill("اختبار الوصول");
          assert.equal(
            await page.locator("#buyer").inputValue(),
            "اختبار الوصول",
          );
          await page.screenshot({
            path: path.join(output, `fill-${width}-${size}.png`),
          });
        }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.evaluate(() => {
        UIPreferences.set("fontSize", 13);
        UIPreferences.set("theme", "light");
      });
      await page.screenshot({ path: path.join(output, "fill-light.png") });
      await page.evaluate(() => UIPreferences.set("theme", "dark"));
      await page.screenshot({ path: path.join(output, "fill-dark.png") });
      await page.evaluate(() => Workspace.open("appearance"));
      await page.screenshot({ path: path.join(output, "settings.png") });
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ passed: results, errors }, null, 2),
    );
    console.log("PASS no browser errors");
  } finally {
    await browser.close();
    web.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
