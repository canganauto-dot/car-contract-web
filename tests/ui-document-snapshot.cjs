const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const serve = require("./server.cjs");
(async () => {
  const web = await serve(path.resolve(__dirname, "../dist"));
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
    });
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    const out = {};
    for (const type of ["installment", "cash", "exchange", "external"]) {
      out[type] = await page.evaluate((type) => {
        d = normalizeData({
          ...fresh(),
          contractType: type,
          contractDate: "2026-11-13",
          contractTime: "12:00",
          firstDate: "2026-12-13",
          depositDate: "2026-11-13",
          dateManual: true,
          timeManual: true,
          buyer: "زبون اختبار",
          number: "TEST-1",
          total: 10000000,
          deposit: 2000000,
          count: 20,
          payment: 400000,
        });
        Services.home = false;
        document.body.classList.remove("home-mode");
        App.scene = null;
        render();
        return [...document.querySelectorAll("#pages .paper")].map((p) => ({
          id: p.dataset.page,
          nodes: [...p.querySelectorAll(".scene-node")].map((n) => {
            const s = getComputedStyle(n);
            return {
              id: n.dataset.node,
              text: n.textContent,
              style: [
                "left",
                "top",
                "width",
                "height",
                "fontFamily",
                "fontSize",
                "lineHeight",
                "color",
                "backgroundColor",
                "border",
                "fontWeight",
              ].map((k) => s[k]),
            };
          }),
        }));
      }, type);
    }
    const target = path.resolve(
      __dirname,
      "../work",
      process.argv[2] || "ui-documents.json",
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 2));
    // Match the recorded baseline's automatic print stamp for pixel comparison.
    await page.evaluate(() => {
      d.manualContractDate = true;
      d.manualContractTime = true;
      d.contractDate = "2026-11-13";
      d.contractTime = "17:42";
      render();
    });
    await page.pdf({
      path: target.replace(".json", ".pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
    console.log(target);
  } finally {
    await browser.close();
    web.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
