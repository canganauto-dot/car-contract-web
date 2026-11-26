const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn,execFileSync} = require("node:child_process");
const {once} = require("node:events");
const readline = require("node:readline");
const {chromium} = require("playwright");

(async()=>{
  const source=path.resolve(__dirname,"..");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"contract-shared-test-"));
  let host,browser;
  try{
    for(const file of fs.readdirSync(source,{withFileTypes:true})){
      if(file.isFile() && /\.(py|html|js|css|json)$/.test(file.name))
        fs.copyFileSync(path.join(source,file.name),path.join(temp,file.name));
    }
    for(const dir of ["templates","dist","vendor","assets"])
      fs.cpSync(path.join(source,dir),path.join(temp,dir),{recursive:true});
    fs.symlinkSync(path.join(source,"node_modules"),path.join(temp,"node_modules"),"junction");
    const seedFile=path.join(temp,"initial-data.json");
    const seed=JSON.parse(fs.readFileSync(seedFile));
    const design=seed.config.design;
    const layout=(design.documentLayouts ||= {})["contract:installment"] ||= {};
    layout.pages=(layout.pages || design.pages).map(p=>p.id===1?{...p,nodes:[]}:p);
    delete layout.approvedLayout;
    fs.writeFileSync(seedFile,JSON.stringify(seed));
    const python=execFileSync("py",["-3","-c","import sys;print(sys.executable)"],{encoding:"utf8"}).trim();
    host=spawn(python,["-B","serve_contracts.py","--port","0","--preview-port","0"],{cwd:temp,windowsHide:true,stdio:["ignore","pipe","inherit"]});
    const lines=readline.createInterface({input:host.stdout});
    const [ports]=await Promise.race([once(lines,"line"),once(host,"exit").then(()=>{throw Error("test host failed to start");})]);
    const {main,preview}=JSON.parse(ports);
    const mainURL="http://127.0.0.1:"+main, previewURL="http://localhost:"+preview;
    const get=async url=>(await (await fetch(url+"/_defaults")).json()).config;
    const scoped=(config)=>config.design.documentLayouts["contract:installment"].pages.find(p=>p.id===1);
    const initial=await get(mainURL), examples=await get(previewURL);
    assert.equal(scoped(initial).nodes.length,0);
    assert(scoped(examples).nodes.length>0);
    browser=await chromium.launch({channel:"msedge"});
    const open=async(url,prefix)=>{
      const page=await browser.newPage();
      page.on("pageerror",error=>console.error(error));
      await page.goto(url);await page.waitForFunction(()=>startReady);
      await page.locator("#setupTitle").fill("موظف العقود");
      await page.locator("#setupOrganizer").fill("اختبار "+prefix);
      await page.locator("#setupBranch").fill("اختبار");
      await page.locator("#setupForm button").click();
      await page.locator("#setupDialog").waitFor({state:"hidden"});
      await page.locator("#workNew").click();
      await page.waitForFunction(()=>!Services.home && !Workbench.switching);
      return page;
    };
    const editor=await open(previewURL,"E"), reader=await open(mainURL,"R");
    // The setup screens and ordinary saves must never promote preview-only example pages.
    assert.equal(scoped(await get(mainURL)).nodes.length,0);
    await editor.evaluate(()=>App.enter());
    const name="اختبار اعتماد مشترك";
    const id=await editor.evaluate(name=>{const n=App.create("text");n.html=name;App.render();App.persist();return n.id;},name);
    assert.equal(scoped(await get(mainURL)).nodes.some(n=>n.id===id),false);
    await reader.locator("#buyer").fill("قيمة قبل الانتقال");
    await editor.locator('[data-action="approve"]').click();
    await editor.waitForFunction(()=>App.mode==="fill");
    let saved=await get(mainURL);
    assert(scoped(saved).nodes.some(n=>n.id===id && n.html===name));
    assert.equal(saved.design.documentLayouts["contract:installment"].approvedLayout,true);
    assert.deepEqual(scoped(await get(previewURL)),scoped(saved));
    assert.equal(JSON.stringify(saved).includes("قيمة قبل الانتقال"),false);
    assert(fs.existsSync(path.join(temp,"work/default-backups")));
    await reader.evaluate(()=>SharedDefaults.refresh());
    assert.equal(await reader.locator("#buyer").inputValue(),"قيمة قبل الانتقال");
    await reader.locator("#buyer").press("Tab");
    await reader.waitForFunction(id=>!!App.element(id),id,{timeout:18000});
    assert.equal(await reader.locator("#buyer").inputValue(),"قيمة قبل الانتقال");
    assert.equal(await reader.evaluate(()=>cfg.fixed.prefix),"R");
    assert.equal(await reader.locator('[data-node="'+id+'"] .node-content').first().textContent(),name);
    console.log("PASS preview editor publishes to the project and a separate active browser receives it after input commit");

    await reader.evaluate(()=>App.enter());
    await editor.evaluate(async()=>{await App.enter();App.create("text");await App.approve();});
    await reader.evaluate(()=>{App.create("text");void App.approve();});
    await reader.locator("#feedbackDialog").waitFor({state:"visible"});
    assert.match(await reader.locator("#feedbackMessage").textContent(),/نسخة أحدث/);
    await reader.locator("#feedbackAccept").click();
    assert.equal(await reader.evaluate(()=>App.mode),"design");
    assert(await reader.evaluate(async()=>!!(await getDB("designDraft:contract:installment"))));
    console.log("PASS stale editor keeps its draft and cannot overwrite the other approval");

    await editor.evaluate(async()=>{const copy=await getDB("config");const face=copy.design.documentLayouts["contract:installment"].pages.find(p=>p.id===1);face.nodes=[];await putDB("config",copy);});
    await editor.reload();await editor.waitForFunction(()=>startReady);
    assert(await editor.evaluate(id=>cfg.design.documentLayouts["contract:installment"].pages.find(p=>p.id===1).nodes.some(n=>n.id===id),id));
    const final=await get(mainURL);
    assert.equal((await fetch(mainURL+"/_defaults",{headers:{"If-None-Match":'"'+final.sharedRevision+'"'}})).status,304);
    assert.equal((await fetch(mainURL+"/_defaults",{method:"POST",headers:{Origin:"http://unrelated.invalid","Content-Type":"application/json","If-Match":final.sharedRevision},body:"{}"})).status,403);
    assert.equal(final.sharedRevision,(await get(previewURL)).sharedRevision);
    console.log("PASS startup takes approved layout over stale local cache, revision polling and origin restrictions");
  }finally{
    if(browser)await browser.close();
    if(host && host.exitCode===null){const ended=once(host,"exit");host.kill();await ended;}
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
