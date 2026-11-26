const { chromium } = require("playwright"),
  path = require("path"),
  assert = require("assert");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const p = await b.newPage({
        viewport: { width: 1500, height: 1050 },
        acceptDownloads: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(
      () => typeof startReady !== "undefined" && startReady,
    );
    if (await p.locator("#setupDialog").isVisible()) {
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupOrganizer").fill("اختبار تجريبي");
      await p.locator("#setupTitle").fill("موظف العقود");
      await p.locator("#setupForm button").click();
    }
    assert.equal(await p.locator("#homeCreate").isVisible(), false);
    assert.equal(await p.locator("#newLetter").isVisible(), false);
    assert.equal(await p.locator("#importArchive").isVisible(), false);
    assert.equal(await p.locator("#toolbar #offlineEdition").count(), 1);
    await p.screenshot({
      path: "development/work/legacy-results/compact-home.png",
    });
    await p.evaluate(() => Workbench.start(4));
    await p.evaluate(() => App.enter());
    await p.evaluate(() => {
      App.page = 4;
      App.render();
      SmartTables.wizard();
    });
    await p.locator(".smart-dialog [name=style]").selectOption("cards");
    await p.locator(".smart-dialog [name=numbered]").check();
    await p.locator(".smart-dialog [name=total]").check();
    await p.locator(".smart-dialog [data-column=qty]").check();
    await p.locator(".save-table").click();
    const id = await p.evaluate(() => App.selected()[0].id);
    await p.evaluate(() => {
      cfg.design = clone(App.scene);
      App.leave();
      Workbench.form();
    });
    await p
      .locator(".table-entry")
      .getByRole("button", { name: "＋ سطر", exact: true })
      .click();
    await p.locator('.table-entry input[aria-label="الطراز 1"]').fill("شانجان");
    await p.locator('.table-entry input[aria-label="الموديل 1"]').fill("2026");
    await p.locator('.table-entry input[aria-label="العدد 1"]').fill("2");
    await p.locator('.table-entry input[aria-label="السعر 1"]').fill("100000");
    await p.locator('.table-entry input[aria-label="السعر 1"]').blur();
    assert.match(
      await p.locator("#pages .smart-node").last().textContent(),
      /200,000/,
    );
    const packed = await p.evaluate(
      () => normalizeData(JSON.parse(ContractFiles.pack(d)).data).tableData,
    );
    assert.equal(packed[id][0].trim, "شانجان");
    await p.evaluate(() => {
      cfg.priceCatalogs = [
        {
          id: "cat",
          name: "المعتمدة",
          category: "شانجان",
          from: "2020-01-01",
          to: "2035-12-31",
          items: [
            {
              id: "car1",
              trim: "CS85",
              model: "2026",
              price: "500000",
              type: "SUV",
            },
          ],
        },
      ];
      cfg.bookPriceDefaults = { 4: "cat" };
      document.activeElement.blur();
      SmartTables.inputs();
    });
    await p
      .locator(".table-entry")
      .getByRole("button", { name: "اختيار الأصناف" })
      .click();
    await p.locator("[data-item=car1]").check();
    await p.getByRole("button", { name: "اعتماد الأصناف المحددة" }).click();
    assert.match(
      await p.locator("#pages .smart-node").last().textContent(),
      /700,000/,
    );
    await p.evaluate(() => {
      cfg.priceCatalogs[0].items[0].price = "600000";
      render();
    });
    assert.match(
      await p.locator("#pages .smart-node").last().textContent(),
      /800,000/,
    );
    assert(
      await p.evaluate(() =>
        Object.values(JSON.parse(ContractFiles.pack(d)).data.tableData)
          .flat()
          .every((r) => !r.priceLink),
      ),
    );
    await p.evaluate((id) => {
      d.tableData[id] = Array.from({ length: 40 }, (_, i) => ({
        trim: "نوع " + i,
        model: "2026",
        qty: 1,
        price: 1000,
      }));
      render();
    }, id);
    assert((await p.locator("#pages>.paper").count()) > 1);
    assert.equal(await p.locator("#pages .smart-node tbody tr").count(), 40);
    assert.match(
      await p.locator("#pages .smart-node").last().textContent(),
      /40,000/,
    );
    assert(
      await p.evaluate(() =>
        [...SmartTables.parents].every(([id]) => Schedule.enabled(id)),
      ),
    );
    await p.emulateMedia({ media: "print" });
    await p
      .locator("#pages>.paper")
      .first()
      .screenshot({
        path: "development/work/legacy-results/smart-table-print.png",
      });
    await p.emulateMedia({ media: "screen" });
    const record = await p.evaluate(() => d.recordId);
    await p.locator("#homeButton").click();
    await p.waitForFunction((record) => Services.home &&
      Services.library.entries.some((e) => e.data.recordId === record), record);
    assert.equal(await p.locator("#workItems .work-tile.active").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS compact toolbar, dynamic wizard, row entry, totals, JSON, linked catalog, price snapshot, table pagination, returning home retains the draft",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
