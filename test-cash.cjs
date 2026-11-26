const { chromium } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(() => startReady);
    if (await p.locator("#setupTitle").isVisible()) {
      await p.locator("#setupTitle").fill("موظف العقود");
      await p.locator("#setupOrganizer").fill("م. رسول");
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupForm button").click();
    }
    await p.locator("#workNew").click();
    await p.waitForFunction(() => !Services.home);
    const upload = await p.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 90;
      canvas.height = 112;
      const g = canvas.getContext("2d");
      g.fillStyle = "#e7edf0";
      g.fillRect(0, 0, 90, 112);
      g.fillStyle = "#8c9eaa";
      g.beginPath();
      g.arc(45, 40, 18, 0, 2 * Math.PI);
      g.fill();
      g.beginPath();
      g.ellipse(45, 107, 34, 39, 0, 0, 2 * Math.PI);
      g.fill();
      return canvas.toDataURL().split(",")[1];
    });
    await p.locator("#customerPhotoFile").setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(upload, "base64"),
    });
    await p.waitForFunction(() => d.customerPhoto.startsWith("data:image/png"));
    const checkHeaders = () =>
      p.evaluate(() =>
        [...document.querySelectorAll("#pages > article")].every((page) => {
          const many = page.dataset.page === "1" ? 1 : 0;
          const portraits = [
            ...page.querySelectorAll('[data-node$="-portrait"] img'),
          ];
          const logos = [...page.querySelectorAll('[data-node$="-logo"] img')];
          const names = [
            ...page.querySelectorAll(
              '[data-node*="-name-"][data-node*="hdr-"]',
            ),
          ];
          return (
            portraits.length === many &&
            logos.length === many &&
            names.length === many * 3 &&
            portraits.every(
              (img) => img.getAttribute("src") === d.customerPhoto,
            ) &&
            logos.every(
              (img) => img.getAttribute("src") === co().imageValues.headerLogo,
            ) &&
            (!many ||
              names
                .slice(0, 3)
                .map((el) => el.textContent)
                .join(" ") === co().fullName)
          );
        }),
      );
    assert(await checkHeaders());
    await p.locator("#archiveContractType").selectOption("cash");
    const positions = () =>
      p.evaluate(() => {
        const source = ContractTemplates.scoped(cfg.design, "contract:installment").pages.find((page) => page.id === 1).nodes;
        const cash = App.scene.cashTemplate.nodes;
        const geometry = (n) => [n.x, n.y, n.w, n.h];
        const pairs = source
          .filter((n) =>
            /^(label-|value-|seller-intro$|total$|extra-(money|date)-)/.test(
              n.id,
            ),
          )
          .map((n) => [
            geometry(n),
            geometry(cash.find((c) => c.id === "cash-" + n.id)),
          ]);
        return pairs;
      });
    const blankLayout = await positions();
    assert(blankLayout.length > 45);
    // Approved cash and installment templates may have different geometry.
    for (const pair of blankLayout) {
      for (const [x, y, width, height] of pair) {
        assert([x, y, width, height].every(Number.isFinite));
        assert(x >= 0 && y >= 0 && width > 0 && height > 0);
        assert(x + width <= 210.1 && y + height <= 297.1);
      }
    }
    assert(!(await p.locator("#guarantorCard").isVisible()));
    assert(!(await p.locator("#count").isVisible()));
    await p.locator("#buyer").fill("مشتري تجريبي");
    await p.locator("#buyerPhone").fill("07700000000");
    await p.locator("#buyerAddress").fill("بغداد");
    await p.locator("#buyerId").fill("123456789012");
    await p.locator("#car").fill("شانجان CS75");
    await p.locator("#model").fill("2026");
    await p.locator("#color").fill("أبيض");
    await p.locator("#vin").fill("TEST0000000000001");
    await p.locator("#total").fill("12000000");
    await p.locator("#cashReceived").fill("4000000");
    await p.locator("#cashDueDate").fill("2027-02-01");
    assert.deepEqual(await p.evaluate(() => calculate(d).errors), []);
    assert.equal(await p.evaluate(() => calculate(d).remaining), 8000000);
    assert(!(await p.evaluate(() => Schedule.enabled(0))));
    await p.locator("#cashTransferLetter").check();
    for (let i = 0; i < 4; i++) {
      await p.locator("#addPaymentSlot").click();
      await p.locator("#cash-amount-" + i).fill("2000000");
      await p.locator("#cash-date-" + i).fill("2027-0" + (i + 1) + "-12");
    }
    assert.deepEqual(await p.evaluate(() => calculate(d).errors), []);
    assert.match(
      (await p.locator('[data-node="cash-extra-date-3"]').innerText()).replace(/[\u200f\u2066-\u2069]/g,""),
      /١٢\/٠٤\/٢٠٢٧/,
    );
    assert.deepEqual(
      await p.evaluate(() => App.displayPages.map((p) => p.id)),
      [1, 2, 4, 5, 7, 8, 9002, 0],
    );
    await p.locator("#noWarranty").check();
    assert.deepEqual(
      await p.evaluate(() => App.displayPages.map((p) => p.id)),
      [1, 4, 7, 8, 9002, 0],
    );
    await p.locator("#noWarranty").uncheck();
    assert.equal(await p.evaluate(() => Archive.balances(d).paid), 4000000);
    assert.deepEqual(await positions(), blankLayout);
    await p.locator("#cash-amount-1").fill("");
    await p.locator("#cash-date-1").fill("");
    assert.equal(
      await p.locator('[data-node="cash-extra-money-1"]').count(),
      0,
    );
    assert.match(
      (await p.locator('[data-node="cash-extra-date-2"]').innerText()).replace(/[\u200f\u2066-\u2069]/g,""),
      /١٢\/٠٣\/٢٠٢٧/,
    );
    assert.deepEqual(await positions(), blankLayout);
    await p.locator("#cash-amount-1").fill("2000000");
    await p.locator("#cash-date-1").fill("2027-02-12");
    assert.equal(
      await p
        .locator('#pages [data-node="cash-clause-12"]')
        .getAttribute("data-clause-number"),
      "-",
    );
    await p.locator("#cash-amount-3").fill("2500000");
    await p.locator("#cash-amount-3").blur();
    assert.match(await p.locator("#validation").innerText(), /الواصل والدفعات تتجاوز/);
    await p.locator("#cash-amount-3").fill("2000000");
    await p
      .locator("#cashTransferNote")
      .fill("تراجع معاملة نقل الملكية لدى الفرع.");
    await p.locator("#notes").fill("تسلّم المشتري نسخة العقد.");
    await p.locator("#pagePreview").selectOption("0");
    assert.equal(await p.evaluate(() => App.page), 0);
    const letter = p.locator('#pages .paper[data-page="0"]');
    await letter.scrollIntoViewIfNeeded();
    await p.waitForFunction(() => document.querySelector('#pages .paper[data-page="0"]')?.innerText.includes("مشتري تجريبي"));
    assert.match(await letter.innerText(), /مشتري تجريبي/);
    assert.equal(
      await letter.locator('[data-node="transfer-agents"] tbody tr').count(),
      9,
    );
    assert.equal(
      await letter.locator('[data-node="transfer-parties"]').count(),
      0,
    );
    assert.equal(
      await letter.locator('[data-node="transfer-buyer"]').innerText(),
      "مشتري تجريبي",
    );
    assert.match(
      await letter.locator('[data-node="transfer-intro"]').innerText(),
      /إلى:$/,
    );
    for (const id of [0, 4]) {
      const cells = p.locator('#pages [data-page="' + id + '"] .vehicle-cell');
      assert.equal(await cells.count(), 10);
      assert.equal(await cells.last().textContent(), "أبيض");
    }
    const companySelect = p.locator("#companySelect");
    const initialCompany = await companySelect.inputValue();
    const nextCompany = await companySelect
      .locator("option")
      .evaluateAll(
        (options, id) => options.find((o) => o.value !== id).value,
        initialCompany,
      );
    await companySelect.selectOption(nextCompany);
    assert(await checkHeaders());
    assert.match(
      await letter.locator('[data-node="transfer-to"]').textContent(),
      new RegExp(await p.evaluate(() => co().name)),
    );
    await companySelect.selectOption(initialCompany);
    await p.locator("#cashTransferLetter").uncheck();
    assert.equal(await p.evaluate(() => Schedule.enabled(0)), false);
    await p.locator("#cashTransferLetter").check();
    assert.match(
      await p.locator('[data-node="cash-clause-12"]').textContent(),
      /عداد المسافات/,
    );
    assert(
      (await p.locator('#pages .paper[data-page="1"]').textContent()).replace(/[\u200f\u2066-\u2069]/g,"").includes(
        await p.evaluate(() => dateLabel(d.contractDate).replace(/\d/g,n=>"٠١٢٣٤٥٦٧٨٩"[n])),
      ),
    );
    assert.equal(
      await p
        .locator('#pages .paper[data-page="1"] [data-node="cash-transfer"]')
        .count(),
      0,
    );
    const letterNote = letter.locator('[data-node="transfer-note"]');
    assert.equal(
      await letterNote.evaluate((el) => getComputedStyle(el).color),
      "rgb(176, 0, 32)",
    );
    const location = await letter.evaluate((el) => {
      const rect = (id) =>
        el
          .querySelector('[data-node="transfer-' + id + '"]')
          .getBoundingClientRect();
      return (
        rect("vehicle-row-4-1").bottom < rect("note").top &&
        rect("note").bottom < rect("agents").top &&
        rect("manager").left < rect("organizer").left
      );
    });
    assert(location);
    const noteMetrics = () => letterNote.evaluate(el => {
      const body = el.querySelector(".node-content");
      const image = el.querySelector(".document-ink").getBoundingClientRect();
      return {size:getComputedStyle(body).fontSize, width:el.getBoundingClientRect().width, scroll:image.width,
        height:image.height, value:body.textContent};
    });
    const shortNote = await noteMetrics();
    const longNote = "ش".repeat(160);
    await p.locator("#cashTransferNote").fill(longNote);
    await p.locator("#cashTransferNote").blur();
    const wrapped = await noteMetrics();
    assert.equal(wrapped.size, shortNote.size);
    assert(wrapped.height > shortNote.height && wrapped.scroll <= wrapped.width + 1);
    assert(wrapped.value.includes(longNote));
    await p
      .locator("#cashTransferNote")
      .fill("تراجع معاملة نقل الملكية لدى الفرع.");
    await p.locator("#archiveContractType").selectOption("exchange");
    await p.locator("#cashTransferLetter").check();
    assert(await p.locator("#cashTransferNote").isVisible());
    assert.equal(
      await p.locator('[data-node="transfer-note"]').textContent(),
      "تراجع معاملة نقل الملكية لدى الفرع.",
    );
    assert(
      await p.evaluate(() =>
        [3, 6].every(
          (id) =>
            JSON.stringify(App.scene.pages.find((p) => p.id === id).nodes) ===
            JSON.stringify(ContractTemplates.scoped(cfg.design,"contract:exchange").pages.find((p) => p.id === id).nodes),
        ),
      ),
    );
    await p.locator("#cashTransferNote").fill("");
    await p.locator("#cashTransferNote").blur();
    assert.equal(await p.locator('[data-node="transfer-note"]').count(), 0);
    await p
      .locator("#cashTransferNote")
      .fill("تراجع معاملة نقل الملكية لدى الفرع.");
    await p.locator("#archiveContractType").selectOption("cash");
    await p.emulateMedia({ media: "print" });
    const first = p.locator('#pages .paper[data-page="1"]');
    await letter.screenshot({
      path: path.join(os.tmpdir(), "contract-transfer-review.png"),
    });
    await first.screenshot({
      path: path.join(os.tmpdir(), "contract-cash-review.png"),
    });
    const bounds = await first.evaluate((el) => {
      const rect = (key) => {
        return el.querySelector('[data-node="cash-' + key + '"] > .document-ink').getBoundingClientRect();
      };
      return {
        clauses: rect("clause-12").bottom,
        warranty: rect("warranty").top,
        warrantyEnd: rect("warranty").bottom,
        notes: rect("notes").top,
      };
    });
    assert(
      bounds.clauses < bounds.warranty && bounds.warrantyEnd <= bounds.notes,
      JSON.stringify(bounds),
    );
    const requestedPages = await p.evaluate(
      () =>
        PrintPlan.arrange(
          [...document.querySelectorAll("#pages > .paper")].filter((paper) =>
            Schedule.enabled(Number(paper.dataset.page)),
          ),
          d,
        ).length,
    );
    await p.evaluate(async()=>{await BranchNumbers.verify(d);Services.refreshPrintClock();render();await DocumentQR.issueSelected();BranchNumbers.printing=BranchNumbers.signature(d);});
    const pdf = await p.pdf({ preferCSSPageSize: true });
    assert.equal(
      (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
      requestedPages,
    );
    await p.emulateMedia({ media: "screen" });
    await p.locator("#cancelPrinted").click();
    await p.locator("#cashReceived").fill("12000000");
    await p.locator("#cashReceived").blur();
    assert.deepEqual(await p.evaluate(() => calculate(d).errors), []);
    assert.equal(
      await p.locator('[data-node="cash-extra-money-0"]').count(),
      0,
    );
    await p.locator("#cashReceived").fill("4000000");
    await p.locator("#archiveContractType").selectOption("installment");
    assert(await p.locator("#guarantorCard").isVisible());
    assert(await p.locator("#count").isVisible());
    assert.equal(await p.locator('[data-node="cash-title"]').count(), 0);
    await p.locator("#archiveContractType").selectOption("cash");
    await p.evaluate(async () => {
      await App.enter();
      App.page = 1;
      App.selection = new Set(["cash-title"]);
      App.property("fontSize", 26);
      await App.approve();
      Services.beforePrint();
      await Services.confirmPrint();
      await Services.showHome();
    });
    await p.reload();
    await p.waitForFunction(() => startReady);
    await p.locator("#printedArchive .archive-open").first().click();
    assert.match(
      await p
        .locator('#archiveViewBody [data-node="transfer-note"]')
        .textContent(),
      /معاملة نقل الملكية/,
    );
    assert.equal(
      await p
        .locator('#archiveViewBody [data-node="cash-title"]')
        .evaluate((el) => el.style.fontSize),
      "26px",
    );
    assert.equal(
      await p
        .locator(
          '#archiveViewBody [data-page="6"],#archiveViewBody [data-page="3"]',
        )
        .count(),
      0,
    );
    assert.match(
      await p
        .locator('#archiveViewBody [data-node="cash-extra-money-3"]')
        .innerText(),
      /2,000,000/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: cash first page, immediate or deferred payment, 4 dates, archive, approved edits and print layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
