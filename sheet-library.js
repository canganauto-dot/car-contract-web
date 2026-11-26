const SheetLibrary = {
  isAdded(id){return Number.isSafeInteger(id) && id>=100000000;},
  sources(){
    return [...Object.entries(Archive.types).filter(([key])=>["cash","exchange","installment","external"].includes(key)).map(([id,name])=>["contract:"+id,name]),
      ...(cfg.design.contractTemplates||[]).map(t=>["contract:"+t.id,t.name]),
      ...[{id:0,name:"نقل ملكية"},{id:4,name:"تخويل قيادة"},...(cfg.letterTemplates||[])].map(t=>["book:"+t.id,t.name])];
  },
  pages(scope,editor){
    if(scope===ContractTemplates.scopeKey())return editor.displayPages.filter(p=>p.tableParent==null);
    const scene=ContractTemplates.scoped(cfg.design,scope),[kind,key]=scope.split(":");
    let pages;
    if(kind==="book"){
      const basic=Number(key)===0?[TransferLetter.template(scene)]:scene.pages;
      pages=Letters.pages(scene,basic,key);
    }else{
      const t=ContractTemplates.find(key,scene);
      pages=t?t.pages.map(r=>ContractTemplates.resolve(scene,r)).filter(Boolean):ContractTemplates.catalog(scene,key);
    }
    return [...pages.filter(p=>!p.addedFor),...scene.pages.filter(p=>p.addedFor===scope)];
  },
  open(editor){
    const dlg=document.createElement("dialog");dlg.className="template-dialog sheet-library";dlg.dir="rtl";
    dlg.innerHTML='<form><h3>إضافة صفحة</h3><label>المصدر<select name="source"><option value="">صفحة فارغة</option></select></label><label hidden>الصفحة<select name="page"></select></label><label>اسم الصفحة<input name="title" required maxlength="80"></label><footer><button>إضافة</button><button type="button" name="cancel">إلغاء</button></footer></form>';
    const form=dlg.firstChild,{source,page,title,cancel}=form.elements;
    for(const [key,label] of this.sources())source.add(new Option((key.startsWith("book:")?"كتاب · ":"عقد · ")+label,key));
    let choices=[];
    const name=()=>title.value=choices[page.selectedIndex]?.name||"صفحة إضافية";
    source.onchange=()=>{choices=source.value?this.pages(source.value,editor):[];page.replaceChildren(...choices.map((p,i)=>new Option(p.name,String(i))));page.parentElement.hidden=!source.value;name();};
    page.onchange=name;source.onchange();cancel.onclick=()=>dlg.close();
    form.onsubmit=e=>{e.preventDefault();if(!title.value.trim()||(source.value&&!choices[page.selectedIndex]))return;
      const original=choices[page.selectedIndex],sheet=original?clone(original):{nodes:[]};
      const id=Math.max(100000000,...editor.scene.pages.map(p=>p.id))+1;
      if(original){sheet.sourcePage=original.sourcePage??original.id;sheet.sourceScope=original.sourceScope||source.value;}
      Object.assign(sheet,{id,name:title.value.trim(),addedFor:ContractTemplates.scopeKey()});
      editor.checkpoint();editor.scene.pages.push(sheet);editor.page=id;editor.selection.clear();editor.render();
      $("pagePreview").value=String(id);editor.changePage();editor.persist();dlg.close();};
    document.body.append(dlg);dlg.onclose=()=>dlg.remove();dlg.showModal();
  }
};
