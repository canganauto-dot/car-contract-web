const App = new ContractEditor();
window.addEventListener("beforeprint",()=>DocumentInk.drain(),true);
function render() {
  if (App.mode === "fill" && App.configRef !== cfg) {
    App.scene = null;
    App.configRef = cfg;
  }
  App.render();
  if (Workbench.ready) {
    Workbench.paint();
    Workbench.form();
    EntryDates.sync();
    FillDesigner.apply(false);
  }
}
(async () => {
  if(Cloud.enabled && new URLSearchParams(location.search).has("verify"))return DocumentQR.verifyLocal();
  await Cloud.gate();
  if(Cloud.enabled && Cloud.restricted){
    cfg=normalizeConfig(clone(seed.config));Cloud.prepare(cfg);
    UIPreferences.defaults=UIPreferences.validate(cfg.design?.uiDefaults);UIPreferences.value=UIPreferences.read();UIPreferences.apply();
    await SalesForms.init();document.documentElement.removeAttribute("data-starting");
    document.body.inert=false;startReady=true;return;
  }
  try {
    db = await openDB();
    await removeTestArchives();
    const saved = await getDB("config");
    cfg = seed.offline ? normalizeConfig(clone(seed.config)) : await SharedDefaults.start(saved);
    cfg.setupComplete = !!saved?.setupComplete;
    if (seed.offline && saved?.setupComplete) {
      for (const key of ["organizer","staffTitle","branch","nextNumber"])
        if (saved.fixed?.[key] !== undefined) cfg.fixed[key] = saved.fixed[key];
      if (saved.offlineAgentConfigured) {
        for (const key of ["hasAgent","agent","agencyNo","agencyDate","agencyFrom"])
          if (saved.fixed?.[key] !== undefined) cfg.fixed[key] = saved.fixed[key];
        cfg.offlineAgentConfigured = true;
      }
    }
    if (!cfg.setupComplete) Object.assign(cfg.fixed,{organizer:"",staffTitle:"",prefix:"",branch:""});
    if(Cloud.enabled) Cloud.prepare(cfg);
    d = normalizeData(await getDB("draft"));
    await putDB("config", cfg);
  } catch (e) {
    if(Cloud.enabled)throw e;
    d = fresh();
    d.number = d.number || "غير محفوظ";
    $("saveStatus").textContent = "تعذر التخزين المحلي";
  }
  Services.ensureSchemas();
  Images.ensure();
  bindEvents();
  BranchNumbers.bind();
  $("printSides").value = cfg.printSides || "simplex";
  $("printSides").onchange = () => {
    cfg.printSides = $("printSides").value;
    scheduleConfig();
  };
  try {
    await Promise.all([WebResources.loadDocumentFont(),DocumentInk.init()]);
  } catch (error) {
    const cover = $("startupThread");
    cover.replaceChildren();
    const standalone=seed.offline || location.protocol==="file:";
    const retry = document.createElement(standalone?"p":"button");
    retry.textContent = standalone ? "تعذّر فتح النسخة. نزّل ملف HTML مجدداً من زر التنزيل في الموقع." :
      "تعذّر تحميل خط العقد أو محرّك الرسم. إعادة المحاولة";
    retry.title=error.message || "";
    if(!standalone)retry.onclick = () => location.reload();
    cover.append(retry);
    document.body.inert = false;
    return;
  }
  buildInputs();
  await App.init();
  BranchNumbers.migration=BranchNumbers.registerExisting();
  await ContractFiles.init();
  EditorEnhancements.init();
  await Workbench.init();
  SmartTables.init();
  TableTools.init();
  UIPreferences.init();
  StaffConsole.init();
  OfflineEdition.init();
  FieldStudio.init();
  FillDesigner.init();
  if(Cloud.formsReady){
    await SalesForms.init();
    const key=sessionStorage.getItem("open-company-draft");
    if(key){sessionStorage.removeItem("open-company-draft");const entry=Services.library.entries.find(e=>e.id==="draft:"+key);if(entry)await Services.openEntry(entry);}
  }
  document.documentElement.removeAttribute("data-starting");
  document.body.inert = false;
  startReady = true;
  saveDraft();
  await refreshBackups();
  $("fileStatus").textContent =
    Cloud.enabled ? "أرشيف الشركة متصل. تُحفظ المسودات ضمن الفرع." : "الحفظ محلي في هذا المتصفح. صدّر JSON للنسخ الاحتياطي.";
})().catch(error=>{
  const cover=$("startupThread"), retry=document.createElement("button");
  retry.textContent="تعذّر فتح مساحة العمل. إعادة المحاولة";retry.title=error.message;
  retry.onclick=()=>location.reload();cover.replaceChildren(retry);document.body.inert=false;
});
