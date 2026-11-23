const FieldStudio = {
  fields() { return cfg.design?.fieldRegistry || {}; },
  groups: {buyerInputs:"الزبون",guarantorInputs:"الكفيل",carInputs:"المركبة",oldVehicleInputs:"المركبة القديمة",paymentInputs:"الدفع",installmentInputs:"الأقساط",financialNotes:"الملاحظات",noteInputs:"الضمان"},
  sorted(keys) { return [...keys].sort((a,b)=>(this.fields()[a]?.order??999)-(this.fields()[b]?.order??999)); },
  applies(spec) {
    if(!spec?.scope)return true;
    const scope=ContractTemplates.scopeKey();
    return scope===spec.scope || scope==="contract:"+spec.scope;
  },
  inputValues() {
    const values=Object.entries(d.bookValues || {});
    return Object.fromEntries(values.filter(([key])=>this.applies(this.fields()[key])));
  },
  values(result) {
    for (const [key,f] of Object.entries(this.fields())) {
      if (!this.applies(f))continue;
      if (f.source==="company") result[key]=d.bookNoCompany?"":f.values?.[d.companyId]??"";
      if (f.source==="vehicle") {
        const car=cfg.cars.find(c=>[c.name,...(c.aliases||[])].some(n=>normalizeName(n)===normalizeName(d.car)));
        result[key]=f.values?.[car?.id]??"";
      }
      if (f.source==="input") result[key]=d.bookValues?.[key]??f.value??"";
      if (f.source==="toggle") result[key]=d.bookValues?.[key]?f.on:f.off;
    }
    return result;
  },
  applyForm() {
    if(d.standaloneBook)return;
    const fields=Object.assign(Object.create(null),this.fields());
    const managed=FillLayout.bindings();
    const template=ContractTemplates.find();
    if(template && !d.standaloneBook){
      const known=context(), scene=ContractTemplates.scoped(cfg.design);
      for(const ref of ContractTemplates.find(d.templateId,scene).pages){
        const page=ContractTemplates.resolve(scene,ref);
        for(const key of documentVariables(page)){
          if((!Object.hasOwn(known,key) || Object.hasOwn(d.bookValues||{},key)) && !Object.hasOwn(fields,key) && !(key in {}))
            fields[key]={label:cfg.variableLabels?.[key]||key,source:"input",group:"buyerInputs",order:999};
        }
      }
    }
    for (const key of this.sorted(Object.keys(fields))) {
      const f=fields[key], host=$(f.group);
      if(!this.applies(f) || managed.has(key))continue;
      if (!host) continue;
      let label=$(key)?.closest("label");
      if (!label && ["input","toggle"].includes(f.source)) {
        label=document.createElement("label");
        const span=document.createElement("span"), input=document.createElement("input");
        input.id=key; input.dataset.field=key; label.dataset.field=key;
        input.type=f.source==="toggle"?"checkbox":"text";
        input.value=d.bookValues?.[key]??f.value??""; input.checked=!!d.bookValues?.[key];
        input.onchange=()=>{(d.bookValues ||= {})[key]=input.type==="checkbox"?input.checked:input.value; render();saveDraft();};
        if(key==="number"){input.type="text";input.value=d.number;BranchNumbers.bind(input);}
        label.append(span,input);label.style.setProperty("--entry-span","span 6");
      }
      if(!label || !label.closest("#cards") && label.isConnected) continue;
      if(f.hidden){label.hidden=true;continue;}
      if(label.querySelector("span")) label.querySelector("span").textContent=f.label;
      label.hidden=false;
      const before=[...host.children].filter(n=>n!==label)[Math.max(0,(f.order||1)-1)];
      host.insertBefore(label,before||null);
    }
  },
  dialog(title) {
    const dialog=document.createElement("dialog");
    dialog.className="studio-dialog";
    const h=document.createElement("h3");h.textContent=title;dialog.append(h);
    document.body.append(dialog);dialog.onclose=()=>dialog.remove();
    return dialog;
  },
  button(host,title,click) {
    const b=document.createElement("button");b.type="button";b.textContent=title;b.onclick=click;host.append(b);return b;
  },
  book() {
    const dlg=this.dialog("قالب كتاب جديد");
    dlg.insertAdjacentHTML("beforeend",'<label>اسم الكتاب<input maxlength="80"></label><label>ابدأ من صفحة<select></select></label>');
    const title=dlg.querySelector("input"),select=dlg.querySelector("select"),scene=cfg.design;
    const pages=[{name:"كتاب فارغ",page:null}];
    for(const [type,label] of Object.entries(Archive.types)) for(const page of ContractTemplates.catalog(scene,type))
      pages.push({name:label+" · "+page.name,page});
    for(const t of scene.contractTemplates||[]) for(const ref of t.pages){
      const page=ContractTemplates.resolve(scene,ref);
      if(page)pages.push({name:t.name+" · "+page.name,page});
    }
    for(const t of cfg.letterTemplates||[]) {
      const page=scene.pages.find(p=>p.id===t.id);
      if(page)pages.push({name:t.name,page});else pages.push({name:t.name,page:null,body:t.body});
    }
    pages.forEach((p,i)=>select.add(new Option(p.name,i)));
    this.button(dlg,"حفظ القالب",async e=>{
      const name=title.value.trim();
      if(!name || [...(cfg.letterTemplates||[]),{name:"تخويل قيادة"},{name:"نقل ملكية"}].some(t=>t.name===name)){title.setCustomValidity("أدخل اسماً فريداً");title.reportValidity();return;}
      const id=Math.max(12000,...scene.pages.map(p=>p.id),...(cfg.letterTemplates||[]).map(t=>t.id))+1;
      const page=pages[select.value].page;
      if(page)scene.pages.push({...clone(page),id,name});
      (cfg.letterTemplates ||= []).push({id,name,body:pages[select.value].body||""});
      e.currentTarget.disabled=true;
      try {await saveConfig(); App.scene=null;dlg.close();}
      catch(err){cfg.letterTemplates.pop();if(page)scene.pages.pop();dlg.querySelector("button").disabled=false;await Feedback.notice(err.message);}
    });
    title.oninput=()=>title.setCustomValidity("");
    this.button(dlg,"إغلاق",()=>dlg.close());dlg.showModal();
  },
  open(){
    const dlg=this.dialog("خانات الملء والمتغيرات");
    dlg.insertAdjacentHTML("beforeend",'<label>بحث<input name="search"></label><select size="7" name="list" aria-label="المتغيرات"></select><label>رمز المتغير<input name="key" dir="ltr"></label><label>عنوان الخانة<input name="label"></label><label>مصدر القيمة<select name="source"></select></label><label>يظهر في<select name="scope"></select></label><label>مجموعة الملء<select name="group"></select></label><label>ترتيب الخانة والتنقل<input type="number" min="1" name="order"></label><label><input type="checkbox" name="hidden"> إخفاء خانة الملء</label><section></section><output></output>');
    const q=name=>dlg.querySelector('[name="'+name+'"]'), list=q("list"),rows=dlg.querySelector("section"),out=dlg.querySelector("output");
    const defs=Object.entries(dataDefs).flatMap(([group,items])=>items.map(([key,label],i)=>({key,label,group,order:i+1})));
    q("scope").add(new Option("كل المستندات",""));
    for(const [k,v] of Object.entries(Archive.types))q("scope").add(new Option(v,k));
    ContractTemplates.list(q("scope"));
    for(const t of [{id:4,name:"تخويل قيادة"},{id:0,name:"نقل ملكية"},...(cfg.letterTemplates||[])])q("scope").add(new Option(t.name,"book:"+t.id));
    for(const [k,v] of Object.entries(this.groups))q("group").add(new Option(v,k));
    for(const [k,v] of Object.entries({native:"قيمة النظام",input:"إدخال نص",company:"حسب الشركة",vehicle:"حسب المركبة",toggle:"خيار تشغيل وإيقاف"}))q("source").add(new Option(v,k));
    const used=[...JSON.stringify(cfg.design).matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]);
    const keys=()=>[...new Set([...used,...Object.keys(contextCache).filter(k=>typeof contextCache[k]!=="object"),...defs.map(f=>f.key),...Object.keys(this.fields())])];
    const contextCache=context();
    const labelFor=k=>this.fields()[k]?.label||cfg.variableLabels?.[k]||defs.find(f=>f.key===k)?.label||k;
    const refresh=()=>{const s=q("search").value.toLowerCase();list.replaceChildren(...keys().filter(k=>(k+" "+labelFor(k)).toLowerCase().includes(s)).map(k=>new Option(labelFor(k)+" · "+k,k)));};
    let current="";
    const companyProps={company:"fullName",shortCompany:"name",manager:"manager",address:"address",phone:"phone",transferAddressee:"transferAddressee"};
    const companySource=k=>Object.hasOwn(companyProps,k)||cfg.companyFields?.some(f=>f.key===k);
    const values=()=>{
      rows.replaceChildren();const f=this.fields()[current]||{}, source=q("source").value;
      if(source==="native"){rows.textContent="القيمة الحالية · "+(contextCache[current]??"");return;}
      const items=source==="company"?cfg.companies:source==="vehicle"?cfg.cars:source==="toggle"?[{id:"on",name:"عند التفعيل"},{id:"off",name:"عند الإلغاء"}]:[{id:"value",name:"القيمة الافتراضية"}];
      for(const item of items){const l=document.createElement("label"),i=document.createElement("input");l.textContent=item.name;i.dataset.key=item.id;i.value=(source==="company"||source==="vehicle"?(companySource(current)?(companyProps[current]?item[companyProps[current]]:item.values?.[current]):f.values?.[item.id]):f[item.id])??"";l.append(i);rows.append(l);}
    };
    const select=k=>{
      current=k;const f=this.fields()[k]||{}, def=defs.find(x=>x.key===k);
      q("key").value=k;q("key").readOnly=!!k;q("label").value=k?labelFor(k):"";
      q("scope").value=f.scope||"";q("group").value=f.group||def?.group||"buyerInputs";q("order").value=f.order||def?.order||1;q("hidden").checked=!!f.hidden;
      q("source").value=companySource(k)?"company":f.source||(k && Object.hasOwn(contextCache,k)?"native":"input");q("source").disabled=companySource(k)||q("source").value==="native";
      q("source").options[0].disabled=!k;values();out.textContent="";
    };
    q("search").oninput=refresh;list.onchange=()=>select(list.value);q("source").onchange=values;
    this.button(dlg,"متغير جديد",()=>{list.selectedIndex=-1;select("");q("key").focus();});
    this.button(dlg,"حفظ",async()=>{
      const key=q("key").value.trim(),label=q("label").value.trim();
      if(!label|| !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||(!current&&(keys().includes(key)||key in {}||$(key)))){out.textContent="أدخل عنواناً ورمزاً إنكليزياً فريداً.";return;}
      const f={label,scope:q("scope").value,source:q("source").value,group:q("group").value,order:Math.max(1,Number(q("order").value)||1),hidden:q("hidden").checked};
      const vals=Object.fromEntries([...rows.querySelectorAll("input")].map(i=>[i.dataset.key,i.value]));
      if(companySource(key)){for(const c of cfg.companies){if(companyProps[key])c[companyProps[key]]=vals[c.id]??"";else (c.values ||= {})[key]=vals[c.id]??"";}f.source="native";}
      else if(["company","vehicle"].includes(f.source))f.values=vals;else Object.assign(f,vals);
      (cfg.design.fieldRegistry ||= {})[key]=f;(cfg.variableLabels ||= {})[key]=label;
      try{await saveConfig();App.scene=null;buildInputs();render();refresh();list.value=key;select(key);out.textContent="تم حفظ {{"+key+"}}";}catch(err){out.textContent=err.message;}
    });
    this.button(dlg,"إغلاق",()=>dlg.close());refresh();select(list.value);dlg.showModal();
  },
  init(){
    if(seed.offline)return;
    this.button($("templateActions"),"قالب كتاب جديد",()=>this.book());
    this.button($("fieldActions"),"خانات الملء والمتغيرات",()=>this.open());
    const b=this.button($("draftCount").parentElement,"",async()=>{
      if(Archive.busy)return;
      const ids=new Set(Archive.selectedRows().filter(e=>e.kind==="draft").map(e=>e.id));
      if(!ids.size || !await Feedback.ask("حذف المعلّقات المحددة ("+ids.size+")؟"))return;
      await Services.flush();
      if(Cloud.enabled){try{for(const e of Services.library.entries.filter(e=>ids.has(e.id)))await Cloud.write("remove",e.data);}catch(error){Services.library=await Cloud.archive();Archive.refresh();await Feedback.notice(error.message);return;}}
      if(ids.has("draft:"+d.recordId)){d=fresh();await putDB("draft",clone(d));}
      Services.library.entries=Services.library.entries.filter(e=>e.kind!=="draft" || !ids.has(e.id));
      await Services.persistLibrary();Archive.refresh();Workbench.paint();
    });
    b.id="deletePickedDrafts";b.className="danger";b.title="حذف المعلّقات المحددة";
    b.setAttribute("aria-label",b.title);b.innerHTML=Archive.icon("trash");
    $("draftCount").after(b);Archive.selectionState();
  }
};
