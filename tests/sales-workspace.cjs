// Run against a hosted build. All network responses are local fixtures.
const assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {chromium}=require("playwright"),serve=require("./server.cjs");
const {PDFDocument}=require("../vendor/pdf-lib-1.17.1.min.js");
(async()=>{
 const server=await serve(path.resolve(__dirname,"../work/forms-hosted")),browser=await chromium.launch({channel:"msedge"});
 try{
  const ctx=await browser.newContext({acceptDownloads:true}),forms=new Map(),errors=[];
  let dept="sales",version=0,contractDraft;
  const account=()=>({formsWorkspace:true,name:"موظف",userId:dept,companies:[{id:"bakheet",sharedBrand:true,name:"لؤلؤة البخيت",role:dept==="contracts"?"administrator":"employee",department:dept,branches:[{name:"الدورة",id:"b"}],branchRoles:{b:"employee"}},...(dept==="contracts"?[{id:"imad",sharedBrand:true,name:"عماد الأرض",role:"administrator",department:"contracts",branches:[{name:"الدورة",id:"i"}],branchRoles:{}}]:[])]});
  await ctx.route("**/functions/v1/contract-access",async route=>{
   const p=route.request().postDataJSON();let data;
   if(p.action==="login")data={access_token:"a",refresh_token:"r",expires_at:Date.now()/1000+3000,account:account()};
   else if(["alerts","alerts_seen","form_sellers"].includes(p.action))data=[];
   else if(p.action==="session")data=account();
   else if(p.action==="forms_list")data=[...forms.values()].filter(f=>dept!=="finance"||f.published).map(f=>({...f,buyer:f.data.buyer,author_name:"موظف"}));
   else if(p.action==="form_save"||p.action==="form_publish"){const row=forms.get(p.id)||{id:p.id,branch:p.branch,version:0};assert.equal(row.version,p.version);Object.assign(row,{data:p.data,version:row.version+1,changed:new Date().toISOString()});if(p.action==="form_publish")row.published=row.changed;forms.set(p.id,row);version=row.version;data={version};}
   else if(p.action==="form_read")data=forms.get(p.id);
   else if(p.action==="form_approve"){const f=forms.get(p.id);f.approved=f.changed;f.version++;data={version:f.version};}
   else if(p.action==="form_convert"){const f=forms.get(p.id);f.contract_key="fixture-contract";contractDraft={record:f.contract_key,draft:{...f.data,recordId:f.contract_key,number:"F-1",numberBranch:f.branch,companyId:"bakheet"},version:1,changed:f.changed};data={record:f.contract_key};}
   else if(p.action==="list")data=contractDraft?[{...contractDraft,company:contractDraft.draft.companyId}]:[];
   else if(p.action==="move_contract"){assert.equal(p.record,contractDraft.record);contractDraft.draft.companyId=p.destination;contractDraft.version++;data=true;}
   else if(p.action==="layouts")data={revision:"0",layouts:{}};
   else if(p.action==="draft")data={version:2};
   else if(p.action==="logout")data=true;else throw Error("unexpected operation "+p.action);
   await route.fulfill({json:data});
  });
  const page=await ctx.newPage();page.on("pageerror",e=>errors.push(e.message));await page.goto(server.url);
  const login=async(remember)=>{const form=page.locator("#startupThread form");await form.locator("[name=username]").fill(dept);await form.locator("[name=password]").fill("fixture");if(remember)await form.locator("[name=remember]").check();await form.getByRole("button",{name:"تسجيل الدخول"}).click();};
  await login(true);
  const panel=page.locator("#salesWorkspace");
  for(const buyer of ["زبون أول","زبون ثان"]){
   await panel.getByRole("button",{name:"إضافة فورمة"}).click();
   await panel.getByLabel("المشتري",{exact:true}).fill(buyer);
   await page.waitForFunction(()=>SalesForms.active?.version>0);
   await panel.getByRole("button",{name:"نشر الفورمة"}).click();await panel.getByRole("button",{name:buyer,exact:true}).waitFor();
  }
  await page.reload();await panel.getByRole("button",{name:"زبون أول",exact:true}).waitFor();
  await panel.getByLabel("تحديد كل الفورمات المعروضة").check();
  const other=await ctx.newPage();await other.goto(server.url);await other.locator("#salesWorkspace").getByRole("button",{name:"إضافة فورمة"}).waitFor();await other.close();
  const ready=page.waitForEvent("download");await panel.getByRole("button",{name:"تنزيل PDF"}).click();const file=await ready;
  const pdf=await PDFDocument.load(fs.readFileSync(await file.path()));assert.ok(pdf.getPageCount()>=2);
  await panel.getByRole("button",{name:"خروج",exact:true}).click();await page.locator("#startupThread form").waitFor();
  dept="finance";await login(false);await panel.getByRole("button",{name:"زبون أول",exact:true}).click();
  assert.equal(await panel.getByLabel("المشتري",{exact:true}).isDisabled(),true);
  assert.equal(await panel.getByRole("button",{name:/نشر الفورمة|إنشاء عقد|إضافة فورمة/}).count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem("contract-auth")),null);
  await panel.getByRole("button",{name:"الفورمات",exact:true}).click();
  await panel.getByRole("button",{name:"خروج",exact:true}).click();await page.locator("#startupThread form").waitFor();
  dept="contracts";await login(false);await page.waitForFunction(()=>startReady);
  if(await page.locator("#setupDialog").isVisible()){
    await page.locator("#setupBranch").fill("الدورة");await page.locator("#setupForm button").click();
  }
  await page.locator("#salesWorkspace").getByRole("button",{name:"الفورمات",exact:true}).click();await panel.getByRole("button",{name:"زبون أول",exact:true}).click();
  await panel.getByRole("button",{name:"اعتماد الفورمة"}).click();await panel.getByLabel("ملاحظة الاعتماد").fill("تم تدقيق الفورمة");await panel.getByRole("button",{name:"تأكيد الاعتماد"}).click();await panel.getByRole("button",{name:"زبون أول",exact:true}).click();
  await panel.getByRole("button",{name:"إنشاء عقد من الفورمة"}).click();await page.waitForFunction(()=>!Services.home && d.recordId==="fixture-contract");
  assert.equal(await page.locator("#buyer").inputValue(),"زبون أول");console.log("PASS supervisor approval and populated, editable contract");
  await page.locator("#companySelect").selectOption("imad");
  await page.waitForFunction(()=>typeof startReady!=="undefined" && startReady && d?.companyId==="imad" && d?.recordId==="fixture-contract");
  assert.equal(await page.locator("#buyer").inputValue(),"زبون أول");
  console.log("PASS changing a contract draft to another authorized company");
  assert.deepEqual(errors,[]);console.log("PASS sales autosave, publication, remembered login, combined PDF and read-only finance view");
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
