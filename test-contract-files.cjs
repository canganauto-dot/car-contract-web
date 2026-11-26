const { chromium } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const b = await chromium.launch({
    channel: "msedge",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    const p = await b.newPage({ viewport: { width: 1366, height: 768 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(() => startReady);
    if (await p.locator("#setupDialog").isVisible()) {
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupOrganizer").fill("اختبار تجريبي");
      await p.locator("#setupTitle").fill("موظف العقود");
      await p.locator("#setupForm button").click();
    }
    await p.locator("#workNew").click();
    await p.waitForFunction(() => !Services.home);
    await p.locator("#buyer").fill("عميل السكان");
    await p.locator("#vin").fill("LS5123456789012345");
    await p.locator("#vin").blur();
    const packed = await p.evaluate(() => ContractFiles.pack(d));
    assert(packed.length < 10000);
    const item = JSON.parse(packed);
    assert.equal(item.data.buyer, "عميل السكان");
    assert(item.data.contractDate);
    await p.locator("#loadContract").click();
    await p
      .locator("#contractJSON")
      .setInputFiles({
        name: "test.json",
        mimeType: "application/json",
        buffer: Buffer.from(packed),
      });
    await p.waitForFunction(() => d.buyer === "عميل السكان");
    await p.locator("#selectAllPages").click();
    assert.equal(await p.locator("#pageRail input:checked").count(), 0);
    await p.locator("#selectAllPages").click();
    assert((await p.locator("#pageRail input:checked").count()) > 0);
    await p.evaluate(() => App.enter());
    await p.locator("#layoutPrint").click();
    await p
      .locator("#printLayoutRows .layout-row")
      .first()
      .getByRole("button", { name: "＋ فراغ" })
      .click();
    await p.locator("#printLayoutSave").click();
    assert(
      await p.evaluate(() =>
        App.scene.printLayouts[d.contractType][1].startsWith("blank:"),
      ),
    );
    await p.evaluate(() => App.leave());
    await p.screenshot({
      path: "development/work/legacy-results/workflow-fill.png",
    });
    await p.evaluate(() => {
      Services.library.entries = [];
      Services.beforePrint();
    });
    await p.evaluate(() => Services.confirmPrint());
    await p.evaluate(() => Services.showHome());
    await p.locator("#printedArchive .upload-signed").first().click();
    await p.locator("#signedCamera").click();
    await p.waitForFunction(
      () => document.getElementById("signedVideo").videoWidth > 0,
    );
    await p.locator("#signedCapture").click();
    await p.locator("#signedCapture").click();
    assert.equal(await p.locator("#signedShots button").count(), 2);
    await p.evaluate(() => {
      window.testSaved = [];
      ContractFiles.folder = {
        queryPermission: async () => "granted",
        getFileHandle: async (name) => ({
          createWritable: async () => ({
            write: async (blob) =>
              window.testSaved.push({ name, size: blob.size }),
            close: async () => {},
          }),
        }),
      };
    });
    await p.locator("#signedFinish").click();
    await p.waitForFunction(
      () => !document.getElementById("signedDialog").open,
    );
    assert(
      await p.evaluate(
        () =>
          testSaved.length === 1 &&
          testSaved[0].name.includes("عميل السكان") &&
          testSaved[0].name.includes("789012345"),
      ),
    );
    await p.locator("#feedbackAccept").click();
    assert(
      await p.evaluate(
        () =>
          !!Archive.signed(
            Services.library.entries.find((e) => e.kind === "printed"),
          ),
      ),
    );
    await p.reload();
    await p.waitForFunction(() => startReady);
    assert(
      await p.evaluate(
        () =>
          !!Archive.signed(
            Services.library.entries.find((e) => e.kind === "printed"),
          ),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS JSON roundtrip, compact data, bulk pages, custom blank ordering, multi-page camera scan, folder naming and signed persistence",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
