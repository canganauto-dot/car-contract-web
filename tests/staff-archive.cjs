const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const serve = require("./server.cjs");

(async () => {
  const server = await serve(
    process.env.CONTRACT_TEST_BUILD || path.resolve(__dirname, "../dist"),
    { sampleFaces: true },
  );
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(() => startReady);
    if (await page.locator("#setupDialog").isVisible()) {
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupOrganizer").fill("اختبار");
      await page.locator("#setupPrefix").fill("Q");
      await page.locator("#setupForm button").click();
    }
    await page.locator("#workNew").click();
    await page.waitForFunction(() => !Services.home);
    const counts = await page.evaluate(async () => {
      const rows = () =>
        Services.library.entries.filter((e) => e.data.recordId === d.recordId);
      const count = () =>
        rows().map((e) => [
          e.kind,
          e.history?.length || 0,
          !!Archive.signed(e),
        ]);
      const print = async () => {
        Services.beforePrint();
        Services.afterPrint();
        await Promise.all([Services.confirmPrint(), Services.confirmPrint()]);
      };
      d.buyer = "مشتري أول";
      cfg.priceCatalogs=[{id:"fixture",items:[{id:"car",price:2500,model:"2026",trim:"اختبار"}]}];
      d.tableData={test:[{qty:2,priceLink:{catalog:"fixture",item:"car"}}]};
      Services.saveCurrent(d);
      await print();
      const first = count();
      await Services.showHome();
      await Services.openEntry(rows()[0]);
      rows()[0].signedFile = {
        dataUrl: "data:application/pdf;base64,JVBERi0=",
      };
      await print();
      Services.saveCurrent(d);
      await Services.flush();
      const repeated = count();
      d.buyer = "مشتري معدل";
      Services.saveCurrent(d);
      await Services.flush();
      const edited = count();
      await print();
      const changed = count(),
        previous = rows()[0].history[0];
      return {
        first,
        repeated,
        edited,
        changed,
        prior: [previous.data.buyer, !!Archive.signed(previous)],
      };
    });
    assert.deepEqual(counts.first, [["printed", 0, false]]);
    assert.deepEqual(counts.repeated, [["printed", 0, true]]);
    assert.deepEqual(counts.edited, [
      ["draft", 0, false],
      ["printed", 0, true],
    ]);
    assert.deepEqual(counts.changed, [["printed", 1, false]]);
    assert.deepEqual(counts.prior, ["مشتري أول", true]);
    console.log(
      "PASS reprint, double confirmation, real edits and signed history",
    );
    await page.getByRole("button",{name:"حسابي وصلاحياتي"}).click();
    let panel = page.locator("#staffSettings");
    await panel.getByRole("button", { name: "إضافة مستخدم" }).click();
    const dlg = page.locator("dialog.staff-dialog");
    await dlg.getByLabel("الاسم", { exact: true }).fill("موظف تجريبي جديد");
    await dlg.getByLabel("البريد الإلكتروني").fill("qa@example.test");
    await dlg.getByRole("button", { name: "حفظ" }).click();
    assert(await dlg.getByRole("alert").innerText());
    await dlg.getByLabel("الجادرية", { exact: true }).check();
    await dlg.getByRole("button", { name: "حفظ" }).click();
    const row = panel.locator("li").filter({ hasText: "qa@example.test" });
    await row.getByRole("button").click();
    await dlg.getByLabel("حالة العضوية").selectOption("inactive");
    await dlg.getByRole("button", { name: "حفظ" }).click();
    await row.getByText("موقوف", { exact: true }).waitFor();
    await panel
      .getByLabel("الشركة", { exact: true })
      .selectOption({ index: 1 });
    await panel.locator(".staff-directory").waitFor();
    assert.equal(await row.count(), 0);
    for (const role of ["branch_manager", "employee"]) {
      await panel.getByLabel("معاينة الدور").selectOption(role);
      await panel.locator("details[open]").waitFor();
      assert.equal(await panel.locator(".staff-directory").count(), 0);
    }
    console.log(
      "PASS staff administration, branch assignment, suspension, company and role switching",
    );
    const scopes = await page.evaluate(() => {
      const mixed = {
        role: "branch_manager",
        branchIds: ["a", "b"],
        branches: [{ id: "a" }, { id: "b" }],
        branchRoles: { a: "branch_manager", b: "employee" },
      };
      return [
        staffCan(mixed, "manageBranch", "a"),
        staffCan(mixed, "manageBranch", "b"),
        staffCan(mixed, "archive", "b"),
        staffCan(mixed, "archive", "c"),
        staffCan(mixed, "memberships"),
        staffCan({ ...mixed, active: false }, "archive", "a"),
      ];
    });
    assert.deepEqual(scopes, [true, false, true, false, false, false]);
    const record = await page.evaluate(async () => {
      const parent = Services.library.entries.find((e) => e.kind === "printed");
      const legacy = {
        ...parent.history[0],
        kind: "draft",
        id: "revision:test-old",
      };
      Services.library.entries.push(legacy);
      await Services.persistLibrary();
      return parent.data.recordId;
    });
    await page.reload();
    await page.waitForFunction(() => startReady);
    assert.deepEqual(
      await page.evaluate((id) => {
        const parent = Services.library.entries.find(
          (e) => e.data.recordId === id && e.kind === "printed",
        );
        const old = parent.history.find((e) => e.id === "revision:test-old");
        return [
          Services.library.entries.some((e) => e.id === "revision:test-old"),
          old.kind,
          !!Archive.signed(old),
        ];
      }, record),
      [false, "printed", true],
    );
    console.log(
      "PASS mixed branch permissions, inactive scope and legacy signed history",
    );
    assert.deepEqual(errors, []);
    const connected = await browser.newPage();
    const calls = [];
    let authenticated = false,
      role = "branch_manager";
    await connected.route(server.url, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "<head>",
          '<head><meta name="contract-staff-api" content="enabled">',
        ),
      });
    });
    await connected.route("**/api/staff/**", async (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      calls.push(endpoint);
      if (endpoint.endsWith("/login")) authenticated = true;
      if (endpoint.endsWith("/logout")) authenticated = false;
      const c = {
        id: "company-a",
        memberId: "me",
        name: "شركة",
        role,
        branches: [{ id: "a", name: "فرع" }],
        branchIds: ["a"],
      };
      const status =
        endpoint.endsWith("/session") && !authenticated
          ? 401
          : endpoint.endsWith("/members")
            ? 403
            : 200;
      await route.fulfill({
        status,
        json: endpoint.endsWith("/session")
          ? { name: "موظف", companies: [c], csrf: "test-token" }
          : {},
      });
    });
    await connected.goto(server.url);
    await connected.waitForFunction(() => startReady);
    await connected.evaluate(() => {
      if ($("setupDialog").open) $("setupDialog").close();
      Workspace.open("staff");
    });
    panel = connected.locator("#staffSettings");
    await panel.getByLabel("البريد الإلكتروني").fill("user@example.test");
    await panel.getByLabel("كلمة المرور").fill("test-password");
    await panel.getByRole("button", { name: "تسجيل الدخول" }).click();
    await panel.getByRole("button", { name: "تسجيل الخروج" }).waitFor();
    assert.equal(
      calls.some((url) => url.endsWith("/members")),
      false,
    );
    assert.equal(await panel.getByLabel("معاينة الدور").count(), 0);
    role = "administrator";
    await connected.evaluate(() => StaffConsole.refresh());
    assert.match(await panel.getByRole("status").textContent(), /صلاحية/);
    assert.equal(await panel.locator(".staff-directory").count(), 0);
    console.log(
      "PASS connected login, restricted role, server denial without demo fallback",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
