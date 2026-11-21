// Static deployments read the published build. An optional HTTPS service stores later approvals.
const PagesTemplates = {
  request(url,options={}) {
    return fetch(url,{cache:"no-store",credentials:"omit",redirect:"error",
      signal:AbortSignal.timeout(15000),...options});
  },
  async hash(bytes) {
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
  },
  async baseHash(scope) {
    if(!this.hashes.has(scope)){
      const design=this.base.design, layout=design.documentLayouts?.[scope] || {};
      const effective=Object.fromEntries(ContractTemplates.layoutKeys.map(k=>[k,layout[k] ?? design[k]]));
      effective.contractTemplates=effective.contractTemplates?.filter(t=>scope==="contract:"+t.id);
      this.hashes.set(scope,await this.hash(new TextEncoder().encode(JSON.stringify(effective))));
    }
    return this.hashes.get(scope);
  },
  async descriptor() {
    const response=await this.request("assets/template-sync.json");
    if(!response.ok)throw Error("تعذرت قراءة إصدار القوالب المنشور.");
    const {build,endpoint}=await response.json();
    if(!/^[a-f0-9]{64}$/.test(build))throw Error("إصدار القوالب غير صالح.");
    if(endpoint){
      const url=new URL(endpoint);
      if(url.username || url.password || url.search || url.hash ||
          !(url.protocol==="https:" || url.protocol==="http:" && ["localhost","127.0.0.1"].includes(url.hostname)))
        throw Error("عنوان خدمة التصاميم غير صالح.");
    }
    return {build,endpoint};
  },
  async read(previous) {
    const {build,endpoint}=await this.descriptor();
    if(this.build!==build){
      const response=await this.request("assets/js/seed.js?v="+build);
      if(!response.ok)throw Error("تعذرت قراءة التصاميم المنشورة.");
      const bytes=await response.arrayBuffer();
      const hash=await this.hash(bytes);
      if(hash!==build)throw Error("تحديث ملفات القوالب جارٍ. ستُعاد المحاولة تلقائياً.");
      const script=new TextDecoder().decode(bytes), start="const ContractSeed=", end=script.indexOf(";\nconst ContractAssets=");
      if(!script.startsWith(start) || end<0)throw Error("ملف القوالب غير صالح.");
      this.base=JSON.parse(script.slice(start.length,end)).config;
      this.build=build;
      this.hashes=new Map();
    }
    if(this.endpoint!==endpoint){this.endpoint=endpoint;this.latest=null;}
    if(endpoint){
      const headers=this.latest?{"If-None-Match":'"'+this.latest.revision+'"'}:{};
      const response=await this.request(endpoint,{headers});
      if(response.status!==304){
        if(!response.ok)throw Error("تعذّر الاتصال بخدمة اعتماد التصاميم.");
        const data=await response.json();
        if(!data.revision || !data.layouts || typeof data.layouts!=="object")throw Error("استجابة خدمة التصاميم غير صالحة.");
        this.latest=data;
      }
    }
    const revision=build+":"+(this.latest?.revision || "0");
    if(previous===revision)return null;
    const base=clone(this.base);
    for(const [scope,record] of Object.entries(this.latest?.layouts || {})){
      if(record.baseHash!==await this.baseHash(scope))continue;
      const layout=record.layout;
      (base.design.documentLayouts ||= {})[scope]=clone(layout);
      for(const {id,name} of layout.pages || []){
        if(id>8 && !(base.extraPages || []).some(p=>p.id===id))
          (base.extraPages ||= []).push({id,name});
      }
      if(scope.startsWith("contract:template-")){
        const template=layout.contractTemplates?.find(t=>scope==="contract:"+t.id);
        if(template && !(base.design.contractTemplates||[]).some(t=>t.id===template.id))
          (base.design.contractTemplates ||= []).push(clone(template));
      }
      if(scope.startsWith("book:")){
        const id=Number(scope.slice(5)), page=layout.pages?.find(p=>p.id===id);
        if(id>=12000 && page && !(base.letterTemplates || []).some(t=>t.id===id))
          (base.letterTemplates ||= []).push({id,name:page.name,body:""});
      }
    }
    return {...base,sharedRevision:revision};
  },
  editorKey(title="رمز اعتماد التصاميم") {
    const dialog=document.createElement("dialog");
    dialog.className="app-ui studio-dialog";dialog.dir="rtl";
    dialog.innerHTML='<form method="dialog"><label>رمز اعتماد التصاميم<input type="password" autocomplete="off" required></label><footer><button value="publish" class="primary">اعتماد</button><button value="cancel" formnovalidate>إلغاء</button></footer></form>';
    document.body.append(dialog);
    dialog.querySelector("label").firstChild.textContent=title;
    return new Promise(resolve=>{
      dialog.addEventListener("close",()=>{
        const key=dialog.returnValue==="publish" ? dialog.querySelector("input").value.trim() : "";
        dialog.remove();resolve(key);
      },{once:true});
      dialog.showModal();dialog.querySelector("input").focus();
    });
  },
  async publish(scope,layout,expected) {
    const {build,endpoint}=await this.descriptor();
    const [base,revision]=expected.split(":");
    if(base!==build || this.endpoint!==endpoint)throw Error("نُشر إصدار جديد للموقع. حدّث الصفحة وراجع مسودتك قبل الاعتماد.");
    if(!endpoint)throw Error("خدمة اعتماد التصاميم غير مربوطة بهذا الموقع.");
    const key=await this.editorKey();
    if(!key)throw Error("بقي تعديلك محفوظاً كمسودة.");
    const baseHash=await this.baseHash(scope);
    const response=await this.request(endpoint,{method:"PUT",
      headers:{"Authorization":"Bearer "+key,"If-Match":'"'+revision+'"',"Content-Type":"application/json"},
      body:JSON.stringify({scope,baseHash,layout})});
    if(response.status===401 || response.status===403)throw Error("لم تسمح خدمة التصاميم بالاعتماد. تحقق من رمز الاعتماد وعنوان الموقع.");
    if(response.status===409)throw Error("اعتمد مستخدم آخر نسخة أحدث. حدّث الصفحة وراجع مسودتك.");
    if(!response.ok)throw Error("تعذّر نشر التصميم. مسودتك محفوظة.");
    const result=await response.json();
    this.latest={revision:result.revision,layouts:{...this.latest?.layouts,[scope]:{baseHash,layout:clone(layout)}}};
    return build+":"+result.revision;
  },
};
