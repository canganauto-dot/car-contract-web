const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const root = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};
const server = http.createServer((req, res) => {
  const name = path.resolve(
    root,
    "." +
      decodeURIComponent(
        req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0],
      ),
  );
  if (path.relative(root, name).startsWith("..")) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(name, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(name)] || "application/octet-stream",
      "Content-Length": stat.size,
    });
    fs.createReadStream(name).pipe(res);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    channel: "msedge",
    args: ["--enable-precise-memory-info"],
  });
  try {
    const samples = [];
    for (let run = 0; run < 5; run++) {
      const context = await browser.newContext({
        viewport: { width: 1500, height: 1000 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {
        waitUntil: "load",
        timeout: 120000,
      });
      await page.waitForFunction(
        () => typeof startReady !== "undefined" && startReady,
        { timeout: 120000 },
      );
      const sample = await page.evaluate(() => ({
        readyMs: performance.now(),
        loadMs: performance.getEntriesByType("navigation")[0].loadEventEnd,
        resourceBytes:
          performance.getEntriesByType("navigation")[0].encodedBodySize +
          performance
            .getEntriesByType("resource")
            .reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        requests: performance.getEntriesByType("resource").length + 1,
        heapBytes: performance.memory?.usedJSHeapSize,
      }));
      const session = await context.newCDPSession(page);
      await session.send("HeapProfiler.collectGarbage");
      sample.retainedHeapBytes = (
        await session.send("Runtime.getHeapUsage")
      ).usedSize;
      sample.errors = errors;
      samples.push(sample);
      console.log(JSON.stringify({ run: run + 1, ...sample }));
      if (run === 0)
        await page.screenshot({ path: output.replace(/\.json$/, ".png") });
      await context.close();
    }
    const medians = Object.fromEntries(
      [
        "readyMs",
        "loadMs",
        "resourceBytes",
        "requests",
        "heapBytes",
        "retainedHeapBytes",
      ].map((key) => [
        key,
        samples.map((sample) => sample[key]).sort((a, b) => a - b)[2],
      ]),
    );
    fs.writeFileSync(
      output,
      JSON.stringify({ root, samples, medians }, null, 2),
    );
    console.log("MEDIANS " + JSON.stringify(medians));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
