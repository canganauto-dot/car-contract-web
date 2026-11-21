const ContractTemplates = {
  scopeKey() { return d.standaloneBook ? "book:"+d.standaloneBook : "contract:"+(d.templateId||d.contractType||"installment"); },
  scoped(scene, scope = this.scopeKey()) {
    const {documentLayouts, ...base} = scene;
    const layout = documentLayouts?.[scope];
    const result = { ...base, ...layout };
    // A saved layout owns the edited pages of its template, not the catalog.
    if (base.contractTemplates && layout?.contractTemplates) {
      const own = layout.contractTemplates.find(template => scope === "contract:" + template.id);
      result.contractTemplates = base.contractTemplates.map(template => template.id === own?.id ? own : template);
    }
    return clone(result);
  },
  layoutKeys: ["pages","cashTemplate","exchangeTemplate","externalPages","transferLetter","scheduleTemplate","companySheets","printLayouts","contractTemplates","variableLabels"],

  find(id = d?.templateId, scene = cfg.design) {
    return !id ? null : scene?.contractTemplates?.find(t => t.id === id);
  },
  list(select, scene = cfg.design) {
    for (const o of [...select.querySelectorAll("option[data-template]")]) o.remove();
    for (const t of scene?.contractTemplates || []) {
      const o = new Option(t.name, t.id);
      o.dataset.template = "1";
      select.add(o);
    }
  },
  catalog(scene, type) {
    if (type === "external") return External.pages(scene);
    const pages = scene.pages.filter(p => p.id < 12000 && (type !== "cash" || ![3,6,8].includes(p.id)))
      .map(p => p.id !== 1 ? p : type === "cash" ? Cash.template(scene) : type === "exchange" ? Exchange.template(scene) : p);
    if (type !== "cash") pages.push(Schedule.template(scene));
    pages.push(...CompanySheets.pages(scene));
    if (["cash","exchange"].includes(type)) pages.push(TransferLetter.template(scene));
    return pages;
  },
  resolve(scene, ref) {
    if (ref.page) return ref.page;
    return this.catalog(scene, ref.source).find(p => p.id === ref.id);
  },
  pages(scene, standard, design) {
    const template = !d.standaloneBook && this.find(d.templateId, scene);
    if (!template) return standard;
    return template.pages.flatMap(ref => {
      if (ref.id === -1) return standard.filter(p => p.id < 0);
      if (!design && d.noWarranty && [2,5].includes(ref.id)) return [];
      const page = this.resolve(scene, ref);
      return page ? [page] : [];
    });
  },
  open() {
    const scene = clone(cfg.design || App.scene);
    const dialog = document.createElement("dialog");
    dialog.className="template-dialog";
    dialog.innerHTML='<form><h3>قالب عقد جديد</h3><label>اسم القالب<input name="title" required maxlength="80"></label><label>نسخ عقد موجود<select name="base"></select></label><div class="template-pages"></div><label>استعارة ورقة من<select name="source"></select></label><div class="template-import"><select name="sheet" aria-label="الورقة"></select><button type="button" name="add">إضافة الورقة</button></div><p role="status"></p><footer><button type="submit">حفظ القالب</button><button type="button" name="cancel">إلغاء</button></footer></form>';
    const form=dialog.firstChild, el=form.elements, status=form.querySelector("[role=status]");
    for(const s of [el.base,el.source]){
      for(const [id,title] of Object.entries(Archive.types)) s.add(new Option(title,id));
      this.list(s,scene);
    }
    if((cfg.letterTemplates||[]).length) el.source.add(new Option("الكتب الخاصة","books"));
    const sources = new Map();
    const refsFor = id => {
      if (sources.has(id)) return sources.get(id);
      let refs;
      if (id === "books") {
        refs = (cfg.letterTemplates || []).flatMap(t => {
          const page = this.scoped(scene, "book:" + t.id).pages.find(p => p.id === t.id);
          return page ? [{ id: t.id, page }] : [];
        });
      } else {
        const source = this.scoped(scene, "contract:" + id);
        const template = this.find(id, source);
        const pages = template ? template.pages : this.catalog(source, id).map(p => ({ id:p.id, source:id }));
        refs = pages.map(ref => ref.id === -1 ? { ...ref } : { ...ref, page:this.resolve(source, ref) });
      }
      sources.set(id, refs);
      return refs;
    };
    let refs=[];
    const draw = () => {
      const host=form.querySelector(".template-pages");
      host.replaceChildren();
      refs.forEach((ref,i)=>{
        const row=document.createElement("div"), label=document.createElement("span");
        label.textContent=this.resolve(scene,ref)?.name || String(ref.id);
        row.append(label);
        for(const [name,delta] of [["رفع",-1],["خفض",1],["حذف",0]]){
          const b=document.createElement("button");
          b.type="button"; b.textContent=name; b.disabled=(!delta && ref.id===1) || i+delta<0 || i+delta>=refs.length;
          b.onclick=()=>{if(delta) [refs[i],refs[i+delta]]=[refs[i+delta],refs[i]];else refs.splice(i,1);draw()};
          row.append(b);
        }
        host.append(row);
      });
    };
    el.base.onchange=()=>{refs=refsFor(el.base.value);draw()};
    el.source.onchange=()=>el.sheet.replaceChildren(...refsFor(el.source.value).map(r=>new Option(this.resolve(scene,r)?.name || String(r.id),r.id)));
    el.add.onclick=()=>{
      const item=refsFor(el.source.value).find(r=>r.id===Number(el.sheet.value));
      if(!item) return;
      const at=refs.findIndex(r=>r.id===item.id);
      if(at<0) refs.push(item); else refs[at]=item;
      draw();
    };
    el.base.onchange(); el.source.onchange();
    el.cancel.onclick=()=>dialog.close();
    form.onsubmit=async e=>{
      e.preventDefault();
      const name=el.title.value.trim();
      if(!refs.length){status.textContent="أضف ورقة واحدة على الأقل للقالب.";return}
      if(!name || [...el.base.options].some(o=>o.text===name)){status.textContent="اختر اسماً مميزاً للقالب.";return}
      const baseType=this.find(el.base.value,scene)?.baseType || el.base.value;
      const id="template-"+crypto.randomUUID();
      const template={id,name,baseType,pages:refs.map(r=>r.id===1 || r.page
        ? {...r,page:clone(this.resolve(scene,r))} : {...r})};
      const design=cfg.design ||= clone(App.scene);
      (design.contractTemplates ||= []).push(template);
      form.querySelector('[type=submit]').disabled=true;
      try {await saveConfig(); this.list($("archiveContractType")); Archive.refresh(); dialog.close(); $("saveStatus").textContent="أضيف قالب "+name;}
      catch(error){design.contractTemplates=design.contractTemplates.filter(t=>t.id!==id);status.textContent=error.message;form.querySelector('[type=submit]').disabled=false;}
    };
    document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();el.title.focus();
  }
};
