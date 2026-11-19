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
    const p = await b.newPage();
    await p.goto(process.env.CONTRACT_TEST_URL);
    await p.waitForFunction(() => startReady);
    assert.equal(
      await p
        .locator(".contracts-mark")
        .evaluate((e) => getComputedStyle(e).fontSize),
      "22px",
    );
    if (await p.locator("#setupDialog").isVisible()) {
      await p.locator("#setupBranch").fill("الدورة");
      await p.locator("#setupOrganizer").fill("اختبار");
      await p.locator("#setupPrefix").fill("Q");
      await p.locator("#setupForm button").click();
    }
    await p.locator("#workNew").click();
    await p.waitForFunction(() => !Services.home);
    await p.evaluate(() => Services.openCamera());
    await p.waitForFunction(
      () => !document.getElementById("takeCustomerPhoto").disabled,
    );
    assert.equal(await p.locator("#cameraZoomValue").textContent(), "110%");
    const box = await p.locator("#cameraFrame").boundingBox();
    assert(Math.abs(box.width - box.height) < 1);
    await p.locator("#cameraFrame").hover();
    await p.mouse.wheel(0, -100);
    await p.waitForFunction(() => Services.cameraZoom > 1.1);
    await p.evaluate(() => Services.takePhoto());
    const dimensions = await p.evaluate(async () => {
      const img = new Image();
      img.src = d.customerPhoto;
      await img.decode();
      return [img.width, img.height];
    });
    assert.equal(dimensions[0], dimensions[1]);
    console.log(
      "PASS square camera, 110% initial zoom, wheel zoom, square saved image, formal home",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
