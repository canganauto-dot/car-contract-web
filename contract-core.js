function context(r = calculate(d)) {
  const c = co(),
    f = cfg.fixed;
  const result = {
    ...d,
    ...FieldStudio.inputValues(),
    ...f,
    company: d.bookNoCompany
      ? ""
      : c.fullName ||
        "شركة " +
          c.name +
          " للتجارة العامة والوكالات التجارية محدودة المسؤولية",
    shortCompany: c.name,
    transferAddressee: c.transferAddressee || "وكيل شركة " + c.name,
    manager: c.manager,
    address: c.address || "بغداد - الدورة",
    phone: c.phone || "",
    date: dateLabel(d.contractDate),
    depositDate: dateLabel(d.depositDate),
    firstDate: dateLabel(d.firstDate),
    lastDate: dateLabel(r.lastDate),
    agencyDate: dateLabel(f.agencyDate),
    buyerIdDate: dateLabel(d.buyerIdDate),
    guarantorIdDate: dateLabel(d.guarantorIdDate),
    agent: f.hasAgent ? f.agent : "",
    number: d.number,
    branch: d.numberBranch || f.branch,
    total: money(r.total),
    totalWords: words(r.total),
    deposit: money(r.deposit),
    depositWords: words(r.deposit),
    payment: money(r.payment),
    paymentWords: words(r.payment),
    last: r.last < 0 ? "-" : money(r.last),
    lastWords: r.last < 0 ? "-" : words(r.last),
    remaining: money(r.remaining),
    remainingWords: words(r.remaining),
    duration: r.duration,
    count: r.count || "",
    warrantyText: d.noWarranty
      ? ""
      : "الضمان والصيانة: يتحمل الزبون كلفة الفحص عند عدم وجود عطل مشمول بالضمان، ويلتزم بإجراء الصيانة الدورية حصراً في ورش الشركة وفق جدول الصيانات المرفق. " +
        (selectedBrand() === "deepal"
          ? "لمركبات ديبال: فحص دوري كل 5,000 كم أو 3 أشهر، وتبديل الزيت والفلتر كل 10,000 كم أو 6 أشهر، أيهما أسبق. "
          : "لمركبات شانجان: تبديل الزيت والفلتر كل 5,000 كم أو 6 أشهر، أيهما أسبق. ") +
        "يشمل الضمان الأعطال المصنعية لمدة " +
        d.warrantyYears +
        " سنوات من تاريخ تصنيع المركبة، ويُلغى في حالات سوء الاستخدام أو التعديلات غير المصرح بها أو الصيانة خارج ورش الشركة، ولا يشمل أضرار الوقود الرديء أو الحوادث.",
  };
  const values=FieldStudio.values(Services.enrichContext(result,r));
  values.number=d.number;
  return values;
}
let ctx = {};
function interpolate(template) {
  return esc(template).replace(
    /\{\{(\w+)\}\}/g,
    (_, k) => '<span class="v">' + esc(ctx[k] ?? "") + "</span>",
  );
}
function saveDraft() {
  if (!d.number && !d.recordId) return;
  Services.saveCurrent(d);
  d.updatedAt = Date.now();
  putDB("draft", clone(d))
    .then(() => ($("saveStatus").textContent = "المسودة محفوظة"))
    .catch(
      () =>
        ($("saveStatus").textContent =
          "احفظ بيانات العقد JSON؛ التخزين المحلي غير متاح"),
    );
}

const dataDefs = {
  oldVehicleInputs: [
    ["oldCar", "نوع السيارة"],
    ["oldColor", "اللون"],
    ["oldModel", "الموديل"],
    ["oldPlate", "رقم اللوحة"],
    ["oldMileage", "العداد"],
    ["oldVin", "الشاصي"],
  ],
  buyerInputs: [
    ["buyer", "اسم المشتري", "text", true],
    ["buyerId", "رقم الهوية"],
    ["buyerIdDate", "تاريخ الإصدار", "date"],
    ["buyerIdFrom", "محل الإصدار", "text", true],
    ["buyerAddress", "العنوان", "text", true],
    ["district", "محلة"],
    ["street", "زقاق"],
    ["house", "دار"],
    ["buyerPhone", "رقم الهاتف", "tel"],
  ],
  carInputs: [
    ["car", "نوع السيارة أو رقمها", "car", true],
    ["brand", "التصنيف", "brand"],
    ["color", "اللون"],
    ["model", "الموديل"],
    ["plate", "رقم اللوحة"],
    ["mileage", "العداد"],
    ["vin", "الشاصي", "text", true],
  ],
  noteInputs: [
    ["warrantyYears", "مدة الضمان / سنة", "number"],
    ["noWarranty", "خارج الضمان", "checkbox"],
  ],
  financialNotes: [["notes", "الملاحظة", "textarea", true]],
  paymentInputs: [
    ["total", "المبلغ الكلي", "money"],
    ["deposit", "المقدمة", "money"],
    ["depositDate", "تاريخ المقدمة", "date"],
  ],
  installmentInputs: [
    ["count", "عدد الأقساط مع الأخير", "number"],
    ["payment", "القسط الواحد", "money"],
    ["firstDate", "بداية الأقساط", "date"],
    ["phaseEnabled", "أقساط بمرحلتين", "checkbox", true],
    ["phasePayment", "قيمة المرحلة الأولى", "money"],
    ["phaseCount", "عدد المرحلة الأولى", "number"],
    ["phaseSecondCount", "عدد المرحلة الثانية", "number"],
  ],
  guarantorInputs: [
    ["guarantor", "اسم الكفيل", "text", true],
    ["guarantorId", "رقم الهوية"],
    ["guarantorIdDate", "تاريخ الإصدار", "date"],
    ["guarantorIdFrom", "محل الإصدار", "text", true],
    ["guarantorAddress", "العنوان", "text", true],
    ["guarantorDistrict", "محلة"],
    ["guarantorStreet", "زقاق"],
    ["guarantorHouse", "دار"],
    ["guarantorPhone", "رقم الهاتف", "tel"],
  ],
};
const fixedDefs = [
  ["organizer", "المنظم"],
  ["branch", "الفرع"],
  ["prefix", "حرف / رمز الحاسبة"],
  ["nextNumber", "بداية تسلسل الفرع الجديد", "number"],
  ["hasAgent", "إظهار بيانات الوكيل", "checkbox", true],
  ["agent", "اسم الوكيل", "text", true],
  ["agencyNo", "رقم الوكالة"],
  ["agencyDate", "تاريخ الإصدار", "date"],
  ["agencyFrom", "صادرة من", "text", true],
];
function updateInputPreview() {
  render();
  saveDraft();
}
function copyPartyAddress(key, target, input) {
  if (!["buyerAddress", "guarantorAddress"].includes(key) || input.value.trim() !== "=") return;
  const buyer = ["buyerAddress", "district", "street", "house"];
  const guarantor = ["guarantorAddress", "guarantorDistrict", "guarantorStreet", "guarantorHouse"];
  const [to, from] = key === "buyerAddress" ? [buyer, guarantor] : [guarantor, buyer];
  to.forEach((field, i) => {
    target[field] = target[from[i]] || "";
    if ($(field)) $(field).value = target[field];
  });
}
function buildFields(where, defs, target, onChange) {
  $(where).replaceChildren();
  for (const [key, title, type = "text", full = false] of defs) {
    const label = document.createElement("label");
    if (full) label.className = "full";
    const text = document.createElement("span");
    text.textContent = title;
    let input = document.createElement(
      type === "textarea" ? "textarea" : type === "brand" ? "select" : "input",
    );
    input.id = target === cfg.fixed ? "fixed-" + key : key;
    input.dataset.field = key;
    if (input.id === "brand") input.tabIndex = -1;
    if (type === "brand")
      for (const [value, text] of [
        ["auto", "تلقائي"],
        ["changan", "شانجان"],
        ["deepal", "ديبال"],
      ]) {
        input.add(new Option(text, value));
      }
    else if (type !== "textarea") {
      input.type = ["money", "car"].includes(type) ? "text" : type;
      if (type === "money") input.inputMode = "numeric";
      if (type === "number") {
        input.min = "0";
        input.step = "1";
      }
    }
    if (type === "car") Workspace.bindCar(input);
    if (type === "checkbox") {
      input.checked = !!target[key];
      label.className += " check";
    } else input.value = target[key] ?? "";
    if (type === "textarea") {
      input.rows = 3;
      input.maxLength = 330;
    }
    if (key === "prefix") input.maxLength = 4;
    input.addEventListener("change", () => {
      copyPartyAddress(key, target, input);
      const val = type === "checkbox" ? input.checked : input.value;
      target[key] = val;
      Services.fieldChanged(key, input);
      onChange(key);
    });
    if (type === "car") input.addEventListener("blur", resolveCar);
    label.append(text, input);
    $(where).append(label);
  }
}
function buildInputs() {
  const focused = document.activeElement;
  if (focused?.matches("input,select,textarea") && focused.closest("#fillPanel")) focused.blur();
  FillLayout.restorePositions();
  delete $("installmentInputs").dataset.phaseOrder;
  $("paymentActions").querySelector("label:has(#phaseEnabled)")?.remove();
  if($("customerPhotoTools")) {delete $("customerPhotoTools").dataset.fillIndependent;$("buyerCard").append($("customerPhotoTools"));}
  const companyField=$("companySelect")?.closest("label");
  if(companyField) $("carCard").querySelector(".card-heading").append(companyField);

  ContractTemplates.list($("archiveContractType"));
  $("archiveContractType").value = ContractTemplates.find()?.id || d.contractType || "installment";
  $("archiveContractType").onchange = (e) => {
    App.commitText();
    const template = ContractTemplates.find(e.target.value);
    d.templateId = template?.id || "";
    d.contractType = template?.baseType || e.target.value;
    if (template) d.pages = [...new Set([...d.pages, ...template.pages.map(p=>p.id).filter(id=>id>0)])];
    App.selection.clear();
    App.cells = [];
    App.tableId = null;
    buildInputs();
    $("pagePreview").value = "1";
    App.page = 1;
    $("canvas").scrollTop = 0;
    render();
  };
  for (const [where, defs] of Object.entries(dataDefs))
    buildFields(where, defs, d, updateInputPreview);
  const exchange = d.contractType === "exchange";
  $("cards").classList.toggle("exchange-form", exchange);
  $("oldVehiclePanel").hidden = !exchange;
  $("vehicleHeading").textContent = exchange ? "السيارة الجديدة" : "المركبة";
  buildFields("fixedInputs", fixedDefs, cfg.fixed, () => {
    scheduleConfig();
    render();
  });
  $("contractDate").value = d.contractDate;
  $("contractTime").value = d.contractTime;
  renderExtraInputs();
  Cash.buildInputs();
  companyOptions();
  renderCatalogOptions();
  Services.decorateForm();
  External.build();
  EditorEnhancements.exchangeFields();
  FieldStudio.applyForm();
  FillDesigner.syncGuarantor();
}
function renderExtraInputs() {
  $("extraEditors").replaceChildren();
  d.extras = d.extras.slice(0, 4);
  while (d.extras.length < 4)
    d.extras.push({ label: "دفعة إضافية", amount: "", date: today() });
  d.extras.forEach((x, i) => {
    const row = document.createElement("div");
    row.className = "extra-card";
    for (const [k, type, label] of [
      ["label", "text", "عنوان الدفعة " + (i + 1)],
      ["amount", "text", "المبلغ"],
      ["date", "date", "التاريخ"],
    ]) {
      const input = document.createElement("input");
      input.type = type;
      input.id = "extra-"+k+"-"+i;
      input.value = x[k] || "";
      input.placeholder = label;
      input.setAttribute("aria-label", label);
      input.onchange = () => {
        x[k] = input.value;
        x.enabled = amount(x.amount) > 0;
        render();
      };
      if (k === "label") {
        const field=document.createElement("label"),caption=document.createElement("span");
        field.className="extra-title-field";caption.textContent="عنوان الدفعة";field.append(caption,input);row.append(field);
      } else {
        const field = document.createElement("label");
        const caption = document.createElement("span");
        caption.textContent = k === "amount" ? "قيمة الدفعة " + (i + 1) : "تاريخها";
        if (k === "amount") input.inputMode = "numeric";
        field.append(caption, input);
        if(k==="amount")Workspace.addRemovePayment(field,i,false);
        row.append(field);
      }
    }
    $("extraEditors").append(row);
  });
}

function companyOptions() {
  for (const id of ["companySelect", "settingsCompany"]) {
    $(id).replaceChildren();
    const options=Cloud.formsReady && id==="companySelect"?Cloud.account.companies.filter(c=>!["sales","finance"].includes(c.department)):cfg.companies;
    for (const c of options) $(id).add(new Option(c.name, c.id));
    $(id).value = d.companyId;
  }
  fillCompany();
}
function fillCompany() {
  const c =
    cfg.companies.find((c) => c.id === $("settingsCompany").value) || co();
  const defs = [
    ["editCompanyName", "اسم الشركة", c.name],
    ["editCompanyFull", "الاسم الكامل", c.fullName || ""],
    ["editCompanyManager", "المدير المفوض", c.manager],
    [
      "editTransferAddressee",
      "المخاطَب في كتاب نقل الملكية",
      c.transferAddressee || "",
    ],
    ["editCompanyAddress", "العنوان", c.address || ""],
    ["editCompanyPhone", "الهاتف", c.phone || ""],
  ];
  $("companyInputs").innerHTML = defs
    .map(
      ([id, label, value]) =>
        '<label class="full">' +
        esc(label) +
        '<input id="' +
        id +
        '" value="' +
        esc(value) +
        '"></label>',
    )
    .join("");
  Services.companyPanel();
}
function renderCatalogOptions() {
  if ($("carChoices").matches(":popover-open")) Workspace.showCars($("car"));
}
function renderCatalog() {
  $("catalogRows").innerHTML = cfg.cars
    .map(
      (c, i) =>
        '<tr data-car-index="' +
        i +
        '"><td><input data-k="order" type="number" min="1" value="' +
        c.order +
        '" style="width:45px"></td><td><input data-k="name" value="' +
        esc(c.name) +
        '"></td><td><select data-k="brand"><option value="changan" ' +
        (c.brand === "changan" ? "selected" : "") +
        '>شانجان</option><option value="deepal" ' +
        (c.brand === "deepal" ? "selected" : "") +
        '>ديبال</option></select></td><td><input data-k="cargo" type="checkbox" aria-label="مركبة حمل" ' +
        (c.cargo ? "checked" : "") + '></td><td><button data-remove-car="' +
        i +
        '">×</button></td></tr>',
    )
    .join("");
}

function normalizeConfig(c) {
  if (c && typeof c === "object") delete c.pin;
  if (!c || !Array.isArray(c.companies) || !c.companies.length)
    throw Error("إعدادات شركات غير صالحة");
  for (const company of c.companies)
    if (
      company.id === "imad" &&
      /والوكالات التجارية/.test(company.fullName || "")
    )
      company.fullName = company.fullName.replace(
        "والوكالات التجارية",
        "وتجارة السيارات",
      );
  c.companies = c.companies.map((x) => ({
    ...x,
    id: String(x.id),
    name: String(x.name),
    manager: String(x.manager || ""),
    background: safeImage(x.background),
    imageValues: Object.fromEntries(
      Object.entries(x.imageValues || {}).map(([key, value]) => [
        key,
        safeImage(value),
      ]),
    ),
  }));
  for (const values of Object.values(c.vehicleImages || {}))
    for (const key of Object.keys(values)) values[key] = safeImage(values[key]);
  for (const item of c.vehicleImageHistory || [])
    item.src = safeImage(item.src);
  for (const key of Object.keys(c.assets || {}))
    c.assets[key] = safeImage(c.assets[key]);
  c.fixed = { ...seed.config.fixed, ...c.fixed };
  c.extraPages = (c.extraPages || []).filter(
    (p) => Number.isInteger(p.id) && p.id > 8,
  );
  c.objects = (c.objects || []).filter(
    (o) =>
      Number.isInteger(o.page) &&
      ["image", "rect", "ellipse", "round", "line"].includes(o.type),
  );
  for (const o of c.objects) if (o.type === "image") o.src = safeImage(o.src);
  c.edits = c.edits || {};
  c.content = c.content || {};
  c.custom = (c.custom || []).filter(
    (x) =>
      Number.isInteger(x.page) &&
      x.page >= 1 &&
      (x.page <= 8 || (c.extraPages || []).some((p) => p.id === x.page)),
  );
  c.cars = c.cars || clone(seed.config.cars);
  c.clauses = c.clauses || clone(seed.config.clauses);
  c.assets = { ...seed.config.assets, ...c.assets };
  FillLayout.upgrade(c.design);
  if (c.design?.version === 6) arrangeBillPages(c.design);
  return c;
}
function normalizeData(raw) {
  if(raw) {raw={...raw};delete raw.guarantorJob;}
  const result = fresh();
  if (!raw || typeof raw !== "object") return result;
  for (const k of Object.keys(result)) {
    if (["extras", "pages", "cashPayments"].includes(k)) continue;
    if (typeof result[k] === "boolean") {
      if (k in raw) result[k] = raw[k] === true;
    } else if (typeof raw[k] === "string" || typeof raw[k] === "number")
      result[k] = raw[k];
  }
  for (const key of ["extraSlotsShown", "cashSlotsShown"])
    if (raw[key] !== undefined)
      result[key] = Math.min(4, Math.max(0, Math.trunc(Number(raw[key])) || 0));
  if (
    raw.bookValues &&
    typeof raw.bookValues === "object" &&
    !Array.isArray(raw.bookValues)
  )
    result.bookValues = Object.fromEntries(
      Object.entries(raw.bookValues).filter(
        ([k, v]) =>
          /^[a-zA-Z][a-zA-Z0-9_]{0,100}$/.test(k) && (typeof v === "string" || typeof v === "boolean"),
      ),
    );
  if (
    raw.tableData &&
    typeof raw.tableData === "object" &&
    !Array.isArray(raw.tableData)
  )
    result.tableData = Object.fromEntries(
      Object.entries(raw.tableData)
        .filter(([k, v]) => Array.isArray(v))
        .slice(0, 100)
        .map(([k, rows]) => [
          k,
          rows
            .slice(0, 2000)
            .filter((r) => r && typeof r === "object")
            .map((r) => ({
              ...Object.fromEntries(
                [
                  "trim",
                  "model",
                  "type",
                  "specs",
                  "qty",
                  "price",
                  "fuel",
                  "attachments",
                  "notes",
                ]
                  .filter(
                    (k) => typeof r[k] === "string" || typeof r[k] === "number",
                  )
                  .map((k) => [k, r[k]]),
              ),
              ...(r.priceLink &&
              typeof r.priceLink.catalog === "string" &&
              typeof r.priceLink.item === "string"
                ? {
                    priceLink: {
                      catalog: r.priceLink.catalog,
                      item: r.priceLink.item,
                    },
                  }
                : {}),
            })),
        ]),
    );
  if (Array.isArray(raw.extras))
    result.extras = raw.extras.slice(0, 4).map((x) => ({
      enabled: x?.enabled === true,
      label: String(x?.label || "دفعة إضافية"),
      amount: String(x?.amount || ""),
      date: String(x?.date || today()),
    }));
  while (result.extras.length < 4)
    result.extras.push({
      enabled: false,
      label: "دفعة إضافية",
      amount: "",
      date: today(),
    });
  if (Array.isArray(raw.pages))
    result.pages = [
      ...new Set(
        raw.pages.filter(
          (n) =>
            Number.isInteger(n) &&
            n >= 1 &&
            (n <= 8 || (cfg.extraPages || []).some((p) => p.id === n) || ContractTemplates.find(result.templateId)?.pages.some(p=>p.id===n)),
        ),
      ),
    ];
  if (!cfg.companies.some((c) => c.id === result.companyId))
    result.companyId = cfg.companies[0].id;
  result.customerPhoto = safeImage(result.customerPhoto);
  Object.assign(result, cashTerms(raw));
  return result;
}
async function allocateNumber() {
  const prefix = String(cfg.fixed.prefix || "").trim();
  const branch=String(cfg.fixed.branch || "").trim();
  const key="offline-counter:"+branch;
  let floor=Math.max(1,Math.floor(Number(cfg.fixed.nextNumber)||1));
  try{floor=Math.max(floor,Number(localStorage.getItem(KEY+"-sequence-"+prefix))||0);}catch{}
  for(const {data} of Services.library.entries){
    if(data.numberBranch && data.numberBranch!==branch)continue;
    const match=normalizeDigits(data.number).match(/(?:^|-)(\d{1,9})(?:-F)?$/);
    if(match)floor=Math.max(floor,Number(match[1])+1);
  }
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("store","readwrite"),store=tx.objectStore("store"),read=store.get(key);
    let number;
    read.onsuccess=()=>{
      number=Math.max(floor,Number(read.result)||1);
      if(!Number.isSafeInteger(number) || number>999999999){tx.abort();return;}
      store.put(number+1,key);
    };
    tx.oncomplete=()=>resolve((prefix?prefix+"-":"")+number);
    tx.onabort=()=>reject(Error("تعذّر حجز العدد المحلي."));
  });
}
function reserveNumber(number) {
  const prefix = String(cfg.fixed.prefix || "").trim();
  const raw = String(number || "").replace(/-F$/i,"");
  const n = Number(
    prefix
      ? raw.startsWith(prefix + "-")
        ? raw.slice(prefix.length + 1)
        : NaN
      : raw,
  );
  if (Number.isSafeInteger(n) && n > 0) {
    const key = KEY + "-sequence-" + prefix;
    try {
      localStorage.setItem(
        key,
        String(Math.max(n + 1, Number(localStorage.getItem(key)) || 0)),
      );
    } catch {}
  }
}
function newContract() {
  return Services.createContract();
}
function scheduleConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveConfig().catch((e) => ($("saveStatus").textContent = e.message));
  }, 900);
}
async function saveConfig(approvedScope) {
  const saved = clone(cfg);
  saved.updatedAt = Date.now();
  cfg.updatedAt = saved.updatedAt;
  SharedDefaults.pendingWrites++;
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const prev = await getDB("config");
      if (prev) {
        let backups = (await getDB("backups")) || [];
        backups.unshift({
          id: Date.now() + "-" + Math.random().toString(16).slice(2),
          time: new Date().toISOString(),
          config: prev,
          data: clone(d),
        });
        await putDB("backups", backups.slice(0, 10));
      }
      await SharedDefaults.publish(saved,approvedScope);
      try{
        await putDB("config", saved);
        await refreshBackups();
      }catch(error){
        if(!approvedScope)throw error;
        console.warn("Approved design was saved on the host. Local cache update failed.",error);
      }
    }).finally(()=>{SharedDefaults.pendingWrites--;});
  return writeQueue;
}
function settingsJSON(config = cfg, data = fresh()) {
  const layout = clone(config);
  delete layout.pin;
  return JSON.stringify({ schemaVersion: 4, layout, data });
}

function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
async function refreshBackups() {
  const list = (await getDB("backups")) || [];
  $("backupList").replaceChildren();
  for (const b of list)
    $("backupList").add(
      new Option(new Date(b.time).toLocaleString("ar-IQ"), b.id),
    );
  $("backupStatus").textContent = list.length + " نسخة محفوظة في هذا المتصفح";
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(Error("اختر صورة"));
    if (file.size > 12000000)
      return reject(Error("الصورة كبيرة؛ استخدم صورة أقل من 12 ميغابايت."));
    const r = new FileReader();
    r.onload = () => {
      try {
        resolve(safeImage(r.result));
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(Error("تعذر قراءة الصورة"));
    r.readAsDataURL(file);
  });
}
function overflowIssues() {
  const issues = [];
  document.querySelectorAll(".paper").forEach((p) => {
    if (!Schedule.enabled(Number(p.dataset.page))) return;
    const rect = p.getBoundingClientRect();
    for (const e of p.querySelectorAll(
      ".left-column,.contract-warranty,.note-body,.body-sheet,.bill,[data-edit],[data-object]",
    )) {
      if (e.closest(".inactive") || e.classList.contains("hidden-edit"))
        continue;
      const er = e.getBoundingClientRect();
      if (
        (e.clientHeight > 0 &&
          e.scrollHeight > e.clientHeight + 3 &&
          e.matches(
            ".left-column,.contract-warranty,.note-body,.body-sheet",
          )) ||
        er.right > rect.right + 2 ||
        er.left < rect.left - 2 ||
        er.bottom > rect.bottom + 2 ||
        er.top < rect.top - 2
      ) {
        issues.push(
          "الصفحة " +
            p.dataset.page +
            ": نص يتجاوز مساحته. قلل حجمه أو عدل مكانه.",
        );
        break;
      }
    }
  });
  return [...new Set(issues)];
}
function applyContentOrder() {
  document.querySelectorAll("#pages [data-edit]").forEach((el) => {
    const p = el.parentElement;
    if (p && !p.dataset.orderParent) {
      const page = el.closest(".paper")?.dataset.page || "0";
      p.dataset.orderParent =
        page +
        "-" +
        String(p.className || p.tagName).replace(/[^a-zA-Z0-9_-]/g, "_");
    }
  });
  for (const [parentKey, ids] of Object.entries(cfg.contentOrder || {})) {
    const parent = document.querySelector(
      '[data-order-parent="' + CSS.escape(parentKey) + '"]',
    );
    if (!parent) continue;
    for (const id of ids) {
      const child = parent.querySelector(
        ':scope > [data-edit="' + CSS.escape(id) + '"]',
      );
      if (child) parent.appendChild(child);
    }
  }
}
function unchangedPrintFields() {
  const book = !!d.standaloneBook;
  const external = !book && d.contractType === "external";
  const exchange = !book && d.contractType === "exchange";
  const company = book ? "bookCompany" : "companySelect";
  const root = $(book ? "bookFields" : "cards");
  const visible = input => input && root?.contains(input) && input.getClientRects().length &&
    !input.closest("[hidden],[inert]") && getComputedStyle(input).visibility === "visible";
  const candidates = external
    ? [["externalBuyer", "اسم المشتري"], ["externalSeller", "اسم البائع"]]
    : [["buyer", "اسم الزبون"], ["guarantor", "اسم الكفيل"]];
  candidates.push(
    ["car", exchange ? "نوع السيارة الجديدة" : "نوع السيارة"],
    ["vin", exchange ? "شاصي السيارة الجديدة" : "الشاصي"],
    ["plate", exchange ? "لوحة السيارة الجديدة" : "اللوحة"],
  );
  if (exchange) candidates.push(["oldCar", "نوع السيارة القديمة"], ["oldVin", "شاصي السيارة القديمة"], ["oldPlate", "لوحة السيارة القديمة"]);
  candidates.push(["total", "المبلغ الكلي"], ["cashReceived", "الواصل"], ["deposit", "الواصل"]);
  const names = new Set();
  for (const [key, label] of candidates) {
    if (external && ["externalBuyer","externalSeller"].includes(key) && d[key + "Company"]) continue;
    const field = $(book ? "bookInput-" + key : key);
    if (visible(field) && !field.value.trim()) names.add(label);
  }
  const companyInput = $(company);
  const initialCompany = d.initialCompanyId || cfg.companies[0]?.id;
  if (visible(companyInput) && (companyInput.value === initialCompany || !companyInput.value) &&
      !(external && (d.externalBuyerCompany || d.externalSellerCompany))) names.add("الشركة");
  return [...names];
}

function bindEvents() {
  $("newContract").onclick = newContract;
  $("contractDate").onchange = () => {
    d.manualContractDate = !!$("contractDate").value;
    Services.dateChanged($("contractDate").value || today());
  };
  $("contractTime").onchange = () => {
    d.manualContractTime = !!$("contractTime").value;
    d.contractTime = $("contractTime").value || timeNow();
    render();
  };
  $("companySelect").onchange = async () => {
    if(Cloud.enabled && $("companySelect").value!==Cloud.company.id){
      const next=$("companySelect").value;$("companySelect").value=d.companyId;
      try{
        if(!d.recordId)return await Cloud.switchCompany(next);
        Services.saveCurrent(d);await Services.flush();
        await Cloud.call("move_contract",{record:d.recordId,version:Cloud.versions.get(d.recordId),destination:next});
        sessionStorage.setItem("open-company-draft",d.recordId);sessionStorage.setItem("contract-company",next);location.reload();
      }catch(error){await Feedback.notice(error.message);}return;
    }
    d.companyId = $("companySelect").value;
    $("settingsCompany").value = d.companyId;
    fillCompany();
    render();
  };
  $("settingsCompany").onchange = fillCompany;
  $("previewToggle").onclick = () => {
    document.body.classList.toggle("preview-only");
    $("previewToggle").textContent = document.body.classList.contains(
      "preview-only",
    )
      ? "إظهار المدخلات"
      : "إخفاء المدخلات";
  };
  $("pagePreview").onchange = () => App.changePage();
  $("openSettings").onclick = () => {
    $("appMenu").hidden = true;
    $("cards").hidden = false;
    $("settingsDrawer").hidden = false;
    $("shade").hidden = false;
    renderCatalog();
    Images.vehiclePanel();
    refreshBackups();
  };
  $("closeSettings").onclick = $("shade").onclick = () => {
    $("settingsDrawer").hidden = true;
    $("shade").hidden = true;
  };
  $("saveData").onclick = () =>
    download(
      "contract-" + d.number + ".json",
      JSON.stringify(
        {
          schemaVersion: 4,
          data: d,
          layout: {
            companies: cfg.companies,
            companyFields: cfg.companyFields,
            companyImageSlots: cfg.companyImageSlots,
            vehicleImageSlots: cfg.vehicleImageSlots,
            vehicleImages: cfg.vehicleImages,
            vehicleImageHistory: cfg.vehicleImageHistory,
            imageSeparationVersion: cfg.imageSeparationVersion,
            formulas: cfg.formulas,
            cars: cfg.cars,
            assets: cfg.assets,
            design: cfg.design || null,
            tables: cfg.tables || [],
            frames: cfg.frames || {},
            extraPages: cfg.extraPages || [],
            objects: cfg.objects || [],
            custom: cfg.custom,
            edits: cfg.edits,
            content: cfg.content,
            variableLabels: cfg.variableLabels || {},
          },
        },
        null,
        2,
      ),
      "application/json",
    );
  $("loadData").onclick = () => $("dataFile").click();
  $("dataFile").onchange = async () => {
    try {
      const file = $("dataFile").files[0];
      if (!file) return;
      const v = JSON.parse(await file.text());
      if (![3, 4].includes(v.schemaVersion)) throw Error("إصدار ملف غير معروف");
      if (!(await Feedback.ask("استبدال بيانات العقد الحالي؟"))) return;
      Services.saveCurrent(d);
      await Services.flush();
      if (App.mode === "design") App.leave();
      const nextConfig = v.layout ? normalizeConfig({ ...cfg, ...v.layout }) : cfg;
      const imported=normalizeData(v.data);
      imported.numberBranch ||= nextConfig.fixed.branch;
      await BranchNumbers.imported(imported,v.origin==="offline");
      cfg=nextConfig;
      d=v.layout ? normalizeData({...v.data,recordId:imported.recordId,number:imported.number,
        numberBranch:imported.numberBranch,offlineNumber:imported.offlineNumber}) : imported;
      reserveNumber(d.number);
      Services.ensureSchemas();
      Images.ensure();
      Services.home = false;
      document.body.classList.remove("home-mode");
      $("homeScreen").hidden = true;
      $("appMenu").hidden = true;
      buildInputs();
      render();
    } catch (e) {
      Feedback.notice(e.message);
    } finally {
      $("dataFile").value = "";
    }
  };
  $("exportHTML").onclick = () =>
    download("contract-settings.json", settingsJSON(), "application/json");
  $("saveCompany").onclick = () => {
    try {
      const c = cfg.companies.find((c) => c.id === $("settingsCompany").value);
      if (!c) return;
      c.name = $("editCompanyName").value.trim();
      c.fullName = $("editCompanyFull").value.trim();
      c.manager = $("editCompanyManager").value;
      c.transferAddressee = $("editTransferAddressee").value.trim();
      c.address = $("editCompanyAddress").value;
      c.phone = $("editCompanyPhone").value;
      if (!c.name) throw Error("اسم الشركة مطلوب");
      companyOptions();
      render();
      scheduleConfig();
    } catch (e) {
      Feedback.notice(e.message);
    }
  };
  $("addCompany").onclick = () => {
    const c = {
      id: "c" + Date.now(),
      name: "شركة جديدة",
      fullName: "",
      manager: "",
      background: "",
      address: "",
      phone: "",
    };
    cfg.companies.push(c);
    d.companyId = c.id;
    companyOptions();
    render();
    scheduleConfig();
  };
  $("deleteCompany").onclick = async () => {
    if (cfg.companies.length === 1)
      return Feedback.notice("يجب الإبقاء على شركة واحدة");
    const id = $("settingsCompany").value;
    if (!(await Feedback.ask("حذف الشركة من القائمة؟"))) return;
    cfg.companies = cfg.companies.filter((c) => c.id !== id);
    if (d.companyId === id) d.companyId = cfg.companies[0].id;
    companyOptions();
    render();
    scheduleConfig();
  };
  $("addCar").onclick = () => {
    cfg.cars.push({
      order: Math.max(0, ...cfg.cars.map((c) => c.order)) + 1,
      name: "سيارة جديدة",
      brand: "changan",
      aliases: [],
    });
    renderCatalog();
  };
  $("catalogRows").onclick = (e) => {
    const b = e.target.closest("[data-remove-car]");
    if (b) {
      cfg.cars.splice(Number(b.dataset.removeCar), 1);
      renderCatalog();
    }
  };
  $("saveCatalog").onclick = () => {
    const arr = [...$("catalogRows").querySelectorAll("tr")].map((tr) => {
      const old = cfg.cars[Number(tr.dataset.carIndex)];
      return {
        ...old,
        order: Number(tr.querySelector("[data-k=order]").value),
        name: tr.querySelector("[data-k=name]").value.trim(),
        brand: tr.querySelector("[data-k=brand]").value,
        cargo: tr.querySelector("[data-k=cargo]").checked,
      };
    });
    if (
      arr.some((c) => !Number.isInteger(c.order) || c.order < 1 || !c.name) ||
      new Set(arr.map((c) => c.order)).size !== arr.length
    )
      return Feedback.notice(
        "استخدم أرقام ترتيب صحيحة وغير مكررة وأسماء غير فارغة.",
      );
    cfg.cars = arr;
    Images.ensure();
    renderCatalogOptions();
    Images.vehiclePanel();
    render();
    scheduleConfig();
  };
  $("saveBound").onclick = async () => {
    try {
      await saveConfig();
      $("fileStatus").textContent = "حُفظت الإعدادات في هذا المتصفح";
    } catch (error) {
      Feedback.notice(error.message);
    }
  };
  $("restoreBackup").onclick = async () => {
    const b = ((await getDB("backups")) || []).find(
      (x) => x.id === $("backupList").value,
    );
    if (!b || !(await Feedback.ask("استعادة الإعدادات والعقد من هذه النسخة؟")))
      return;
    cfg = normalizeConfig(clone(b.config));
    d = normalizeData(b.data);
    reserveNumber(d.number);
    await putDB("config", cfg);
    buildInputs();
    render();
  };
  $("downloadBackup").onclick = async () => {
    const b = ((await getDB("backups")) || []).find(
      (x) => x.id === $("backupList").value,
    );
    if (b)
      download(
        "contract-backup.json",
        settingsJSON(b.config, b.data),
        "application/json",
      );
  };
  $("printAll").onclick = async () => {
    const selected=d;
    if (document.activeElement?.closest("#fillPanel, #toolbar")) document.activeElement.blur();
    Services.refreshPrintClock();
    App.commitText();
    const unchanged = unchangedPrintFields();
    const reminder = unchanged.length ? "الخانات اللي ما تغيّرت:\n• " + unchanged.join("\n• ") : "";
    const r = calculate(d);
    const blockers = [];
    if (!App.displayPages.some(p => Schedule.enabled(p.id))) blockers.push("اختر صفحة واحدة على الأقل");
    if (!d.standaloneBook) {
      if (Array.isArray(cfg.requiredFields)) {
        Workspace.markMissing(r);
        const required = [...$("cards").querySelectorAll(".missing-value")].filter(el =>
          !el.closest("[hidden],[inert]") && el.getClientRects().length);
        if (required.length) {
          const labels = new Set(required.map(el => el.getAttribute("aria-label") ||
            el.closest("label")?.textContent.trim() || el.placeholder));
          blockers.push("أكمل الخانات الأساسية: " + [...labels].join("، "));
        }
      }
      blockers.push(...r.errors, ...Services.formulaErrors);
      if (d.car && d.brand === "auto" && !detectBrand(d.car)) blockers.push("حدد تصنيف السيارة قبل الطباعة");
    }
    if (blockers.length) return Feedback.notice([reminder, blockers.join("\n")].filter(Boolean).join("\n\n"));
    const old = $("pagePreview").value;
    $("pagePreview").value = "all";
    applyPageVisibility();
    const overflow = overflowIssues();
    if (overflow.length) {
      $("pagePreview").value = old;
      applyPageVisibility();
      return Feedback.notice([reminder, overflow.join("\n")].filter(Boolean).join("\n\n"));
    }
    const missing = reminder ? [reminder] : [];
    if (!d.standaloneBook && Schedule.enabled(2) && !Images.source({ binding: "receipt" }))
      missing.push("صورة الصفحة الثانية لم تضف");
    if (!d.standaloneBook && Schedule.enabled(5) && !Images.source({ binding: "maintenance" }))
      missing.push("صورة الصيانة لم تضف");
    if (
      missing.length &&
      !(await Feedback.ask(
        missing.join("\n") + "\nطباعة النموذج بالوضع الحالي؟",
      ))
    ) {
      $("pagePreview").value = old;
      applyPageVisibility();
      return;
    }
    try{
      if(d!==selected)throw Error("تغيّر المستند المفتوح. اختر طباعة من المستند المطلوب.");
      await BranchNumbers.verify(d);
      if(d!==selected)throw Error("تغيّر المستند المفتوح. اختر طباعة من المستند المطلوب.");
      BranchNumbers.printing=BranchNumbers.signature(d);
      window.print();
    }catch(error){await Feedback.notice(error.message);}
    finally{if(!App.printing)BranchNumbers.printing=null;}
    $("pagePreview").value = old;
    applyPageVisibility();
  };
}
