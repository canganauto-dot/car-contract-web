// Published forms retain their submitted data when a contract clerk creates a working copy.
const SalesForms = {
  selected:new Set(), rows:[], tail:Promise.resolve(), types:{installment:"أقساط",cash:"كاش",exchange:"استبدال",external:"شراء / خارجي"},
  el(tag,text){const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;},
  button(label,action){
    const b=this.el("button",label);b.type="button";
    b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){this.status.textContent=e.message;}finally{b.disabled=false;}};
    return b;
  },
  select(label,values,value){
    const s=this.el("select");s.ariaLabel=label;
    for(const [key,name] of values)s.add(new Option(name,key));
    s.value=value;return s;
  },
  groups(v){
    const external=v.contractType==="external",exchange=v.contractType==="exchange",cash=v.contractType==="cash";
    const parties=external?["Seller","Buyer"].map((p,i)=>[i?"المشتري":"البائع",[
      ["external"+p,"الاسم"],["external"+p+"Phone","الهاتف","tel"],["external"+p+"Id","رقم الهوية"],["external"+p+"Address","العنوان"]]]):[["المشتري",dataDefs.buyerInputs]];
    const inst=!external&&!cash&&(!exchange||v.exchangeManual!=="1");
    if(inst)parties.push(["الكفيل",dataDefs.guarantorInputs]);
    const pay=[["total","المبلغ الكلي","money"],[cash||external?"cashReceived":"deposit","الواصل","money"]];
    if(inst)pay.push(["depositDate","تاريخ المقدمة","date"],...dataDefs.installmentInputs.filter(x=>v.phaseEnabled||!["phasePayment","phaseCount","phaseSecondCount"].includes(x[0])),["intervalMonths","الفاصل بالأشهر","number"]);
    if(cash)pay.push(["cashDueDate","تاريخ تسديد الرصيد","date"]);
    if(exchange)pay.unshift(["exchangePayer","دافع الفرق","payer"],["exchangeManual","تسوية يدوية","manual"],["exchangePaymentNote","طريقة دفع الفرق"]);
    if(cash||inst)for(let i=0;i<4;i++){const prefix=(cash?"cashPayments":"extras")+"."+i+".";pay.push([prefix+"amount","الدفعة "+(i+1),"money"],[prefix+"date","تاريخ الدفعة "+(i+1),"date"]);}
    const custom=[];
    for(const [id,spec] of Object.entries(cfg.design?.fillAppearance?.["contract:"+v.contractType]||{})){
      const key=spec.binding||id;
      if(spec.kind==="field"&&!spec.hidden&&key!=="number"&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)&&!Object.hasOwn(Object.prototype,key))
        custom.push(["bookValues."+key,spec.title||key,spec.type||"text"]);
    }
    return [...parties,...(exchange?[["المركبة القديمة",dataDefs.oldVehicleInputs]]:[]),[exchange?"المركبة الجديدة":"المركبة",external?[...dataDefs.carInputs,["externalKeys","بصمة / مفتاح"],["externalPurchaseDate","تاريخ شراء المركبة","date"],["externalWaiverDate","تاريخ التنازل","date"]]:dataDefs.carInputs],
      ...(!external?[["الضمان",dataDefs.noteInputs]]:[]),["الدفع",pay],...(custom.length?[["خانات إضافية",custom]]:[]),["الملاحظات",dataDefs.financialNotes]];
  },
  value(v,key){return key.split(".").reduce((o,k)=>o?.[k],v);},
  set(v,key,value){const keys=key.split(".");let o=v;while(keys.length>1){const k=keys.shift();o=o[k]??=(/^\d+$/.test(keys[0])?[]:{});}o[keys[0]]=value;},
  async init(){
    document.body.classList.add("hosted-workspaces");
    this.panel=this.el("main");this.panel.id="salesWorkspace";this.panel.dir="rtl";this.panel.hidden=true;
    this.status=this.el("output");this.status.setAttribute("role","status");this.bar=this.el("header");this.content=this.el("div");
    this.panel.append(this.bar,this.status,this.content);document.body.append(this.panel);
    window.addEventListener("focus",()=>{if(!this.panel.hidden&&!this.active&&this.listing)this.list().catch(e=>this.status.textContent=e.message);});
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&this.active?.dirty)this.flush().catch(e=>this.status.textContent=e.message);});
    window.addEventListener("keydown",event=>{
      if(this.panel.hidden || !(event.ctrlKey||event.metaKey) || event.key.toLowerCase()!=="p")return;
      event.preventDefault();event.stopImmediatePropagation();
      const task=this.active?this.singleOutput(0):this.selected.size?this.output(0):null;
      if(task)task.catch(e=>this.status.textContent=e.message);else this.status.textContent="حدّد الفورمات المطلوبة للطباعة.";
    },true);
    if(!Cloud.restricted){
      const b=this.button("الفورمات",()=>this.open());$("homeButton").after(b,this.button("العقود",()=>this.contracts()));
      $("homeButton").title="الأرشيف";$("homeButton").ariaLabel="الأرشيف";
    }else await this.open();
  },
  async open(){
    if(!Cloud.restricted && !this.panel.hidden)return;
    if(!Cloud.restricted){document.activeElement?.blur();await Services.flush();}
    this.panel.hidden=false;document.body.classList.add("forms-workspace");
    this.hiddenNodes=[...document.body.children].filter(e=>e!==this.panel && e.id!=="startupThread" && !e.inert && !["SCRIPT","STYLE","LINK"].includes(e.tagName));
    for(const e of this.hiddenNodes)e.inert=true;
    await this.list();
  },
  async contracts(){
    if(this.panel.hidden)await this.open();await this.flush();this.active=null;
    this.listing=false;Services.library=await Cloud.archive();this.status.textContent="";
    this.bar.replaceChildren(this.el("h1","العقود والكتب"),this.button("الفورمات",()=>this.list()),this.button("الأرشيف",()=>this.leave(true)));
    const drafts=Services.library.entries.filter(e=>e.kind==="draft");
    this.content.replaceChildren(this.button("إضافة عقد",async()=>{await this.leave(false);await Services.createContract();}),this.button("إضافة كتاب",async()=>{await this.leave(false);await Workbench.choose();}),this.el("h2","مسوداتي"));
    for(const e of drafts)this.content.append(this.button([e.data.number,e.data.buyer||e.data.externalBuyer||e.data.bookTitle].filter(Boolean).join(" · "),async()=>{await this.leave(false);await Services.openEntry(e);}));
  },
  async leave(archive){
    await this.flush();this.active=null;this.panel.hidden=true;document.body.classList.remove("forms-workspace");
    for(const e of this.hiddenNodes||[])e.inert=false;
    if(archive)await Services.showHome();
  },
  async list(){
    await this.flush();this.active=null;this.listing=true;this.status.textContent="";this.selected.clear();const rows=[];let cursor={};const ticket=this.listTicket=Symbol();
    for(;;){const batch=await Cloud.call("forms_list",cursor);if(this.listTicket!==ticket)return;rows.push(...batch);if(batch.length<100)break;const last=batch.at(-1);cursor={before:last.changed,cursor:last.id};}
    this.rows=rows;const company=this.select("الشركة",Cloud.account.companies.map(c=>[c.id,c.name]),Cloud.company.id);
    company.onchange=()=>Cloud.switchCompany(company.value);
    this.bar.replaceChildren(this.el("h1","الفورمات"),company);
    if(Cloud.company.department!=="finance"){
      this.bar.append(this.button("إضافة فورمة",()=>this.create()));
      const saved=this.recovered();if(saved)this.bar.append(this.button("استعادة كتابة غير محفوظة",()=>this.restore(saved)));
    }
    if(!Cloud.restricted)this.bar.append(this.button("العقود",()=>this.contracts()),this.button("الأرشيف",()=>this.leave(true)));
    this.bar.append(this.button("تحديث",()=>this.list()),this.button("خروج",()=>Cloud.logout()));
    const tools=this.el("div");tools.className="forms-actions";const all=this.el("input");all.type="checkbox";all.ariaLabel="تحديد كل الفورمات المعروضة";
    const search=this.el("input");search.type="search";search.placeholder="بحث بالزبون أو المركبة أو الفرع";search.ariaLabel=search.placeholder;
    const actions=["طباعة","تنزيل PDF","مشاركة PDF"].map((s,i)=>this.button(s,()=>this.output(i)));tools.append(all,search,...actions);
    const lists=this.el("div");lists.className="forms-lists";this.content.replaceChildren(tools,lists);
    const paint=()=>{
      const visible=this.rows.filter(r=>[r.buyer,r.car,r.branch,r.author_name].some(x=>String(x||"").includes(search.value.trim())));
      this.selected=new Set([...this.selected].filter(id=>visible.some(r=>r.id===id)));
      const state=()=>{all.checked=!!visible.length&&visible.every(r=>this.selected.has(r.id));all.indeterminate=!all.checked&&!!this.selected.size;actions.forEach(b=>b.disabled=!this.selected.size);};
      all.onchange=()=>{this.selected=new Set(all.checked?visible.map(r=>r.id):[]);paint();};
      lists.replaceChildren();
      for(const published of Cloud.company.department==="finance"?[true]:[false,true]){
        const section=this.el("section");section.append(this.el("h2",published?"الفورمات المنشورة":"مسوداتي"));
        const batch=visible.filter(r=>!!r.published===published);
        for(const r of batch){
          const row=this.el("div");row.className="forms-row";const ck=this.el("input");ck.type="checkbox";ck.checked=this.selected.has(r.id);ck.ariaLabel="تحديد "+(r.buyer||"فورمة");
          ck.onchange=()=>{if(ck.checked)this.selected.add(r.id);else this.selected.delete(r.id);state();};
          const name=this.button(r.buyer||"فورمة جديدة",()=>this.view(r));name.className="forms-name";
          const info=this.el("small",[r.car,r.branch,r.author_name,new Date(r.changed).toLocaleDateString("ar-IQ")].filter(Boolean).join(" · "));
          row.append(ck,name,info);
          if(published)row.append(this.el("span",r.approved?"✓ معتمدة":"بانتظار الاعتماد"));
          if(r.linked)row.append(this.el("span","تم إنشاء عقد"));section.append(row);
        }
        if(!batch.length)section.append(this.el("p",published?"لا توجد فورمات منشورة.":"لا توجد مسودات."));lists.append(section);
      }state();
    };search.oninput=paint;paint();
  },
  async create(){
    if(this.recovered())throw Error("استعد الكتابة غير المحفوظة أولاً.");
    const branch=Cloud.company.branches.find(b=>b.name===cfg.fixed.branch)||Cloud.company.branches[0];
    if(!branch)throw Error("يحتاج حسابك إلى فرع مسند.");
    this.active={id:crypto.randomUUID(),branch:branch.name,version:0,data:fresh(),dirty:false};
    this.active.data.companyId=Cloud.company.id;this.edit();
  },
  async view(row){
    const f=await Cloud.call("form_read",{id:row.id});this.active={...f,branch:row.branch,approved_by:row.approved_by,author_name:row.author_name,dirty:false};
    this.edit();
  },
  get recoveryKey(){return "unsaved-sales-form:"+Cloud.storageKey();},
  keep(f){try{sessionStorage.setItem(this.recoveryKey,JSON.stringify({id:f.id,branch:f.branch,version:f.version,data:f.data}));}catch{}},
  recovered(){try{return JSON.parse(sessionStorage.getItem(this.recoveryKey));}catch{return null;}},
  async restore(saved){
    const row=this.rows.find(r=>r.id===saved.id);
    if(row?.published || !Cloud.company.branches.some(b=>b.name===saved.branch)){sessionStorage.removeItem(this.recoveryKey);await this.list();return;}
    if(row && row.version!==saved.version){
      // Keep the user's text as a separate draft when another tab saved a newer version.
      saved={...saved,id:crypto.randomUUID(),version:0};
    }
    this.active={...saved,dirty:true};this.edit();await this.flush();
  },
  dirty(){this.active.dirty=true;this.keep(this.active);this.status.textContent="جارٍ حفظ المسودة…";clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(e=>this.status.textContent=e.message),500);},
  async flush(){
    clearTimeout(this.timer);const f=this.active;
    const write=async()=>{
      if(!f?.dirty||f.published)return;
      const data=clone(f.data);f.dirty=false;
      try{const res=await Cloud.call("form_save",{id:f.id,branch:f.branch,version:f.version,data});f.version=res.version;if(!f.dirty){sessionStorage.removeItem(this.recoveryKey);this.status.textContent="حُفظت المسودة";}else this.keep(f);}
      catch(e){f.dirty=true;throw e;}
    };
    const pending=this.tail.then(write);this.tail=pending.catch(()=>{});return pending;
  },
  edit(){
    this.listTicket=null;this.listing=false;const f=this.active,v=f.data,readOnly=!!f.published;this.bar.replaceChildren(this.button("الفورمات",()=>this.list()),this.el("h1",readOnly?"فورمة منشورة":"تعبئة فورمة"));
    this.status.textContent=readOnly?(f.approved?"معتمدة · "+(f.approved_by||""):"بانتظار الاعتماد"):"مسودة خاصة";
    if(!readOnly)this.bar.append(this.button("نشر الفورمة",async()=>{if(![v.buyer,v.externalBuyer,v.externalSeller].some(s=>s?.trim()))throw Error("أدخل اسم الزبون قبل النشر.");await this.flush();if(!f.version){f.dirty=true;await this.flush();}await Cloud.call("form_publish",{id:f.id,version:f.version,data:v});this.active=null;await this.list();}));
    this.bar.append(this.button("طباعة",()=>this.singleOutput(0)),this.button("تنزيل PDF",()=>this.singleOutput(1)));
    const br=Cloud.company.branches.find(b=>b.name===f.branch);
    if(readOnly&&!f.approved&&(Cloud.company.role==="administrator"||Cloud.company.branchRoles?.[br?.id]==="branch_manager"))this.bar.append(this.button("اعتماد الفورمة",async()=>{await Cloud.call("form_approve",{id:f.id,version:f.version});await this.list();}));
    if(readOnly&&!Cloud.restricted&&!f.linked)this.bar.append(this.button("إنشاء عقد من الفورمة",async()=>{
      const {record}=await Cloud.call("form_convert",{id:f.id,version:f.version,prefix:cfg.fixed.prefix});await this.leave(false);Services.library=await Cloud.archive();const entry=Services.library.entries.find(e=>e.id==="draft:"+record);if(!entry)throw Error("تعذّر فتح مسودة العقد.");await Services.openEntry(entry);
    }));
    const meta=this.el("div");meta.className="forms-actions";
    const kind=this.select("نوع العقد",Object.entries(this.types),v.contractType),branch=this.select("الفرع",Cloud.company.branches.map(b=>[b.name,b.name]),f.branch);
    branch.disabled=readOnly||!!f.version;branch.onchange=()=>{f.branch=branch.value;this.dirty();branch.disabled=true;};
    kind.disabled=readOnly;kind.onchange=()=>{v.contractType=kind.value;this.dirty();this.edit();};
    meta.append(this.el("span",Cloud.company.name),branch,kind);this.content.replaceChildren(meta);
    for(const [title,fields] of this.groups(v)){
      const box=this.el("fieldset");box.append(this.el("legend",title));
      for(const [key,caption,type] of fields){
        const val=this.value(v,key),label=this.el("label"),input=type==="brand"?this.select(caption,[["auto","تلقائي"],["changan","شانجان"],["deepal","ديبال"]],val||"auto"):type==="payer"?this.select(caption,[["0","الطرف الأول"],["1","الطرف الثاني"]],val||"0"):this.el(type==="textarea"?"textarea":"input");
        input.disabled=readOnly;label.append(this.el("span",caption),input);
        if(type==="manual"||type==="checkbox"){input.type="checkbox";input.checked=type==="manual"?val==="1":!!val;}
        else{if(type==="date"||type==="tel")input.type=type;if(type==="number"||type==="money")input.inputMode="numeric";input.value=val??"";if(type==="car")input.setAttribute("list","salesCars");}
        input.oninput=()=>{if(key==="firstDate")v.firstAuto=false;if(key==="depositDate")v.depositAuto=false;this.set(v,key,type==="manual"?(input.checked?"1":"0"):type==="checkbox"?input.checked:input.value);this.dirty();if(key==="phaseEnabled"||key==="exchangeManual")this.edit();};
        box.append(label);
      }this.content.append(box);
    }
    const cars=this.el("datalist");cars.id="salesCars";for(const c of cfg.cars||[])cars.append(new Option(c.name));this.content.append(cars);
  },

  async singleOutput(mode){
    const f=this.active;if(!f.version)f.dirty=true;await this.flush();
    return this.output(mode,[{...f,author_name:f.author_name||Cloud.account.name}]);
  },
  async output(mode,rows=this.rows.filter(r=>this.selected.has(r.id))){
    if(!rows.length)return;
    const dialog=this.el("dialog");dialog.className="forms-output";const caption=this.el("p","جارٍ تجهيز "+rows.length+" فورمة…");
    const close=this.button("إغلاق",()=>dialog.close());dialog.append(caption,close);this.panel.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
    try {
      await WebResources.loadDocumentFont();await WebResources.pdf();
      const pdf=await PDFLib.PDFDocument.create(),images=[];
      for(const row of rows){
        const f=await Cloud.call("form_read",{id:row.id});
        const canvas=this.el("canvas");canvas.width=1240;canvas.height=1754;
        const ctx=canvas.getContext("2d");ctx.direction="rtl";ctx.textAlign="right";
        let y=0;
        const page=()=>{ctx.fillStyle="#fff";ctx.fillRect(0,0,1240,1754);ctx.fillStyle="#19354a";ctx.fillRect(70,68,1100,3);ctx.font="bold 46px Alyamama, sans-serif";ctx.fillText("فورمة "+(this.types[f.data.contractType]||""),1170,131);ctx.font="30px Alyamama, sans-serif";ctx.fillText(Cloud.company.name+"  ·  "+row.branch+"  ·  "+row.author_name,1170,181);y=230;};
        const finish=async()=>{const image=canvas.toDataURL("image/jpeg",0.9);const embedded=await pdf.embedJpg(image),p=pdf.addPage(PDFLib.PageSizes.A4);p.drawImage(embedded,{x:0,y:0,width:p.getWidth(),height:p.getHeight()});if(mode===0)images.push(image);};
        const line=async(text,heading=false)=>{
          if(y>1640){await finish();page();}
          ctx.fillStyle=heading?"#edf2f5":"#fff";ctx.fillRect(70,y-34,1100,48);
          ctx.fillStyle=heading?"#19354a":"#17262e";ctx.font=(heading?"bold ":"")+"30px Alyamama, sans-serif";ctx.fillText(text,1154,y);y+=49;
        };
        page();await line(row.approved?"معتمدة · "+row.approved_by:row.published?"منشورة · بانتظار الاعتماد":"مسودة");
        for(const [group,fields] of this.groups(f.data)){
          const values=fields.filter(([k,,type])=>{const v=this.value(f.data,k);if(k.includes(".")&&k.endsWith(".date")&&!this.value(f.data,k.replace(/date$/,"amount")))return false;return v!=null&&v!==""&&v!==false&&!(type==="manual"&&v==="0");});
          if(!values.length)continue;await line(group,true);
          for(const [k,label,type] of values){
            const val=this.value(f.data,k),str=label+"    "+(type==="payer"?(val==="1"?"الطرف الثاني":"الطرف الأول"):type==="manual"||type==="checkbox"?"نعم":val);
            // Split by measured width so long Arabic notes and chassis numbers remain inside A4.
            let part="";for(const ch of str){if(ch==="\n"||ctx.measureText(part+ch).width>1060){await line(part);part="";}if(ch!=="\n")part+=ch;}if(part)await line(part);
          }
        }await finish();
      }
      const file=new File([await pdf.save()],"فورمات.pdf",{type:"application/pdf"});
      const save=()=>{const url=URL.createObjectURL(file),a=this.el("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
      if(mode===1){save();dialog.close();return;}
      if(mode===2){
        if(navigator.canShare?.({files:[file]})){caption.textContent="ملف PDF جاهز للمشاركة";dialog.prepend(this.button("مشاركة الملف",async()=>{await navigator.share({files:[file],title:"فورمات"});dialog.close();}));}
        else{caption.textContent="احفظ الملف وأرسله من جهازك.";dialog.prepend(this.button("تنزيل PDF",save));}
        return;
      }
      const frame=this.el("iframe");frame.title="معاينة طباعة الفورمات";dialog.prepend(frame);
      const doc=frame.contentDocument,style=doc.createElement("style");style.textContent="@page{size:A4 portrait;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}";
      doc.head.append(style);for(const data of images){const im=doc.createElement("img");im.src=data;doc.body.append(im);await im.decode();}
      caption.textContent="جاهز للطباعة";const print=()=>{frame.contentWindow.focus();frame.contentWindow.print();};dialog.prepend(this.button("طباعة",print));print();
    }catch(error){caption.textContent=error.message;}
  }
};
