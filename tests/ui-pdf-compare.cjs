const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const serve = require("./server.cjs");
(async () => {
  const web = await serve(path.resolve(__dirname, "../dist")),
    browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    const files = ["ui-documents-before.pdf", "ui-documents-after.pdf"].map(
      (file) =>
        Array.from(fs.readFileSync(path.resolve(__dirname, "../work", file))),
    );
    const result = await page.evaluate(async (files) => {
      const reader = await ArchiveOutput.reader();
      const pdfs = await Promise.all(
        files.map(
          (data) =>
            reader.getDocument({
              data: Uint8Array.from(data),
              isEvalSupported: false,
              useSystemFonts: true,
            }).promise,
        ),
      );
      const pages = [];
      for (let i = 1; i <= Math.min(...pdfs.map((p) => p.numPages)); i++) {
        const images = [],
          texts = [];
        for (const pdf of pdfs) {
          const page = await pdf.getPage(i),
            viewport = page.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: context, viewport }).promise;
          images.push(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          );
          texts.push(
            (await page.getTextContent()).items.map((i) => i.str).join(" "),
          );
        }
        let changed = 0;
        for (let p = 0; p < images[0].length; p += 4)
          if (
            [0, 1, 2].some(
              (c) => Math.abs(images[0][p + c] - images[1][p + c]) > 8,
            )
          )
            changed++;
        pages.push({
          page: i,
          changedPixels: changed,
          totalPixels: images[0].length / 4,
          fraction: changed / (images[0].length / 4),
          sameText: texts[0] === texts[1],
          textBefore: texts[0],
          textAfter: texts[1],
        });
      }
      return { counts: pdfs.map((p) => p.numPages), pages };
    }, files);
    fs.writeFileSync(
      path.resolve(__dirname, "../work/ui-pdf-comparison.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          counts: result.counts,
          pages: result.pages.map(({ textBefore, textAfter, ...rest }) => rest),
        },
        null,
        2,
      ),
    );
    assert.equal(result.counts[0], result.counts[1]);
  } finally {
    await browser.close();
    web.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
