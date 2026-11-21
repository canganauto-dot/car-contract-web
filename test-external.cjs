const { chromium } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const { pathToFileURL } = require("url");
(async () => {
  const b = await chromium.launch({ channel: "msedge" });
  try {
    const p = await b.newPage({ viewport: { width: 1366, height: 768 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(() => startReady);
    if (await p.locator("#setupPrefix").isVisible()) {
      await p.locator("#setupPrefix").fill("T");
      await p.locator("#setupOrganizer").fill("اختبار");
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupForm button").click();
    }
    await p.locator("#workNew").click();
    await p.waitForFunction(() => !Services.home);
    await p.locator("#archiveContractType").selectOption("external");
    assert.equal(await p.locator("#externalSeller").inputValue(), "");
    assert.equal(await p.locator("#externalBuyer").inputValue(), "");
    assert.equal(await p.locator("#pages .paper").count(), 2);
    await p.locator("#externalBuyerCompany").selectOption({ index: 1 });
    assert.equal(
      await p.locator("#externalBuyer").inputValue(),
      "عبدالله مظهر عبدالحسن",
    );
    for (const [k, v] of Object.entries({
      externalSeller: "بائع تجريبي",
      externalSellerAddress: "بغداد",
      externalSellerPhone: "07700000000",
      externalPurchaseDate: "2022-09-07",
      externalWaiverDate: "2026-11-10",
      car: "CS75",
      vin: "LS500000000000001",
      model: "2022",
      color: "أبيض",
      plate: "98131 و",
      mileage: "12000",
      total: "25000000",
      cashReceived: "20000000",
    }))
      await p.locator("#" + k).fill(v);
    await p.locator("#cashReceived").blur();
    await p.screenshot({
      path: "development/work/legacy-results/external-form.png",
    });
    assert.equal(
      await p.locator('#pages [data-node="external-bg-payment"]').count(),
      1,
    );
    await p.emulateMedia({ media: "print" });
    await p
      .locator('#pages .paper[data-page="1"]')
      .screenshot({
        path: "development/work/legacy-results/external-contract.png",
      });
    await p
      .locator('#pages .paper[data-page="3"]')
      .screenshot({
        path: "development/work/legacy-results/external-waiver.png",
      });
    const overflow = await p.locator("#pages .paper").evaluateAll((pages) =>
      pages.flatMap((p) =>
        [...p.querySelectorAll(".node-content")]
          .filter((c) => {
            if (!c.textContent.trim()) return false;
            const r = document.createRange();
            r.selectNodeContents(c);
            return (
              r.getBoundingClientRect().bottom >
              c.getBoundingClientRect().bottom + 4
            );
          })
          .map((c) => c.parentElement.dataset.node),
      ),
    );
    assert.deepEqual(overflow, []);
    await p.emulateMedia({ media: "screen" });
    await p.evaluate(async () => {
      Services.beforePrint();
      await Services.confirmPrint();
      await Services.showHome();
    });
    await p.reload();
    await p.waitForFunction(() => startReady);
    await p.locator("#printedArchive .archive-open").click();
    assert.match(
      await p.locator("#archiveViewBody").textContent(),
      /بائع تجريبي/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS external: blank parties, manager fill, two pages, print bounds, archive",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
