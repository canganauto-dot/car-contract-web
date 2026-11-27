const selectDocument=require("./tests/select-document.cjs");
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
(async () => {
  const b = await chromium.launch({ channel: "msedge" });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(() => startReady);
    if (await p.locator("#setupTitle").isVisible()) {
      await p.locator("#setupTitle").fill("موظف العقود");
      await p.locator("#setupOrganizer").fill("منظّم تجريبي");
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupForm button").click();
    }
    await p.locator("#workNew").click();
    await p.waitForFunction(() => !Services.home);
    await selectDocument(p,"archiveContractType","exchange");
    for (const [key, val] of Object.entries({
      oldCar: "كيا سبورتاج",
      oldModel: "2022",
      oldPlate: "بغداد 1234",
      oldColor: "أسود",
      oldVin: "OLD00000000000001",
      oldMileage: "65000",
      car: "شانجان CS75",
      model: "2026",
      plate: "بغداد 5678",
      color: "أبيض",
      vin: "NEW00000000000002",
      mileage: "15",
      buyer: "مشتري تجريبي",
      buyerAddress: "بغداد",
      buyerPhone: "07700000000",
      total: "10000000",
      deposit: "2000000",
      count: "16",
      payment: "500000",
    }))
      await p.locator("#" + key).fill(val);
    await p.locator("#payment").blur();
    const oldCard = await p.locator("#oldVehiclePanel").boundingBox();
    const newCard = await p.locator("#carCard").boundingBox();
    assert(oldCard.y + oldCard.height <= newCard.y);
    assert((await p.locator('[data-node^="exchange-clause-"]').count()) > 0);
    const renumbered=await p.evaluate(()=>{
      const page=clone(App.displayPages.find(p=>p.id===1));
      page.nodes=page.nodes.filter(n=>n.id!=="exchange-clause-8");
      Exchange.numberClauses(page);
      return ["exchange-payment-title","exchange-clause-9","exchange-clause-10"].map(id=>page.nodes.find(n=>n.id===id).clauseNumber);
    });
    assert.deepEqual(renumbered,[3,8,9]);
    assert.equal(await p.evaluate(() => detectBrand("شانجان CS75")), "changan");
    assert.equal(await p.evaluate(() => detectBrand("S07")), "deepal");
    assert(
      !/^\s*[١1]/.test(
        await p
          .locator('[data-node="exchange-clause-1"] .node-content')
          .textContent(),
      ),
    );
    await p.screenshot({
      path: path.resolve(
        "development/work/legacy-results/exchange-form-preview.png",
      ),
    });
    assert.match(
      await p.locator('[data-node="exchange-payment-title"]').textContent(),
      /10,000,000/,
    );
    assert.equal(await p.evaluate(() => calculate(d).remaining), 8000000);
    await p.emulateMedia({ media: "print" });
    const face = p.locator('#pages .paper[data-page="1"]');
    await face.screenshot({
      path: path.resolve(
        "development/work/legacy-results/exchange-preview.png",
      ),
    });
    const overflow = await face.evaluate((p) =>
      [...p.querySelectorAll(".node-content")].flatMap((content) => {
        if (!content.textContent.trim()) return [];
        const r = document.createRange();
        r.selectNodeContents(content);
        return r.getBoundingClientRect().bottom >
          content.getBoundingClientRect().bottom + 4
          ? [content.parentElement.dataset.node]
          : [];
      }),
    );
    assert.deepEqual(overflow, []);
    assert.equal(
      await p
        .locator(
          '#pages .paper:not([data-page="1"]) [data-node][style*="clip-path: inset(28mm"]',
        )
        .count(),
      0,
    );
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
      await p
        .locator('#archiveViewBody [data-node="exchange-old-3"]')
        .textContent(),
      /OLD00000000000001/,
    );
    assert.match(
      await p
        .locator('#archiveViewBody [data-node="exchange-new-3"]')
        .textContent(),
      /NEW00000000000002/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: exchange stacked vehicles, clauses, payment, A4 layout and archived vehicles",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
