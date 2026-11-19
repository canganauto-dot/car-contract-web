function T(key, template, tag = "span", cls = "") {
  cfg.content = cfg.content || {};
  if (!(key in cfg.content)) cfg.content[key] = template;
  const base = cfg.content[key];
  const ov = cfg.edits[key] || {},
    text = ov.text ?? base;
  return (
    "<" +
    tag +
    ' class="' +
    cls +
    '" data-edit="' +
    esc(key) +
    '" data-template="' +
    esc(text) +
    '">' +
    interpolate(text) +
    "</" +
    tag +
    ">"
  );
}
function F(k, label, token = k) {
  return (
    '<span class="subfield">' +
    T("label-" + k, label, "span", "label") +
    T("value-" + k, "{{" + token + "}}", "span", "value") +
    "</span>"
  );
}
function line(...items) {
  return '<div class="line">' + items.join("") + "</div>";
}
function vehicleTable(prefix) {
  return (
    '<table class="vehicle-table">' +
    [
      ["نوع السيارة", "car", "اللون", "color"],
      ["الموديل", "model", "رقم اللوحة", "plate"],
      ["الشاصي", "vin", "العداد", "mileage"],
    ]
      .map(
        (r, i) =>
          "<tr><th>" +
          T(prefix + "-label-" + i + "a", r[0]) +
          "</th><td>" +
          T(prefix + "-" + r[1], "{{" + r[1] + "}}") +
          "</td><th>" +
          T(prefix + "-label-" + i + "b", r[2]) +
          "</th><td>" +
          T(prefix + "-" + r[3], "{{" + r[3] + "}}") +
          "</td></tr>",
      )
      .join("") +
    "</table>"
  );
}
function formLayer(mode) {
  const bg = safeImage(co().background);
  if (!bg) return "";
  return mode === "header"
    ? '<div class="header-crop"><img src="' + bg + '" alt=""></div>'
    : '<img class="form-background" src="' + bg + '" alt="">';
}
function page(n, body, form = "") {
  return (
    '<article class="paper ' +
    (form ? "" : "plain-sheet") +
    '" data-page="' +
    n +
    '">' +
    (form ? formLayer(form) : "") +
    body +
    "</article>"
  );
}
function contract() {
  const clauses = cfg.clauses
    .map(
      (c) =>
        "<li>" +
        T("clause-head-" + c.id, c.title, "b") +
        " " +
        T("clause-body-" + c.id, c.body) +
        "</li>",
    )
    .join("");
  const extra = d.extras
    .slice(0, 4)
    .map(
      (x, i) =>
        '<div class="money-row dated extra-slot ' +
        (amount(x.amount) > 0 ? "" : "inactive") +
        '">' +
        T("extra-label-" + i, x.label, "span", "label") +
        T("extra-money-" + i, money(amount(x.amount)), "span", "amount-box") +
        T("extra-words-" + i, words(amount(x.amount)), "span", "words-box") +
        T("extra-date-" + i, dateLabel(x.date), "span", "date-box") +
        "</div>",
    )
    .join("");
  return page(
    1,
    '<div class="page-meta">' +
      T("meta-organizer", "المنظم: {{organizer}} · الفرع: {{branch}}") +
      T("meta-number", "العدد: {{number}} · {{date}}") +
      "</div>" +
      T(
        "contract-title",
        "عقد بيع وشراء سيارات بالتقسيط",
        "div",
        "contract-title",
      ) +
      '<div class="columns"><div class="right-column">' +
      '<section class="block">' +
      T(
        "seller-intro",
        "الطرف الأول: {{manager}} - المدير المفوض لـ{{company}} إضافة لوظيفته",
        "p",
        "seller-line",
      ) +
      line(
        F("sellerAddress", "العنوان:", "address"),
        F("sellerPhone", "الهاتف:", "phone"),
      ) +
      "</section>" +
      '<section class="block" style="visibility:' +
      (cfg.fixed.hasAgent ? "visible" : "hidden") +
      '">' +
      line(F("agent", "اسم الوكيل:")) +
      line(F("agencyNo", "رقم الوكالة:"), F("agencyDate", "تاريخ الإصدار:")) +
      line(F("agencyFrom", "صادرة من:")) +
      "</section>" +
      '<section class="block">' +
      line(F("buyer", "الطرف الثاني:")) +
      line(F("buyerId", "رقم الهوية:"), F("buyerIdDate", "تاريخ الإصدار:")) +
      line(F("buyerIdFrom", "محل الإصدار:")) +
      line(F("buyerAddress", "العنوان:")) +
      line(F("district", "محلة:"), F("street", "زقاق:"), F("house", "دار:")) +
      line(F("buyerPhone", "رقم الهاتف:")) +
      "</section>" +
      '<section class="block">' +
      line(F("car", "نوع السيارة:")) +
      line(F("color", "اللون:"), F("model", "الموديل:")) +
      line(F("plate", "رقم اللوحة:"), F("mileage", "العداد:")) +
      line(F("vin", "الشاصي:")) +
      "</section>" +
      '<section class="money-block">' +
      '<div class="money-row">' +
      T("total-label", "المبلغ الكلي:", "span", "label") +
      T("total", "{{total}}", "span", "amount-box") +
      T("totalWords", "{{totalWords}}", "span", "words-box") +
      "</div>" +
      '<div class="money-row dated">' +
      T("deposit-label", "المقدمة:", "span", "label") +
      T("deposit", "{{deposit}}", "span", "amount-box") +
      T("depositWords", "{{depositWords}}", "span", "words-box") +
      T("depositDate", "{{depositDate}}", "span", "date-box") +
      "</div>" +
      '<div id="extraPrinted">' +
      extra +
      "</div>" +
      T(
        "installmentIntro",
        "تدفع أقساط مع القسط الأخير عددها {{count}} تبدأ بتاريخ: {{firstDate}} بقيم كما موضح أدناه:",
        "p",
        "installment-intro",
      ) +
      '<div class="money-row">' +
      T("payment-label", "القسط الواحد:", "span", "label") +
      T("payment", "{{payment}}", "span", "amount-box") +
      T("paymentWords", "{{paymentWords}}", "span", "words-box") +
      "</div>" +
      '<div class="money-row">' +
      T("last-label", "القسط الأخير:", "span", "label") +
      T("last", "{{last}}", "span", "amount-box") +
      T("lastWords", "{{lastWords}}", "span", "words-box") +
      "</div>" +
      T(
        "last-date",
        "يسدد القسط الأخير بتاريخ: {{lastDate}}",
        "p",
        "last-date-line",
      ) +
      "</section>" +
      T(
        "agreement",
        "لرغبة الطرف الثاني بشراء المركبة العائدة إلى الطرف الأول بنظام الأقساط بمدة محددة قدرها ({{duration}}) وكالآتي: مقدمة وأقساط ودفعة أخيرة.",
        "p",
        "agreement",
      ) +
      '</div><div class="left-column"><ol class="clauses">' +
      clauses +
      "</ol></div></div>" +
      T("warranty", "{{warrantyText}}", "div", "contract-warranty") +
      '<div class="contract-notes">' +
      T("notes", "{{notes}}", "span", "note-body") +
      "</div>" +
      '<div class="signatures"><div class="buyer-sign">' +
      T("sig-buyer-label", "الطرف الثاني (المشتري)") +
      T("sig-buyer", "{{buyer}}", "p", "signature-name") +
      "</div><div>" +
      T("finger-label", "بصمة الإبهام الأيسر") +
      '<div class="fingerprint"></div></div><div>' +
      T("sig-seller-label", "الطرف الأول (البائع)") +
      T("sig-manager", "{{manager}}", "p", "signature-name") +
      T("sig-seller-role", "المدير المفوض إضافة لوظيفته", "p") +
      T("sig-agent", "{{agent}}", "p", "signature-name") +
      "</div></div>",
    "header",
  );
}
function imageSheet(n, key, full) {
  const img = cfg.assets[key] || "";
  return page(
    n,
    '<div class="image-frame ' +
      (full ? "full-image" : "") +
      '">' +
      (img
        ? '<img src="' + esc(img) + '" alt="">'
        : '<span class="blank-image">لم تُضف صورة ' +
          (full ? "الصيانة" : "الضمان") +
          " بعد<br>يمكن إضافتها من الإعدادات</span>") +
      "</div>" +
      (full
        ? ""
        : '<div class="image-caption">' +
          T(
            "receipt-details",
            "نوع السيارة: {{car}} · الشاصي: {{vin}} · التاريخ: {{date}}",
          ) +
          '</div><div class="image-footer"><div>' +
          T(
            "receipt-owner",
            "توقيع المالك<br>{{buyer}}".replace("<br>", "\n"),
          ) +
          "</div><div>" +
          T("receipt-agent", "توقيع الوكيل\n{{agent}}") +
          "</div></div>"),
  );
}
function waiver() {
  return page(
    3,
    '<div class="body-sheet">' +
      T("waiver-to", "إلى / {{company}}", "p") +
      T("waiver-title", "م/ تعهد وتنازل", "h2") +
      T(
        "waiver-body",
        "إني الموقع أدناه ({{buyer}}) أقر بالتنازل عن حقوقي بالسيارة المدرجة تفاصيلها في أدناه إلى {{company}}، وأتعهد بتحمل كافة التبعات القانونية والمالية والعشائرية والغرامات من تاريخ شرائي للسيارة ولغاية عدولي عنها، وأقر باستلامي كافة المستحقات المالية الخاصة بالسيارة المدرجة تفاصيلها في أدناه.",
        "p",
      ) +
      vehicleTable("waiver") +
      T("waiver-date", "التاريخ: {{date}}", "p") +
      '</div><div class="document-footer"><div>' +
      T("waiver-sig", "اسم وتوقيع الزبون\n{{buyer}}") +
      "</div><div>" +
      T("waiver-finger", "بصمة الزبون") +
      '<div class="fingerprint"></div></div></div>',
  );
}
function authorization() {
  return page(
    4,
    '<div class="body-sheet">' +
      T("auth-to", "إلى / الجهات المختصة كافة", "p") +
      T("auth-title", "م/ تخويل قيادة", "h2") +
      T(
        "auth-body",
        "نخول السيد ({{buyer}})، حامل الهوية المرقمة ({{buyerId}})، بقيادة المركبة العائدة إلى {{company}} والمبينة أوصافها أدناه. ويتحمل المخوّل مسؤولية الالتزام بقواعد المرور والمحافظة على المركبة، ولا يتضمن هذا التخويل حق بيع المركبة أو نقل ملكيتها إلى الغير.",
        "p",
      ) +
      vehicleTable("auth") +
      T("auth-date", "حرر بتاريخ: {{date}}", "p") +
      '</div><div class="document-footer"><div>' +
      T("auth-organizer", "المنظم\n{{organizer}}") +
      "</div><div>" +
      T("auth-manager", "{{manager}}\nالمدير المفوض إضافة لوظيفته\nالتوقيع") +
      "</div></div>",
    "full",
  );
}
function guarantee() {
  return page(
    6,
    '<div class="body-sheet">' +
      T("guarantee-to", "إلى / {{company}}", "p") +
      T("guarantee-title", "م/ تعهد كفالة", "h2") +
      T(
        "guarantee-body",
        "أتعهد أنا الموقع أدناه ({{guarantor}}) بكفالة السيد ({{buyer}}) كفالة تضامنية عن المبلغ المتبقي بذمته وقدره ({{remaining}}) دينار عراقي، كتابةً ({{remainingWords}})، الناتج عن شرائه المركبة المبينة أدناه من {{company}} بموجب العقد المرقم ({{number}}) المؤرخ ({{date}}). وألتزم بتسديد ما يستحق من الدين المكفول عند تخلف المشتري عن السداد وفق مواعيد العقد، وبحدود الرصيد غير المسدد، وللشركة المطالبة وفق القانون. وتقل مسؤوليتي بمقدار ما يتم تسديده من أصل الدين، وتنتهي بسداده كاملاً.",
        "p",
      ) +
      vehicleTable("guarantee") +
      T(
        "guarantor-info",
        "معلومات الكفيل:\nالاسم: {{guarantor}} · رقم الهوية: {{guarantorId}}\nتاريخ الإصدار: {{guarantorIdDate}} · محل الإصدار: {{guarantorIdFrom}}\nالعنوان: {{guarantorAddress}} · محلة: {{guarantorDistrict}} · زقاق: {{guarantorStreet}} · دار: {{guarantorHouse}}\nالهاتف: {{guarantorPhone}}",
        "p",
      ) +
      '</div><div class="document-footer"><div>' +
      T(
        "guarantor-sig",
        "اسم وتوقيع الكفيل\n{{guarantor}}\nالتاريخ: {{date}}",
      ) +
      "</div><div>" +
      T("guarantor-finger", "البصمة") +
      '<div class="fingerprint"></div></div></div>',
    "full",
  );
}
function bills(n, offset) {
  const values = splitBills(calculate(d).remaining);
  let html = "";
  for (let i = offset; i < offset + 2; i++) {
    ctx["bill" + i] = money(values[i]);
    ctx["billWords" + i] = words(values[i]);
    const tx = (key, text, tag = "div", cls = "") =>
      T("modern-bill-" + i + "-" + key, text, tag, cls);
    const field = (key, title, value) =>
      '<div class="bill-field">' +
      tx(key + "-label", title, "small") +
      tx(key, value) +
      "</div>";
    html +=
      '<section class="bill modern-bill">' +
      tx("title", "كمبيالة", "h2") +
      '<div class="bill-grid">' +
      field("due", "تاريخ الاستحقاق", "........................") +
      field("place", "محل الإصدار", "{{branch}}") +
      field("date", "تاريخ الإصدار", "{{date}}") +
      '</div><div class="bill-amounts">' +
      field("words", "المبلغ كتابة", "{{billWords" + i + "}}") +
      field("amount", "المبلغ رقماً · د.ع", "{{bill" + i + "}}") +
      "</div>" +
      tx(
        "promise",
        "إني الموقع أدناه، أتعهد بموجب هذه الكمبيالة عند مرور .................... من تاريخه أعلاه، ملزماً بدفع المبلغ المذكور أعلاه فقط، نقداً في ........................",
        "p",
        "bill-promise",
      ) +
      tx(
        "order",
        "لأمر: {{manager}} - المدير المفوض لـ{{company}} إضافة لوظيفته.",
        "p",
        "bill-order",
      ) +
      tx(
        "received",
        "والعوض وصلنا عن القيمة التي استلمت بالتمام والقيد من كل عيب.",
        "p",
        "bill-received",
      ) +
      '<div class="bill-bottom"><div class="bill-person">' +
      field("name", "الاسم", "{{buyer}}") +
      field("id", "رقم الهوية", "{{buyerId}}") +
      '<div class="bill-grid two">' +
      field("id-date", "تاريخ الإصدار", "{{buyerIdDate}}") +
      field("id-place", "محل الإصدار", "{{buyerIdFrom}}") +
      '</div></div><div class="bill-signs">' +
      tx("witness1", "الشاهد الأول\n........................") +
      tx("witness2", "الشاهد الثاني\n........................") +
      tx("signature", "التوقيع\n........................") +
      '</div><div class="bill-thumb">' +
      tx("thumb", "بصمة الإبهام الأيسر") +
      '<div class="fingerprint"></div></div></div></section>';
  }
  return page(n, html + '<div class="cut-line"></div>');
}

function annotate() {
  for (const p of document.querySelectorAll(".paper")) {
    let index = 0;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (
        n.textContent.trim() &&
        !n.parentElement.closest("[data-edit],.blank-image")
      )
        nodes.push(n);
    }
    for (const n of nodes) {
      const span = document.createElement("span");
      span.dataset.edit = "auto-" + p.dataset.page + "-" + index++;
      span.dataset.template = n.textContent;
      span.textContent = n.textContent;
      n.replaceWith(span);
    }
  }
}
function applyEdits() {
  document.querySelectorAll("[data-edit]").forEach((el) => {
    const o = cfg.edits[el.dataset.edit];
    if (!o) return;
    if (o.text != null) el.innerHTML = interpolate(o.text);
    if (getComputedStyle(el).display === "inline")
      el.style.display = "inline-block";
    el.style.transform =
      "translate(" + (Number(o.x) || 0) + "mm," + (Number(o.y) || 0) + "mm)";
    if (o.size)
      el.style.fontSize = Math.max(6, Math.min(60, Number(o.size))) + "px";
    if (/^#[a-f0-9]{6}$/i.test(o.color || "")) el.style.color = o.color;
    if (o.weight) el.style.fontWeight = o.weight;
    if (o.heading) el.style.fontWeight = "700";
    if (o.align) el.style.textAlign = o.align;
    el.style.transform = "translate(" + o.x + "mm," + o.y + "mm)";
    el.classList.toggle("hidden-edit", !!o.hidden);
  });
}
function renderTemplate(measureLayout = false) {
  if (!d) return;
  ctx = context();
  const brand = selectedBrand();
  let firstPage;
  if (measureLayout) {
    const data = d,
      values = ctx;
    try {
      d = fresh();
      ctx = context();
      firstPage = contract();
    } finally {
      d = data;
      ctx = values;
    }
  } else firstPage = contract();
  $("pages").innerHTML =
    firstPage +
    imageSheet(
      2,
      brand === "deepal" ? "receiptDeepal" : "receiptChangan",
      false,
    ) +
    waiver() +
    authorization() +
    imageSheet(
      5,
      brand === "deepal" ? "maintenanceDeepal" : "maintenanceChangan",
      true,
    ) +
    guarantee() +
    bills(7, 0) +
    bills(8, 2) +
    (cfg.extraPages || []).map((p) => page(p.id, "")).join("");
  for (const item of cfg.custom) {
    const p = document.querySelector('[data-page="' + item.page + '"]');
    if (p)
      p.insertAdjacentHTML(
        "beforeend",
        T(item.id, item.text, "div", "custom-text"),
      );
  }
  annotate();
  applyContentOrder();
  applyEdits();
  applyPageVisibility();
  const r = calculate(d);
  $("contractNumber").value = d.number;
  $("validation").textContent = r.errors.join("\n");
  if (d.car && d.brand === "auto" && !detectBrand(d.car))
    $("validation").textContent +=
      "\nنوع السيارة غير معروف؛ حدد شانجان أو ديبال من التصنيف.";
}
function applyPageVisibility() {
  const show = $("pagePreview").value;
  document.querySelectorAll(".paper").forEach((p) => {
    p.style.display = "";
    p.classList.toggle("print-skip", !Schedule.enabled(Number(p.dataset.page)));
  });
}
