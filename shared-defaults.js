const SharedDefaults = {
  enabled: false,
  keys: "companies cars assets clauses edits custom content contentOrder extraPages objects design companyFields companyImageSlots formulas vehicleImageSlots vehicleImages vehicleImageHistory imageSeparationVersion printSides bookPriceDefaults deletedCompanyImageSlots frames letterTemplates priceCatalogs requiredFields tables variableLabels".split(" "),
  pendingWrites: 0,
  async recoverLocalDesign(saved, base) {
    if(!saved?.design || saved.sharedHostVersion || !await getDB("beforeApprovalBackup"))return;
    const scopes=Object.entries(saved.design.documentLayouts || {}).filter(([scope,layout])=>
      JSON.stringify(layout)!==JSON.stringify(base.design.documentLayouts?.[scope]));
    if(!scopes.length)return;
    // Retain the complete local approval in the existing backup UI. Never publish it during startup.
    const backups=await getDB("backups") || [];
    const id="before-server-templates-"+(saved.sharedRevision || saved.updatedAt || "local");
    if(!backups.some(b=>b.id===id)){
      backups.unshift({id,time:new Date().toISOString(),config:saved,data:await getDB("draft")});
      await putDB("backups",backups);
    }
    const compatible=saved.sharedRevision===base.sharedRevision ||
      this.pages && saved.sharedRevision===PagesTemplates.base?.sharedRevision;
    if(!compatible)return;
    for(const [scope] of scopes){
      const key="designDraft:"+scope;
      if(!await getDB(key))await putDB(key,{version:6,scope,baseRevision:base.sharedRevision,
        scene:ContractTemplates.scoped(saved.design,scope),recovered:true,updatedAt:saved.updatedAt});
    }
  },
  async start(saved) {
    const bundled=seed.config;
    const http=location.protocol==="http:" || location.protocol==="https:";
    if(!http)return normalizeConfig(clone(saved || bundled));
    const probe=http && await fetch("assets/js/seed.js",{method:"HEAD",cache:"no-store"}).catch(()=>null);
    this.pages=probe?.headers?.get("X-Contract-Defaults")!=="1";
    this.enabled=!!http;
    let base;
    try{base=await this.read();await this.recoverLocalDesign(saved,base);}
    catch(error){this.unavailable=true;base=saved || bundled;console.warn(error.message);}
    const current=this.accept(base,saved);
    const check=()=>this.refresh().catch(error=>console.warn("Shared templates:",error.message));
    window.addEventListener("focus",check);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)check();});
    document.addEventListener("input",e=>{if(e.target.closest("#fillPanel,#toolbar"))this.typing=e.target;});
    document.addEventListener("focusout",e=>{if(e.target===this.typing)this.typing=null;});
    if(typeof BroadcastChannel==="function"){
      this.channel=new BroadcastChannel("contract-shared-defaults");
      this.channel.onmessage=check;
    }
    window.setInterval(check,5000);
    return current;
  },
  accept(base,local) {
    let source=base;
    if(this.pages && local && !this.unavailable &&
        (local.sharedRevision?.split(":")[0]===PagesTemplates.build || local.sharedRevision===PagesTemplates.base?.sharedRevision)){
      // Site settings still belong to this browser. Published page layouts always come from the host.
      source={...local,...Object.fromEntries(["sharedRevision","design","extraPages","letterTemplates"].map(k=>[k,base[k]]))};
      source.design={...base.design};
      for(const k of ["fillOrders","bookFillOrders","fillAppearance","uiDefaults","fillGeometryVersion"])
        if(local.design?.[k]!==undefined)source.design[k]=local.design[k];
      for(const [target,key,items] of [[source.design,"contractTemplates",local.design?.contractTemplates],[source,"letterTemplates",local.letterTemplates]]){
        if(items?.length)target[key]=[...(target[key] || []),...items.filter(item=>!(target[key] || []).some(t=>t.id===item.id))];
      }
    }
    const current=normalizeConfig(clone(source));
    if(local?.fixed)Object.assign(current.fixed,local.fixed);
    current.setupComplete=!!local?.setupComplete;
    if(!this.unavailable)current.sharedHostVersion=1;
    if(Cloud.enabled)Cloud.prepare(current);
    this.baseline=clone(current);
    this.revision=base.sharedRevision;
    return current;
  },
  async read(revision) {
    if(this.pages)return PagesTemplates.read(revision);
    const response=await fetch("/_defaults",{cache:"no-store",
      headers:revision?{"If-None-Match":'"'+revision+'"'}:{}});
    if(response.status===304)return null;
    if(!response.ok)throw Error("تعذّرت قراءة قوالب الهوست.");
    const {config}=await response.json();
    if(!config?.sharedRevision || !config.design)throw Error("ردّ الهوست لا يحتوي على نسخة صالحة من القوالب.");
    return config;
  },
  busy() {
    return !startReady || document.hidden || this.writing || this.pendingWrites || saveTimer || this.typing ||
      App.mode==="design" || App.printing || FillLayout.panel || !$("settingsDrawer").hidden ||
      document.querySelector("dialog[open]");
  },
  async refresh() {
    if(!this.enabled || this.reading || this.busy())return;
    this.reading=true;
    try{
      const previous=this.revision;
      const base=await this.read(this.unavailable ? undefined : previous);
      if(!base || this.revision!==previous || this.busy() || !this.unavailable && base.sharedRevision===previous)return;
      if(this.unavailable)await this.recoverLocalDesign(cfg,base);
      this.unavailable=false;
      cfg=this.accept(base,cfg);
      App.draft=null;
      App.scene=null;
      const focused=document.activeElement, id=focused?.id;
      const date=focused?.matches(".date-text") && focused.parentElement.querySelector("[type=date]")?.id;
      $("printSides").value=cfg.printSides;
      buildInputs();render();Archive.refresh();
      if(focused && !focused.isConnected){
        const next=date ? $(date)?.parentElement.querySelector(".date-text") : id && $(id);
        next?.focus?.({preventScroll:true});
      }
      await putDB("config",cfg);
    }finally{this.reading=false;}
  },
  requirePublisher() {
    if(this.unavailable || !this.enabled || !this.revision)throw Error("تعذّر الاتصال بخدمة اعتماد التصاميم. مسودة تعديلك محفوظة في هذا المتصفح.");
    if(this.pages && !PagesTemplates.endpoint)throw Error("هذا الموقع يعرض التصاميم المنشورة. للنشر من المحرّر اربط خدمة اعتماد التصاميم، أو اعتمد التعديل على هوست المشروع ثم ارفع البناء المحدّث. مسودتك محفوظة.");
  },
  async publish(config,scope) {
    if (!this.enabled) return;
    if(this.pages){
      if(!scope)return;
      this.requirePublisher();
      this.revision=await PagesTemplates.publish(scope,config.design.documentLayouts[scope],this.revision);
      config.sharedRevision=cfg.sharedRevision=this.revision;
      this.channel?.postMessage(this.revision);
      return;
    }
    const changed = {};
    for (const k of this.keys)
      if (config[k] !== undefined && JSON.stringify(config[k]) !== JSON.stringify(this.baseline[k]))
        changed[k] = config[k];
    if (!Object.keys(changed).length) {config.sharedRevision=this.revision;return;}
    this.writing = true;
    try {
      const response = await fetch("/_defaults", {
        method:"POST", headers:{"Content-Type":"application/json","If-Match":this.revision}, body:JSON.stringify(changed)
      });
      if (response.status === 409) throw Error("اعتمد مستخدم آخر نسخة أحدث. مسودتك محفوظة. ارجع للملء وحدّث الصفحة حتى تراجع النسخة الجديدة قبل الاعتماد.");
      if (!response.ok) throw Error("تعذّر حفظ الإعدادات المشتركة في المشروع.");
      this.revision = (await response.json()).revision;
      Object.assign(this.baseline, changed);
      config.sharedRevision = cfg.sharedRevision = this.revision;
      this.channel?.postMessage(this.revision);
    } finally { this.writing = false; }
  }
};
