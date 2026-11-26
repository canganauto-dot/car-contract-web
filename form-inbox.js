// Device delivery is optional. The account inbox remains authoritative.
const FormInbox={
  names:{published:"نُشرت فورمة",approved:"اعتُمدت فورمة",rejected:"رُفضت فورمة"},
  async init(ui){
    this.ui=ui;
    if("serviceWorker" in navigator){
      this.registration=navigator.serviceWorker.register("./sw.js").catch(()=>null);
      const prior=localStorage.getItem("form-device-owner");
      if(prior&&prior!==Cloud.account.userId){const reg=await this.registration;const sub=await reg?.pushManager?.getSubscription();if(sub)await sub.unsubscribe();localStorage.removeItem("form-device-owner");}
      navigator.serviceWorker.addEventListener("message",e=>{if(e.data==="refresh-inbox")this.refresh().catch(()=>{});if(e.data==="open-inbox")this.open().catch(e=>ui.status.textContent=e.message);});
    }
    const refresh=()=>{if(!document.hidden)this.refresh().catch(()=>{});};
    document.addEventListener("visibilitychange",refresh);this.timer=setInterval(refresh,45000);refresh();
    if(new URL(location.href).searchParams.has("inbox")){const url=new URL(location.href);url.searchParams.delete("inbox");history.replaceState(null,"",url);await this.open();}
  },
  button(ui){
    const btn=ui.button("الإشعارات",()=>this.open());btn.className="inbox-toggle";btn.title=btn.ariaLabel="الإشعارات";btn.innerHTML=Archive.icon("bell");
    const badge=ui.el("span");badge.dataset.alertCount="";btn.append(badge);badge.textContent=this.badgeText();return btn;
  },
  badgeText(){const n=(this.rows||[]).filter(r=>!r.seen).length;return n?" "+n:"";},
  updateBadge(){for(const badge of document.querySelectorAll("[data-alert-count]"))badge.textContent=this.badgeText();},
  async refresh(){const rows=await Cloud.request("alerts");this.rows=rows;this.updateBadge();},
  async device(){
    if(!this.registration||!("PushManager" in window)||!("Notification" in window))throw Error("على iPhone أضف الموقع للشاشة الرئيسية أولاً، ثم افتحه منها لتفعيل الإشعارات.");
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw Error("يمكنك السماح بالإشعارات من إعدادات الموقع في المتصفح.");
    const {key}=await Cloud.call("push_key");
    if(!key)throw Error("إشعارات الحساب فعّالة. يحتاج الخادم إلى إعداد مفاتيح إشعارات الجهاز.");
    const reg=await this.registration;if(!reg)throw Error("تعذّر تشغيل إشعارات الجهاز.");await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(sub&&localStorage.getItem("form-device-owner")!==Cloud.account.userId){await sub.unsubscribe();sub=null;}
    if(!sub){const bytes=Uint8Array.from(atob(key.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
      sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});}
    await Cloud.call("push_subscribe",{endpoint:sub.endpoint,...sub.toJSON().keys});localStorage.setItem("form-device-owner",Cloud.account.userId);
  },
  async detach(){
    if(!this.registration)return;
    const reg=await this.registration,sub=await reg?.pushManager?.getSubscription();
    if(sub){try{await Cloud.request("push_unsubscribe",{endpoint:sub.endpoint});}finally{await sub.unsubscribe();}}
    localStorage.removeItem("form-device-owner");
  },
  async open(){
    if(this.dialog?.open)return;const ui=this.ui;await this.refresh();
    const dlg=ui.el("dialog");this.dialog=dlg;dlg.className="form-alert-dialog";dlg.dir="rtl";
    const list=ui.el("div"),status=ui.el("output");status.setAttribute("role","status");
    const run=(name,fn)=>ui.button(name,async()=>{try{await fn();}catch(e){status.textContent=e.message;}});
    const on=run("تفعيل إشعارات الجهاز",async()=>{await this.device();status.textContent="إشعارات هذا الجهاز مفعّلة.";});
    const off=run("إيقاف إشعارات الجهاز",async()=>{await this.detach();status.textContent="أُوقفت إشعارات هذا الجهاز.";});
    const install=run("تثبيت التطبيق",async()=>{
      if(this.installPrompt){const prompt=this.installPrompt;this.installPrompt=null;await prompt.prompt();await prompt.userChoice;}
      else status.textContent="من قائمة المتصفح اختر تثبيت التطبيق، أو من قائمة المشاركة اختر إضافة إلى الشاشة الرئيسية.";
    });
    let entries=this.rows.slice(), more=entries.length===25;
    const draw=()=>{list.replaceChildren();for(const r of entries){
      const text=this.names[r.kind]+" · "+r.branch+" · "+ui.time(r.created_at);
      const item=r.form_id?run(text,async()=>{await ui.flush();if(ui.panel.hidden)await ui.open("forms");await ui.view({id:r.form_id,company:r.company});dlg.close();}):ui.el("p",text);
      if(r.details){const d=r.details,info=ui.el("small");info.textContent=["الناشر "+(d.publisher||"—"),[d.car,d.model].filter(Boolean).join(" · ")||"—","السعر "+(d.price||"—")].join("  |  ");item.append(info);}
      item.className=r.seen?"":"alert-unread";list.append(item);}
      if(more)list.append(run("إظهار المزيد",async()=>{const last=entries.at(-1)?.id;const page=await Cloud.request("alerts",{beforeId:last});if(last!==entries.at(-1)?.id)return;entries.push(...page);more=page.length===25;draw();}));
      if(!entries.length)list.append(ui.el("p","لا توجد إشعارات بعد."));};
    const all=run("تأشير كمقروءة",async()=>{this.rows=await Cloud.call("alerts_seen",{through:this.rows[0]?.id||0});entries.forEach(r=>r.seen=true);this.updateBadge();draw();});
    const head=ui.el("header"),tools=ui.el("nav"),close=ui.button("إغلاق",()=>dlg.close());
    for(const [b,icon] of [[on,"bell"],[off,"mute"],[install,"download"],[all,"check"],[close,"close"]]){b.title=b.ariaLabel=b.textContent;b.innerHTML=Archive.icon(icon);tools.append(b);}
    head.append(ui.el("h2","الإشعارات"),tools);dlg.append(head,status,list);
    document.body.append(dlg);dlg.onclose=()=>dlg.remove();dlg.showModal();draw();
  }
};
window.addEventListener("beforeinstallprompt",e=>{if(!Cloud.enabled)return;e.preventDefault();FormInbox.installPrompt=e;});
