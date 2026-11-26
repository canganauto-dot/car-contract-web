// Hosted workspace only. Offline exports and the local editor keep their own storage.
const Activity = {
  pending:0,
  async run(work,button){
    this.pending++;document.documentElement.dataset.working="";
    if(button){button.disabled=true;button.setAttribute("aria-busy","true");}
    try{
      if(button && !document.hidden)await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      return await work();
    }finally{
      if(button){button.disabled=false;button.removeAttribute("aria-busy");}
      if(--this.pending===0)delete document.documentElement.dataset.working;
    }
  }
};
// Keep native clicks synchronous for the camera, file pickers and printing.
// Track the actual Promise returned by older editor and settings buttons.
document.addEventListener("click",event=>{
  const button=event.target.closest?.("button");
  if(!button||button.closest("#salesWorkspace")||button.form||!button.onclick)return;
  if(button.dataset.actionPending){event.preventDefault();event.stopImmediatePropagation();return;}
  if(button.onclick.tracksActivity)return;
  const handler=button.onclick;
  function tracked(e){
    const result=handler.call(this,e);
    if(result && typeof result.then==="function"){
      button.dataset.actionPending="1";button.setAttribute("aria-busy","true");
      const finish=()=>{delete button.dataset.actionPending;button.removeAttribute("aria-busy");};
      Activity.run(()=>result).then(finish,error=>{finish();console.error(error);});
    }
    return result;
  }
  tracked.tracksActivity=true;button.onclick=tracked;
},true);
const Cloud = {
  get enabled(){return !seed.offline && !!document.querySelector('meta[name="contract-cloud"]');},
  get endpoint(){return document.querySelector('meta[name="contract-cloud"]').content;},
  get company(){return this.account?.companies.find(c=>c.sharedBrand && c.id==="bakheet") || this.account?.companies.find(c=>c.id===sessionStorage.getItem("contract-company")) || this.account?.companies[0];},
  get brands(){return this.company?.sharedBrand?this.account.companies.filter(c=>c.sharedBrand):[this.company];},
  async saveBrand(brand){await this.call("brand_save",{brand});this.account=await this.call("session");},
  call(action,data={},authenticated=true){return Activity.run(()=>this.request(action,data,authenticated));},
  async request(action,data={},authenticated=true){
    if(authenticated && this.tokens && this.tokens.expires_at*1000 < Date.now()+60000)await this.renew();
    const response=await fetch(this.endpoint,{method:"POST",headers:{"Content-Type":"application/json",
      ...(authenticated && this.tokens?{Authorization:"Bearer "+this.tokens.access_token}:{})},
      credentials:"omit",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30000),
      body:JSON.stringify({...data,company:data.company || this.company?.id,action})});
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      if(authenticated && response.status===401){this.clearLogin();location.reload();}
      throw Object.assign(Error(result?.error || "تعذّر الاتصال بالخادم."),{status:response.status});
    }
    return result;
  },
  get formsReady(){return this.enabled && this.account?.formsWorkspace===true;},
  get restricted(){return ["sales","finance"].includes(this.company?.department) && this.company?.role==="employee";},
  clearLogin(){sessionStorage.removeItem("contract-auth");if(this.remember)localStorage.removeItem("contract-auth");this.tokens=null;},
  accept(s){
    this.tokens={userId:s.account.userId,access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at};
    (this.remember?localStorage:sessionStorage).setItem("contract-auth",JSON.stringify(this.tokens));this.account=s.account;
  },
  renew(){
    if(!this.refreshing){
      const refresh=async()=>{
        if(this.remember){
          const saved=JSON.parse(localStorage.getItem("contract-auth")||"null");
          if(!saved)throw Error("انتهت جلسة الدخول.");
          this.tokens=saved;
          if(this.tokens.expires_at*1000>Date.now()+60000)return;
        }
        this.accept(await this.call("refresh",{refresh_token:this.tokens.refresh_token},false));
      };
      this.refreshing=(this.remember && navigator.locks?navigator.locks.request("contracts-auth-refresh",refresh):refresh()).finally(()=>{this.refreshing=null;});
    }
    return this.refreshing;
  },
  async gate(){
    if(!this.enabled)return;
    this.remember=!sessionStorage.getItem("contract-auth") && !!localStorage.getItem("contract-auth");
    window.addEventListener("storage",event=>{if(this.remember && event.key==="contract-auth" && (!event.newValue || JSON.parse(event.newValue).userId!==this.tokens?.userId))location.reload();});
    try{this.tokens=JSON.parse((this.remember?localStorage:sessionStorage).getItem("contract-auth")||"null");
      if(this.tokens){this.account=await this.call("session");if(this.company)return;}
    }catch(error){if(this.tokens && ![400,401,403].includes(error.status))throw error;}
    this.clearLogin();
    const host=$("startupThread"),old=[...host.childNodes];
    document.body.inert=false;host.classList.add("cloud-signin");
    const form=document.createElement("form");
    form.innerHTML='<h1>منظومة عقود السيارات</h1><label>اسم المستخدم<input name="username" dir="ltr" autocomplete="username" required></label><label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required></label><label><span><input name="remember" type="checkbox"> تذكّر دخولي على هذا الجهاز</span></label><button>تسجيل الدخول</button><output role="status"></output>';
    const request=document.createElement("button");request.type="button";request.textContent="طلب حساب موظف";form.append(request);
    request.onclick=()=>{
      const apply=document.createElement("form");apply.innerHTML='<h1>طلب حساب موظف</h1><label>الاسم الكامل<input name="name" required maxlength="120"></label><label>اسم المستخدم<input name="username" dir="ltr" required maxlength="40"></label><input type="hidden" name="company" value="bakheet"><button>إرسال للمدير</button><button type="button">العودة للدخول</button><output role="status"></output>';
      apply.querySelector('[type="button"]').onclick=()=>host.replaceChildren(form);
      apply.onsubmit=async ev=>{ev.preventDefault();const submit=apply.querySelector("button");submit.disabled=true;
        try{await this.call("request_access",Object.fromEntries(new FormData(apply)),false);host.replaceChildren(form);form.querySelector("output").textContent="وصل طلبك. بعد الموافقة، يسلّمك المدير كلمة المرور.";}
        catch(e){apply.querySelector("output").textContent=e.message;}finally{submit.disabled=false;}};
      host.replaceChildren(apply);apply.elements.name.focus();
    };
    host.replaceChildren(form);form.elements.username.focus();
    await new Promise(resolve=>{form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector("button");button.disabled=true;button.setAttribute("aria-busy","true");const dots=document.querySelector("#taskProgress .wait-dots").cloneNode(true);button.append(dots);
      try{this.remember=form.elements.remember.checked;this.accept(await this.call("login",{username:form.elements.username.value,password:form.elements.password.value},false));resolve();}
      catch(error){form.querySelector("output").textContent=error.message;form.elements.password.select();}
      finally{dots.remove();button.disabled=false;button.removeAttribute("aria-busy");}
    };});
    document.body.inert=true;host.classList.remove("cloud-signin");host.replaceChildren(...old);
  },
  async logout(){try{await FormInbox.detach().catch(()=>{});await this.call("logout");}finally{this.clearLogin();sessionStorage.removeItem("contract-company");location.reload();}},
  async switchCompany(id){
    if(this.company?.id===id || !this.account.companies.some(c=>c.id===id))return;
    try{document.activeElement?.blur();if(SalesForms.active || this.restricted)await SalesForms.flush();else await Services.flush();sessionStorage.setItem("contract-company",id);location.reload();}
    catch(error){await Feedback.notice(error.message);}
  },
  storageKey(){
    const c=this.company;
    return "contracts-online-"+JSON.stringify([this.account.userId,c.id,c.role,...(this.restricted?[c.department]:[]),[...c.branches.map(b=>b.id)].sort()]);
  },
  prepare(cfg){
    const c=this.company;
    if(!c)throw Error("الحساب بلا شركة.");
    cfg.companies=this.brands.map(b=>({...clone(cfg.companies.find(item=>item.id===b.id)||seed.config.companies.find(item=>item.id===b.id)||{}),...b.brandProfile,id:b.id,name:b.name}));
    const options=c.branches.map(b=>new Option(b.name,b.name));
    $("setupBranches").replaceChildren(...options);
    if(!c.branches.some(b=>b.name===cfg.fixed.branch))cfg.fixed.branch=c.branches[0]?.name||"";
    cfg.fixed.organizer=this.account.name;
    cfg.fixed.staffTitle=c.role==="administrator"?"المدير العام":c.role==="branch_manager"?"مسؤول الفرع":({sales:"موظف المبيعات",finance:"موظف المالية",contracts:"موظف العقود"}[c.department]||"موظف");
    if(!branchHasAgent(cfg.fixed.branch))cfg.fixed.hasAgent=false;
  },
  versions:new Map(), writes:Promise.resolve(),
  serialize(fn){const task=this.writes.then(fn);this.writes=task.catch(()=>{});return task;},
  async archive(){
    const entries=[], versions=new Map();let after="";
    for(;;){
      const batch=await this.call("list",{after});
      for(const row of batch){
        versions.set(row.record,row.version);
        if(row.draft)entries.push({kind:"draft",id:"draft:"+row.record,data:row.draft,seller:row.seller,updatedAt:Date.parse(row.changed)});
        if(row.printed)entries.push({kind:"printed",id:"printed:"+row.record,data:row.printed,seller:row.seller,updatedAt:Date.parse(row.issuedAt),cloudRevision:row.revision,cloudSigned:row.signed});
      }
      if(batch.length<16)break;
      after=batch[batch.length-1].record;
    }
    this.versions=versions;
    return {entries:entries.sort((a,b)=>b.updatedAt-a.updatedAt),configs:{},version:1};
  },
  write(action,data,extra={}){
    const record=data.recordId;
    return this.serialize(async()=>{
      const result=await this.call(action,{company:data.companyId,record,data,version:this.versions.get(record)||0,...extra});
      this.versions.set(record,result.version);return result;
    });
  },
  async file(entry,purpose,blob){
    if(this.tokens.expires_at*1000<Date.now()+60000)await this.renew();
    const meta={company:entry.data.companyId,record:entry.data.recordId,revision:entry.cloudRevision,purpose};
    const url=new URL(this.endpoint);
    if(blob){if(blob.size>15000000)throw Error("حجم النسخة يتجاوز ١٥ ميغابايت.");url.search=new URLSearchParams({...meta,request:crypto.randomUUID()});}
    const response=await fetch(url,{method:"POST",cache:"no-store",credentials:"omit",redirect:"error",
      headers:{Authorization:"Bearer "+this.tokens.access_token,"Content-Type":blob?"application/pdf":"application/json"},
      body:blob||JSON.stringify({...meta,action:"file"})});
    if(!blob && response.status===404)return null;
    if(!response.ok)throw Error((await response.json().catch(()=>null))?.error||"تعذّر نقل نسخة المستند.");
    return blob?true:response.blob();
  },
  async materialize(entry){
    if(!entry.cloudRevision)return;
    const read=await this.call("read",{company:entry.data.companyId,record:entry.data.recordId,revision:entry.cloudRevision});
    entry.config=read.config;
    entry.history=read.history.map(r=>({kind:"printed",id:"revision:"+r.revision,data:r.data,cloudRevision:r.revision,cloudSigned:r.signed,updatedAt:Date.parse(r.changed)}));
    const signed=await this.file(entry,"signed_pdf");
    const file=signed||await this.file(entry,"generated_pdf");
    if(file){
      const url=await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result);reader.onerror=()=>rej(reader.error);reader.readAsDataURL(file);});
      if(signed)entry.signedFile=url;else entry.snapshot={config:entry.config,pdf:url};
    }
  },
  async issue(data){
    const {revision}=await this.write("issue",data,{config:cfg});
    const entry={kind:"printed",id:"printed:"+data.recordId,data,cloudRevision:revision,config:cfg};
    if(!await this.file(entry,"generated_pdf")){
      const pinned=await this.call("read",{company:data.companyId,record:data.recordId,revision});
      entry.config=pinned.config;
      await this.file(entry,"generated_pdf",await ArchiveOutput.build([entry],false));
    }
  },
  staff(){
    return {session:async()=>Cloud.account=await Cloud.call("session"),logout:()=>Cloud.logout(),
      members:c=>Cloud.call("members",{company:c.id}),
      save:async(c,m,changes)=>{
        const {password,...fields}=changes;
        const data={...fields,company:c.id,username:fields.email,target:m?.id,version:m?.version};
        await Cloud.call(m?"update":"create",m?data:{...data,password});
        if(m && password)await Cloud.call("reset",{company:c.id,target:m.id,password});
      }};
  }
};
