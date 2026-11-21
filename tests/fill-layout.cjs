const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const serve = require("./server.cjs");

(async () => {
  const web = await serve(process.env.CONTRACT_TEST_BUILD || path.resolve(__dirname, "../dist"));
  let browser;
  try {
    browser = await chromium.launch({channel:"msedge"});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    if (await page.locator("#setupDialog").isVisible()) {
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupOrganizer").fill("اختبار");
      await page.locator("#setupPrefix").fill("F");
      await page.locator("#setupForm button").click();
      await page.locator("#setupDialog").waitFor({state:"hidden"});
    }
    await page.evaluate(async () => {await Services.createContract(); await document.fonts.ready;});
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const field = id => page.locator("#"+id).evaluate(input => {
      const label=input.closest("label"), box=label.getBoundingClientRect();
      const caption=label.querySelector(".entry-caption").getBoundingClientRect();
      const value=(label.querySelector(".date-text") || input).getBoundingClientRect();
      return {width:box.width,height:box.height,above:caption.bottom<=value.top+1,inside:value.bottom<=box.bottom+1};
    });
    for (const width of [1440,1100]) {
      await page.setViewportSize({width,height:900});
      await page.locator("#buyerId").waitFor({state:"visible"});
      await settle();
      const before=await field("buyerId");
      await page.locator("#buyerId").fill("12345"+width);
      await page.locator("#buyerId").press("Tab");
      await settle();
      assert.deepEqual(await field("buyerId"),before);
      assert(before.above && before.inside && before.height>25,JSON.stringify(before));
      const intersections=await page.evaluate(()=>{
        const rows=[["buyer","customerCapture","buyerPhone"],["companySelect","brand"],["payment","count","firstDate"]];
        return rows.flatMap(ids=>ids.flatMap((id,i)=>{
          const bounds=key=>($(key).closest("label") || $(key)).getBoundingClientRect();
          const a=bounds(id);
          return ids.slice(i+1).filter(other=>{
            const b=bounds(other);
            return Math.min(a.right,b.right)>Math.max(a.left,b.left)+2 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+2;
          }).map(other=>[id,other]);
        }));
      });
      assert.deepEqual(intersections,[]);
      const aligned=await page.evaluate(()=>["buyer","guarantor"].map(prefix=>["Id","IdDate","IdFrom"]
        .map(key=>$(prefix+key).closest("label").getBoundingClientRect().top)));
      for(const row of aligned) assert(Math.max(...row)-Math.min(...row)<2,JSON.stringify(aligned));
    }
    console.log("PASS field dimensions and caption alignment through input and blur at two viewport widths");

    await page.setViewportSize({width:1440,height:900});await settle();
    const natural=await field("buyerId");
    await page.evaluate(() => {FillLayout.open();FillLayout.select("buyerId");});
    const panel=page.locator(".fill-layout-panel");
    const height=panel.locator("label").filter({hasText:"الارتفاع (١–٣)"}).locator("input");
    await height.fill("3"); await height.press("Tab");
    const tall=await field("buyerId");
    assert(tall.height>2.8*natural.height && tall.above && tall.inside,JSON.stringify({natural,tall}));
    await height.fill("1"); await height.press("Tab");
    assert.deepEqual(await field("buyerId"),natural);
    const size=panel.locator("label").filter({hasText:"حجم المحتوى"}).locator("input");
    await size.fill("52");await size.press("Tab");
    const larger=await field("buyerId");
    assert(larger.height>natural.height && larger.above && larger.inside,JSON.stringify(larger));
    await panel.getByRole("button",{name:"إلغاء",exact:true}).click();
    assert.deepEqual(await field("buyerId"),natural);
    console.log("PASS inspector resizes the entire field from one to three rows and restores it on cancel");

    const short=await field("notes");
    await page.locator("#notes").fill("الأول\nالثاني\nالثالث\nالرابع");
    const long=await field("notes");
    assert(long.height>short.height+25 && long.inside,JSON.stringify({short,long}));
    await page.locator("#notes").fill("");
    assert.deepEqual(await field("notes"),short);
    await page.locator("#notes").press("Tab");
    const paymentLayout=()=>page.evaluate(()=>{
      const top=$("paymentCard").getBoundingClientRect().top;
      const bounds=element=>{const r=element.getBoundingClientRect();return [r.top-top,r.bottom-top];};
      return {button:bounds($("addPaymentSlot")),notes:bounds($("financialNotes")),
        rows:[...$("extraEditors").children].filter(n=>!n.hidden).map(bounds)};
    });
    const start=await paymentLayout();
    for(let n=1;n<=4;n++){
      await page.locator("#addPaymentSlot").click();
      await settle();
      const state=await paymentLayout();
      assert.equal(state.rows.length,n);
      assert(Math.abs(state.button[0]-start.button[0])<=1,JSON.stringify(state));
      assert(state.notes[0]>=state.rows.at(-1)[1],JSON.stringify(state));
    }
    for(let n=4;n>0;n--)await page.locator("#extraEditors .extra-card:not([hidden]) .remove-payment").last().click();
    await settle();
    assert.deepEqual(await paymentLayout(),start);
    console.log("PASS notes grow and shrink, four payment rows reserve their space and release it on deletion");

    await page.evaluate(()=>FillLayout.open());
    await panel.getByRole("button",{name:"+ حافظة",exact:true}).click();
    const group=await page.evaluate(()=>FillLayout.selected.slice("section:".length));
    await panel.getByRole("button",{name:"+ خانة",exact:true}).click();
    const added=await page.evaluate(()=>FillLayout.selected);
    const selectType=panel.locator("section select").filter({has:page.locator('option[value="date"]')});
    await selectType.selectOption("date");
    assert.equal(await page.locator("#"+group+" .entry-date > #"+added).count(),1);
    await selectType.selectOption("text");
    assert.equal(await page.locator("#"+group+" .entry-date").count(),0);
    await panel.getByRole("button",{name:"+ زر",exact:true}).click();
    const button=await page.evaluate(()=>FillLayout.selected);
    assert.equal(await page.locator("#"+group+" #"+button).count(),1);
    await page.evaluate(id=>FillLayout.select("section:"+id),group);
    await panel.getByRole("button",{name:"إزالة العنصر",exact:true}).click();
    for(const id of [group,added,button])assert.equal(await page.locator("#"+id).count(),0);
    await panel.getByRole("button",{name:"إلغاء",exact:true}).click();
    console.log("PASS new fields and buttons stay in their selected group, date changes reverse and group deletion cleans up children");

    await page.selectOption("#archiveContractType","exchange");
    await page.locator("#addPaymentSlot").click();
    await settle();
    assert.equal(await page.locator("#oldVehiclePanel").isVisible(),true);
    const title=await field("extra-label-0");
    assert(title.width>0 && title.above && title.inside,JSON.stringify(title));
    await page.selectOption("#archiveContractType","external");
    assert(await page.locator("#externalSellerCard").isVisible() && await page.locator("#externalBuyerCard").isVisible());
    await page.selectOption("#archiveContractType","cash");
    assert.equal(await page.locator("#oldVehiclePanel").isVisible(),false);
    console.log("PASS exchange payment titles, external party sections and cash visibility follow the active contract");

    await page.evaluate(()=>Workbench.start(4));
    const bookBuyer=page.locator("#bookInput-buyer");
    const original=await bookBuyer.elementHandle();
    await bookBuyer.fill("اسم تجريبي"); await bookBuyer.press("Tab");await settle();
    assert(await original.evaluate(node=>node.isConnected && node===document.getElementById(node.id)));
    assert.equal(await page.evaluate(()=>d.buyer),"اسم تجريبي");
    await page.selectOption("#bookType","0");
    assert.equal(await page.locator("#bookInput-cashTransferNote").count(),1);
    await page.evaluate(()=>FillLayout.open());
    await panel.getByRole("button",{name:"+ حافظة",exact:true}).click();
    const bookGroup=await page.evaluate(()=>FillLayout.selected.slice("section:".length));
    await panel.getByRole("button",{name:"+ خانة",exact:true}).click();
    const bookField=await page.evaluate(()=>FillLayout.selected);
    await panel.getByRole("button",{name:"اعتماد",exact:true}).click();
    await panel.waitFor({state:"detached"});
    const heading=page.locator("#"+bookGroup+" .card-heading");
    await heading.click();
    await page.waitForFunction(id=>$(id).closest(".section-inner").inert,bookField);
    await heading.click();
    await page.waitForFunction(id=>!$(id).closest(".section-inner").inert,bookField);
    await page.locator("#"+bookField).fill("قيمة الكتاب");
    await page.locator("#"+bookField).press("Tab");
    assert.equal(await page.evaluate(key=>context()[key],bookField),"قيمة الكتاب");
    await page.evaluate(()=>{
      (cfg.design.fieldRegistry ||= {}).testScoped={scope:"book:0",source:"input",label:"اختبار"};
      (d.bookValues ||= {}).testScoped="خاص بنقل الملكية";
    });
    await page.selectOption("#bookType","4");
    assert.equal(await page.locator("#"+bookGroup).count(),0);
    assert.equal(await page.evaluate(()=>context().testScoped),undefined);
    await page.selectOption("#bookType","0");
    assert.equal(await page.evaluate(()=>context().testScoped),"خاص بنقل الملكية");
    assert.equal(await page.locator("#"+bookField).count(),1);
    assert.deepEqual(errors,[]);
    console.log("PASS books preserve inputs and isolate custom collapsible groups across book types");
  } finally {
    if(browser)await browser.close();
    web.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
