const SharedDefaults = {
  enabled: false,
  keys: "companies cars assets clauses edits custom content contentOrder extraPages objects design companyFields companyImageSlots formulas vehicleImageSlots vehicleImages vehicleImageHistory imageSeparationVersion printSides bookPriceDefaults deletedCompanyImageSlots frames letterTemplates priceCatalogs requiredFields tables variableLabels".split(" "),
  async start(saved) {
    const bundled = seed.config;
    let base = bundled;
    if (location.protocol === "http:" || location.protocol === "https:") {
      const probe = await fetch("assets/js/seed.js", { method: "HEAD", cache: "no-cache" }).catch(() => null);
      this.enabled = probe?.headers.get("X-Contract-Defaults") === "1";
      if (this.enabled) base = (await this.read()).config;
    }
    this.revision = base.sharedRevision;
    // The sequence and workstation identity are local even when templates change.
    const useSaved = saved && (base.sharedRevision
      ? saved.sharedRevision === base.sharedRevision
      : (saved.updatedAt || 0) > (base.updatedAt || 0));
    const current = normalizeConfig(clone(useSaved ? saved : base));
    if (saved?.fixed) current.fixed = { ...current.fixed, ...saved.fixed };
    if (saved?.setupComplete) current.setupComplete = true;
    this.baseline = clone(base);
    if (this.enabled) {
      window.addEventListener("focus", () => this.refresh().catch(console.warn));
      this.channel = new BroadcastChannel("contract-shared-defaults");
      this.channel.onmessage = () => this.refresh().catch(console.warn);
    }
    return current;
  },
  async read() {
    const response = await fetch("/_defaults", { cache: "no-store" });
    if (!response.ok) throw Error("تعذرت قراءة إعدادات المشروع.");
    return response.json();
  },
  async refresh() {
    if (!startReady || this.writing || saveTimer || App.mode === "design" || !$("settingsDrawer").hidden) return;
    const previous = this.revision;
    const {config} = await this.read();
    if (config.sharedRevision === this.revision || previous !== this.revision || this.writing ||
        saveTimer || App.mode === "design" || !$("settingsDrawer").hidden) return;
    cfg = normalizeConfig({ ...config, fixed:cfg.fixed, setupComplete:cfg.setupComplete });
    this.baseline = clone(config);
    this.revision = config.sharedRevision;
    App.draft = null;
    await putDB("config", cfg);
    $("printSides").value = cfg.printSides;
    buildInputs();
    render();
    Archive.refresh();
  },
  async publish(config) {
    if (!this.enabled) return;
    const changed = {};
    for (const k of this.keys)
      if (config[k] !== undefined && JSON.stringify(config[k]) !== JSON.stringify(this.baseline[k]))
        changed[k] = config[k];
    if (!Object.keys(changed).length) return;
    this.writing = true;
    try {
      const response = await fetch("/_defaults", {
        method:"POST", headers:{"Content-Type":"application/json","If-Match":this.revision}, body:JSON.stringify(changed)
      });
      if (response.status === 409) throw Error("اعتمد مستخدم آخر نسخة أحدث. صدّر تعديلك ثم أعد فتح الصفحة قبل الدمج.");
      if (!response.ok) throw Error("تعذّر حفظ الإعدادات المشتركة في المشروع.");
      this.revision = (await response.json()).revision;
      Object.assign(this.baseline, changed);
      config.sharedRevision = cfg.sharedRevision = this.revision;
      this.channel.postMessage(this.revision);
    } finally { this.writing = false; }
  }
};
