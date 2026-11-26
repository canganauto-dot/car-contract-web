// No private pages, API responses, credentials or PDFs are cached.
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let info={};try{info=event.data?.json()||{};}catch{}
  let body={published:"نُشرت فورمة جديدة",approved:"تم اعتماد فورمة",rejected:"رُفضت فورمة"}[info.kind]||"لديك تحديث في سجل الفورمات";
  const d=info.details;if(d)body+=" · "+[d.publisher,d.car,d.model,d.price].filter(Boolean).join(" · ");
  event.waitUntil(Promise.all([
    self.registration.showNotification("منظومة العقود",{body,lang:"ar",dir:"rtl",icon:"./icon-192.png",tag:"form-alert-"+(info.id||"inbox")}),
    self.clients.matchAll({type:"window"}).then(tabs=>tabs.forEach(tab=>tab.postMessage("refresh-inbox")))
  ]));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();event.waitUntil((async()=>{
    const scope=new URL(self.registration.scope);
    for(const view of await self.clients.matchAll({type:"window",includeUncontrolled:true})){
      const url=new URL(view.url);if(url.origin===scope.origin&&url.pathname===scope.pathname){
        await view.focus();view.postMessage("open-inbox");return;
      }
    }
    await self.clients.openWindow(new URL("./?inbox=1",scope).href);
  })());
});
