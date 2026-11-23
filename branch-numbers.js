const BranchNumbers = {
  queue:Promise.resolve(), keys:new Map(),
  async send(data,mode,label="",prompt=true) {
    const branch=data.numberBranch || cfg.fixed.branch;
    if(!branch)throw Error("اختَر الفرع أولاً لحجز العدد.");
    if(Cloud.enabled){
      const result=await Cloud.call("number",{branch,record:data.recordId,mode,label,prefix:cfg.fixed.prefix||"",expected:data.number||"",offline:!!data.offlineNumber});
      data.numberBranch=branch;return result.number;
    }
    const local=!seed.offline && SharedDefaults.enabled && !SharedDefaults.pages;
    const url=local ? "/_numbers" : !seed.offline && PagesTemplates.endpoint && new URL("numbers",PagesTemplates.endpoint).href;
    if(!url)throw Error("حجز عدد الفرع يحتاج اتصال بخدمة الأعداد. يمكنك الاحتفاظ بالمسودة.");
    const payload={branch,record:data.recordId,mode,label,prefix:cfg.fixed.prefix || "",
      start:Math.max(1,Number(cfg.fixed.nextNumber)||1),expected:data.number || "",offline:!!data.offlineNumber};
    const call=async()=>{
      const headers={"Content-Type":"application/json"};
      if(!local && this.keys.has(branch))headers.Authorization="Bearer "+this.keys.get(branch);
      return fetch(url,{method:"POST",headers,body:JSON.stringify(payload),credentials:"omit",cache:"no-store",
        signal:AbortSignal.timeout(10000),redirect:"error"});
    };
    let response=await call();
    if(!local && response.status===401 && prompt){
      const key=await PagesTemplates.editorKey("رمز حجز الأعداد لفرع "+branch);
      if(!key)throw Error("بقيت المسودة بانتظار حجز العدد.");
      this.keys.set(branch,key);
      await this.registerExisting();
      response=await call();
    }
    const reply=await response.json();
    if(!response.ok){
      if(response.status===401)this.keys.delete(branch);
      throw Object.assign(Error(reply.error || "تعذّر تأكيد العدد لدى الفرع."),{status:response.status,current:reply.current});
    }
    data.numberBranch=branch;
    return reply.number;
  },
  async begin(data) {
    data.numberBranch=cfg.fixed.branch;
    if(seed.offline){data.offlineNumber=true;data.number=(await allocateNumber())+"-F";return;}
    try {data.number=await this.send(data,"claim");}
    catch(error){$("saveStatus").textContent=error.message;}
  },
  edit(data,value) {
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      let label=normalizeDigits(value.trim());
      if((data.offlineNumber || seed.offline) && label && !label.endsWith("-F"))label+="-F";
      if(seed.offline){
        if(!label)label=(await allocateNumber())+"-F";
        if(!/^(?:[^/\\]{1,40}-)?[0-9]{1,9}-F$/.test(label))throw Error("عدد الأوفلاين غير صالح.");
        if(Services.library.entries.some(e=>e.data.number===label && e.data.recordId!==data.recordId))throw Error("العدد مستخدم في مستند محلي آخر.");
        data.number=label;data.offlineNumber=true;reserveNumber(label.slice(0,-2));
      }else data.number=await this.send(data,"edit",label);
      if(data.numberRequest===value){data.numberRequest="";data.numberUnconfirmed=false;}
      if(d===data){render();saveDraft();}
    });
    return this.queue;
  },
  async verify(data) {
    await this.queue.catch(()=>{});
    if(data.numberUnconfirmed || data.numberRequest)throw Error("صحّح العدد المدخل أو امسحه لحجز العدد التالي.");
    if(seed.offline){
      if(!data.number)await this.begin(data);
      if(!data.number.endsWith("-F"))data.number+="-F";
      data.offlineNumber=true;
      if(d===data){render();saveDraft();}
      return;
    }
    if(!data.number)data.number=await this.send(data,"claim");
    await this.send(data,"verify",String(data.number));
    if(d===data){render();saveDraft();}
  },
  async imported(data,offline) {
    data.recordId ||= "contract-"+crypto.randomUUID();
    data.numberBranch ||= cfg.fixed.branch;
    if(offline || data.offlineNumber || /-F$/i.test(data.number)){
      data.offlineNumber=true;
      if(data.number)data.number=String(data.number).replace(/-F$/i,"")+"-F";
    }
    if(seed.offline){await this.verify(data);reserveNumber(data.number);return;}
    try{data.number=await this.send(data,"claim",String(data.number || ""));}
    catch(error){
      if(!data.offlineNumber || error.status!==409)throw error;
      if(error.current){data.number=error.current;return;}
      data.number=await this.send(data,"claim");
      await Feedback.notice("حُجز لهذا المستند المستورد العدد "+data.number+" لأن عدده السابق مستخدم.");
    }
  },
  bind(input=$("contractNumber")) {
    input.dir="ltr";
    input.title="عدد الفرع · اكتب عدداً لتغييره، أو امسحه لحجز التالي";
    input.oninput=()=>{d.numberRequest=input.value;d.numberUnconfirmed=input.value!==d.number;};
    input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();input.blur();}};
    input.onchange=()=>{
      const data=d, value=input.value;
      if(!data.recordId || value===data.number){data.numberRequest="";data.numberUnconfirmed=false;return;}
      this.edit(data,value).then(()=>input.removeAttribute("aria-invalid")).catch(error=>{if(data===d){input.setAttribute("aria-invalid","true");saveDraft();Feedback.notice(error.message);}});
    };
  },
  readyToPrint(data) {
    return !data.numberUnconfirmed && !data.numberRequest && !!data.number && (seed.offline && data.number.endsWith("-F") ||
      this.printing===this.signature(data));
  },
  signature(data){return JSON.stringify([data.recordId,data.numberBranch,data.number]);},
  async registerExisting() {
    if(Cloud.enabled || seed.offline || !cfg.setupComplete || (!PagesTemplates.endpoint && SharedDefaults.pages))return;
    const items=[...Services.library.entries].sort((a,b)=>Number(b.kind==="printed")-Number(a.kind==="printed"));
    const seen=new Set();
    const synced=await getDB("branch-number-history") || {};
    for(const entry of items){
      const data=entry.data;
      if(!data?.number || !data.recordId || seen.has(data.recordId) || data.numberBranch && data.numberBranch!==cfg.fixed.branch)continue;
      seen.add(data.recordId);
      const branch=data.numberBranch || Services.library.configs?.[entry.configKey]?.fixed?.branch || cfg.fixed.branch;
      const mark=JSON.stringify([branch,data.number,entry.kind,data.offlineNumber || false]);
      if(synced[data.recordId]===mark)continue;
      try{await this.send({...data,numberBranch:branch},entry.kind==="printed"?"verify":"claim",String(data.number),false);synced[data.recordId]=mark;}
      catch(error){$("saveStatus").textContent=error.message;}
    }
    await putDB("branch-number-history",synced);
  }
};
