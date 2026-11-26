const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const serve = require("./server.cjs");

(async () => {
  const web = await serve(path.resolve(__dirname, "../dist"));
  let browser;
  try {
    browser = await chromium.launch({channel: "msedge"});
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web.url);
    await page.waitForFunction(() => startReady);
    if (await page.locator("#setupDialog").isVisible()) {
      await page.locator("#setupBranch").fill("الدورة");
      await page.locator("#setupOrganizer").fill("اختبار تجريبي");
      await page.locator("#setupTitle").fill("موظف العقود");
      await page.locator("#setupForm button").click();
    }
    await page.evaluate(async () => { await Services.createContract(); await App.enter(); });

    const sample = await page.evaluate(() => {
      const n = App.create("text");
      Object.assign(n, {fontSize: 24, lineHeight: 1.5, x: 12, y: 26, w: 16, h: 6, verticalAlign: "top",
        html: '  كلمة طويلة<br>ABCDEFGHIJK0123456789', manualFontSize: false, nowrap: true, balanced: true});
      App.render();
      return n.id;
    });
    const devtools = await page.context().newCDPSession(page);
    await devtools.send("DOM.enable");
    await devtools.send("CSS.enable");
    const {root} = await devtools.send("DOM.getDocument");
    const {nodeId} = await devtools.send("DOM.querySelector", {
      nodeId:root.nodeId, selector:`#pages [data-node="${sample}"] .node-content`
    });
    const {fonts} = await devtools.send("CSS.getPlatformFontsForNode", {nodeId});
    assert(fonts.some(f => f.isCustomFont && /alyamama/i.test(f.familyName) && f.glyphCount > 0),
      JSON.stringify(fonts));
    assert((await page.locator("#buyer").evaluate(el => getComputedStyle(el).fontFamily)).includes("Alyamama"));
    console.log("PASS embedded Alyamama renders glyphs in the document and applies to form inputs");
    const snapshot = () => page.evaluate(id => {
      const el = App.element(id), body = el.firstElementChild, style = getComputedStyle(body);
      return {size:style.fontSize, line:style.lineHeight, spaces:style.whiteSpace,
        height:body.offsetHeight, width:body.clientWidth, scroll:body.scrollWidth, text:body.innerHTML};
    }, sample);
    const narrow = await snapshot();
    assert.equal(narrow.size, "24px");
    assert.equal(narrow.line, "36px");
    assert.equal(narrow.spaces, "pre-wrap");
    assert(narrow.height > 72 && narrow.scroll <= narrow.width + 1);
    assert(narrow.text.startsWith("  ") && narrow.text.includes("<br>"));
    await page.evaluate(() => App.property("w", 130));
    const wide = await snapshot();
    assert.equal(wide.size, narrow.size);
    assert.equal(wide.line, narrow.line);
    assert(wide.height < narrow.height);
    await page.emulateMedia({media:"print"});
    const printed = await snapshot();
    assert.equal(printed.size, wide.size);
    assert.equal(printed.line, wide.line);
    await page.emulateMedia({media:"screen"});
    console.log("PASS Arabic wrapping, long identifiers, spacing, resizing and print styles");

    const tokens = await page.evaluate(() => {
      const div = document.createElement("div");
      renderMarkup(div, '<b>{{bu</b><i>yer}}</i> {{x}}<br>{<br>{x}}', false, {buyer:"<اسم>", x:0});
      const rich = documentTextContent({tokenRich:{token:"x", runs:[
        {length:-2, style:{position:"fixed"}}, {length:1,style:{fontWeight:"700"}}, {length:50}
      ]}}, {x:"123"});
      return [div.innerHTML,rich.textContent,rich.children[1].style.fontWeight,rich.children[0].style.position];
    });
    assert.deepEqual(tokens,['<b>&lt;اسم&gt;</b><i></i> 0<br>{<br>{x}}',"123","700",""]);
    assert.deepEqual(await page.evaluate(()=>[...documentVariables({nodes:[
      {html:"<b>{{bu</b>yer}} {{bad<br>Name}}"}, {tokenRich:{token:"rich"}},
      {type:"table",html:"<table><tr><td>{{cross</td><td>Cell}}</td><td>{{price}}</td></tr></table>"}
    ]})]),["buyer","rich","price"]);

    await page.evaluate(id => {
      App.editText(id);
      const editor = App.editing.element, range = document.createRange();
      range.setStart(editor.firstChild, 2); range.setEnd(editor.firstChild, 6);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      App.range = range.cloneRange();
      App.format("underline");
      $("fontSize").value="31.5"; $("fontSize").dispatchEvent(new Event("change"));
      App.commitText();
    }, sample);
    const styled = await page.evaluate(id => {
      const el=App.element(id);
      return [App.node(id).fontSize, el.classList.contains("field-underlined"),
        [...el.querySelectorAll("*")].some(e => e.style.fontSize === "31.5px"),
        [...el.querySelectorAll("*")].some(e => e.tagName==="U" || e.style.textDecoration.includes("underline"))];
    }, sample);
    assert.deepEqual(styled,[24,false,true,true]);
    console.log("PASS partial underline and fractional sizes, split variable names and literal user data");

    const limits = await page.evaluate(id => {
      const n=App.node(id);
      const prior=App.history.length;
      App.property("w","");
      const kept=App.history.length===prior && n.w===130;
      App.property("lineHeight",1000); App.property("fontSize",-15); App.property("strokeWidth",0);
      App.property("w",1000); App.property("x",2000);
      return [kept,n.w,n.x,n.fontSize,n.lineHeight,n.strokeWidth];
    }, sample);
    assert.deepEqual(limits,[true,198,12,6,3,0]);
    console.log("PASS page bounds, empty and out-of-range settings and zero stroke");

    const scopes = await page.evaluate(async id => {
      const first=ContractTemplates.scopeKey();
      App.leave();
      d.contractType="cash"; App.scene=null; App.render(); await App.enter();
      const n=App.create("text"); n.html="نص نقدي تجريبي"; App.persist(); App.leave();
      await App.draftQueue;
      const other=await getDB("designDraft:contract:cash");
      d.contractType="installment"; App.scene=null; App.render(); await App.enter();
      return [first, !!App.node(id), !!other, App.current().nodes.some(x => x.id===n.id)];
    },sample);
    assert.deepEqual(scopes,["contract:installment",true,true,false]);
    console.log("PASS independent contract design drafts across switches");
    assert.deepEqual(errors,[]);
  } finally {
    try { await browser?.close(); } finally { web.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
