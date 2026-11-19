const App = new ContractEditor();
function render() {
  if (App.mode === "fill" && App.configRef !== cfg) {
    App.scene = null;
    App.configRef = cfg;
  }
  App.render();
}
(async () => {
  try {
    db = await openDB();
    await removeTestArchives();
    const saved = await getDB("config");
    cfg = seed.offline ? normalizeConfig(clone(seed.config)) : await SharedDefaults.start(saved);
    cfg.setupComplete = !!saved?.setupComplete;
    if (seed.offline && saved?.setupComplete) {
      for (const key of ["organizer","prefix","branch","nextNumber"])
        if (saved.fixed?.[key] !== undefined) cfg.fixed[key] = saved.fixed[key];
      if (saved.offlineAgentConfigured) {
        for (const key of ["hasAgent","agent","agencyNo","agencyDate","agencyFrom"])
          if (saved.fixed?.[key] !== undefined) cfg.fixed[key] = saved.fixed[key];
        cfg.offlineAgentConfigured = true;
      }
    }
    if (!cfg.setupComplete) Object.assign(cfg.fixed,{organizer:"",prefix:"",branch:""});
    // Keep the recovered draft and its archive baseline from the same read.
    const store = db.transaction("store").objectStore("store");
    const [draft, archive] = await Promise.all([getDB("draft", store), getDB("contractArchive", store)]);
    if (Array.isArray(archive?.entries)) Services.library = archive;
    d = normalizeData(draft);
    await putDB("config", cfg);
  } catch (e) {
    d = fresh();
    d.number = d.number || "غير محفوظ";
    $("saveStatus").textContent = "تعذر التخزين المحلي";
  }
  Services.ensureSchemas();
  Images.ensure();
  bindEvents();
  $("printSides").value = cfg.printSides || "simplex";
  $("printSides").onchange = () => {
    cfg.printSides = $("printSides").value;
    scheduleConfig();
  };
  try {
    await WebResources.loadDocumentFont();
  } catch {
    const cover = $("startupThread");
    cover.replaceChildren();
    const retry = document.createElement("button");
    retry.textContent = "تعذّر تحميل خط العقد. إعادة المحاولة";
    retry.onclick = () => location.reload();
    cover.append(retry);
    document.body.inert = false;
    return;
  }
  buildInputs();
  await App.init();
  await ContractFiles.init();
  EditorEnhancements.init();
  await Letters.init();
  await Workbench.init();
  SmartTables.init();
  TableTools.init();
  UIPreferences.init();
  OfflineEdition.init();
  FieldStudio.init();
  FillDesigner.init();
  await startupMinimum;
  document.documentElement.setAttribute("data-revealing", "");
  document.documentElement.removeAttribute("data-starting");
  await new Promise(resolve => setTimeout(resolve, 450));
  document.documentElement.removeAttribute("data-revealing");
  document.body.inert = false;
  startReady = true;
  saveDraft();
  await refreshBackups();
  $("fileStatus").textContent =
    "الحفظ محلي في هذا المتصفح. صدّر JSON للنسخ الاحتياطي.";
})();
