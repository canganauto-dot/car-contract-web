const assert = require("node:assert/strict");
const {createHash,randomBytes} = require("node:crypto");
const {spawn,execFileSync} = require("node:child_process");
const {once} = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const {chromium} = require("playwright");

(async()=>{
  const root=path.resolve(__dirname,".."), dist=path.join(root,"dist");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"pages-templates-"));
  const key=randomBytes(32).toString("hex");
  const hash=value=>createHash("sha256").update(value).digest("hex");
  const mount="/car-contract-web/";
  let seed=fs.readFileSync(path.join(dist,"assets/js/seed.js")), build=hash(seed);
  let endpoint="",service,browser;
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,"http://localhost").pathname;
    if(!name.startsWith(mount) || !["HEAD","GET"].includes(req.method))return res.writeHead(404).end();
    const rel=name.slice(mount.length) || "index.html";
    const filename=path.join(dist,rel);
    if(path.relative(dist,filename).startsWith("..") || !fs.existsSync(filename))return res.writeHead(404).end();
    const body=rel==="assets/template-sync.json" ? JSON.stringify({build,endpoint})
      : rel==="assets/js/seed.js" ? seed : fs.readFileSync(filename);
    const type={".js":"text/javascript",".wasm":"application/wasm",".css":"text/css",".html":"text/html",".json":"application/json",".png":"image/png",".jpg":"image/jpeg"};
    res.writeHead(200,{"Content-Type":type[path.extname(filename)] || "application/octet-stream","Cache-Control":"no-store"}).end(body);
  });
  const stopService=async()=>{
    if(service && service.exitCode===null){const end=once(service,"exit");service.kill();await end;}
  };
  try{
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const origin="http://127.0.0.1:"+server.address().port;
    const python=execFileSync("py",["-3","-c","import sys;print(sys.executable)"],{encoding:"utf8"}).trim();
    async function startService(port=0){
      service=spawn(python,["-B","template_service.py","--port",String(port),"--origin",origin,"--store",path.join(temp,"templates.sqlite")],
        {cwd:root,windowsHide:true,env:{...process.env,CONTRACT_TEMPLATE_TOKEN_SHA256:hash(key),CONTRACT_BRANCH_KEY_HASHES:JSON.stringify({"اختبار":hash(key)})},stdio:["ignore","pipe","ignore"]});
      const lines=readline.createInterface({input:service.stdout});
      const [assigned]=await Promise.race([once(lines,"line"),once(service,"exit").then(()=>{throw Error("template service failed to start");})]);
      return "http://127.0.0.1:"+assigned+"/templates";
    }
    endpoint=await startService();
    browser=await chromium.launch({channel:"msedge"});
    async function open(prefix){
      const page=await browser.newPage();
      await page.goto(origin+mount);await page.waitForFunction(()=>startReady);
      await page.locator("#setupTitle").fill("موظف العقود");
      await page.locator("#setupOrganizer").fill("اختبار "+prefix);
      await page.locator("#setupBranch").fill("اختبار");
      await page.locator("#setupForm button").click();
      await page.locator("#setupDialog").waitFor({state:"hidden"});
      await page.locator("#workNew").click();
      await page.locator("dialog[open] input[type=password]").fill(key);
      await page.locator('dialog[open] button[value="publish"]').click();
      await page.waitForFunction(()=>!Services.home && !Workbench.switching);
      return page;
    }
    const editor=await open("E"), reader=await open("R");
    assert(await editor.evaluate(()=>SharedDefaults.pages && !!PagesTemplates.endpoint && !SharedDefaults.unavailable));
    const original=await editor.locator("#contractNumber").inputValue(), second=await reader.locator("#contractNumber").inputValue();
    assert.equal(Number(second.split("-").at(-1)),Number(original.split("-").at(-1))+1);
    await editor.locator("#contractNumber").fill("77");
    await editor.locator("#contractNumber").press("Tab");
    await editor.waitForFunction(()=>d.number==="77");
    const imported=await reader.evaluate(async()=>{
      const file=new File([JSON.stringify({format:"contracts-data",version:1,origin:"offline",data:{
        recordId:"dummy-offline-file",number:"77",numberBranch:"اختبار"}})],"offline.json",{type:"application/json"});
      await ContractFiles.load(file);await ContractFiles.load(file);await BranchNumbers.verify(d);
      if(JSON.parse(ContractFiles.pack(d)).origin!=="offline")throw Error("Lost offline provenance on re-export");
      return d.number;
    });
    assert.equal(imported,"77-F");
    const importCollision=()=>reader.evaluate(()=>ContractFiles.load(new File([JSON.stringify({
      format:"contracts-data",version:1,origin:"offline",data:{recordId:"another-offline-file",number:"77",numberBranch:"اختبار"}
    })],"another.json",{type:"application/json"})));
    const firstImport=importCollision();
    await reader.locator("#feedbackDialog").waitFor({state:"visible"});
    assert.match(await reader.locator("#feedbackMessage").textContent(),/78-F/);
    await reader.locator("#feedbackAccept").click();
    await firstImport;
    const reassigned=await reader.evaluate(()=>d.number);
    assert.match(reassigned,/78-F$/);
    await importCollision();
    assert.equal(await reader.evaluate(()=>d.number),reassigned);
    const bad=await fetch(new URL("numbers",endpoint),{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,Authorization:"Bearer invalid"},
      body:JSON.stringify({mode:"verify",branch:"اختبار",record:"other",label:"77"})});
    assert.equal(bad.status,401);
    console.log("PASS editable shared branch number, immediate draft reservation, independent offline import suffix and branch authorization");
    await editor.locator("#buyer").fill("اسم خاص بمحرر القالب");
    await editor.locator("#buyer").press("Tab");
    await editor.evaluate(()=>App.enter());
    const id=await editor.evaluate(()=>{
      const n=App.create("text");n.html="التصميم المشترك";App.render();App.persist();return n.id;
    });
    await reader.locator("#buyer").fill("زبون اختبار خاص");
    await editor.locator('[data-action="approve"]').click();
    await editor.locator("dialog[open] input[type=password]").fill(key);
    await editor.locator('dialog[open] button[value="publish"]').click();
    await editor.waitForFunction(()=>App.mode==="fill");
    const head=await (await fetch(endpoint)).json(), scope="contract:installment";
    const body=JSON.stringify({scope,...head.layouts[scope]});
    assert(!body.includes("زبون اختبار خاص"));
    assert(!body.includes("اسم خاص بمحرر القالب"));
    assert(head.layouts[scope].layout.pages.some(p=>p.nodes.some(n=>n.id===id)));
    await reader.locator("#buyer").press("Tab");
    await reader.waitForFunction(id=>!!App.element(id),id,{timeout:20000});
    assert.equal(await reader.locator("#buyer").inputValue(),"زبون اختبار خاص");
    assert.equal(await reader.evaluate(()=>cfg.fixed.prefix),"R");
    assert.match(await reader.locator('[data-node="'+id+'"] .node-content').first().textContent(),/التصميم المشترك/);
    console.log("PASS static site under a repository path, editor approval reaches another open browser across origins");

    const put=(data,token=key,from=origin,revision=head.revision)=>fetch(endpoint,{method:"PUT",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,Origin:from,"If-Match":'"'+revision+'"'},body:data});
    assert.equal((await put(body,"invalid")).status,401);
    assert.equal((await put(body,key,"http://unrelated.invalid")).status,403);
    assert.equal((await put(body,key,origin,"0")).status,409);
    assert.equal((await put(JSON.stringify({scope,baseHash:head.layouts[scope].baseHash,layout:{pages:[null]}}))).status,400);
    assert.equal((await fetch(endpoint,{headers:{"If-None-Match":'"'+head.revision+'"'}})).status,304);
    const port=new URL(endpoint).port;
    await stopService();endpoint=await startService(port);
    assert.deepEqual(await (await fetch(endpoint)).json(),head);
    await reader.evaluate(async()=>{const c=await getDB("config");c.design.documentLayouts["contract:installment"].pages=[];await putDB("config",c);});
    await reader.reload();await reader.waitForFunction(()=>startReady);
    await reader.evaluate(key=>BranchNumbers.keys.set("اختبار",key),key);
    assert(await reader.evaluate(id=>cfg.design.documentLayouts["contract:installment"].pages.some(p=>p.nodes.some(n=>n.id===id)),id));
    console.log("PASS revision persistence across service restart, stale browser cache, signature, origin and conflict checks");

    await editor.evaluate(async()=>{await Workbench.start(0);await App.enter();});
    const letterId=await editor.evaluate(()=>{const n=App.create("text");n.html="اختبار كتاب نقل الملكية";App.render();App.persist();return n.id;});
    await editor.locator('[data-action="approve"]').click();
    await editor.locator("dialog[open] input[type=password]").fill(key);
    await editor.locator('dialog[open] button[value="publish"]').click();
    await editor.waitForFunction(()=>App.mode==="fill");
    await reader.evaluate(()=>Workbench.start(0));
    await reader.waitForFunction(id=>!!App.element(id),letterId,{timeout:20000});
    await reader.locator("#bookInput-number").fill("130");
    await reader.locator("#bookInput-number").press("Tab");
    await reader.waitForFunction(()=>d.number==="130" && !d.numberUnconfirmed);
    await reader.evaluate(()=>BranchNumbers.verify(d));
    assert.equal(await reader.locator("#contractNumber").inputValue(),"130");
    const afterLetter=await (await fetch(endpoint)).json();
    assert.deepEqual(afterLetter.layouts[scope],head.layouts[scope]);
    await editor.evaluate(()=>Services.createContract());
    console.log("PASS transfer letter approval reaches a second browser independently of the installment contract");

    const source=seed.toString(), end=source.indexOf(";\nconst ContractAssets=");
    const updated=JSON.parse(source.slice("const ContractSeed=".length,end));
    const layout=updated.config.design.documentLayouts[scope], face=layout.pages.find(p=>p.id===1);
    face.nodes.push({...head.layouts[scope].layout.pages.find(p=>p.id===1).nodes.find(n=>n.id===id),id:"published-face",html:"تصميم الرفع الجديد"});
    const newSeed=Buffer.from("const ContractSeed="+JSON.stringify(updated)+source.slice(end));
    build=hash(newSeed);
    const mismatch=await editor.evaluate(async()=>{try{await PagesTemplates.read();return false;}catch(error){return error.message;}});
    assert.match(mismatch,/تحديث/);
    seed=newSeed;
    await editor.waitForFunction(()=>!!App.element("published-face"),null,{timeout:20000});
    assert.equal(await editor.evaluate(id=>!!App.element(id),id),false);
    endpoint="";
    await editor.waitForFunction(()=>PagesTemplates.endpoint==="",null,{timeout:20000});
    await editor.evaluate(()=>App.enter());
    await editor.evaluate(()=>{App.create("text");App.persist();});
    await editor.locator('[data-action="approve"]').click();
    await editor.locator("#feedbackDialog").waitFor({state:"visible"});
    assert.match(await editor.locator("#feedbackMessage").textContent(),/مسودتك محفوظة/);
    assert.equal(await editor.evaluate(()=>App.mode),"design");
    assert(await editor.evaluate(()=>getDB("designDraft:contract:installment")));
    console.log("PASS new uploaded seed supersedes its older remote layout, partial upload retries, unconnected site preserves drafts");
  }finally{
    if(browser)await browser.close();
    await stopService();
    if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
