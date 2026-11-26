/* Public QR snapshots are issued by the server. A scan URL contains only its UUID. */
const DocumentQR={
  uuid:/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  labels:{buyer:"المشتري",vin:"الشاصي",number:"العدد",date:"التاريخ",car:"المركبة",plate:"اللوحة",model:"الموديل",color:"اللون",shortCompany:"الشركة",manager:"المدير المفوض",organizer:"المنظّم"},
  clean(source){
    const result={};
    for(const [key,v] of Object.entries(source||{}))if(/^[-\d]{1,12}$/.test(key)&&this.uuid.test(v?.id)&&typeof v.signature==="string"&&v.signature.length<80000)
      result[key]={id:v.id,signature:v.signature,local:v.local===true,pending:v.pending===true};
    return result;
  },
  mandatory(page){return page.id===0||page.sourcePage===0||page.id===12001||page.sourcePage===12001||/نقل\s+(?:ال)?ملكية/.test(page.name||"");},
  make(page){
    const n={id:"verification-"+page.id,type:"image",name:"رمز التحقق",binding:"documentQR",w:30,h:30,x:12,y:101,z:50,fit:"contain",lockAspect:true,qrFields:["buyer","vin"]};
    const obstacles=page.nodes.filter(o=>o.w<200&&o.h<275&&!o.firstFormHeader);
    for(let y=42;y<=243;y+=4)for(const x of [10,170,48,132,90]){
      if(!obstacles.some(o=>x<o.x+o.w+2&&x+32>o.x&&y<o.y+o.h+2&&y+32>o.y))return {...n,x,y};
    }
    return n;
  },
  ensure(page){
    const first=page.nodes.find(n=>n.binding==="documentQR");
    if(first){if(page.nodes.some(n=>n!==first&&n.binding==="documentQR"))page.nodes=page.nodes.filter(n=>n===first||n.binding!=="documentQR");}
    else if(this.mandatory(page))page.nodes.push(this.make(page));
  },
  options(page){
    const all={...this.labels},names={...cfg.variableLabels,...App.scene?.variableLabels};
    for(const key of documentVariables(page))if(/^[A-Za-z][A-Za-z0-9_]{0,64}$/.test(key)&&!Object.hasOwn(all,key))all[key]=names[key]||key;
    return all;
  },
  dialog(title){
    const dlg=document.createElement("dialog");dlg.className="template-dialog verification-dialog";dlg.dir="rtl";
    const h=document.createElement("h3");h.textContent=title;dlg.append(h);document.body.append(dlg);dlg.onclose=()=>dlg.remove();return dlg;
  },
  button(title,fn){const b=document.createElement("button");b.type="button";b.textContent=title;b.onclick=fn;return b;},
  settings(editor){
    editor.commitText();const p=editor.current();if(!p)return;
    const current=p.nodes.find(n=>n.binding==="documentQR"),dlg=this.dialog("الباركود · "+p.name);
    const note=document.createElement("p");note.textContent="المعلومات التي تظهر للزائر عند مسح الرمز";dlg.append(note);
    const grid=document.createElement("div");grid.className="qr-choices";
    for(const [key,label] of Object.entries(this.options(p))){const l=document.createElement("label"),i=document.createElement("input");i.type="checkbox";i.value=key;i.checked=(current?.qrFields||["buyer","vin"]).includes(key);l.append(i,document.createTextNode(label));grid.append(l);}
    const foot=document.createElement("footer");
    foot.append(this.button(current?"حفظ":"إضافة باركود",()=>{const fields=[...grid.querySelectorAll(":checked")].map(i=>i.value);
      if(fields.length>24){note.textContent="اختر 24 خانة كحد أقصى.";return;}
      editor.checkpoint();const n=current||this.make(p);if(!current)p.nodes.push(n);n.qrFields=fields;editor.selection=new Set([n.id]);editor.render();editor.persist();dlg.close();}));
    if(current&&!this.mandatory(p))foot.append(this.button("حذف الباركود",()=>{editor.checkpoint();p.nodes=p.nodes.filter(n=>n!==current);editor.selection.clear();editor.render();editor.persist();dlg.close();}));
    foot.append(this.button("إلغاء",()=>dlg.close()));dlg.append(grid,foot);dlg.showModal();
  },
  scanUrl(code){return code.local?"http://127.0.0.1:8088/?verify="+code.id:"https://canganauto-dot.github.io/QR/?id="+code.id;},
  cache:new Map(),
  picture(code){
    const url=this.scanUrl(code);if(this.cache.has(url))return this.cache.get(url);
    const qr=qrcode(0,"M");qr.addData(url);qr.make();const size=qr.getModuleCount(),canvas=document.createElement("canvas"),k=6;
    canvas.width=canvas.height=(size+8)*k;const g=canvas.getContext("2d");g.fillStyle="white";g.fillRect(0,0,canvas.width,canvas.height);g.fillStyle="black";
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(qr.isDark(y,x))g.fillRect((x+4)*k,(y+4)*k,k,k);
    const src=canvas.toDataURL("image/png");if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value);this.cache.set(url,src);return src;
  },
  mark(el,code){const img=new Image();img.alt="باركود تحقق";img.src=this.picture(code);img.style.cssText="width:100%;height:100%;object-fit:contain;image-rendering:pixelated";el.replaceChildren(img);el.dataset.issued=code.id;
    if(code.pending){const status=document.createElement("small");status.className="qr-pending";status.textContent="بانتظار التسجيل";el.append(status);}},
  draw(el,n,pageId,values,frozen){
    const labels=this.labels,keys=n.qrFields||["buyer","vin"],fields=keys.map(key=>({key,label:String(labels[key]||cfg.variableLabels?.[key]||key).slice(0,80),value:String(values[key]??"").replace(/[\u2066-\u2069]/g,"")}));
    const payload={company:d.companyId,branch:d.numberBranch||cfg.fixed.branch,record:d.recordId,sheet:ContractTemplates.scopeKey()+"/"+pageId,fields};
    el.dataset.qrPayload=JSON.stringify(payload);el.dataset.qrPage=pageId;
    const code=d.verificationCodes?.[pageId];if(code&&(frozen||code.signature===el.dataset.qrPayload)){this.mark(el,code);return;}
    const placeholder=document.createElement("span");placeholder.className="qr-placeholder";placeholder.textContent="QR · عند الإصدار";el.append(placeholder);
  },
  selected(){return [...$("pages").querySelectorAll("[data-qr-payload]")].filter(el=>Schedule.enabled(Number(el.closest(".paper").dataset.page)));},
  needsIssue(){return this.selected().some(el=>!el.dataset.issued);},
  async issue(elements,data){
    for(const el of elements){
      if(el.dataset.issued)continue;

      const p=JSON.parse(el.dataset.qrPayload);p.record=data.recordId||p.record;
      if(!Cloud.enabled&&!p.record)p.record=data.recordId="contract-"+crypto.randomUUID();
      if(!p.record)throw Error("احفظ المستند قبل إصدار الباركود.");
      if(p.fields.some(f=>f.value.length>2000))throw Error("إحدى قيم الباركود تتجاوز 2000 حرف.");
      const id=el.dataset.qrPage,signature=JSON.stringify(p),existing=data.verificationCodes?.[id];
      if(existing?.signature===signature){this.mark(el,existing);continue;}
      if(!Cloud.enabled){
        const ledger=data.pendingQr||=[],previous=ledger.find(q=>q.signature===signature);
        const code=previous||{id:crypto.randomUUID(),signature,local:!!seed.localQr,pending:true};
        if(!previous)ledger.push(code);(data.verificationCodes||={})[id]=code;this.mark(el,code);continue;
      }
      const r=await Cloud.call("qr_issue",p);if(!this.uuid.test(r?.id))throw Error("تعذّر تأكيد إصدار الرمز.");
      const code={id:r.id,signature,local:new URL(Cloud.endpoint).hostname==="127.0.0.1"};
      (data.verificationCodes||={})[id]=code;this.mark(el,code);
    }
  },
  async registerPending(data){
    if(!Cloud.enabled||!data.pendingQr?.length)return;
    const local=new URL(Cloud.endpoint).hostname==="127.0.0.1";
    for(const code of data.pendingQr){
      if(!!code.local!==local)throw Error("ملف الباركود تابع لبيئة مختلفة. استورده في الموقع الذي صدرت منه نسخته.");
      const p=JSON.parse(code.signature);if(!p.record||p.record!==data.recordId)throw Error("بيانات الباركود لا تطابق رقم المستند.");
      const registered=await Cloud.call("qr_issue",{...p,reserved:code.id});if(registered.id!==code.id)throw Error("تعذّر تسجيل الرمز المطبوع.");
      for(const saved of Object.values(data.verificationCodes))if(saved.id===code.id)saved.pending=false;
    }
    data.pendingQr=[];
  },
  async issueSelected(){
    document.activeElement?.blur();App.commitText();const data=d,elements=this.selected();if(!elements.length)return;
    await this.issue(elements,data);
    if(d!==data)throw Error("تغيّر المستند المفتوح أثناء الإصدار.");
    if(elements.some(el=>!el.isConnected)){render();if(this.needsIssue())throw Error("تغيّرت بيانات الكتاب أثناء الإصدار. راجعها وأعد الطباعة.");}
    Services.saveCurrent(data);await Services.flush();await Promise.all(this.selected().flatMap(el=>[...el.querySelectorAll("img")].map(img=>img.decode())));
    $("saveStatus").textContent=data.pendingQr?.length?"الباركود بانتظار استيراد ملف JSON في الموقع":"باركود التحقق جاهز";
  },
  manage(codes){
    const dlg=this.dialog("حالة باركود التحقق"),id=document.createElement("input"),out=document.createElement("output"),footer=document.createElement("footer");
    id.dir="ltr";id.placeholder="رابط التحقق أو رقم الإصدار";id.ariaLabel=id.placeholder;
    const existing=this.selected().find(el=>el.dataset.issued);id.value=Object.values(codes||{})[0]?.id||existing?.dataset.issued||"";let state=null;
    const chooser=document.createElement("select"),grid=document.createElement("div");grid.className="qr-choices";chooser.ariaLabel="باركود الصفحة";
    for(const [page,v] of Object.entries(codes||d?.verificationCodes||{}))chooser.add(new Option("صفحة "+(App.displayPages?.find(p=>p.id===Number(page))?.name||page),v.id));
    chooser.hidden=chooser.options.length<2;chooser.onchange=()=>{id.value=chooser.value;read();};
    const save=this.button("حفظ الحقول الظاهرة",async()=>{if(!state)return;save.disabled=true;try{state=await Cloud.call("qr_visibility",{id:state.id,revision:state.revision,hidden:[...grid.querySelectorAll("input:not(:checked)")].map(i=>i.value)});show();}catch(e){out.textContent=e.message;}finally{save.disabled=false;}});save.hidden=true;
    const change=this.button("",async()=>{if(!state)return;change.disabled=true;try{state=await Cloud.call("qr_change",{id:state.id,revision:state.revision,approved:!state.approved});show();}catch(e){out.textContent=e.message;change.hidden=true;}finally{change.disabled=false;}});
    const show=()=>{grid.replaceChildren();for(const f of state.fields){const l=document.createElement("label"),i=document.createElement("input");i.type="checkbox";i.value=f.key;i.checked=!state.hidden.includes(f.key);l.append(i,document.createTextNode(f.label));grid.append(l);}save.hidden=!state.fields.length;out.textContent=state.approved?"الرمز معتمد":"الرمز غير معتمد";change.hidden=false;change.textContent=state.approved?"إلغاء اعتماد الرمز":"اعتماد الرمز";};change.hidden=true;
    const read=async()=>{state=null;grid.replaceChildren();save.hidden=change.hidden=true;try{const raw=id.value.trim();let key=raw;if(!this.uuid.test(key)){const u=new URL(raw);key=u.searchParams.get("id")||u.searchParams.get("verify");}if(!this.uuid.test(key))throw Error("أدخل رقم إصدار صالح.");state=await Cloud.call("qr_review",{id:key});show();}catch(e){out.textContent=e.message;}};
    id.oninput=()=>{state=null;grid.replaceChildren();save.hidden=change.hidden=true;out.textContent="";};footer.append(this.button("استعلام",read),change,save,this.button("إغلاق",()=>dlg.close()));dlg.append(chooser,id,out,grid,footer);dlg.showModal();if(id.value)read();
  },
  async verifyLocal(){
    const cover=$("startupThread");document.body.inert=false;cover.classList.add("cloud-signin");const card=document.createElement("form");cover.replaceChildren(card);
    const title=document.createElement("h1");title.textContent="التحقق من المستند";card.append(title);
    try{const id=new URLSearchParams(location.search).get("verify");if(!this.uuid.test(id))throw Error("رمز غير صالح.");const r=await Cloud.request("qr_verify",{id},false);
      title.textContent=r.approved?"مستند معتمد":"مستند غير معتمد";for(const f of r.fields){const row=document.createElement("p");row.textContent=f.label+" · "+f.value;card.append(row);}
    }catch(e){title.textContent=e.message;}
    const again=document.createElement("a");again.href="./reader/index.html";again.textContent="مسح مستند آخر";card.append(again);
  }
};
