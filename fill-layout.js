const FillLayout = {
  records: new Map(),
  selection:new Set(),
  boxMetrics(box) {
    const css=getComputedStyle(box);
    return {width:box.offsetWidth,height:box.offsetHeight,position:css.position,
      end:parseFloat(css.marginInlineEnd)||0,bottom:parseFloat(css.marginBottom)||0};
  },
  upgrade(design) {
    if(!design?.fillAppearance || design.fillGeometryVersion>=1)return;
    // These shipped desktop offsets predate the responsive vehicle and payment grids.
    // Preserve coordinates that the operator has actually changed.
    const original={deposit:[-71,0], count:[-1,1], firstDate:[-74,1], brand:[-147,0],
      noWarranty:[-198,0], phaseEnabled:[-122,-8], intervalToggle:[-341,-52]};
    const installment=design.fillAppearance["contract:installment"] || {};
    const issuingPlace=installment.guarantorIdFrom;
    if(issuingPlace?.footHeight===56 && issuingPlace.wUnits===2 && issuingPlace.widthScale===6 &&
       issuingPlace.hUnits===1 && !issuingPlace.dx && !issuingPlace.dy){
      delete issuingPlace.wUnits;delete issuingPlace.widthScale;
    }
    for(const [key,[x,y]] of Object.entries(original)){
      const spec=installment[key];
      if(spec && spec.dx===x && spec.dy===y){
        delete spec.dx;delete spec.dy;
        // The date and count shared six tracks in the original installment row.
        if((key==="firstDate" && spec.wUnits===1 || key==="count" && spec.wUnits===2) && spec.widthScale===6){
          delete spec.wUnits;delete spec.widthScale;
        }
      }
    }
    for(const layout of Object.values(design.fillAppearance)){
      for(const [key,spec] of Object.entries(layout)){
        delete spec.footHeight;
        if(!Object.keys(spec).length)delete layout[key];
      }
    }
    design.fillGeometryVersion=1;
  },
  actions: {customerCapture:"صورة الزبون", printAll:"طباعة المستند", addPaymentSlot:"إضافة دفعة"},
  unit(value,max) {return Math.round(EditorSettings.number(value, {min:1, max}) ?? 1);},
  widthUnits(spec) {
    const scale = Number(spec.widthScale) > 0 ? Number(spec.widthScale) : 10;
    const units = EditorSettings.number(spec.wUnits, {min:1, max:scale}) ?? scale;
    return units * EditorSettings.fill.wUnits.max / scale;
  },
  buttonRange(key, item) {
    if (key === "buttonHeight" && item.compactAction) return {min:8, max:24};
    return EditorSettings.fill[key];
  },
  units(item) {
    const host=item.box.parentElement.closest(".grid,.external-party-fields,#bookFields,.section-inner") || FillDesigner.root();
    const style=getComputedStyle(host);
    const full=host.clientWidth-(parseFloat(style.paddingInlineStart)||0)-(parseFloat(style.paddingInlineEnd)||0);
    const gap=parseFloat(style.columnGap) || 0;
    const tracks=style.display==="grid" ? style.gridTemplateColumns.split(" ").length : 0;
    return {w:Math.max(1,(full+gap)/EditorSettings.fill.wUnits.max),gap,rowGap:parseFloat(style.rowGap)||0,h:this.baseHeight || 48,tracks};
  },
  freeBox(item,spec,metrics=this.boxMetrics(item.box),units=this.units(item)) {
    const {box,element,control}=item;
    if(item.pinned)spec={...spec,dx:0,dy:0};
    if(item.container || !metrics.width || !metrics.height)return;
    if(metrics.position==="static")this.style(box,"position","relative");
    if (spec.dx || spec.dy) this.style(box,"translate",(spec.dx || 0)+"px "+(spec.dy || 0)+"px");
    this.style(box,"z-index",String(EditorSettings.number(spec.layer,EditorSettings.fill.layer) ?? 2));
    const section=box.closest(".section-inner");
    if(!item.pinned && section && !section.closest(".ui-collapsed"))this.style(section,"overflow","visible");
    if(item.moveOnly || (!spec.wUnits && !spec.hUnits && !spec.buttonWidth && !spec.buttonHeight))return;
    const width=EditorSettings.number(spec.buttonWidth,this.buttonRange("buttonWidth",item)) ?? (spec.wUnits ? this.widthUnits(spec)*units.w-units.gap : metrics.width);
    let height=EditorSettings.number(spec.buttonHeight,this.buttonRange("buttonHeight",item)) ?? (spec.hUnits ? this.unit(spec.hUnits,3)*(units.h+units.rowGap)-units.rowGap : metrics.height);
    if(control && (spec.fontSize || spec.titleSize) && element.classList.contains("entry-field")){
      const value=getComputedStyle(element.querySelector(".date-text") || control);
      const oneLine=parseFloat(value.lineHeight)+parseFloat(value.paddingTop)+parseFloat(value.paddingBottom);
      if(Number.isFinite(oneLine))height=Math.max(height,item.title.offsetHeight+oneLine+2);
    }
    const gridSlot=spec.wUnits && units.tracks===12 && box.parentElement.matches(".grid") && !item.pinned;
    if(gridSlot){
      this.style(box,"grid-column","span "+Math.max(1,Math.round(this.widthUnits(spec)*2)));
      if(spec.column)this.style(box,"grid-column-start",String(spec.column));
    }
    if(box.id==="customerCapture" && box.closest("#buyerInputs") && units.tracks===12){
      const span=Math.min(6,Math.max(1,Math.ceil((width+units.gap)/(units.w/2))));
      this.style(box.parentElement,"grid-column","span "+span);
      const name=$("buyer")?.closest("label");
      if(name && name.parentElement===box.parentElement.parentElement)
        this.style(name,"--buyer-name-span",String(Math.max(1,6-span)));
    }
    this.style(box,"justify-self","start");
    this.style(box,"align-self","start");
    this.style(box,"box-sizing","border-box");
    if(spec.wUnits || spec.buttonWidth)this.style(box,"width",gridSlot?"100%":width+"px");
    if(control?.id==="notes")this.style(box,"min-height",height+"px");
    else this.style(box,"height",height+"px");
    if(!item.pinned){
      this.style(box,"margin-bottom",(metrics.bottom+Math.max(0,spec.dy||0))+"px");
    }
    this.style(box,"max-width",item.pinned?"100%":"none");
    this.style(box,"max-height",item.compactAction?"24px":"none");
    this.style(box,"min-width","0");
    if(control?.id!=="notes")this.style(box,"min-height","0");
    if(control && element.classList.contains("entry-field"))
      this.style(element,"--entry-body-min","0px");
  },
  addedValue(key,spec) {
    if((spec.binding || key)==="number")return d.numberUnconfirmed ? d.numberRequest : d.number;
    return d.bookValues?.[spec.binding || key] ?? "";
  },
  bindings() {
    const layout=cfg.design?.fillAppearance?.[FillDesigner.scope()] || {};
    return new Set(Object.entries(layout).filter(([,spec])=>spec.kind==="field").map(([id,spec])=>spec.binding || id));
  },
  origins: new Map(),
  restorePositions() {
    for (const [box, anchor] of this.origins) {
      if (anchor.isConnected && box.isConnected) anchor.after(box);
      anchor.remove();
    }
    this.origins.clear();
  },
  place(root, layout) {
    // Resolve destinations against the original form, even after their fields move.
    const origins = new Map();
    for (const [id,item] of this.elements) {
      origins.set(id,this.origins.get(item.box)?.parentElement || item.box.parentElement);
    }
    for (const [id,spec] of Object.entries(layout || {})) {
      const item=this.elements.get(id), host=origins.get(spec.hostField) || (spec.hostGroup && document.getElementById(spec.hostGroup+"-fields"));
      if (!item?.control || item.pinned || !host || !root.contains(host) || host===item.box.parentElement || item.box.contains(host)) continue;
      if (!this.origins.has(item.box)) {
        const anchor=document.createComment("fill position");
        item.box.before(anchor);
        this.origins.set(item.box,anchor);
      }
      host.append(item.box);
    }
  },
  elements: new Map(),
  init() {
    if (seed.offline) return;
    for(const id of ["fieldActions","templateActions"]){
      $(id).addEventListener("click",event=>{if(event.target.closest("button"))$("closeSettings").click();},true);
    }
    FieldStudio.button($("fieldActions"), "تعديل واجهة الملء مباشرة", () => {
      if (Services.home) return Feedback.notice("افتح العقد أو الكتاب المطلوب تعديله أولاً.");
      this.open();
    });
  },
  syncAdded(root,layout,scope) {
    for(const node of root.querySelectorAll("[data-fill-added]")){
      const spec=layout?.[node.dataset.fillAdded];
      if(node.dataset.fillScope!==scope || !spec?.kind || spec.kind==="field" && node.dataset.binding!==(spec.binding || node.dataset.fillAdded)){
        // Return built-in fields before removing a custom group.
        if(node.querySelector("label"))this.restorePositions();
        node.remove();
      }else if(node.dataset.binding==="number"){
        const input=node.querySelector("input");
        if(input && document.activeElement!==input)input.value=this.addedValue(node.dataset.fillAdded,spec);
      }
    }
    for(const kind of ["group","field","button"]){
      for(const [key,spec] of Object.entries(layout || {})){
        if(spec?.kind!==kind || document.getElementById(key))continue;
        const destination = spec.home && document.getElementById(spec.home);
        const home = destination && root.contains(destination) ? destination : root;
        let node;
        if(kind==="group"){
          node=document.createElement("section");node.className="card";
          node.id=key;
          node.innerHTML='<div class="card-heading"><h2></h2></div><div class="grid"></div>';
          node.querySelector("h2").textContent=spec.title || "حافظة جديدة";
          node.lastElementChild.id=key+"-fields";
          root.append(node);
        }else if(kind==="button"){
          node=document.createElement("button");node.type="button";node.id=key;
          const caption=document.createElement("span");caption.textContent=spec.title || "زر جديد";node.append(caption);
          node.onclick=()=>{
            const action=cfg.design.fillAppearance?.[scope]?.[key]?.action;
            if(Object.hasOwn(this.actions,action) && !this.panel) $(action)?.click();
          };
          home.append(node);
        }else{
          const host=home!==root || d.standaloneBook ? home : $("buyerInputs");
          if(!host)continue;
          node=document.createElement("label");
          const caption=document.createElement("span"),input=document.createElement("input");
          caption.textContent=spec.title || key;
          input.type=spec.type || "text";input.id=key;
          input.value=this.addedValue(key,spec);
          input.onchange=()=>{
            const current=cfg.design.fillAppearance?.[scope]?.[key] || spec;
            (d.bookValues ||= {})[current.binding || key]=input.value;
            render();saveDraft();
          };
          node.className="entry-field";caption.className="entry-caption";
          node.dataset.binding=spec.binding || key;
          if((spec.binding || key)==="number")BranchNumbers.bind(input);
          node.append(caption,input);host.append(node);
        }
        node.dataset.fillAdded=key;node.dataset.fillScope=scope;
      }
    }
  },
  collect(root) {
    const entries = new Map();
    for (const card of root.querySelectorAll(":scope > .card, .external-party")) {
      const title = card.querySelector("h2,h3");
      const key = card.dataset.fillSection || card.id;
      if (title && key) entries.set("section:" + key, {element:card, title, box:card,container:true});
    }
    for (const label of root.querySelectorAll("label")) {
      const control = label.querySelector("input[id], select[id], textarea[id]");
      if (!control) continue;
      const title = FillDesigner.caption(label);
      if (!title) continue;
      const box = label;
      // Payment rows appear and disappear in normal flow. Their fields stay in their own row.
      const pinned=control.id==="notes" || !!label.closest("#extraEditors,#cashPaymentRows,#paymentActions");
      entries.set(control.id, {element:label, control, title, box, pinned,
        moveOnly:control.type==="checkbox" || control.type==="radio"});
    }
    for(const button of root.querySelectorAll("button[id]")){
      const compactAction=button.id==="addPaymentSlot";
      entries.set(button.id,{element:button,box:button,title:button.querySelector(":scope > span") || button,
        button:true,pinned:compactAction,compactAction});
    }
    const texts=root.querySelectorAll("h2,h3,p.mini,.metrics > span,output,.notice");
    for(const node of texts){
      if(node.closest("label,button"))continue;
      const parent=node.parentElement.closest("[id]") || root;
      const siblings=[...parent.querySelectorAll(node.tagName)].filter(el=>el.parentElement.closest("[id]")===parent);
      const key="text:"+(node.id || parent.id+"-"+node.tagName+"-"+siblings.indexOf(node));
      entries.set(key,{element:node,box:node,title:node,moveOnly:true});
    }
    return entries;
  },
  reset() {
    for (const [node, record] of this.records) {
      if (!node.isConnected) continue;
      for (const [prop, old] of record.styles) {
        node.style.setProperty(prop,old[0],old[1]);
      }
      if (record.title !== undefined) node.textContent = record.title;
    }
    this.records.clear();

  },
  record(node) {
    if (!this.records.has(node)) this.records.set(node,{styles:new Map()});
    return this.records.get(node);
  },
  style(node, prop, value) {
    const rec=this.record(node);
    if (!rec.styles.has(prop)) rec.styles.set(prop,[node.style.getPropertyValue(prop),node.style.getPropertyPriority(prop)]);
    node.style.setProperty(prop,value,"important");
  },
  flowCards(root) {
    return [...this.elements].filter(([,item]) => item.container && item.box.parentElement === root &&
      !item.box.hidden && item.box.getClientRects().length)
      .sort((a,b) => Number(getComputedStyle(a[1].box).order) - Number(getComputedStyle(b[1].box).order));
  },
  normalizeCardOrder(root, layout) {
    if (!layout) return layout;
    const cards = this.flowCards(root);
    if (!cards.some(([key]) => layout[key]?.free && layout[key].dy)) return layout;
    if(!this.panel)layout={...layout};
    // Older layouts moved cards visually. Convert the displayed order to a
    // real flow order so their position follows the height of preceding cards.
    const oldVehicle = cards.find(([key])=>key==="section:oldVehiclePanel")?.[1].box;
    if(oldVehicle)this.style(oldVehicle,"order","0");
    const top = new Map(cards.map(([key,item])=>[key,item.box.getBoundingClientRect().top+(layout[key]?.dy || 0)]));
    cards.sort(([key],[other])=>top.get(key)-top.get(other));
    cards.forEach(([key], index) => {
      const spec = layout[key] = {...layout[key],order:index};
      delete spec.free;
      delete spec.dx;
      delete spec.dy;
    });
    return layout;
  },
  pairCards(root,layout) {
    const pairs=new Map(),paired=new Set();
    for(const [key,spec] of Object.entries(layout || {})){
      const box=this.elements.get(key)?.box,peer=this.elements.get(spec.beside)?.box;
      if(!box || !peer || box===peer || box.parentElement!==root || peer.parentElement!==root ||
         box.hidden || peer.hidden || paired.has(box) || paired.has(peer))continue;
      pairs.set(peer,box);paired.add(box);paired.add(peer);
    }
    if(pairs.size){
      this.style(root,"display","grid");this.style(root,"grid-template-columns","repeat(2,minmax(0,1fr))");
      this.style(root,"align-content","start");this.style(root,"align-items","start");
      let row=0;
      for(const [,item] of this.flowCards(root)){
        const card = item.box;
        if(paired.has(card) && !pairs.has(card))continue;
        const partner=pairs.get(card);row++;
        this.style(card,"grid-row",String(row));this.style(card,"grid-column",partner?"1":"1 / -1");
        if(partner){this.style(partner,"grid-row",String(row));this.style(partner,"grid-column","2");}
      }
    }
  },
  dragCard(event, root, key, item) {
    const {pointerId,clientY} = event;
    const gesture = new AbortController();
    this.events.signal.addEventListener("abort",()=>gesture.abort(),{once:true,signal:gesture.signal});
    const options = {signal:gesture.signal};
    const heading = item.box.querySelector(":scope > .card-heading");
    heading.setPointerCapture(pointerId);
    const cards = this.flowCards(root).filter(([id])=>id!==key);
    let target, after;
    const clear = () => target?.[1].box.removeAttribute("data-card-drop");
    heading.addEventListener("pointermove", move => {
      if (move.pointerId !== pointerId || Math.abs(move.clientY-clientY)<5) return;
      clear();
      target = cards.find(([,card]) => move.clientY < card.box.getBoundingClientRect().bottom) || cards.at(-1);
      if (!target) return;
      const rect = target[1].box.getBoundingClientRect();
      after = move.clientY > rect.top + rect.height/2;
      target[1].box.dataset.cardDrop = after ? "after" : "before";
    },options);
    heading.addEventListener("pointerup", up=>{
      if (up.pointerId!==pointerId) return;
      clear();
      gesture.abort();
      if(target) this.move(key,target[0],after);
    },options);
    heading.addEventListener("lostpointercapture",()=>{clear();gesture.abort();},options);
  },
  layoutChanged(records) {
    const selector = "label,input,textarea,select,button,.card,.grid";
    return records.some(record => {
      if (record.type === "attributes") return (record.oldValue !== null) !== record.target.hidden;
      return [...record.addedNodes,...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector)));
    });
  },
  observe(root) {
    if (this.root === root) return;
    this.restorePositions();
    this.reset();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    for (const node of this.root?.querySelectorAll("[data-fill-added]") || []) node.remove();
    this.root=root;
    this.lastApplied=null;
    this.observer=new MutationObserver(records => {
      if(this.layoutChanged(records)) this.invalidate();
    });
    this.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"],attributeOldValue:true});
    this.resizeObserver=new ResizeObserver(entries => {
      const width=entries[0]?.contentRect.width;
      if(width && width !== this.observedWidth){this.observedWidth=width;this.invalidate();}
    });
    this.observedWidth=0;
    this.resizeObserver.observe(root);
  },
  invalidate() {
    this.lastApplied=null;
    if(this.frame)return;
    this.frame=requestAnimationFrame(()=>{this.frame=0;this.refresh();});
  },
  apply(root,force=false) {
    this.observe(root);
    const scope=FillDesigner.scope();
    if (this.panel && this.scope!==scope) {this.close();return false;}
    const saved=this.panel ? this.draft : cfg.design.fillAppearance?.[scope];
    let layout=saved;
    const last=this.lastApplied;
    const structural=this.layoutChanged(this.observer.takeRecords());
    if (!force && !this.panel && !structural && last?.scope===scope && last.layout===saved &&
        last.width===root.clientWidth && last.fontSize===UIPreferences.value?.fontSize) {
      // Data edits don't change placement. Keep only the values in user-added controls in sync.
      for (const [key, spec] of Object.entries(layout || {})) {
        const control = spec.kind === "field" && this.elements.get(key)?.control;
        if (control && document.activeElement !== control) control.value = this.addedValue(key, spec);
      }
      return false;
    }
    this.lastApplied = null;
    if(this.lastScope!==scope)this.restorePositions();
    this.lastScope=scope;
    this.reset();
    this.syncAdded(root,layout,scope);
    FillDesigner.prepare(root);
    const notes=root.querySelector("#notes")?.closest("label");
    const notesHost=root.querySelector("#financialNotes");
    if(notes && notesHost && notes.parentElement!==notesHost)notesHost.append(notes);
    if (!layout && !this.panel) {
      this.elements.clear();
      this.lastApplied={scope,layout:saved,width:root.clientWidth,fontSize:UIPreferences.value?.fontSize};
      this.observer.takeRecords();
      return true;
    }
    this.elements=this.collect(root);
    layout=this.normalizeCardOrder(root,layout);
    this.place(root,layout);
    for(const [key,item] of this.elements){
      if(item.container && layout?.[key]?.order!==undefined)this.style(item.box,"order",String(layout[key].order));
    }
    this.pairCards(root,layout);
    const reference=[...this.elements.values()].find(entry=>entry.control && entry.element.classList.contains("entry-field") && entry.element.offsetHeight>0);
    // Measure an ordinary visible one-line field at its natural font size.
    const base=[...this.elements.values()].find(item => item.control && !item.button &&
      !item.moveOnly && item.control.tagName!=="TEXTAREA" && item.box.offsetHeight>0 && item.box.classList.contains("entry-field")) || reference;
    this.baseHeight=base?.box.offsetHeight || 48;
    // Keep keyboard traversal and screen-reader order aligned with the edited layout.
    const ordered=new Map();
    for(const [key,spec] of Object.entries(layout || {})){
      const item=this.elements.get(key);
      if(!item || item.container || item.pinned || spec.order===undefined)continue;
      const {box}=item;
      const parent=box.parentElement;
      if(!ordered.has(parent))ordered.set(parent,[]);
      ordered.get(parent).push({box,order:spec.order});
    }
    for(const [parent,items] of ordered){
      items.sort((a,b)=>a.order-b.order);
      const boxes=items.map(item=>item.box);
      const existing=[...parent.children].filter(node=>boxes.includes(node));
      if(existing.every((box,i)=>box===boxes[i]))continue;
      const slots=existing.map(box=>{
        if(!this.origins.has(box)){
          const origin=document.createComment("field origin");
          box.before(origin);this.origins.set(box,origin);
        }
        const slot=document.createComment("position");box.before(slot);return slot;
      });
      slots.forEach((slot,i)=>slot.replaceWith(boxes[i]));
    }
    for (const [key,spec] of Object.entries(layout || {})) {
      const item=this.elements.get(key);
      if (!item) continue;
      const {element,title,box,control}=item;
      if(spec.kind==="field" && control && document.activeElement!==control) {
        const type=spec.type || "text";
        if(control.type!==type) control.type=type;
        control.value=this.addedValue(key,spec);
      }
      if (spec.title && (!item.button || spec.kind==="button")) {
        this.record(title).title=title.textContent;
        title.textContent=spec.title;
      }
      const titleSize=EditorSettings.number(spec.titleSize,EditorSettings.fill.titleSize);
      if (titleSize!==null) this.style(title,"font-size",titleSize+"px");
      const fontSize=EditorSettings.number(spec.fontSize,EditorSettings.fill.fontSize);
      if (control && fontSize!==null) this.style(element.querySelector(".date-text") || control,"font-size",fontSize+"px");
      if (spec.ink) {
        if (control) this.style(element.querySelector(".date-text") || control,"--fill-field-ink",spec.ink);
        else this.style(title,"color",spec.ink);
      }
      if (spec.edge) {
        this.style(element,"border-color",spec.edge);
        if (control) {
          this.style(element,"--entry-custom-edge",spec.edge);
          if(/^#[0-9a-f]{6}$/i.test(spec.edge))this.style(element,"--entry-caption-ink",UIPreferences.luminance(spec.edge)>.179?"#000":"#fff");
        }
        if (!control) this.style(title.closest(".card-heading") || title,"background-color",spec.edge);
      }
      if (spec.span && control && !item.pinned) this.style(box,"grid-column","span "+spec.span);
      if (!item.pinned && spec.order!==undefined) this.style(box,"order",String(spec.order));
      if (!item.container && spec.width && !spec.free) {
        const host=box.parentElement, styles=getComputedStyle(host);
        const tracks=styles.gridTemplateColumns.split(" ").map(parseFloat);
        const gap=parseFloat(styles.columnGap)||0;
        if (!item.pinned && styles.display==="grid" && tracks[0]>0) {
          const span=Math.min(tracks.length, Math.max(1,Math.ceil((spec.width+gap)/(tracks[0]+gap))));
          this.style(box,"grid-column","span "+span);
        }
        this.style(box,"width",spec.width+"px");
        this.style(box,"max-width","100%");
        this.style(box,"min-width","0");
      }
      if (!item.container && spec.height && !spec.free) {
        this.style(box,"min-height","0");
        this.style(box,"height",spec.height+"px");
        if(control && !element.classList.contains("entry-field")){
          const visible=element.querySelector(".date-text") || control;
          this.style(title,"min-height","0");
          this.style(title,"line-height","1");
          this.style(visible,"min-height","0");
          this.style(visible,"height","100%");
          this.style(visible,"max-height","100%");
          this.style(element,"min-height","0");
          this.style(element,"overflow","hidden");
        }
      }
      if (!item.pinned && spec.column) this.style(box,"grid-column-start",String(spec.column));
      if (!item.pinned && spec.row) this.style(box,"grid-row-start",String(spec.row));
      if (!item.pinned && spec.gapX) this.style(box,"margin-inline-start",spec.gapX+"px");
      if (!item.pinned && spec.gapY) this.style(box,"margin-top",spec.gapY+"px");
      if(spec.free){item.metrics=this.boxMetrics(box);this.freeBox(item,spec,item.metrics);}
      if (spec.hidden && !this.panel) this.style(box,"display","none");
    }
    // Keep the contact row together when the scroll gutter or camera width changes.
    const name=$("buyer")?.closest("label"), photo=$("customerPhotoTools"), phone=$("buyerPhone")?.closest("label");
    if(name && photo && phone && name.nextElementSibling===photo && photo.nextElementSibling===phone &&
        getComputedStyle(name.parentElement).gridTemplateColumns.split(" ").length===12){
      const span=el=>Number(getComputedStyle(el).gridColumn.match(/span (\d+)/)?.[1])||1;
      this.style(name,"grid-column","span "+Math.max(1,12-span(photo)-span(phone)));
    }
    const extents=new Map();
    for(const [id,spec] of Object.entries(layout || {})){
      if(!spec.free || !spec.dy || this.elements.get(id)?.pinned)continue;
      const box=this.elements.get(id)?.box,inner=box?.closest(".section-inner");
      if(!inner || !box.offsetHeight || inner.closest(".ui-collapsed"))continue;
      const rect=inner.getBoundingClientRect(),scale=rect.width/inner.offsetWidth || 1;
      const bottom=(box.getBoundingClientRect().bottom-rect.top)/scale;
      extents.set(inner,Math.max(extents.get(inner)||0,bottom));
    }
    for(const [inner,bottom] of extents)if(bottom>inner.offsetHeight)this.style(inner,"min-height",Math.ceil(bottom)+"px");
    if (!this.panel) this.lastApplied={scope,layout:saved,width:root.clientWidth,fontSize:UIPreferences.value?.fontSize};
    this.observer.takeRecords();
    if(this.panel)for(const key of this.selection){
      const entry=this.elements.get(key);
      if(entry)this.style(entry.element,"outline","2px dashed #1583cf");
    }
    return true;
  },
  refresh() { FillDesigner.apply(); },
  open() {
    if (this.panel) return;
    this.scope=FillDesigner.scope();
    this.draft=clone(cfg.design.fillAppearance?.[this.scope] || {});
    this.panel=document.createElement("aside");
    this.panel.className="fill-layout-panel app-ui";
    this.panel.dir="rtl";
    this.panel.innerHTML='<strong>تعديل واجهة الملء</strong><select aria-label="الحافظة أو الخانة"></select><section></section><footer></footer>';
    document.body.append(this.panel);
    this.pick=this.panel.querySelector("select");
    this.pick.onchange=()=>{this.selection.clear();this.select(this.pick.value);};
    this.events=new AbortController();
    const handle=this.panel.querySelector("strong");
    handle.title="اسحب لتحريك لوحة الخصائص";
    handle.onpointerdown=event=>{
      if(event.button!==0)return;
      const bounds=this.panel.getBoundingClientRect(),x=event.clientX,y=event.clientY;
      handle.setPointerCapture(event.pointerId);
      handle.onpointermove=e=>{
        const left=Math.max(0,Math.min(innerWidth-bounds.width,bounds.left+e.clientX-x));
        const top=Math.max(0,Math.min(innerHeight-handle.offsetHeight,bounds.top+e.clientY-y));
        Object.assign(this.panel.style,{left:left+"px",top:top+"px",right:"auto"});
      };
      handle.onlostpointercapture=()=>{handle.onpointermove=null;};
    };
    const root=FillDesigner.root();
    root.addEventListener("click",e=>{
      const hit=[...this.elements].reverse().find(([,v])=>v.element.contains(e.target));
      if(hit){e.preventDefault();e.stopImmediatePropagation();}
    },{capture:true,signal:this.events.signal});
    const hitKey=target=>{
      const heading = target.closest(".card-heading");
      if (heading && !target.closest("label,button")) {
        const card = this.flowCards(root).find(([,item])=>item.box === heading.parentElement);
        if (card) return card[0];
      }
      return [...this.elements].reverse().find(([,v])=>v.element.contains(target))?.[0];
    };
    const options={signal:this.events.signal};
    root.addEventListener("pointerdown",event=>{
      if(event.button!==0 || !event.isPrimary)return;
      const key=hitKey(event.target);
      let item=this.elements.get(key);
      if(!item)return;
      event.preventDefault();
      if(event.ctrlKey || event.metaKey){
        if(this.selection.has(key))this.selection.delete(key);else this.selection.add(key);
        if(this.selection.size)this.select(this.selection.has(key)?key:[...this.selection].at(-1));
        else {this.selected=null;this.grip?.remove();this.panel.querySelector("section").replaceChildren();this.refresh();}
        return;
      }
      if(!this.selection.has(key)){this.selection.clear();this.select(key);}
      item=this.elements.get(key);
      const startX=event.clientX,startY=event.clientY;
      const rect=item.box.getBoundingClientRect();
      const resize=event.target.classList.contains("fill-size-grip");
      if(item.pinned && !resize)return;
      if(this.selected!==key)this.select(key);
      if(item.container && item.box.parentElement===root){
        this.dragCard(event,root,key,item);
        return;
      }
      const gesture=new AbortController();
      this.events.signal.addEventListener("abort",()=>gesture.abort(),{once:true,signal:gesture.signal});
      const spec=this.draft[key] ||= {};
      const units=this.units(item);
      const metrics=item.metrics || this.boxMetrics(item.box);
      const others=[...this.selection].filter(id=>id!==key).map(id=>{
        const entry=this.elements.get(id),settings=this.draft[id] ||= {};
        return {entry,settings,x:settings.dx||0,y:settings.dy||0};
      }).filter(v=>v.entry && !v.entry.pinned && !v.entry.container && !item.box.contains(v.entry.box) && !v.entry.box.contains(item.box));
      const originalX=Number(spec.dx) || 0,originalY=Number(spec.dy) || 0;
      const scale=rect.width/(item.box.offsetWidth || rect.width);
      const grid=item.box.closest(".grid,.external-party-fields,#bookFields") || root;
      const gridStyle=getComputedStyle(grid);
      const gapX=(parseFloat(gridStyle.columnGap)||0)*scale,gapY=(parseFloat(gridStyle.rowGap)||0)*scale;
      const edges=[...this.elements.values()].filter(v=>v!==item && !v.box.contains(item.box) && !item.box.contains(v.box) && v.box.offsetWidth)
        .map(v=>v.box.getBoundingClientRect());
      const container=item.box.closest(".section-inner,.external-party-fields,#bookFields");
      const bounds=container?.getBoundingClientRect();
      const snap=(delta,axis,other)=>{
        let correction=6;
        const horizontal=axis==="x";
        const [lo,hi,crossLo,crossHi]=horizontal?["left","right","top","bottom"]:["top","bottom","left","right"];
        const gap=horizontal?gapX:gapY;
        for(const edge of edges){
          if(rect[crossHi]+other<edge[crossLo]-8 || rect[crossLo]+other>edge[crossHi]+8)continue;
          for(const target of [edge[lo]-gap-rect[hi],edge[hi]+gap-rect[lo]]){
            const diff=target-delta;
            if(Math.abs(diff)<Math.abs(correction))correction=diff;
          }
        }
        if(bounds){
          for(const target of [bounds[lo]-rect[lo],bounds[hi]-rect[hi]]){
            const diff=target-delta;
            if(Math.abs(diff)<Math.abs(correction))correction=diff;
          }
        }
        return delta+(correction===6?0:correction);
      };
      let moved=false;
      const front=Math.min(1000,Math.max(2,...Object.values(this.draft).map(v=>v.layer || 0))+1);
      const finish=()=>gesture.abort();
      document.addEventListener("pointermove",e=>{
        if(e.pointerId!==event.pointerId)return;
        const dx=e.clientX-startX,dy=e.clientY-startY;
        if(!moved && Math.hypot(dx,dy)<4)return;
        moved=true;spec.free=true;
        if(resize){
          if(item.button){
            spec.buttonWidth=EditorSettings.number(Math.round((rect.width-dx)/scale),this.buttonRange("buttonWidth",item));
            spec.buttonHeight=EditorSettings.number(Math.round((rect.height+dy)/scale),this.buttonRange("buttonHeight",item));
          }else{
            spec.widthScale=6;
            spec.wUnits=this.unit(((rect.width-dx)/scale+units.gap)/units.w,6);
            spec.hUnits=this.unit(((rect.height+dy)/scale+units.rowGap)/(units.h+units.rowGap),3);
          }
        }else{
          spec.dx=Math.round(originalX+(e.altKey?dx:snap(dx,"x",dy))/scale);
          spec.dy=Math.round(originalY+(e.altKey?dy:snap(dy,"y",dx))/scale);
          spec.layer=front;
          for(const {entry,settings,x,y} of others){
            Object.assign(settings,{free:true,dx:x+spec.dx-originalX,dy:y+spec.dy-originalY,layer:front});
            this.style(entry.box,"translate",settings.dx+"px "+settings.dy+"px");
          }
        }
        this.freeBox(item,spec,metrics,units);
      },{signal:gesture.signal});
      document.addEventListener("pointerup",e=>{
        if(e.pointerId!==event.pointerId)return;
        finish();if(moved)this.select(key);
      },{signal:gesture.signal});
      document.addEventListener("pointercancel",finish,{once:true,signal:gesture.signal});
    },{...options,capture:true});
    this.refresh();
    for(const [key,item] of this.elements) {this.pick.add(new Option(item.title.textContent.trim() || item.element.getAttribute("aria-label") || item.element.title || this.actions[key] || key,key));}
    const footer=this.panel.querySelector("footer");
    FieldStudio.button(footer,"+ حافظة",()=>{
      const id="fillGroup"+crypto.randomUUID().replaceAll("-","");
      this.draft[id]={kind:"group",title:"حافظة جديدة"};
      this.refresh();this.syncPicker();this.select("section:"+id);
    });
    FieldStudio.button(footer,"+ زر",()=>{
      const id="fillButton"+crypto.randomUUID().replaceAll("-","");
      const home=this.selectedHome();
      this.draft[id]={kind:"button",title:"زر جديد",action:"printAll",home};
      this.refresh();this.syncPicker();this.select(id);
    });
    FieldStudio.button(footer,"+ خانة",()=>{
      const home=this.selectedHome();
      const id="field_"+crypto.randomUUID().replaceAll("-","").slice(0,10);
      this.draft[id]={kind:"field",title:"خانة جديدة",home,type:"text"};
      this.refresh();this.syncPicker();this.select(id);
    });
    FieldStudio.button(footer,"اعتماد",async e=>{
      const button=e.currentTarget;button.disabled=true;
      const layouts=cfg.design.fillAppearance ||= {};
      const old=layouts[this.scope];
      layouts[this.scope]=clone(this.draft);
      try { await saveConfig(); }
      catch(error){if(old) layouts[this.scope]=old;else delete layouts[this.scope];button.disabled=false;await Feedback.notice(error.message);return;}
      this.close();
      if(!d.standaloneBook)buildInputs();
      render();
    });
    FieldStudio.button(footer,"إلغاء",()=>this.close());
    this.select(this.pick.value);
  },
  syncPicker(){
    this.pick.replaceChildren(...[...this.elements].map(([key,item])=>new Option(item.title.textContent.trim() || item.element.getAttribute("aria-label") || item.element.title || this.actions[key] || key,key)));
  },
  select(key) {
    const item=this.elements.get(key);
    if(!item)return;
    if(!this.selection.has(key)){this.selection.clear();this.selection.add(key);}
    this.selected=this.pick.value=key;
    this.grip?.remove();
    this.grip=document.createElement("span");
    this.grip.className="fill-size-grip";this.grip.title="اسحب لتغيير العرض والارتفاع";
    if(!item.container && !item.moveOnly)item.element.append(this.grip);
    const spec=this.draft[key] ||= {};
    const section=this.panel.querySelector("section");
    section.replaceChildren();
    const group=this.selection.size>1;
    const members=[...this.selection].map(id=>this.elements.get(id));
    if(group){const count=document.createElement("strong");count.textContent="العناصر المحددة: "+members.length;section.append(count);}
    const field=(name,label,type,value)=>{
      if(group && (name==="title" || (["wUnits","hUnits","fontSize","titleSize"].includes(name) && members.some(v=>v.moveOnly || v.button)) ||
        (name.startsWith("button") && members.some(v=>!v.button)) || (name==="fontSize" && members.some(v=>!v.control))))return;
      const row=document.createElement("label"),input=document.createElement("input");
      row.textContent=label;input.type=type;input.value=value;
      const range = name.startsWith("button") ? this.buttonRange(name,item) : EditorSettings.fill[name];
      if(type==="number") EditorSettings.input(input,range);
      const applyValue=()=>{
        let next=input.value;
        if(type==="number"){
          const valid=EditorSettings.number(next,range);
          if(valid===null){input.value=value;return;}
          next=Math.round(valid);
          input.value=next;
          value=next;
        }
        for(const id of this.selection){
          const target=this.draft[id] ||= {};
          if(name==="wUnits")target.widthScale=6;
          if(["buttonWidth","buttonHeight","wUnits","hUnits","layer"].includes(name))target.free=true;
          target[name]=next;
        }
        this.refresh();
      };
      if(type==="number" || type==="color") input.onchange=applyValue;
      else input.oninput=applyValue;
      row.append(input);section.append(row);
    };
    if(item.control && spec.kind!=="field"){
      const binding=document.createElement("output");
      binding.textContent="المتغير  {{"+(item.control.dataset.field || key.replace(/^bookInput-/,""))+"}}";
      section.append(binding);
    }
    if(!group && spec.kind==="field"){
      const label=document.createElement("label"),binding=document.createElement("input");
      label.textContent="رمز المتغير";binding.dir="ltr";binding.value=spec.binding || key;
      binding.onchange=()=>{
        const value=binding.value.trim();
        if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || value in d || value in cfg.fixed || value in Object.prototype ||
           (Object.hasOwn(context(),value) && !Object.hasOwn(d.bookValues || {},value))){
          binding.value=spec.binding || key;
          Feedback.notice("اختر رمزاً إنكليزياً خاصاً بالخانة وغير محجوز للنظام.");return;
        }
        spec.binding=value;this.refresh();
      };
      label.append(binding);section.append(label);
      const type=document.createElement("select");
      for(const [id,name] of [["text","نص"],["number","رقم"],["date","تاريخ"],["tel","هاتف"]])type.add(new Option(name,id));
      type.value=spec.type;type.onchange=()=>{spec.type=type.value;item.control.type=type.value;this.refresh();};
      section.append(type);
    }
    if(!group && spec.kind==="button"){
      const action=document.createElement("select");action.setAttribute("aria-label","وظيفة الزر");
      for(const [id,name] of Object.entries(this.actions))action.add(new Option(name,id));
      action.value=spec.action;action.onchange=()=>{spec.action=action.value;};section.append(action);
    }
    if(!item.moveOnly && (!item.button || spec.kind==="button"))field("title","العنوان","text",spec.title || item.title.textContent);
    if(!item.moveOnly)field("titleSize","حجم العنوان","number",spec.titleSize || parseInt(getComputedStyle(item.title).fontSize));
    if(item.control){
      if(!item.moveOnly)field("fontSize","حجم المحتوى","number",spec.fontSize || parseInt(getComputedStyle(item.control).fontSize));
    }
    const units=this.units(item);
    if(item.button){
      field("buttonWidth","عرض الزر بالبكسل","number",spec.buttonWidth || item.box.offsetWidth);
      field("buttonHeight","ارتفاع الزر بالبكسل","number",spec.buttonHeight || item.box.offsetHeight);
    }else if(!item.container && !item.moveOnly){
      field("wUnits","العرض (١–٦)","number",this.unit(spec.wUnits ? this.widthUnits(spec) : (item.box.offsetWidth+units.gap)/units.w,6));
      field("hUnits","الارتفاع (١–٣)","number",spec.hUnits || this.unit(item.box.offsetHeight/units.h,3));
    }
    field("layer","ترتيب الطبقة","number",spec.layer || 2);
    if(item.control && !item.pinned && !group){
      const dest=document.createElement("select");dest.setAttribute("aria-label","نقل الخانة");
      dest.add(new Option("نقل قبل خانة…",""));
      for(const [id,other] of this.elements)if(other.control && !other.pinned && id!==key && other.element.getClientRects().length)
        dest.add(new Option(other.title.textContent+" · "+(other.element.closest(".card")?.querySelector("h2")?.textContent || "الكتاب"),id));
      dest.onchange=()=>this.move(key,dest.value,false);
      section.append(dest);
    }
    FieldStudio.button(section,spec.hidden?"إظهار عند الملء":"إخفاء عند الملء",()=>{spec.hidden=!spec.hidden;this.select(key);});
    field("edge","لون الإطار والعنوان","color",spec.edge || "#8094a3");
    field("ink","لون الكتابة","color",spec.ink || (item.control ? "#111111" : "#17222d"));
    if(!item.pinned && !group)for(const [caption,delta] of [["تقديم",-1],["تأخير",1]]) FieldStudio.button(section,caption,()=>{
      const siblings=this.siblings(item);
      const next=siblings[siblings.findIndex(([id])=>id===key)+delta];
      if(next)this.move(key,next[0]);
    });
    if(!group && item.box.matches(".card") && item.box.parentElement===FillDesigner.root()){
      const beside=document.createElement("select");beside.setAttribute("aria-label","مكان الحافظة");
      beside.add(new Option("حافظة بسطر مستقل",""));
      for(const [id,v] of this.elements)if(v!==item && v.box.matches(".card") && !v.box.hidden && v.box.parentElement===item.box.parentElement)
        beside.add(new Option("بجانب "+v.title.textContent,id));
      beside.value=spec.beside || "";
      beside.onchange=()=>{spec.beside=beside.value;this.refresh();};section.append(beside);
    }
    const addedKey=item.element.dataset.fillAdded;
    FieldStudio.button(section,addedKey?"إزالة العنصر":"استرجاع تنسيق العنصر",()=>{
      this.restorePositions();
      delete this.draft[key];
      if(addedKey){
        delete this.draft[addedKey];
        const removed=new Set([key,addedKey]);
        for(const [id,entry] of Object.entries(this.draft)){
          if(entry.home===addedKey+"-fields"){removed.add(id);delete this.draft[id];}
        }
        for(const entry of Object.values(this.draft)){
          for(const link of ["hostGroup","hostField","beside"])if(removed.has(entry[link]))delete entry[link];
        }
      }
      this.refresh();this.syncPicker();this.select(this.elements.has(key)?key:this.pick.value);
    });
    this.refresh();
  },
  selectedHome() {
    const element=this.elements.get(this.selected)?.element;
    return element?.closest(".grid[id]")?.id || element?.closest(".card")?.querySelector(".grid[id]")?.id ||
      (d.standaloneBook ? "bookFields" : "buyerInputs");
  },
  siblings(item) {
    if(item.container && item.box.parentElement===FillDesigner.root())return this.flowCards(FillDesigner.root());
    return [...this.elements].filter(([,v])=>v.box.parentElement===item.box.parentElement)
      .sort((a,b)=>Number(getComputedStyle(a[1].box).order)-Number(getComputedStyle(b[1].box).order));
  },
  move(from,to,after) {
    const item=this.elements.get(from);
    let target=this.elements.get(to);
    if(!item || !target || item.pinned || target.pinned || from===to)return;
    if(item.control && !target.control){
      const first=[...this.elements].find(([,entry])=>entry.control && entry!==item && target.element.contains(entry.element));
      if(!first){
        const group=target.element.dataset.fillAdded;
        if(!group)return;
        (this.draft[from] ||= {}).hostGroup=group;
        delete this.draft[from].hostField;
        this.refresh();this.select(from);return;
      }
      [to,target]=first;after=false;
    }
    if(!item.control && (target.control || item.box.parentElement!==target.box.parentElement))return;
    const siblings=this.siblings(target).map(([key])=>key);
    const old=siblings.indexOf(from),pos=siblings.indexOf(to);
    if(old>=0)siblings.splice(old,1);
    siblings.splice(siblings.indexOf(to)+Number(after ?? (old>=0 && old<pos)),0,from);
    if(item.control && item.box.parentElement!==target.box.parentElement){
      const destination=target.box.parentElement;
      const original=[...this.elements].find(([,entry])=>entry.control &&
        (this.origins.get(entry.box)?.parentElement || entry.box.parentElement)===destination);
      if(!original)return;
      (this.draft[from] ||= {}).hostField=original[0];
    }
    delete this.draft[from]?.column;delete this.draft[from]?.row;
    siblings.forEach((key,i)=>{
      const settings=this.draft[key] ||= {};
      settings.order=i;
      if(item.container){
        delete settings.free;
        delete settings.dx;
        delete settings.dy;
      }
    });
    this.refresh();
    this.select(from);
  },
  close() {
    this.grip?.remove();this.restorePositions();
    for(const node of FillDesigner.root()?.querySelectorAll("[data-fill-added]") || [])node.remove();
    this.events?.abort();this.panel?.remove();this.panel=null;this.lastApplied=null;
    this.selection.clear();this.selected=null;this.reset();this.refresh();
  }
};
