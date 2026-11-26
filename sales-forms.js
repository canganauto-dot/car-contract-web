// Published forms retain their submitted data when a contract clerk creates a working copy.
const SalesForms = {
  selected:new Set(), rows:[], tail:Promise.resolve(), types:{installment:"أقساط",cash:"نقدي",exchange:"استبدال",external:"شراء / خارجي"},
  el(tag,text){const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;},
  button(label,action){
    const b=this.el("button",label);b.type="button";
    b.onclick=async()=>{try{await Activity.run(action,b);}catch(e){this.status.textContent=e.message;}};
    return b;
  },
  tool(label,icon,fn,primary=false){
    const b=this.button(label,fn);
    b.className=primary?"sales-tool sales-primary":"sales-tool";
    if(!primary)return Archive.labelButton(b,icon,label);
    b.insertAdjacentHTML("afterbegin",Archive.icon(icon));return b;
  },
  readerButton(){
    return this.tool("قارئ الباركود","scan",async()=>{
      if(this.active?.revising&&!await Feedback.ask("هل تريد مغادرة التصحيح قبل حفظه؟"))return;
      document.activeElement?.blur();await this.flush();location.assign("./reader/index.html");
    });
  },
  select(label,values,value){
    const s=this.el("select");s.ariaLabel=label;
    for(const [key,name] of values)s.add(new Option(name,key));
    s.value=value;return s;
  },
  value(v,key){return key.split(".").reduce((o,k)=>o?.[k],v);},
  set(v,key,value){const keys=key.split(".");let o=v;while(keys.length>1){const k=keys.shift();o=o[k]??=(/^\d+$/.test(keys[0])?[]:{});}o[keys[0]]=value;},
  async init(){
    document.body.classList.add("hosted-workspaces");
    this.panel=this.el("main");this.panel.id="salesWorkspace";this.panel.dir="rtl";this.panel.hidden=true;
    this.status=this.el("output");this.status.setAttribute("role","status");this.bar=this.el("header");this.content=this.el("div");
    this.panel.append(this.bar,this.status,this.content);document.body.append(this.panel);
    window.addEventListener("focus",()=>{if(!this.panel.hidden&&!this.active&&this.listing&&Date.now()-(this.listUpdated||0)>30000&&!this.panel.querySelector("dialog[open]"))this.list().catch(e=>this.status.textContent=e.message);});
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&this.active?.dirty)this.flush().catch(e=>this.status.textContent=e.message);});
    window.addEventListener("keydown",event=>{
      if(this.panel.hidden || document.querySelector("dialog[open]") || !(event.ctrlKey||event.metaKey) || event.key.toLowerCase()!=="p")return;
      event.preventDefault();event.stopImmediatePropagation();
      const task=this.active?(this.active.revising?null:this.singleOutput(0)):this.selected.size?this.printSelection?.():null;
      if(task)task.catch(e=>this.status.textContent=e.message);else this.status.textContent="حدّد الاستمارات المطلوبة للطباعة.";
    },true);
    FormInbox.init(this).catch(e=>this.status.textContent=e.message);
    if(!Cloud.restricted){
      $("homeButton").onclick=()=>Activity.run(()=>this.open("archive"),$("homeButton")).catch(e=>Feedback.notice(e.message));
      $("homeButton").hidden=true;this.navigation($("homeButton").parentElement,"");
      if($("setupDialog").open)$("setupDialog").addEventListener("close",()=>{if(Services.home&&App.mode==="fill")this.open("archive").catch(e=>Feedback.notice(e.message));},{once:true});
      else if(!sessionStorage.getItem("open-company-draft"))await this.open("archive",true);
    }else await this.open("forms");
  },
  navigation(host,active){
    this.mainNav??=this.tabs([["archive","الأرشيف"],["drafts","المسودات"],["forms","الاستمارات"]],"",async key=>{
      if(this.active?.revising&&!await Feedback.ask("مغادرة تصحيح الاستمارة قبل حفظه؟"))return;
      if(App.mode==="design")App.leave();this.choosingContract=false;await this.open(key);
    },"مساحة العمل");
    for(const [i,b] of [...this.mainNav.children].entries())b.setAttribute("aria-current",String(["archive","drafts","forms"][i]===active));
    host.append(this.mainNav);this.mainNav.classList.add("workspace-navigation");
  },
  async settings(tab){
    await this.leave(false);Workspace.open();
    const drawer=$("settingsDrawer"),observer=new MutationObserver(()=>{if(!drawer.hidden)return;observer.disconnect();
      if(App.mode!=="design"&&!FillLayout.panel)this.open(tab).catch(e=>Feedback.notice(e.message));});
    observer.observe(drawer,{attributes:true,attributeFilter:["hidden"]});
  },
  async open(tab="forms",useLoaded=false){
    if(tab!=="forms")this.choosingContract=false;
    const visit=this.visit=Symbol();
    if(this.panel.hidden){
      if(!Cloud.restricted){document.activeElement?.blur();await Services.flush();}if(this.visit!==visit)return;
      this.hiddenNodes=[...document.body.children].filter(e=>e!==this.panel&&!["startupThread","taskProgress"].includes(e.id)&&!e.inert&&!["DIALOG","SCRIPT","STYLE","LINK"].includes(e.tagName));
      for(const e of this.hiddenNodes)e.inert=true;
      this.panel.hidden=false;document.body.classList.add("forms-workspace");
    }
    return tab==="forms"?this.list():this.contracts(tab,useLoaded);
  },
  async leave(archive){
    this.visit=null;await this.flush();this.active=null;this.listTicket=null;this.panel.hidden=true;document.body.classList.remove("forms-workspace");
    for(const e of this.hiddenNodes||[])e.inert=false;
    if(!Cloud.restricted)this.navigation($("homeButton").parentElement,"");
    if(archive)await Services.showHome();
  },
  time(value){
    if(!value)return "—";
    this.clock??=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    return this.clock.format(new Date(value));
  },
  tabs(items,current,change,label){
    const nav=this.el("nav");nav.className="register-tabs";nav.ariaLabel=label;
    for(const [key,title] of items){const btn=this.button(title,()=>change(key));btn.setAttribute("aria-current",String(current===key));nav.append(btn);}
    return nav;
  },
  header(tab){
    const h=this.el("h1",tab==="forms"?(this.choosingContract?"اختيار استمارة العقد":"سجل الاستمارات"):tab==="archive"?"أرشيف العقود والكتب":"مسودات العقود والكتب");
    const identity=this.el("div");identity.className="sales-heading";identity.append(h,this.el("small",[cfg.fixed.branch||Cloud.company.branches[0]?.name,Cloud.account.name].filter(Boolean).join("  /  ")));
    const commands=this.el("div");commands.className="register-commands";
    this.bar.replaceChildren(identity,commands);
    if(!Cloud.restricted)this.navigation(this.bar,tab);
    if(tab==="forms"&&Cloud.company.department!=="finance"){
      commands.append(this.tool("إضافة استمارة","add",()=>this.create(),true));
      const saved=this.recovered();if(saved)commands.append(this.button("استعادة المسودة",()=>this.restore(saved)));
    }
    if(tab!=="forms"){
      commands.append(this.tool("إضافة عقد","add",()=>this.chooseForContract(),true),this.tool("إضافة كتاب","face",async()=>{await this.leave(false);await Workbench.choose();}));
      commands.append(this.tool("الأدوات والإعدادات","settings",()=>this.settings(tab)));
    }
    if(this.managesBranches&&["archive","forms"].includes(tab)){
      const branches=[...new Set(Cloud.brands.flatMap(c=>c.branches.map(b=>b.name)))];
      const select=this.select("سجل الفرع",[["","كل الفروع المخوّلة"],...branches.map(b=>[b,b])],this.registerBranch||"");
      select.onchange=()=>{this.registerBranch=select.value;this.open(tab).catch(e=>this.status.textContent=e.message);};commands.append(select);
    }
    if(this.managesBranches)commands.append(this.tool("إدارة رموز التحقق","scan",()=>DocumentQR.manage()));
    commands.append(this.readerButton(),FormInbox.button(this),this.tool("تحديث","refresh",()=>this.open(tab)),this.tool("خروج","logout",()=>Cloud.logout()));
  },
  periodValue(state){
    const current=today().slice(0,7),[y,m]=current.split("-").map(Number);
    return {current,previous:new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7),custom:state.custom||current,all:"",range:""}[state.period];
  },
  filters(state,reload,paint,tab,rows){
    const tools=this.el("div");tools.className="forms-actions";
    const search=this.el("input");search.type="search";search.placeholder="بحث بالاسم أو الشاصي أو الرقم";search.ariaLabel="بحث";search.value=state.query;search.oninput=()=>{state.query=search.value;paint();};
    const period=this.select("تاريخ السجل",[["current","الشهر الحالي"],["previous","الشهر السابق"],["all","كل الأشهر"],["custom","اختيار شهر…"],["range","من تاريخ إلى تاريخ"]],state.period);
    const pick=this.el("input");pick.type="month";pick.ariaLabel="الشهر المطلوب";pick.value=state.custom||today().slice(0,7);pick.hidden=state.period!=="custom";
    const change=()=>Activity.run(reload).catch(e=>this.status.textContent=e.message);
    pick.onchange=()=>{if(pick.value){state.custom=pick.value;change();}};
    const options=this.el("div");options.className="register-filters";options.id="registerFilters";
    const toggle=this.el("button","فلترة");toggle.type="button";toggle.setAttribute("aria-controls",options.id);
    const expand=open=>{state.filtersOpen=open;options.hidden=!open;toggle.setAttribute("aria-expanded",String(open));};
    expand(!!state.filtersOpen);
    toggle.onclick=()=>{expand(options.hidden);period.value=state.period;};
    const range=this.el("form");range.className="register-range";
    const dateInput=(label,value)=>{
      const box=this.el("label",label),input=this.el("input");input.type="date";input.value=value||"";box.append(input);range.append(box);return input;
    };
    const from=dateInput("من تاريخ",state.from),to=dateInput("إلى تاريخ",state.to),apply=this.el("button","تطبيق الفترة");apply.type="submit";range.append(apply);
    const bounds=()=>{from.max=to.value;to.min=from.value;};bounds();from.oninput=to.oninput=bounds;
    range.onsubmit=e=>{e.preventDefault();state.from=from.value;state.to=to.value;state.period=from.value||to.value?"range":"all";change();};
    period.onchange=()=>{if(period.value==="range"){expand(true);from.focus();}else{state.period=period.value;state.from="";state.to="";change();}};
    options.append(range);
    const add=(key,label,items)=>{
      const box=this.el("label",label),select=this.select(label,[["","الكل"],...items],state[key]||"");
      select.onchange=()=>{state[key]=select.value;paint();};box.append(select);options.append(box);
    };
    const sellers=[...new Set(rows.map(r=>r.seller).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
    if(state.seller&&!sellers.includes(state.seller))state.seller="";
    add("seller","البائع",sellers.map(s=>[s,s]));
    add("company","الشركة",Cloud.brands.map(c=>[c.id,c.name]));add("kind","نوع المستند",[...Object.entries(this.types),...(tab==="forms"?[]:[["letter","كتاب"]])]);
    if(tab==="forms"&&this.formTab!=="history")add("approval","الاعتماد",[["yes","معتمدة"],["no","بانتظار الاعتماد"],["rejected","مرفوضة"]]);
    else if(tab!=="forms"){add("balance","الرصيد",[["paid","واصل كامل"],["due","متبقي"]]);if(tab==="archive")add("signed","النسخة الموقعة",[["yes","مرفوعة"],["no","بانتظار الرفع"]]);}
    const box=this.el("label");box.className="register-search";box.innerHTML=Archive.icon("search");box.append(search);
    tools.append(box,period,pick,toggle);return {tools,options};
  },
  async contracts(tab="drafts",useLoaded=false){
    if(this.panel.hidden)return this.open(tab);await this.flush();this.active=null;this.listing=false;
    const ticket=this.listTicket=Symbol();this.header(tab);this.status.textContent="";
    const library=useLoaded?Services.library:await Cloud.archive();if(ticket!==this.listTicket)return;Services.library=library;
    const drafts=tab==="drafts";
    const rows=library.entries.filter(e=>e.kind===(drafts?"draft":"printed")).map(entry=>{
      const d=entry.data;
      return {id:entry.id,entry,kind:d.standaloneBook!==undefined&&d.standaloneBook!==""&&d.standaloneBook!==false?"letter":d.contractType,buyer:d.externalBuyer||d.buyer||d.externalSeller||d.bookTitle||"مستند",vin:d.vin,total:d.total,branch:d.numberBranch,number:d.number,seller:entry.seller||d.organizer,when:entry.updatedAt,company:d.companyId};
    });
    this.register(tab,rows);
  },
  async list(){
    await this.flush();this.active=null;this.listing=true;this.status.textContent="";
    const ticket=this.listTicket=Symbol();this.header("forms");
    if(this.choosingContract)this.status.textContent="اختر استمارة منشورة لإنشاء العقد منها، أو أضف استمارة جديدة.";
    const state=this.filterState("forms"),rows=[];let cursor={};
    let month=this.periodValue(state);
    const lower=state.period==="range"&&state.from?Date.parse(state.from+"T00:00:00+03:00"):null;
    // A republication can cross midnight on the first of the month.
    if(lower!==null&&state.to&&state.from.slice(0,7)===state.to.slice(0,7)&&!state.from.endsWith("-01"))month=state.from.slice(0,7);
    for(;;){const batch=await Cloud.call("forms_list",{...cursor,month,scope:this.formTab==="history"?"history":"active"});if(this.listTicket!==ticket)return;
      rows.push(...batch.map(r=>({...r,company:r.company||Cloud.company.id,seller:r.author_name,when:r.listed_on||r.published||r.changed})));if(batch.length<100)break;
      const last=batch.at(-1);if(lower!==null&&Date.parse(last.changed)<lower)break;
      cursor={before:last.changed,cursor:last.id};
    }
    this.listUpdated=Date.now();this.rows=rows;this.register("forms",rows);
  },
  filterState(key){this.filtersByTab??={};return this.filtersByTab[key]??={period:"current",query:""};},
  register(tab,rows){
    const forms=tab==="forms",drafts=tab==="drafts",state=this.filterState(tab),reload=()=>this.open(tab);
    this.formTab??="published";this.selected.clear();
    const register=this.el("div"),list=this.el("div");register.className="forms-register";list.className="forms-lists";
    if(forms&&Cloud.company.department!=="finance"){
      const tabs=[["published","الاستمارات المنشورة"],["drafts","مسوداتي"]];
      if(this.managesBranches)tabs.push(["history","سجل التغييرات"]);
      register.append(this.tabs(tabs,this.formTab,key=>{
        const refetch=key==="history"||this.formTab==="history";this.formTab=key;
        return refetch?this.list():this.register(tab,rows);
      },"حالة الاستمارة"));
    }
    const norm=x=>normalizeDigits(x??"").toLowerCase().replace(/[,٬]/g,"");
    let limit=25;
    const {tools,options}=this.filters(state,reload,()=>{limit=25;paint();},tab,rows.filter(r=>(!this.registerBranch||tab==="drafts"||r.branch===this.registerBranch)&&(!forms||this.formTab==="history"||!!r.published===(this.formTab==="published")))),all=this.el("input");all.type="checkbox";all.ariaLabel=forms?"تحديد كل الاستمارات المعروضة":"تحديد كل المستندات المعروضة";
    if(!forms||this.formTab!=="history")tools.prepend(all);
    const actions=[],chosen=()=>rows.filter(r=>this.selected.has(r.id));
    this.printSelection=()=>this.formTab==="history"&&forms?null:forms?this.output(0,chosen()):this.documentOutput(chosen(),"print");
    for(const [i,title] of (forms?["طباعة","تنزيل PDF","مشاركة PDF"]:["طباعة","تنزيل PDF","طباعة الوجه"]).entries()){
      const btn=this.tool(title,["print","download",forms?"share":"face"][i],()=>forms?this.output(i,chosen()):this.documentOutput(chosen(),["print","download","face"][i]));actions.push(btn);tools.append(btn);
    }
    if(drafts||forms&&this.formTab==="drafts"&&Cloud.company.department!=="finance"){
      const del=this.tool("حذف المحدد","trash",()=>this.deleteRows(chosen(),forms));actions.push(del);tools.append(del);
    }
    register.append(tools,options,list);this.content.replaceChildren(register);
    const paint=()=>{
      const period=this.periodValue(state),term=norm(state.query.trim());
      const visible=rows.filter(r=>{
        if((state.seller&&r.seller!==state.seller)||(tab!=="drafts"&&this.registerBranch&&r.branch!==this.registerBranch))return false;
        if(forms&&this.choosingContract&&this.formTab==="published"&&(r.linked||r.rejected_at))return false;
        if(forms&&this.formTab!=="history"&&!!r.published!==(Cloud.company.department==="finance"||this.formTab==="published"))return false;
        if((state.company&&r.company!==state.company)||(state.kind&&r.kind!==state.kind))return false;
        if(forms&&this.formTab!=="history"&&state.approval&&((r.rejected_at?"rejected":r.approved?"yes":"no")!==state.approval||!r.published))return false;
        if(!forms&&state.signed&&!!r.entry.cloudSigned!==(state.signed==="yes"))return false;
        if(!forms&&state.balance){if(r.kind==="letter")return false;const n=calculate(r.entry.data).remaining;if((n>0)!==(state.balance==="due"))return false;}
        if(state.period==="range"||(!forms&&period)){
          const timestamp=new Date(r.when).getTime();
          if(!Number.isFinite(timestamp))return false;
          const day=new Date(timestamp+3*3600000).toISOString().slice(0,10);
          if(state.period==="range" ? ((state.from&&day<state.from)||(state.to&&day>state.to)) : !day.startsWith(period))return false;
        }
        return [r.buyer,r.vin,r.total,amount(r.total)||"",r.car,r.branch,r.seller,r.number,r.approved_by,Cloud.brands.find(c=>c.id===r.company)?.name].some(x=>norm(x).includes(term));
      });
      const shown=visible.slice(0,limit),shownIds=new Set(shown.map(r=>r.id));
      this.selected=new Set([...this.selected].filter(id=>shownIds.has(id)));
      const sync=()=>{all.checked=!!shown.length&&shown.every(r=>this.selected.has(r.id));all.indeterminate=!all.checked&&!!this.selected.size;actions.forEach(b=>{b.disabled=!this.selected.size||this.formTab==="history"&&forms;b.hidden=b.disabled;});};
      all.onchange=()=>{this.selected=new Set(all.checked?shown.map(r=>r.id):[]);paint();};
      const scroller=this.el("section"),table=this.el("table"),head=table.createTHead().insertRow(),body=table.createTBody();scroller.className="forms-table-scroll";table.ariaLabel=forms?"سجل الاستمارات":"سجل المستندات";
      const columns=["ت","الزبون","الشاصي","السعر (د.ع)","البائع","التاريخ والوقت",forms?"الاعتماد":"العدد","الإجراء"];
      for(const title of columns){const th=this.el("th",title);th.scope="col";head.append(th);}
      for(const [idx,r] of shown.entries()){
        const row=body.insertRow();
        const cell=(i,value)=>{const td=row.insertCell();td.dataset.label=columns[i];if(value!=null){td.textContent=value;td.title=String(value);}return td;};
        const ck=this.el("input");ck.type="checkbox";ck.checked=this.selected.has(r.id);ck.ariaLabel="تحديد "+r.buyer;ck.onchange=()=>{ck.checked?this.selected.add(r.id):this.selected.delete(r.id);sync();};cell(0).append(...(r.history_only?[]:[ck]),this.el("small",String(idx+1)));
        const open=this.button(r.buyer||(forms?"استمارة جديدة":"مستند"),async()=>{if(forms)return r.history_only?this.history(r):this.view(r);if(!drafts)return ArchiveOutput.view(r.entry);await this.leave(false);await Services.openEntry(r.entry);});open.className="forms-name";cell(1).append(open);
        cell(2,r.vin||"—").dir="ltr";const n=amount(r.total);cell(3,String(r.total??"").trim()&&Number.isFinite(n)?n.toLocaleString("en-US"):"—");cell(4,r.seller||"—");cell(5,this.time(r.when)).dir="ltr";
        if(forms){
          const badge=r.history_only?this.historyLabels[r.last_action]:r.removed_at?"محذوفة":r.rejected_at?"مرفوضة":r.approved?"معتمدة":r.published?"بانتظار الاعتماد":"مسودة";
          const st=!r.history_only&&!r.removed_at&&!r.rejected_at&&r.published&&this.canApprove(r)?this.button(badge,()=>this.approval(r)):this.el("span",badge);
          st.className="form-state "+(r.rejected_at?"is-rejected":r.approved?"is-approved":r.published?"is-pending":"");st.title=[r.approved_by,r.approval_note].filter(Boolean).join(" · ");
          const td=cell(6);td.append(st);
        }else cell(6,r.number||"—");
        const td=cell(7),icon=(key,title,fn)=>{const b=this.button(title,fn);b.className="form-print";b.innerHTML=Archive.icon(key);b.title=b.ariaLabel=title+" "+(r.buyer||"");td.append(b);};
        if(r.history_only)icon("history","السجل",()=>this.history(r));
        else if(forms&&this.choosingContract&&r.published&&!r.linked&&!r.rejected_at)td.append(this.button("إنشاء عقد",()=>this.convert(r)));
        else icon("print","طباعة",()=>forms?this.output(0,[r]):this.documentOutput([r],"print"));
        if(forms&&!r.published&&!r.removed_at){icon("upload","نشر",()=>this.publishRow(r));icon("trash","حذف",()=>this.deleteRows([r],true));}
        if(drafts)icon("trash","حذف",()=>this.deleteRows([r],false));
        if(!forms&&!drafts&&this.managesBranches&&Object.keys(r.entry.data.verificationCodes||{}).length)td.append(this.button("الباركود",()=>DocumentQR.manage(r.entry.data.verificationCodes)));
        if(!forms&&!drafts)icon("upload",r.entry.cloudSigned?"تحديث النسخة الموقعة":"رفع النسخة الموقعة",()=>ContractFiles.open(r.entry));
      }
      scroller.append(table);
      if(limit<visible.length){
        const more=this.button("إظهار المزيد",()=>{limit+=25;paint();});more.className="register-more";
        scroller.append(more);
      }
      if(!visible.length){
        const empty=this.el("div");empty.className="register-empty";empty.innerHTML=Archive.icon(term?"search":"pending");
        empty.append(this.el("strong",term?"لم نعثر على مستند مطابق":"لا توجد مستندات ضمن التحديد الحالي"));scroller.append(empty);
      }list.replaceChildren(scroller);sync();
    };paint();
  },
  async documentOutput(rows,action){
    const entries=rows.map(r=>r.entry);for(const e of entries)await Cloud.materialize(e);return ArchiveOutput.output(entries,action);
  },
  async deleteRows(rows,forms){
    if(!rows.length||!await Feedback.ask("تأكيد حذف "+rows.length+" من مسوداتك؟"))return;
    try{
      for(const r of rows){if(forms)await Cloud.call("form_delete",{company:r.company,id:r.id,version:r.version});else{
        await Cloud.write("remove",r.entry.data);if(d.recordId===r.entry.data.recordId){d=fresh();await putDB("draft",clone(d));}
      }}
    }finally{await this.open(forms?"forms":"drafts");}
  },
  async publishRow(row){
    const f=await Cloud.call("form_read",{company:row.company,id:row.id});
    if(![f.data.buyer,f.data.externalBuyer,f.data.externalSeller].some(v=>v?.trim()))throw Error("أدخل اسم الزبون قبل النشر.");
    await Cloud.call("form_publish",{company:row.company,id:row.id,version:row.version,data:f.data});this.formTab="published";await this.list();
  },
  get managesBranches(){return Cloud.brands.some(c=>c.role==="administrator"||Object.values(c.branchRoles||{}).includes("branch_manager"));},
  historyLabels:{form_correct:"تصحيح",form_withdraw:"سحب",form_republish:"إعادة نشر",form_reject:"رفض",form_remove_published:"حذف",form_approve:"اعتماد"},
  async history(f){
    const versions=await Cloud.call("form_history",{id:f.id,company:f.company});
    const dialog=this.el("dialog");dialog.className="form-history";dialog.dir="rtl";
    const body=this.el("div"),actions=this.historyLabels;
    const pick=this.select("النسخة السابقة",versions.map(v=>[String(v.version),"نسخة "+v.version+" · "+(v.action==="form_republish"?"عند إعادة النشر":"قبل "+(actions[v.action]||v.action))+" · "+this.time(v.at)+" · "+v.by]),String(versions[0]?.version));
    const show=()=>{const v=versions.find(t=>String(t.version)===pick.value);body.replaceChildren(...(v?FormPaper.editor(v.snapshot,true):[this.el("p","لا توجد نسخ سابقة محفوظة.")]));};
    pick.onchange=show;dialog.append(this.el("h2","سجل النسخ السابقة"),pick,this.button("إغلاق",()=>dialog.close()),body);this.panel.append(dialog);
    dialog.onclose=()=>dialog.remove();dialog.showModal();show();
  },
  async reviewAction(f,action,message){
    if(!await Feedback.ask(message))return;
    await Cloud.call(action,{id:f.id,company:f.company,version:f.version});this.active=null;
    this.formTab=action==="form_withdraw"?"drafts":"published";await this.list();
  },
  canApprove(f){
    const membership=Cloud.brands.find(c=>c.id===(f.company||f.data?.companyId))||Cloud.company;
    const branch=membership.branches.find(b=>b.name===f.branch);
    return membership.role==="administrator"||membership.branchRoles?.[branch?.id]==="branch_manager";
  },
  approval(f){
    if(!f.published||f.rejected_at||!this.canApprove(f))return;
    const payload={id:f.id,company:f.company||f.data?.companyId,version:f.version};
    const choices=[];
    if(!f.approved||f.my_approval)choices.push({
      name:f.approved?"تعديل ملاحظة الاعتماد":"اعتماد",confirm:f.approved?"حفظ الملاحظة":"تأكيد الاعتماد",
      note:"ملاحظة الاعتماد",value:f.approval_note,apply:note=>Cloud.call("form_approve",{...payload,approval_note:note,note})
    });
    choices.push({name:"رفض",confirm:"تأكيد الرفض",note:"سبب الرفض",apply:note=>Cloud.call("form_reject",{...payload,note})});
    ReviewDialog.open({host:this.panel,title:"مراجعة الاستمارة",subject:[f.buyer||f.data?.buyer,f.branch].filter(Boolean).join(" · "),choices,after:()=>this.list()});
  },
  async chooseForContract(){
    this.formTab="published";
    this.filtersByTab??={};this.filtersByTab.forms={period:"all",query:""};
    this.choosingContract=true;
    await this.open("forms");
  },
  async sellerOptions(select,f){
    const company=f.data.companyId||Cloud.company.id,branch=f.branch;
    const current=f.data.formSellerId||"";
    try{
      const rows=await Cloud.call("form_sellers",{company,branch});
      if(!select.isConnected||this.active!==f||company!==f.data.companyId||branch!==f.branch)return;
      const options=[new Option(Cloud.account.name,"")];
      for(const row of rows)options.push(new Option(row.name,row.id));
      if(current&&!rows.some(row=>row.id===current))options.push(new Option(f.sellerDisplay||f.author_name||"البائع السابق",current));
      select.replaceChildren(...options);select.value=current;
    }catch(e){if(this.active===f&&select.isConnected)this.status.textContent="تعذّر تحميل أسماء البائعين. "+e.message;}
  },
  async create(){
    if(this.recovered())throw Error("استعد الكتابة غير المحفوظة أولاً.");
    const branch=Cloud.company.branches.find(b=>b.name===cfg.fixed.branch)||Cloud.company.branches[0];
    if(!branch)throw Error("يحتاج حسابك إلى فرع مسند.");
    this.active={id:crypto.randomUUID(),branch:branch.name,version:0,data:fresh(),dirty:false};
    this.active.data.companyId=Cloud.company.id;this.active.data.depositDate="";this.active.data.depositAuto=false;this.edit();
  },
  async view(row){
    const ticket=this.listTicket=Symbol();
    await this.flush();
    const f=await Cloud.call("form_read",{id:row.id,company:row.company});
    if(this.listTicket!==ticket||this.panel.hidden)return;
    this.active={...row,...f,revising:false,data:{...f.data,companyId:f.company||row.company},dirty:false};
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
  dirty(){if(this.active?.revising){this.status.textContent="تصحيح بانتظار الحفظ";return;}this.active.dirty=true;this.keep(this.active);this.status.textContent="جارٍ حفظ المسودة…";clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(e=>this.status.textContent=e.message),500);},
  async flush(){
    clearTimeout(this.timer);const f=this.active;
    const write=async()=>{
      if(!f?.dirty||f.published)return;
      const data=clone(f.data);f.dirty=false;
      try{const res=await Cloud.call("form_save",{id:f.id,branch:f.branch,company:data.companyId,version:f.version,data});f.version=res.version;const branch=this.content.querySelector('[data-key="branch"]');if(this.active===f&&branch)branch.disabled=true;if(!f.dirty){sessionStorage.removeItem(this.recoveryKey);this.status.textContent="حُفظت المسودة";}else this.keep(f);}
      catch(e){f.dirty=true;throw e;}
    };
    const pending=this.tail.then(write);this.tail=pending.catch(()=>{});return pending;
  },
  edit(){
    this.listTicket=null;this.listing=false;const f=this.active,v=f.data,readOnly=!!f.published&&!f.revising;this.bar.replaceChildren(this.button("الاستمارات",()=>this.list()),this.el("h1",readOnly?"استمارة منشورة":"تعبئة استمارة"));
    if(!Cloud.restricted)this.navigation(this.bar,"forms");
    this.bar.append(this.readerButton(),FormInbox.button(this));
    this.status.textContent=readOnly?(f.approved?"معتمدة · "+(f.approved_by||""):"بانتظار الاعتماد"):"مسودة خاصة";
    if(f.rejected_at)this.status.textContent="مرفوضة · "+f.rejection_note;
    const admin=Cloud.brands.find(c=>c.id===f.company)?.role==="administrator",manager=this.canApprove(f);
    if(f.revising){
      this.status.textContent="تصحيح النسخة المنشورة. تحتاج النسخة الجديدة إلى اعتماد.";
      this.bar.append(this.button("حفظ نسخة جديدة",async()=>{await Cloud.call("form_correct",{company:f.company,id:f.id,version:f.version,data:v});await this.view(f);}),this.button("إلغاء التعديل",()=>this.view(f)));
    }else if(readOnly){
      if(f.can_withdraw)this.bar.append(this.button("سحب إلى مسوداتي",()=>this.reviewAction(f,"form_withdraw","ستعود الاستمارة إلى مسوداتك ويُلغى اعتمادها. تنتهي مهلة إعادة النشر في "+this.time(new Date(Date.parse(f.first_release)+30*60000))+". هل تريد سحبها؟")));
      if(admin||manager&&f.rejected_at)this.bar.append(this.tool("تصحيح الاستمارة","edit",()=>{f.revising=true;this.edit();}));
      if(manager){
        this.bar.append(this.tool("سجل النسخ","history",()=>this.history(f)));

      }
      if(admin)this.bar.append(this.tool("حذف المنشورة","trash",()=>this.reviewAction(f,"form_remove_published","حذف الاستمارة من المنشورات وحفظها في سجل المحذوفات؟")));
    }
    if(!readOnly&&!f.revising)this.bar.append(this.button("نشر الاستمارة",async()=>{if(![v.buyer,v.externalBuyer,v.externalSeller].some(s=>s?.trim()))throw Error("أدخل اسم الزبون قبل النشر.");await this.flush();if(!f.version){f.dirty=true;await this.flush();}await Cloud.call("form_publish",{id:f.id,company:v.companyId,version:f.version,data:v});this.active=null;this.formTab="published";await this.list();}));
    if(!f.revising)this.bar.append(this.tool("طباعة","print",()=>this.singleOutput(0)),this.tool("تنزيل PDF","download",()=>this.singleOutput(1)));
    if(readOnly&&!f.rejected_at&&this.canApprove(f))this.bar.append(this.tool("مراجعة الاستمارة","check",()=>this.approval(f)));
    if(readOnly&&!f.rejected_at&&!Cloud.restricted&&!f.linked)this.bar.append(this.button("إنشاء عقد من الاستمارة",()=>this.convert(f)));
    const cars=this.el("datalist");cars.id="salesCars";for(const c of cfg.cars||[])cars.append(new Option(c.name));
    this.content.replaceChildren(cars,...FormPaper.editor(f,readOnly));
  },

  async convert(f){
    const company=f.company||f.data?.companyId;
    const {record}=await Cloud.call("form_convert",{id:f.id,company,version:f.version,prefix:""});
    this.choosingContract=false;await this.leave(false);Services.library=await Cloud.archive();
    const entry=Services.library.entries.find(e=>e.id==="draft:"+record);
    if(!entry)throw Error("تعذّر فتح مسودة العقد.");
    await Services.openEntry(entry);
  },
  async singleOutput(mode){
    const f=this.active;if(!f.version)f.dirty=true;await this.flush();
    return this.output(mode,[{...f,company:f.data.companyId,author_name:f.author_name||Cloud.account.name}]);
  },
  async output(mode,rows=this.rows.filter(r=>this.selected.has(r.id))){
    if(!rows.length)return;
    const dialog=this.el("dialog");dialog.className="forms-output";const caption=this.el("p","جارٍ تجهيز "+rows.length+" استمارة…");
    const urls=[],close=this.tool("إغلاق","close",()=>dialog.close());
    dialog.append(caption,close);this.panel.append(dialog);
    dialog.onclose=()=>{urls.forEach(url=>URL.revokeObjectURL(url));dialog.remove();};dialog.showModal();
    try {
      await WebResources.loadDocumentFont();
      let pdf,frame;
      if(mode===0){
        frame=this.el("iframe");frame.title="معاينة طباعة الاستمارات";dialog.prepend(frame);
        const style=frame.contentDocument.createElement("style");
        style.textContent="@page{size:A4 portrait;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}";
        frame.contentDocument.head.append(style);
      }else{await WebResources.pdf();pdf=await PDFLib.PDFDocument.create();}
      for(const row of rows){
        if(!dialog.open)return;
        const f=await Cloud.call("form_read",{id:row.id,company:row.company});
        const snapshot={...row,...f,company:f.company||row.company,author_name:f.author_name||row.author_name,approved_by:f.approved_by||row.approved_by};
        for(const sheet of FormPaper.layout(snapshot)){
          if(!dialog.open)return;
          const canvas=await FormPaper.draw(sheet,true,2);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
          canvas.width=canvas.height=0;
          if(!dialog.open)return;
          if(!blob)throw Error("تعذّر إعداد صفحة الاستمارة.");
          if(frame){
            const img=frame.contentDocument.createElement("img");img.src=URL.createObjectURL(blob);urls.push(img.src);
            frame.contentDocument.body.append(img);await img.decode();
          }else{
            const image=await pdf.embedPng(await blob.arrayBuffer()),page=pdf.addPage(PDFLib.PageSizes.A4);
            page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
          }
        }
      }
      if(!dialog.open)return;
      if(frame){
        caption.textContent="جاهز للطباعة";const print=()=>{frame.contentWindow.focus();frame.contentWindow.print();};
        dialog.prepend(this.tool("طباعة","print",print));print();return;
      }
      const file=new File([await pdf.save()],"استمارات.pdf",{type:"application/pdf"});
      if(!dialog.open)return;
      const save=()=>{const url=URL.createObjectURL(file),a=this.el("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
      if(mode===1){save();dialog.close();return;}
      if(navigator.canShare?.({files:[file]})){caption.textContent="ملف PDF جاهز للمشاركة";dialog.prepend(this.tool("مشاركة الملف","share",async()=>{await navigator.share({files:[file],title:"استمارات"});dialog.close();}));}
      else{caption.textContent="احفظ الملف وأرسله من جهازك.";dialog.prepend(this.tool("تنزيل PDF","download",save));}
    }catch(error){caption.textContent=error.message;}
  }
};
