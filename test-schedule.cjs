const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path");
(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage({
        viewport: { width: 1366, height: 768 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.CONTRACT_TEST_URL);
    await page.waitForFunction(() => startReady);
    if (await page.locator("#setupTitle").isVisible()) {
      await page.locator("#setupTitle").fill("موظف العقود");
      await page.locator("#setupOrganizer").fill("اختبار تجريبي");
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupForm button").click();
    }
    await page.locator("#workNew").click();
    await page.waitForFunction(() => !Services.home);
    assert(await page.locator("#carCard #companySelect").isVisible());
    await page.evaluate(() => {cfg.requiredFields = ["buyer"];render();});
    for (const theme of ["light","dark"]) {
      await page.evaluate(theme=>UIPreferences.set("theme",theme),theme);
      const buyer = page.locator("#buyer");
      const border = () =>
        buyer.evaluate((el) => getComputedStyle(el.closest("label")).getPropertyValue("--entry-edge"));
      const emptyBorder = await border();
      assert.equal(await buyer.getAttribute("aria-invalid"), "true");
      assert(
        await buyer.evaluate(
          (el) =>
            getComputedStyle(el).backgroundColor !==
            getComputedStyle(el.closest(".card")).backgroundColor,
        ),
      );
      await buyer.fill("اسم الزبون");
      await buyer.blur();
      assert.notEqual(await border(), emptyBorder);
      await buyer.fill("");
      await buyer.blur();
      assert.equal(await border(), emptyBorder);
      assert.equal(
        await page.locator("#notes").getAttribute("aria-invalid"),
        null,
      );
    }
    for (const [count, expected] of [
      [1, [1]],
      [36, [36]],
      [37, [36, 1]],
      [72, [36, 36]],
      [73, [36, 36, 1]],
      [108, [36, 36, 36]],
      [109, [36, 36, 36, 1]],
    ]) {
      const actual = await page.evaluate((count) => {
        Object.assign(d, {
          total: String(count * 1000),
          payment: "1000",
          count: String(count),
        });
        render();
        return [...document.querySelectorAll(".schedule-page")].map((paper) => {
          const boxes = [...paper.querySelectorAll("[data-type=table]")];
          const left = Math.min(
            ...boxes.map((el) => parseFloat(el.style.left)),
          );
          const right = Math.max(
            ...boxes.map(
              (el) => parseFloat(el.style.left) + parseFloat(el.style.width),
            ),
          );
          return {
            center: (left + right) / 2,
            counts: boxes.map(
              (el) =>
                [...el.querySelectorAll("tbody tr")].filter((tr) =>
                  tr.textContent.trim(),
                ).length,
            ),
          };
        });
      }, count);
      assert.deepEqual(
        actual.flatMap((p) => p.counts),
        expected,
      );
      const approvedCenter = await page.evaluate(() => {
        const columns = App.scene.scheduleTemplate.nodes.filter(n=>/^schedule-col-[0-2]$/.test(n.id));
        return (Math.min(...columns.map(n=>n.x)) + Math.max(...columns.map(n=>n.x+n.w))) / 2;
      });
      assert(actual.every(p => Math.abs(p.center - (p.counts.length === 3 ? approvedCenter : 105)) < 0.1));
    }
    for (const i of [1, 2]) {
      await page.locator("#car").click();
      await page.locator("#carChoices button").nth(i).click();
      assert.equal(
        await page.locator("#car").inputValue(),
        await page.evaluate(
          (i) => [...cfg.cars].sort((a, b) => a.order - b.order)[i].name,
          i,
        ),
      );
    }
    await page.locator("#noWarranty").check();
    assert.equal(
      await page
        .locator(
          '.paper[data-page="2"],.paper[data-page="5"],[data-node="warranty"]',
        )
        .count(),
      0,
    );
    assert(!(await page.locator("#warrantyYears").isVisible()));
    await page.locator("#noWarranty").uncheck();
    assert.equal(
      await page
        .locator(
          '.paper[data-page="2"],.paper[data-page="5"],[data-node="warranty"]',
        )
        .count(),
      3,
    );
    await page.evaluate(() => {
      Object.assign(d, {
        total: "127000",
        deposit: "1000",
        depositDate: "2026-10-01",
        phaseEnabled: true,
        phaseCount: "5",
        phasePayment: "2000",
        phaseSecondCount: "114",
        payment: "1000",
        firstDate: "2026-11-30",
        contractDate: "2026-10-01",
        intervalMonths: "2",
        noWarranty: true,
      });
      d.extras[0] = { label: "دفعة خاصة", amount: "500", date: "2026-10-15" };
      buildInputs();
      render();
    });
    assert.equal(await page.locator(".schedule-page").count(), 2);
    const rows = await page
      .locator(".schedule-page tbody tr:visible")
      .allTextContents();
    assert.equal(rows.length, 122);
    assert(rows[0].includes("المقدمة"));
    assert(rows[1].includes("دفعة خاصة"));
    assert(rows[2].replace(/[\u200f\u2066-\u2069]/g,"").includes("٣٠/١١/٢٠٢٦"));
    assert(rows.at(-1).includes("الأخير · 120"));
    assert(rows.at(-1).includes("1,500"));
    assert(
      await page.evaluate(() =>
        [...document.querySelectorAll(".schedule-page tbody tr")]
          .filter((x) => x.getClientRects().length)
          .every(
            (x) =>
              x.getBoundingClientRect().bottom <=
              x.closest(".scene-node").getBoundingClientRect().bottom + 1,
          ),
      ),
    );
    await page.locator("#pagePreview").selectOption("-2");
    assert(await page.locator('.schedule-page[data-page="-2"]').isVisible());
    await page.evaluate(() => {
      d.pages = [];
      d.skipCompanySheets = "9001,9002";
      applyPageVisibility();
    });
    await page.evaluate(async()=>{await BranchNumbers.verify(d);BranchNumbers.printing=BranchNumbers.signature(d);});
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      path: "development/work/legacy-results/schedule-check.pdf",
    });
    assert.equal(
      (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
      2,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: reselect vehicle, conditional warranty, company in vehicle section, dated two-stage ledger, three columns, continuation and selected A4 printing.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
