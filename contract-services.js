/* Contract workflow, company schema and arithmetic expressions. No editor event overrides. */
function arithmetic(expression, resolve) {
  const source = normalizeDigits(expression).trim();
  if (source.length > 500) throw Error("المعادلة طويلة");
  const tokens =
    source.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/%,]/g) || [];
  if (tokens.join("") !== source.replace(/\s/g, ""))
    throw Error("استخدم أرقاماً وأسماء خانات وعمليات حسابية فقط");
  let at = 0;
  const functions = {
    SUM: (...v) => v.reduce((a, b) => a + b, 0),
    MIN: Math.min,
    MAX: Math.max,
    ABS: Math.abs,
    ROUND: (v, d = 0) =>
      Math.round(v * 10 ** Math.max(0, Math.min(6, d))) /
      10 ** Math.max(0, Math.min(6, d)),
  };
  function factor() {
    const t = tokens[at++];
    if (t === "-") return -factor();
    if (t === "+") return factor();
    if (t === "(") {
      const n = expr();
      if (tokens[at++] !== ")") throw Error("قوس ناقص");
      return n;
    }
    if (/^\d/.test(t || "")) return Number(t);
    if (/^[A-Za-z_]/.test(t || "")) {
      if (tokens[at] === "(") {
        at++;
        const fn = functions[t.toUpperCase()];
        if (!fn) throw Error("دالة غير معروفة: " + t);
        const args = [];
        if (tokens[at] !== ")") {
          do {
            args.push(expr());
            if (tokens[at] !== ",") break;
            at++;
          } while (at < tokens.length);
        }
        if (tokens[at++] !== ")" || !args.length)
          throw Error("وسائط الدالة غير صحيحة");
        return fn(...args);
      }
      return resolve(t);
    }
    throw Error("المعادلة غير مكتملة");
  }
  function term() {
    let n = factor();
    while (["*", "/", "%"].includes(tokens[at])) {
      const op = tokens[at++],
        b = factor();
      if ((op === "/" || op === "%") && b === 0) throw Error("قسمة على صفر");
      n = op === "*" ? n * b : op === "/" ? n / b : n % b;
    }
    return n;
  }
  function expr() {
    let n = term();
    while (["+", "-"].includes(tokens[at])) {
      const op = tokens[at++],
        b = term();
      n = op === "+" ? n + b : n - b;
    }
    return n;
  }
  const value = expr();
  if (at !== tokens.length || !Number.isFinite(value) || Math.abs(value) > 1e15)
    throw Error("نتيجة غير صالحة");
  return value;
}
const Feedback = {
  queue: Promise.resolve(),
  open(message, confirm) {
    const display = () =>
      new Promise((resolve) => {
        const dialog = $("feedbackDialog");
        $("feedbackHeading").textContent = confirm ? "تأكيد الإجراء" : "تنبيه";
        $("feedbackMessage").textContent = String(message);
        $("feedbackAccept").textContent = confirm ? "تأكيد" : "موافق";
        $("feedbackCancel").hidden = !confirm;
        dialog.returnValue = "";
        dialog.addEventListener(
          "close",
          () => resolve(dialog.returnValue === "yes"),
          { once: true },
        );
        dialog.showModal();
        $(confirm ? "feedbackCancel" : "feedbackAccept").focus();
      });
    return (this.queue = this.queue.then(display, display));
  },
  notice(message) {
    return this.open(message, false);
  },
  ask(message) {
    return this.open(message, true);
  },
};
class ContractServices {
  constructor() {
    this.home = true;
    this.library = { version: 1, entries: [], configs: {}, updatedAt: 0 };
    this.queue = Promise.resolve();
    this.pendingData = null;
    this.timer = null;
    this.stream = null;
    this.clipboard = null;
    this.printCandidate = null;
    this.initialized = false;
    this.formulaErrors = [];
  }
  ensureSchemas() {
    cfg.companyFields = cfg.companyFields || [];
    cfg.companyImageSlots = cfg.companyImageSlots || [];
    cfg.formulas = cfg.formulas || [];
    for (const c of cfg.companies) {
      c.values = c.values || {};
      c.imageValues = c.imageValues || {};
      for (const f of cfg.companyFields)
        if (!(f.key in c.values)) c.values[f.key] = "";
    }
  }
  enrichContext(result,r = calculate(d)) {
    const c = co();
    result.day = /^\d{4}-\d{2}-\d{2}$/.test(d.contractDate || "")
      ? [
          "الأحد",
          "الاثنين",
          "الثلاثاء",
          "الأربعاء",
          "الخميس",
          "الجمعة",
          "السبت",
        ][new Date(d.contractDate + "T12:00:00Z").getUTCDay()]
      : "";
    for (const f of cfg.companyFields || [])
      result[f.key] = c.values?.[f.key] ?? "";
    result.phaseFirstLine =
      "الأقساط بقيمة: " +
      money(r.earlyPayment) +
      " د.ع. عددها " +
      r.earlyCount +
      " من تاريخ " +
      dateLabel(d.firstDate) +
      (r.interval > 1 ? "، كل " + r.interval + " أشهر" : "");
    result.phaseSecondLine =
      "الأقساط بقيمة: " +
      money(r.payment) +
      " د.ع. عددها " +
      r.secondCount +
      " من تاريخ " +
      dateLabel(r.secondDate);
    result.installmentFrequency=r.interval===1 ? "شهرية" : "كل "+r.interval+" أشهر";
    result.scheduleIntro="تدفع اقساط "+result.installmentFrequency+" عددها ( "+(r.count || "")+" ) تبدأ بتاريخ: "+dateLabel(d.firstDate);
    result.intervalMonths = r.interval;
    result.phaseSecondDate = dateLabel(r.secondDate);
    const numeric = {
        ...d,
        ...c.values,
        total: r.total,
        deposit: r.deposit,
        remaining: r.remaining,
        last: r.last,
        payment: r.payment,
        count: r.count,
        extras: r.extras,
        intervalMonths: r.interval,
        phaseCount: r.earlyCount,
        phaseSecondCount: r.secondCount,
      },
      defs = new Map((cfg.formulas || []).map((f) => [f.key, f])),
      memo = new Map(),
      visiting = new Set();
    this.formulaErrors = [];
    const resolve = (key) => {
      if (memo.has(key)) return memo.get(key);
      if (defs.has(key)) {
        if (visiting.has(key)) throw Error("ارتباط دائري: " + key);
        visiting.add(key);
        try {
          const n = arithmetic(defs.get(key).expression, resolve);
          memo.set(key, n);
          return n;
        } finally {
          visiting.delete(key);
        }
      }
      if (!(key in numeric)) throw Error("خانة غير معروفة: " + key);
      const raw = normalizeDigits(numeric[key]).replace(/[,،٬\s]/g, "");
      if (raw === "") return 0;
      if (!/^-?\d+(?:\.\d+)?$/.test(raw))
        throw Error("الخانة ليست رقماً: " + key);
      return Number(raw);
    };
    for (const f of cfg.formulas || []) {
      try {
        const n = resolve(f.key);
        result[f.key] =
          f.format === "money"
            ? n.toLocaleString("en-US", { maximumFractionDigits: 6 })
            : String(Math.round(n * 1e6) / 1e6);
      } catch (e) {
        result[f.key] = "—";
        this.formulaErrors.push(f.label + ": " + e.message);
      }
    }
    return result;
  }
  upgradeScene(scene) {
    TransferLetter.upgradeVehicleTables(scene);
    arrangeBillPages(scene);
    if (scene.installmentStages) return;
    for (const page of scene.pages) {
      const intro = page.nodes.find((n) => n.id === "installmentIntro"),
        wordsNode = page.nodes.find((n) => n.id === "paymentWords");
      if (!intro || !wordsNode) continue;
      const standard = page.nodes.filter((n) =>
        [
          "installmentIntro",
          "payment",
          "payment-label",
          "paymentWords",
        ].includes(n.id),
      );
      const peers = standard.filter((n) => n !== intro),
        left = Math.min(...peers.map((n) => n.x)),
        right = Math.max(...peers.map((n) => n.x + n.w));
      for (const n of standard) n.condition = "standard";
      for (const n of page.nodes)
        if (
          n.type === "shape" &&
          Math.abs(n.x - wordsNode.x) < 0.2 &&
          Math.abs(n.y - wordsNode.y) < 0.2
        )
          n.condition = "standard";
      if ((intro.html || "").includes("تدفع أقساط"))
        intro.html = "{{scheduleIntro}}";
      page.nodes.push(
        {
          ...clone(intro),
          id: "installment-phase-one",
          name: "المرحلة الأولى للأقساط",
          html: "{{phaseFirstLine}}",
          condition: "phase",
          fontSize: 16,
          weight: "400",

        },
        {
          ...clone(wordsNode),
          id: "installment-phase-two",
          name: "المرحلة الثانية للأقساط",
          x: left,
          w: right - left,
          html: "{{phaseSecondLine}}",
          condition: "phase",
          fontSize: 16,
          weight: "400",

          align: "right",
        },
      );
    }
    scene.installmentStages = true;
  }
  fieldChanged(key, input) {
    if (key === "firstDate") {
      d.firstAuto = !input.value;
      if (d.firstAuto) {
        d.firstDate = addMonths(d.contractDate, 1);
        input.value = d.firstDate;
      }
    }
    if (key === "depositDate") {
      d.depositAuto = !input.value;
      if (d.depositAuto) {
        d.depositDate = d.contractDate;
        input.value = d.depositDate;
      }
    }
    if (key === "phaseEnabled" && d.phaseEnabled && !d.phaseSecondCount) {
      d.phaseSecondCount = String(
        Math.max(0, amount(d.count) - amount(d.phaseCount) - 1),
      );
      if ($("phaseSecondCount"))
        $("phaseSecondCount").value = d.phaseSecondCount;
    }
    this.decorateForm();
  }
  dateChanged(value) {
    const old = d.contractDate;
    d.contractDate = value;
    if (d.firstAuto !== false || !d.firstDate) {
      d.firstDate = addMonths(value, 1);
      $("firstDate").value = d.firstDate;
    }
    if (d.depositAuto !== false || d.depositDate === old) {
      d.depositDate = value;
      $("depositDate").value = value;
    }
    render();
  }
  decorateForm() {
    Workspace.arrangeFields();
    const phaseToggle = $("phaseEnabled").closest("label");
    if (!FillLayout.origins.has(phaseToggle) && phaseToggle.parentElement !== $("paymentActions")) $("paymentActions").prepend(phaseToggle);
    phaseToggle.hidden = !["installment", "exchange"].includes(d.contractType);
    for (const id of ["phaseCount", "phasePayment", "phaseSecondCount"])
      if ($(id)) $(id).closest("label").hidden = !d.phaseEnabled;
    if ($("count")) $("count").closest("label").hidden = !!d.phaseEnabled;
    const payment = $("payment").closest("label");
    const layout=cfg.design?.fillAppearance?.[ContractTemplates.scopeKey()] || {};
    const phasePayment = $("phasePayment"), phaseCount = $("phaseCount");
    for(const [input,standard] of [[$("payment"),d.phaseEnabled ? "قسط المرحلة الثانية" : "قيمة القسط"],
        [phasePayment,"قسط المرحلة الأولى"],[phaseCount,"عدد الأولى"],[$("phaseSecondCount"),"عدد الثانية"]]){
      const caption=FillDesigner.caption(input.closest("label")), text=layout[input.id]?.title || standard;
      if(caption.textContent!==text)caption.textContent=text;
      input.setAttribute("aria-label",text);
    }
    const phaseHost = $("installmentInputs");
    if (phaseHost.dataset.phaseOrder !== String(!!d.phaseEnabled)) {
      if (d.phaseEnabled && [payment,phasePayment.closest("label"),phaseCount.closest("label")].every(label => label.parentElement === phaseHost && !FillLayout.origins.has(label))) {
        phaseHost.insertBefore(phasePayment.closest("label"), payment);
        phaseHost.insertBefore(phaseCount.closest("label"), payment);
      }
      phaseHost.dataset.phaseOrder = String(!!d.phaseEnabled);
    }
    this.photoPreview();
    Cash.decorate();
    External.decorate();
  }
  photoPreview() {
    if (!$("customerPhotoPreview")) return;
    const img = $("customerPhotoPreview");
    $("customerPhotoRemove").disabled=!d.customerPhoto;
    img.hidden = !d.customerPhoto;
    if (d.customerPhoto) img.src = safeImage(d.customerPhoto);
    else img.removeAttribute("src");
  }
  async openCamera() {
    this.stopCamera();
    const zoom = (value) => {
      this.cameraZoom = Math.max(1, Math.min(3, value));
      $("cameraVideo").style.transform = "scale(" + this.cameraZoom + ")";
      $("cameraZoom").value = Math.round(this.cameraZoom * 100);
      $("cameraZoomValue").textContent =
        Math.round(this.cameraZoom * 100) + "%";
    };
    zoom(1.1);
    $("cameraZoom").oninput = (e) => zoom(Number(e.target.value) / 100);
    $("cameraFrame").onwheel = (e) => {
      e.preventDefault();
      zoom(this.cameraZoom + (e.deltaY < 0 ? 0.05 : -0.05));
    };
    $("cameraStatus").textContent = "جاري فتح الكاميرا…";
    $("takeCustomerPhoto").disabled = true;
    $("cameraDialog").showModal();
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("الكاميرا غير متاحة في هذا المتصفح. استخدم تحميل الصورة.");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      if (!$("cameraDialog").open) {
        this.stopCamera();
        return;
      }
      $("cameraVideo").srcObject = this.stream;
      await $("cameraVideo").play();
      $("cameraStatus").textContent = "";
      $("takeCustomerPhoto").disabled = false;
      $("takeCustomerPhoto").focus();
    } catch (e) {
      $("cameraStatus").textContent =
        "تعذر فتح الكاميرا. اسمح باستخدامها أو حمّل صورة من الكمبيوتر.";
    }
  }
  stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if ($("cameraVideo")) $("cameraVideo").srcObject = null;
  }
  takePhoto() {
    const video = $("cameraVideo");
    if (!video.videoWidth) return;
    const canvas = document.createElement("canvas");
    const side =
      Math.min(video.videoWidth, video.videoHeight) / (this.cameraZoom || 1.1);
    canvas.width = canvas.height = Math.min(
      1280,
      Math.min(video.videoWidth, video.videoHeight),
    );
    canvas
      .getContext("2d")
      .drawImage(
        video,
        (video.videoWidth - side) / 2,
        (video.videoHeight - side) / 2,
        side,
        side,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    d.customerPhoto = canvas.toDataURL("image/jpeg", 0.9);
    this.stopCamera();
    $("cameraDialog").close();
    this.photoPreview();
    render();
    saveDraft();
  }
  companyPanel() {
    if (!$("companyFieldValues")) return;
    this.ensureSchemas();
    const c =
      cfg.companies.find((c) => c.id === $("settingsCompany")?.value) || co();
    $("companyFieldValues").replaceChildren();
    for (const f of cfg.companyFields) {
      const label = document.createElement("label");
      label.textContent = f.label + " · {{" + f.key + "}}";
      const input = document.createElement("input");
      input.value = c.values[f.key] || "";
      input.onchange = () => {
        c.values[f.key] = input.value;
        scheduleConfig();
        render();
      };
      label.append(input);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "حذف الخانة";
      remove.onclick = () => {
        cfg.companyFields = cfg.companyFields.filter((x) => x.key !== f.key);
        for (const company of cfg.companies) delete company.values?.[f.key];
        this.companyPanel();
        render();
        scheduleConfig();
      };
      label.append(remove);
      $("companyFieldValues").append(label);
    }
    Images.companyPanel();
  }

  addCompanyField() {
    const label = $("companyFieldLabel").value.trim(),
      raw = $("companyFieldKey").value.trim(),
      key = raw.startsWith("company_") ? raw : "company_" + raw;
    if (!label || !/^company_[A-Za-z][A-Za-z0-9_]*$/.test(key))
      return Feedback.notice(
        "أدخل اسماً وكوداً بحروف إنجليزية وأرقام دون مسافات.",
      );
    if (cfg.companyFields.some((f) => f.key === key))
      return Feedback.notice("هذا الكود موجود.");
    cfg.companyFields.push({ key, label });
    for (const c of cfg.companies) {
      c.values = c.values || {};
      c.values[key] = $("companyFieldDefault").value;
    }
    $("companyFieldLabel").value = "";
    $("companyFieldKey").value = "";
    $("companyFieldDefault").value = "";
    this.companyPanel();
    render();
    scheduleConfig();
  }
  formulaPanel() {
    $("formulaRows").replaceChildren();
    for (const f of cfg.formulas) {
      const row = document.createElement("div");
      row.className = "formula-row";
      const label = document.createElement("span");
      label.textContent = f.label + " · {{" + f.key + "}} = " + f.expression;
      const edit = document.createElement("button");
      edit.textContent = "تعديل";
      edit.onclick = () => {
        $("formulaLabel").value = f.label;
        $("formulaKey").value = f.key;
        $("formulaExpression").value = f.expression;
        $("formulaFormat").value = f.format;
      };
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.onclick = () => {
        cfg.formulas = cfg.formulas.filter((x) => x !== f);
        this.formulaPanel();
        render();
        scheduleConfig();
      };
      row.append(label, edit, remove);
      $("formulaRows").append(row);
    }
  }
  saveFormula() {
    const key = $("formulaKey").value.trim(),
      label = $("formulaLabel").value.trim(),
      expression = $("formulaExpression").value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || !label)
      return ($("formulaMessage").textContent = "أدخل اسماً وكوداً صالحاً.");
    if (
      key in d ||
      (key in ctx && !cfg.formulas.some((f) => f.key === key)) ||
      [
        "day",
        "date",
        "remaining",
        "last",
        "company",
        "manager",
        "duration",
      ].includes(key) ||
      cfg.companyFields.some((f) => f.key === key)
    )
      return ($("formulaMessage").textContent =
        "الكود مستخدم؛ اختر كوداً آخر.");
    const old = clone(cfg.formulas);
    cfg.formulas = cfg.formulas.filter((f) => f.key !== key);
    cfg.formulas.push({
      key,
      label,
      expression,
      format: $("formulaFormat").value,
    });
    context();
    if (this.formulaErrors.length) {
      const errors = [...this.formulaErrors];
      cfg.formulas = old;
      context();
      $("formulaMessage").textContent = errors.join(" · ");
      return;
    }
    $("formulaMessage").textContent =
      "تم الحفظ · استخدم {{" + key + "}} في النص";
    this.formulaPanel();
    render();
    scheduleConfig();
  }
  fingerprint(data) {
    const tables = Object.values(data.tableData || {});
    if (tables.some(rows => Array.isArray(rows) && rows.some(row => row?.priceLink)))
      data = SmartTables.snapshot(data);
    const normalized = {
      ...data,
      ...cashTerms(data),
      transferDealer: data.transferDealer || "",
      skipTransferLetter: !!data.skipTransferLetter,
      contractType: data.contractType || "installment",
      updatedAt: 0,
    };
    delete normalized.signedFile;
    if (data.tableData) {
      // Compare printable cells in their schema order. Catalog item IDs and
      // object insertion order can differ after reopening the saved snapshot.
      normalized.tableData = Object.keys(data.tableData).sort().map(key => {
        const rows = Array.isArray(data.tableData[key]) ? data.tableData[key] : [];
        return [key, rows.map(row => SmartTables.columns.map(([column]) => row?.[column] ?? null))];
      });
    }
    return JSON.stringify(
      Object.keys(normalized)
        .sort()
        .map((key) => [key, normalized[key]]),
    );
  }
  saveCurrent(data) {
    if ((!data.number && !data.recordId) || !this.initialized || App.mode === "design") return;
    if (!data.recordId) data.recordId = "contract-" + crypto.randomUUID();
    this.pendingData = clone(data);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 450);
  }
  persistLibrary() {
    this.library.updatedAt = Date.now();
    // Entry documents are immutable after insertion. Copy the mutable entry
    // wrappers and let IndexedDB serialize the snapshot once, without JSON.
    const snapshot = {
      ...this.library,
      entries: this.library.entries.map(entry => ({ ...entry })),
    };
    this.queue = this.queue
      .catch(() => {})
      .then(() => putDB("contractArchive", snapshot))
      .catch(() => {
        $("saveStatus").textContent = "تعذر حفظ الأرشيف؛ احفظ نسخة البرنامج";
      });
    return this.queue;
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.pendingData) {
      const data = this.pendingData;
      this.pendingData = null;
      const printed = this.library.entries.find(
        (e) => e.kind === "printed" && e.data.recordId === data.recordId,
      );
      const id = "draft:" + data.recordId;
      const at = this.library.entries.findIndex(e => e.id === id);
      const fingerprint = this.fingerprint(data);
      if (printed && this.fingerprint(printed.data) === fingerprint) {
        if (at >= 0) {
          this.library.entries.splice(at, 1);
          await this.persistLibrary();
        }
      } else if (at < 0 || this.fingerprint(this.library.entries[at].data) !== fingerprint) {
        const entry = { id, kind: "draft", data, updatedAt: Date.now(), note: "" };
        if (at >= 0) this.library.entries[at] = entry;
        else this.library.entries.unshift(entry);
        await this.persistLibrary();
      }
    }
    await this.queue;
    if (Workbench.ready) Workbench.paint();
  }
  async showHome() {
    if (App.mode === "design") App.leave();
    App.commitText();
    this.saveCurrent(d);
    await this.flush();
    this.home = true;
    document.body.classList.add("home-mode");
    $("homeScreen").hidden = false;
    this.archivePanel();
  }
  async createContract() {
    await BranchNumbers.migration;
    if (App.mode === "design") App.leave();
    this.saveCurrent(d);
    await this.flush();
    const next = fresh();
    next.recordId = "contract-" + crypto.randomUUID();
    next.companyId = d?.companyId || cfg.companies[0].id;
    next.initialCompanyId = next.companyId;
    await BranchNumbers.begin(next);
    d = next;
    this.home = false;
    document.body.classList.remove("home-mode");
    $("homeScreen").hidden = true;
    App.scene = null;
    App.configRef = cfg;
    buildInputs();
    render();
    saveDraft();
    $("buyer").focus({ preventScroll: true });
  }
  async openEntry(entry) {
    if (App.mode === "design") App.leave();
    this.saveCurrent(d);
    await this.flush();
    d = normalizeData(clone(entry.data));
    if (!d.recordId) d.recordId = "contract-" + crypto.randomUUID();
    this.home = false;
    document.body.classList.remove("home-mode");
    $("homeScreen").hidden = true;
    App.scene = null;
    buildInputs();
    render();
    saveDraft();
  }
  archivePanel() {
    Archive.refresh();
  }
  beforePrint() {
    if (this.home || !d.number) return;
    this.refreshPrintClock();
    if (!seed.offline) this.printCandidate = { data: SmartTables.snapshot(d) };
  }
  afterPrint() {
    if (seed.offline) { this.printCandidate = null; return; }
    if (this.printCandidate && !$("printResultDialog").open)
      $("printResultDialog").showModal();
  }
  refreshPrintClock() {
    const printed = this.library.entries.find(e => e.kind === "printed" && e.data.recordId === d.recordId);
    if (printed && this.fingerprint(printed.data) === this.fingerprint(d)) return;
    if (this.home || !this.stamp(d)) return;
    $("contractDate").value = d.contractDate;
    $("contractTime").value = d.contractTime;
    if ($("firstDate")) $("firstDate").value = d.firstDate;
    if ($("depositDate")) $("depositDate").value = d.depositDate;
    App.render();
  }
  stamp(data) {
    const day = data.manualContractDate ? data.contractDate : today();
    const time = data.manualContractTime ? data.contractTime : timeNow();
    if (day === data.contractDate && time === data.contractTime) return false;
    if (day !== data.contractDate) {
      if (data.firstAuto !== false) data.firstDate = addMonths(day, 1);
      if (data.depositAuto !== false) data.depositDate = day;
    }
    Object.assign(data, { contractDate: day, contractTime: time });
    return true;
  }
  async confirmPrint() {
    if (!this.printCandidate) return;
    const candidate = this.printCandidate;
    this.printCandidate = null;
    await this.flush();
    const key = candidate.data.recordId || "legacy-" + candidate.data.number;
    candidate.data.recordId = key;
    const previous = this.library.entries.find(
      (e) => e.kind === "printed" && e.data.recordId === key,
    );
    this.library.entries = this.library.entries.filter(
      (e) =>
        !(e.kind === "printed" && e.data.recordId === key) &&
        e.id !== "draft:" + key,
    );
    const same = previous && this.fingerprint(previous.data) === this.fingerprint(candidate.data);
    let history = previous?.history || [];
    if (previous && !same) {
      const {history: older, ...snapshot} = previous;
      history = [snapshot, ...history];
    }
    this.library.entries.unshift({
      ...(same ? previous : {}),
      history,
      id: "printed:" + key,
      kind: "printed",
      data: candidate.data,
      updatedAt: Date.now(),
      note: "نسخة الطباعة الحالية",
    });
    await this.persistLibrary();
    $("printResultDialog").close();
    $("saveStatus").textContent = "حُفظ العقد ضمن العقود المطبوعة";
    this.archivePanel();
  }
  copyNodes(cut = false) {
    if (App.mode !== "design" || !App.selection.size) return;
    this.clipboard = {
      kind: "contract-nodes",
      version: 6,
      nodes: clone(App.selected()),
    };
    navigator.clipboard
      ?.writeText(JSON.stringify(this.clipboard))
      .catch(() => {});
    if (cut) App.action("delete");
    else $("saveStatus").textContent = "تم نسخ العناصر المحددة";
  }
  async pasteNodes() {
    let payload = this.clipboard;
    try {
      const text = await navigator.clipboard.readText();
      if (text.length < 20000000) {
        const parsed = JSON.parse(text);
        if (
          parsed.kind === "contract-nodes" &&
          parsed.version === 6 &&
          Array.isArray(parsed.nodes)
        )
          payload = parsed;
      }
    } catch {}
    if (!payload || App.mode !== "design") return;
    const source = payload.nodes
      .filter(
        (n) =>
          ["text", "image", "shape", "table"].includes(n.type) &&
          [n.x, n.y, n.w, n.h].every((v) => Number.isFinite(v)) &&
          n.x >= 0 &&
          n.y >= 0 &&
          n.w > 0 &&
          n.h > 0 &&
          n.x + n.w <= 210.02 &&
          n.y + n.h <= 297.02,
      )
      .filter((n) => {
        try {
          if (n.type === "image" && n.src) safeImage(n.src);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 150);
    if (!source.length) return;
    App.commitText();
    App.checkpoint();
    const page = App.current(),
      z = Math.max(0, ...page.nodes.map((n) => n.z || 0));
    const maxRight = Math.max(...source.map((n) => n.x + n.w)),
      maxBottom = Math.max(...source.map((n) => n.y + n.h)),
      dx = Math.min(5, 210 - maxRight),
      dy = Math.min(5, 297 - maxBottom);
    const copies = clone(source).map((n, i) => ({
      ...n,
      id: "node-" + crypto.randomUUID(),
      x: Math.max(0, n.x + dx),
      y: Math.max(0, n.y + dy),
      z: z + i + 1,
    }));
    page.nodes.push(...copies);
    App.selection = new Set(copies.map((n) => n.id));
    App.render();
    App.persist();
  }
  zoomWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!e.target.closest("#canvas") || this.home) return;
    const canvas = $("canvas"),
      r = canvas.getBoundingClientRect(),
      old = App.scale,
      next = Math.max(0.25, Math.min(2, old * Math.exp(-e.deltaY * 0.002)));
    let opt = $("zoom").querySelector("[data-custom]");
    if (!opt) {
      opt = new Option();
      opt.dataset.custom = "1";
      $("zoom").append(opt);
    }
    opt.value = String(next);
    opt.textContent = Math.round(next * 100) + "%";
    $("zoom").value = String(next);
    const x = canvas.scrollLeft + e.clientX - r.left,
      y = canvas.scrollTop + e.clientY - r.top;
    App.zoom();
    canvas.scrollLeft = (x * next) / old - (e.clientX - r.left);
    canvas.scrollTop = (y * next) / old - (e.clientY - r.top);
  }
  async setup() {
    if (cfg.setupComplete && cfg.fixed.prefix && cfg.fixed.organizer && cfg.fixed.branch) {
      cfg.setupComplete = true;
      return;
    }
    const f = cfg.fixed;
    $("setupOrganizer").value = f.organizer || "";
    $("setupPrefix").value = f.prefix || "";
    $("setupBranch").value = f.branch || "";
    $("setupHasAgent").checked = !!f.hasAgent;
    $("setupAgent").value = f.agent || "";
    $("setupAgencyNo").value = f.agencyNo || "";
    $("setupAgencyDate").value = f.agencyDate || "";
    $("setupAgencyFrom").value = f.agencyFrom || "";
    $("setupHasAgent").closest("label").hidden = false;
    $("setupAgentFields").hidden = !seed.offline && !f.hasAgent;
    $("setupDialog").showModal();
  }
  async init() {
    this.ensureSchemas();
    Images.scan();
    const stored = await getDB("contractArchive");
    this.library = stored || this.library;
    if (!Array.isArray(this.library.entries))
      this.library = { version: 1, entries: [], configs: {}, updatedAt: 0 };
    const printed = new Map(this.library.entries.filter(e => e.kind === "printed").map(e => [e.data.recordId, e]));
    const retained = this.library.entries.filter(e => {
      const parent = typeof e.id === "string" && e.id.startsWith("revision:") && printed.get(e.data.recordId);
      if (!parent) return true;
      (parent.history ||= []).push({...e, kind:"printed"});
      return false;
    });
    if (retained.length !== this.library.entries.length) {
      this.library.entries = retained;
      await this.persistLibrary();
    }
    this.initialized = true;
    if (d.number) {
      if (!d.recordId) d.recordId = "legacy-" + d.number;
      this.saveCurrent(d);
      await this.flush();
    }
    let fdetails = $("formulaDetails");
    if (!fdetails) {
      fdetails = document.createElement("details");
      fdetails.id = "formulaDetails";
      fdetails.innerHTML = "<summary>الكتابات المحسوبة والمعادلات</summary>";
      $("settingsDrawer").append(fdetails);
    }
    fdetails.append($("formulaSettings"));
    $("homeButton").onclick = () => this.showHome();
    $("homeCreate").onclick = () => this.createContract();
    Archive.init();
    $("customerUpload").onclick = () => $("customerPhotoFile").click();
    $("customerCapture").onclick = () => this.openCamera();
    $("customerPhotoRemove").onclick = () => {
      d.customerPhoto = "";
      this.photoPreview();
      render();
      saveDraft();
    };
    $("customerPhotoFile").onchange = async () => {
      try {
        const file = $("customerPhotoFile").files[0];
        if (!file) return;
        d.customerPhoto = await readImage(file);
        this.photoPreview();
        render();
        saveDraft();
      } catch (e) {
        Feedback.notice(e.message);
      } finally {
        $("customerPhotoFile").value = "";
      }
    };
    $("closeCamera").onclick = () => {
      this.stopCamera();
      $("cameraDialog").close();
    };
    $("cameraDialog").addEventListener("cancel", () => this.stopCamera());
    $("cameraDialog").addEventListener("close", () => this.stopCamera());
    $("takeCustomerPhoto").onclick = () => this.takePhoto();
    $("cameraDialog").addEventListener("keydown", e=>{
      if(!["Enter"," "].includes(e.key) || e.target.matches("input"))return;
      if(e.target.closest("button") && e.target.closest("button")!==$("takeCustomerPhoto"))return;
      e.preventDefault();
      if(!e.repeat && !$("takeCustomerPhoto").disabled)this.takePhoto();
    });
    $("cameraUploadFallback").onclick = () => {
      this.stopCamera();
      $("cameraDialog").close();
      $("customerPhotoFile").click();
    };
    document
      .querySelectorAll("[data-close]")
      .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
    $("insertStaticImage").onclick = () => {
      $("imageTypeDialog").close();
      App.imageTarget = null;
      $("editorImageFile").click();
    };
    $("insertCustomerImage").onclick = () => Images.insert("customer");
    $("chooseCompanyImage").onclick = () => {
      $("companyImageCreate").hidden = false;
      $("vehicleImageCreate").hidden = true;
    };
    $("insertCompanyImage").onclick = () => {
      let slot = $("existingImageSlot").value;
      if (!slot) {
        const label = $("newImageSlotLabel").value.trim();
        if (!label) return Feedback.notice("اكتب اسم الخانة.");
        slot = "image_" + crypto.randomUUID().replaceAll("-", "").slice(0, 10);
        Images.companySlot(slot, label);
        scheduleConfig();
      }
      Images.insert("companySlot", slot);
    };
    $("addCompanyField").onclick = () => this.addCompanyField();
    $("addFormula").onclick = () => this.saveFormula();
    $("confirmPrinted").onclick = () => this.confirmPrint();
    $("cancelPrinted").onclick = () => {
      this.printCandidate = null;
      $("printResultDialog").close();
    };
    $("printResultDialog").addEventListener(
      "cancel",
      () => (this.printCandidate = null),
    );
    $("setupDialog").addEventListener("cancel", (e) => e.preventDefault());
    $("setupHasAgent").onchange = () =>
      ($("setupAgentFields").hidden = !$("setupHasAgent").checked);
    $("setupForm").onsubmit = async (e) => {
      e.preventDefault();
      const prefix = $("setupPrefix").value.trim(),
        organizer = $("setupOrganizer").value.trim();
      if (!prefix || !organizer || !$("setupBranch").value.trim()) return;
      Object.assign(cfg.fixed, {
        prefix,
        organizer,
        branch: $("setupBranch").value.trim(),
        hasAgent: $("setupHasAgent").checked,
        agent: $("setupAgent").value,
        agencyNo: $("setupAgencyNo").value,
        agencyDate: $("setupAgencyDate").value,
        agencyFrom: $("setupAgencyFrom").value,
      });
      if (seed.offline) cfg.offlineAgentConfigured = true;
      cfg.setupComplete = true;
      await saveConfig();
      buildInputs();
      if (!this.home) render();
      $("setupDialog").close();
    };
    document.addEventListener("wheel", (e) => this.zoomWheel(e), {
      passive: false,
    });
    document.addEventListener(
      "keydown",
      (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const key = e.key.toLowerCase(),
          typing = !!e.target.closest(
            "input,textarea,select,[contenteditable=true]",
          );
        if (key === "p") {
          e.preventDefault();
          if (this.home && Archive.handlePrintShortcut()) return;
          if (this.home)
            return ($("archiveStatus").textContent =
              "افتح عقداً أولاً للطباعة");
          $("printAll").click();
          return;
        }
        if (["+", "=", "-", "0"].includes(key)) {
          e.preventDefault();
          return;
        }
        if (App.mode === "design" && !typing && ["c", "x", "v"].includes(key)) {
          e.preventDefault();
          if (key === "v") this.pasteNodes();
          else this.copyNodes(key === "x");
        }
      },
      true,
    );
    window.addEventListener("beforeunload", () => this.stopCamera());
    Workspace.init();
    Images.init();
    this.decorateForm();
    this.companyPanel();
    this.formulaPanel();
    await this.showHome();

    await this.setup();
  }
}
const Services = new ContractServices();
