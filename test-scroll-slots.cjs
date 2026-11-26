const { chromium } = require("playwright"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
(async () => {
  const b = await chromium.launch({ channel: "msedge" });
  try {
    const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
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
    await p.locator("#pageRail .page-item button").nth(1).click();
    assert.equal(
      await p.locator("#pages .paper:visible").count(),
      await p.locator("#pages .paper").count(),
    );
    await p.evaluate(() => {
      const t = document.querySelector('#pages [data-page="3"]');
      document.getElementById("canvas").scrollTop +=
        t.getBoundingClientRect().top -
        document.getElementById("canvas").getBoundingClientRect().top -
        45;
    });
    await p.waitForFunction(() => App.page === 3);
    await p.evaluate(() => {
      cfg.companyFields.push({ key: "test_delete", label: "اختبار" });
      cfg.companyImageSlots.push({ id: "test_slot", label: "اختبار صورة" });
      Services.companyPanel();
    });
    await p.evaluate(() => {
      [...document.querySelectorAll("#companyFieldValues label")]
        .find((l) => l.textContent.includes("test_delete"))
        .querySelector("button")
        .click();
      [...document.querySelectorAll("#companyImageValues > *")]
        .find((l) => l.textContent.includes("اختبار صورة"))
        .lastElementChild.click();
      Services.companyPanel();
    });
    assert(
      await p.evaluate(
        () =>
          !cfg.companyFields.some((f) => f.key === "test_delete") &&
          !cfg.companyImageSlots.some((f) => f.id === "test_slot"),
      ),
    );
    console.log(
      "PASS continuous scroll selection and permanent company slot removal",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
