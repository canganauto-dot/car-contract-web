const FillDesigner = {
  scope() {return ContractTemplates.scopeKey();},
  root() {return $(d.standaloneBook ? "bookFields" : "cards");},
  caption(label) {
    let span=label.querySelector(":scope > span:not(.entry-date)");
    if(!span){
      const text=[...label.childNodes].find(n=>n.nodeType===3 && n.textContent.trim());
      if(text){span=document.createElement("span");span.textContent=text.textContent.trim();text.replaceWith(span);}
    }
    return span;
  },
  sizeTitles(root) {
    this.titleMeasure ||= document.createElement("canvas").getContext("2d");
    let width=0;
    for(const caption of root.querySelectorAll(".entry-caption")){
      if(!caption.getClientRects().length)continue;
      const style=getComputedStyle(caption);
      this.titleMeasure.font=style.fontWeight+" "+style.fontSize+" "+style.fontFamily;
      width=Math.max(width,this.titleMeasure.measureText(caption.textContent.trim()).width+
        parseFloat(style.paddingLeft)+parseFloat(style.paddingRight));
    }
    if(width)root.style.setProperty("--entry-title-width",Math.ceil(width)+"px");
  },
  drawFrame(label) {
    const caption=this.caption(label), svg=label.querySelector(":scope > .entry-frame");
    if(!caption || !svg || !label.offsetWidth || !label.offsetHeight)return;
    const w=label.offsetWidth, h=label.offsetHeight;
    const top=caption.offsetHeight, tab=Math.min(w-2,caption.offsetWidth+10);
    const rise=Math.max(1,w-tab), join=Math.max(8,rise-12);
    svg.setAttribute("viewBox","0 0 "+w+" "+h);
    svg.firstElementChild.setAttribute("d",
      "M 8 "+top+" H "+join+
      " C "+(rise+2)+" "+top+" "+(rise-2)+" 0.5 "+(rise+12)+" 0.5"+
      " H "+(w-9)+" Q "+(w-.5)+" 0.5 "+(w-.5)+" 9"+
      " V "+(h-8)+" Q "+(w-.5)+" "+(h-.5)+" "+(w-8)+" "+(h-.5)+
      " H 8 Q 0.5 "+(h-.5)+" 0.5 "+(h-8)+
      " V "+(top+7)+" Q 0.5 "+top+" 8 "+top+" Z");
    svg.lastElementChild.setAttribute("d",
      "M "+join+" "+top+
      " C "+(rise+2)+" "+top+" "+(rise-2)+" 0.5 "+(rise+12)+" 0.5"+
      " H "+(w-9)+" Q "+(w-.5)+" 0.5 "+(w-.5)+" 9"+
      " V "+top+" Z");
  },
  frame(label) {
    if(label.querySelector(":scope > .entry-frame"))return;
    {
      const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
      svg.classList.add("entry-frame");svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");
      const outline=document.createElementNS(ns,"path"),tab=document.createElementNS(ns,"path");
      tab.classList.add("entry-tab-fill");svg.append(outline,tab);label.prepend(svg);
    }
    this.frameObserver ||= new ResizeObserver(entries=>{
      for(const {target} of entries)this.drawFrame(target.closest("label"));
    });
    (this.observedLabels ||= new Set()).add(label);
    this.frameObserver.observe(label);
    this.frameObserver.observe(this.caption(label));
    this.drawFrame(label);
  },
  guarantorSections:new WeakMap(),
  syncGuarantor() {
    if (!d || !["exchange","installment"].includes(d.contractType)) return;
    const collapsed=this.guarantorSections.get(d)?.[d.contractType] ?? (d.contractType==="exchange");
    $("guarantorCard").classList.toggle("ui-collapsed",collapsed);
  },
  toggleSection(card) {
    const collapsed=card.classList.toggle("ui-collapsed");
    if(card.id==="guarantorCard" && ["exchange","installment"].includes(d.contractType)){
      const state=this.guarantorSections.get(d) || {};
      state[d.contractType]=collapsed;
      this.guarantorSections.set(d,state);
    }
  },
  sectionLayout(){
    for(const card of document.querySelectorAll("#cards > .card")){
      if(card.querySelector(":scope > .section-body"))continue;
      const heading=card.querySelector(":scope > .card-heading");
      if(!heading)continue;
      if(card.id==="buyerCard" && $("customerPhotoTools"))
        card.append($("customerPhotoTools"));
      const body=document.createElement("div"),inner=document.createElement("div");
      body.className="section-body";inner.className="section-inner";
      for(const child of [...card.children])if(child!==heading)inner.append(child);
      body.append(inner);card.append(body);
      const sync=()=>{
        const closed=card.classList.contains("ui-collapsed");
        inner.inert=closed;
        heading.setAttribute("aria-expanded",String(!closed));
      };
      const observer=new MutationObserver(sync);
      observer.observe(card,{attributes:true,attributeFilter:["class"]});
      sync();
      heading.tabIndex=-1;heading.setAttribute("role","button");
      const toggle=()=>this.toggleSection(card);
      heading.onclick=e=>{if(!e.target.closest("button,label,input,select,textarea"))toggle();};
      heading.onkeydown=e=>{if(e.target===heading && ["Enter"," "].includes(e.key)){e.preventDefault();toggle();}};
    }
    const buyer=$("buyer")?.closest("label");
    const camera=$("customerPhotoTools");
    if(buyer && camera && !camera.dataset.fillIndependent){
      buyer.after(camera);
      camera.dataset.fillIndependent="true";
    }
    if(buyer && camera && camera.parentElement===$("buyerCard"))buyer.after(camera);
    const notes=$("notes");
    const last=this.notesMeasurement;
    const width=notes?.clientWidth, fontSize=UIPreferences.value?.fontSize;
    if(notes && (last?.element !== notes || last.value !== notes.value || last.width !== width || last.fontSize !== fontSize)){
      notes.rows=1;notes.style.height="auto";
      notes.style.height=Math.max(29,notes.scrollHeight)+"px";
      this.notesMeasurement={element:notes,value:notes.value,width,fontSize};
    }
  },
  apply() {
    if(!d || Services.home || !this.root())return;
    const root=this.root();
    // Removed form elements are released by ResizeObserver when no longer observed.
    for(const label of this.observedLabels||[]){
      if(!label.isConnected){this.frameObserver.unobserve(label);const cap=this.caption(label);if(cap)this.frameObserver.unobserve(cap);this.observedLabels.delete(label);}
    }
    for(const label of root.querySelectorAll("label")) {
      const control=label.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea");
      if(!control || label.querySelector("input[type=checkbox],input[type=radio]")) continue;
      const caption=this.caption(label);
      if(caption) {label.classList.add("entry-field");caption.classList.add("entry-caption");}
    }
    this.sectionLayout();

    FillLayout.apply(root);
    this.sizeTitles(root);
    for(const label of root.querySelectorAll("label.entry-field"))this.frame(label);
  },
  tabOrder(root) {
    const selector = "input,select,textarea,button,[tabindex]";
    const groups = new Map();
    for (const control of root.querySelectorAll(selector)) {
      if (control.tabIndex < 0 || control.matches(":disabled,#brand,.card-heading") ||
          control.closest("[hidden],[inert]")) continue;
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(control).visibility !== "visible") continue;
      const group = control.closest("#cards > .card") || root;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({control, rect});
    }
    const rtl = getComputedStyle(root).direction === "rtl";
    const order = (items, rectOf, vertical = rect => rect.top) => {
      const rows = [];
      for (const item of items.sort((a,b) => vertical(rectOf(a)) - vertical(rectOf(b)))) {
        const top = vertical(rectOf(item));
        const row = rows.at(-1);
        if (row && top - row.top <= 12) row.items.push(item);
        else rows.push({top, items:[item]});
      }
      return rows.flatMap(row => row.items.sort((a,b) => rtl
        ? rectOf(b).right - rectOf(a).right
        : rectOf(a).left - rectOf(b).left));
    };
    const sections = [...groups].map(([group, items]) => ({items, rect:group.getBoundingClientRect()}));
    return order(sections, section => section.rect)
      .flatMap(section => order(section.items, item => item.rect, rect => rect.top + rect.height / 2).map(item => item.control));
  },
  tabBetweenFields(event) {
    if (event.key !== "Tab" || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
        FillLayout.panel || Services.home) return;
    const root = this.root();
    if (!root?.contains(event.target)) return;
    const fields = this.tabOrder(root);
    const index = fields.indexOf(event.target);
    if (index === -1) return;
    const next = fields[index + (event.shiftKey ? -1 : 1)];
    if (!next) {
      // Let the browser leave the form at its visual boundary.
      const restore = fields.filter(field => field !== event.target).map(field => [field, field.getAttribute("tabindex")]);
      for (const [field] of restore) field.tabIndex = -1;
      setTimeout(() => {
        for (const [field, value] of restore) {
          if (value === null) field.removeAttribute("tabindex");
          else field.setAttribute("tabindex", value);
        }
      }, 0);
      return;
    }
    event.preventDefault();
    const dateId = next.matches(".date-text") ? next.parentElement.querySelector("input[type=date]")?.id : "";
    const id = next.id;
    next.focus();
    // Committing the previous field can rebuild a book's inputs.
    if (!next.isConnected) {
      const replacement = dateId ? $(dateId)?.parentElement.querySelector(".date-text") : (id && $(id));
      replacement?.focus();
    }
  },
  init(){
    FillLayout.init();
    $("fillPanel").addEventListener("keydown", event => this.tabBetweenFields(event));
    for(const [id,icon] of [["customerCapture","camera"],["takeCustomerPhoto","shutter"],["cameraUploadFallback","upload"],["customerPhotoRemove","trash"]])
      $(id).innerHTML=Archive.icon(icon);
    $("printSides").after($("fillPrint"));
    $("fillPrint").title="طباعة العقد";
    $("fillPrint").setAttribute("aria-label","طباعة العقد");
    $("fillPrint").innerHTML=Archive.icon("print");
    const remeasure = () => {
      this.notesMeasurement = null;
      FillLayout.lastApplied = null;
      this.apply();
    };
    document.fonts?.ready.then(remeasure);
    document.fonts?.addEventListener("loadingdone",remeasure);
  }
};
