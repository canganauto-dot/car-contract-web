/* Workspace arrangement and settings navigation; scene editing stays in ContractEditor. */
class WorkspaceUI {
  requiredOptions() {
    const options = Object.values(dataDefs)
      .flat()
      .filter((def) => def[2] !== "checkbox")
      .map(([id, label]) => [id, label]);
    return [
      ...options,
      ["companySelect", "الشركة"],
      ["cashReceived", "الواصل · نقدي"],
      ["cashDueDate", "تاريخ السداد النقدي"],
      ["cashTransferNote", "ملاحظة نقل الملكية"],
      ...Array.from({ length: 4 }, (_, i) => [
        ["cash-amount-" + i, "مبلغ الدفعة النقدية " + (i + 1)],
        ["cash-date-" + i, "تاريخ الدفعة النقدية " + (i + 1)],
        ["extra-date-" + i, "تاريخ الدفعة الإضافية " + (i + 1)],
      ]).flat(),
    ];
  }
  requiredSettings() {
    const defaults = [
      "buyer",
      "buyerId",
      "buyerPhone",
      "buyerAddress",
      "companySelect",
      "car",
      "vin",
      "model",
      "total",
      "guarantor",
      "guarantorId",
      "guarantorPhone",
      "guarantorAddress",
      "firstDate",
      "intervalMonths",
      "count",
      "payment",
      "phaseCount",
      "phasePayment",
      "phaseSecondCount",
      "depositDate",
      ...Array.from({ length: 4 }, (_, i) => "extra-date-" + i),
    ];
    const values = new Set(cfg.requiredFields || defaults),
      panel = $("requiredChoices");
    panel.replaceChildren();
    for (const [key, title] of this.requiredOptions()) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = values.has(key);
      input.onchange = () => {
        if (input.checked) values.add(key);
        else values.delete(key);
        cfg.requiredFields = [...values];
        this.markMissing(calculate(d));
        scheduleConfig();
      };
      label.append(input, document.createTextNode(title));
      panel.append(label);
    }
    $("resetRequired").onclick = () => {
      delete cfg.requiredFields;
      this.requiredSettings();
      this.markMissing(calculate(d));
      scheduleConfig();
    };
  }
  markMissing(r) {
    const required = new Set([
      "buyer",
      "buyerId",
      "buyerPhone",
      "buyerAddress",
      "companySelect",
      "car",
      "vin",
      "model",
      "total",
    ]);
    const cash = d.contractType === "cash";
    if (Schedule.enabled(6)) {
      for (const id of [
        "guarantor",
        "guarantorId",
        "guarantorPhone",
        "guarantorAddress",
      ])
        required.add(id);
    }
    if (cash && r.remaining > 0) {
      if (d.cashSplit)
        d.cashPayments.forEach((row, i) => {
          if (row.date) required.add("cash-amount-" + i);
        });
    }
    if (!cash && r.remaining > 0) {
      for (const id of ["firstDate", "intervalMonths"]) required.add(id);
      if (r.phase) {
        for (const id of ["phaseCount", "phasePayment", "phaseSecondCount"])
          required.add(id);
      } else required.add("count");
      if (r.secondCount > 0) required.add("payment");
    }
    if (!cash && r.deposit > 0) required.add("depositDate");
    const extras = [...$("extraEditors").children];
    for (const input of $("cards").querySelectorAll("input,select,textarea")) {
      const row = input.closest(".extra-card");
      const key =
        row && input.type === "date"
          ? "extra-date-" + extras.indexOf(row)
          : input.id;
      let needed = row
        ? !cash &&
          input.type === "date" &&
          amount(d.extras[extras.indexOf(row)]?.amount) > 0
        : required.has(input.id);
      if (Array.isArray(cfg.requiredFields)) {
        needed = cfg.requiredFields.includes(key) && !input.closest("[hidden]");
        if (row)
          needed = needed && amount(d.extras[extras.indexOf(row)]?.amount) > 0;
        if (input.closest("#guarantorCard"))
          needed = needed && Schedule.enabled(6);
        if (
          [
            "count",
            "firstDate",
            "intervalMonths",
            "phaseCount",
            "phaseSecondCount",
            "phasePayment",
            "payment",
          ].includes(key)
        )
          needed = needed && r.remaining > 0;
        if (key === "depositDate") needed = needed && r.deposit > 0;
        if (key.startsWith("cash-date-") || key.startsWith("cash-amount-")) {
          const item = d.cashPayments[Number(key.split("-").pop())];
          needed = needed && !!(item?.amount || item?.date);
        }
      }
      const missing = needed && !input.value.trim();
      input.classList.toggle("missing-value", missing);
      if (needed) input.setAttribute("aria-required", "true");
      else input.removeAttribute("aria-required");
      if (missing) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
  bindCar(input) {
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", "carChoices");
    input.setAttribute("aria-expanded", "false");
    input.autocomplete = "off";
    input.onfocus = input.onclick = () => this.showCars(input);
    input.addEventListener("input", () => this.showCars(input, input.value));
    input.onblur = () => this.closeCars(input);
    input.onkeydown = (e) => {
      const list = $("carChoices"),
        open = list.matches(":popover-open");
      if (e.key === "Escape") {
        this.closeCars(input);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      if (e.key === "Enter") {
        if (open && this.carIndex >= 0) {
          e.preventDefault();
          list.children[this.carIndex]?.click();
        }
        return;
      }
      e.preventDefault();
      if (!open) this.showCars(input);
      const items = [...list.children];
      if (!items.length) return;
      this.carIndex =
        (this.carIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
        items.length;
      items.forEach((b, i) =>
        b.setAttribute("aria-selected", String(i === this.carIndex)),
      );
      items[this.carIndex].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", items[this.carIndex].id);
    };
  }
  closeCars(input) {
    const list = $("carChoices");
    if (list.matches(":popover-open")) list.hidePopover();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  showCars(input, query = "") {
    const list = $("carChoices"),
      q = normalizeName(query);
    this.carIndex = -1;
    list.replaceChildren();
    for (const car of [...cfg.cars]
      .sort((a, b) => a.order - b.order)
      .filter((c) =>
        [c.name, String(c.order), ...(c.aliases || [])].some((v) =>
          normalizeName(v).includes(q),
        ),
      )) {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "vehicle-choice-" + list.children.length;
      b.dataset.brand = car.brand || "";
      if (car.cargo === true) b.dataset.cargo = "true";
      b.tabIndex = -1;
      b.setAttribute("role", "option");
      b.textContent = car.order + " · " + car.name;
      b.onpointerdown = (e) => e.preventDefault();
      b.onclick = () => {
        input.value = d.car = car.name;
        this.closeCars(input);
        render();
      };
      list.append(b);
    }
    if (!list.children.length) {
      this.closeCars(input);
      return;
    }
    const r = input.getBoundingClientRect(),
      w = Math.max(220, r.width),
      below = innerHeight - r.bottom - 8,
      above = r.top - 8,
      down = below >= 180 || below >= above;
    Object.assign(list.style, {
      width: w + "px",
      left: Math.max(4, Math.min(innerWidth - w - 4, r.right - w)) + "px",
      top: down ? r.bottom + 3 + "px" : "auto",
      bottom: down ? "auto" : innerHeight - r.top + 3 + "px",
      maxHeight: Math.min(270, down ? below : above) + "px",
    });
    list.showPopover();
    input.setAttribute("aria-expanded", "true");
  }

  addRemovePayment(field, index, cash) {
    const remove=document.createElement("button");
    remove.type="button";remove.className="remove-payment";remove.textContent="×";
    remove.setAttribute("aria-label","حذف الدفعة "+(index+1));
    remove.onclick=event=>{
      event.preventDefault();
      const data=cash?d.cashPayments:d.extras;
      const key=cash?"cashSlotsShown":"extraSlotsShown";
      const used=data.reduce((last,row,i)=>row.amount || (cash && row.date)?i+1:last,0);
      const shown=Math.max(index+1,used,Number(d[key])||0);
      data.splice(index,1);
      data.push(cash?{amount:"",date:""}:{label:"دفعة إضافية",amount:"",date:today(),enabled:false});
      d[key]=shown-1;
      if(cash){d.cashSplit=d[key]>0;Cash.buildInputs();}else renderExtraInputs();
      render();saveDraft();
    };
    field.classList.add("payment-with-remove");field.append(remove);
  }
  paymentRows() {
    const cash = d.contractType === "cash",
      active = cash || ["installment","exchange"].includes(d.contractType);
    const host = cash ? $("cashPaymentRows") : $("extraEditors");
    const btn = $("addPaymentSlot");
    if (!btn || !host) return;
    btn.hidden = !active || (cash && amount(d.total) <= amount(d.cashReceived));
    const rows = [...host.children];
    const data = cash ? d.cashPayments : d.extras;
    const key = cash ? "cashSlotsShown" : "extraSlotsShown";
    const used = data.reduce(
      (n, r, i) => (r.amount || (cash && r.date) ? i + 1 : n),
      0,
    );
    const count = Math.min(4, Math.max(used, Number(d[key]) || 0));
    rows.forEach((row, i) => (row.hidden = active && i >= count));
    if(cash)host.hidden = count === 0 || btn.hidden;
    btn.disabled = count >= 4;
    btn.onclick = () => {
      d[key] = Math.min(4, count + 1);
      if (cash) {
        d.cashSplit = true;
        $("cashSplit").checked = true;
        Cash.decorate();
      }
      render();
      rows[count]?.querySelector(cash ? "input" : 'input[aria-label="المبلغ"]')?.focus({preventScroll:true});
    };

  }
  arrangeFields() {
    if (!$("buyer") || $("buyer").dataset.arranged) return;
    const personFields = [
      ["buyer", "guarantor", "الاسم", 6],
      ["buyerPhone", "guarantorPhone", "الهاتف", 6],
      ["buyerId", "guarantorId", "رقم الهوية", 6],
      ["buyerIdDate", "guarantorIdDate", "تاريخ الإصدار", 2],
      ["buyerIdFrom", "guarantorIdFrom", "محل الإصدار", 4],
      ["buyerAddress", "guarantorAddress", "العنوان", 6],
      ["district", "guarantorDistrict", "محلة", 2],
      ["street", "guarantorStreet", "زقاق", 2],
      ["house", "guarantorHouse", "دار", 2],
    ];
    const groups = {
      buyerInputs: personFields.map(([id, , title, span]) =>
        [id, id === "buyer" ? "اسم الزبون" : title, span]),
      guarantorInputs: [
        ...personFields.map(([, id, title, span]) =>
          [id, id === "guarantor" ? "اسم الكفيل" : title, span]),
      ],
      oldVehicleInputs: [
        ["oldCar", "نوع المركبة", 6],
        ["oldColor", "اللون", 3],
        ["oldModel", "الموديل", 3],
        ["oldPlate", "رقم اللوحة", 9],
        ["oldMileage", "العداد", 3],
        ["oldVin", "الشاصي", 12],
      ],
      carInputs: [
        ["car", "نوع المركبة", 6],
        ["color", "اللون", 3],
        ["model", "الموديل", 3],
        ["plate", "رقم اللوحة", 9],
        ["mileage", "العداد", 3],
        ["vin", "الشاصي", 9],
        ["warrantyYears", "الضمان / سنة", 3],
        ["companySelect", "الشركة", 6],
        ["brand", "العلامة", 6],
        ["noWarranty", "خارج الضمان", 4],
      ],
      paymentInputs: [
        ["total", "المبلغ الكلي", 12],
        ["deposit", "الواصل", 12],
        ["depositDate", "تاريخ الواصل", 12],
      ],
      installmentInputs: [
        ["payment", "قيمة القسط", 6],
        ["count", "عدد الأقساط", 3],
        ["phaseSecondCount", "عدد الثانية", 3],
        ["firstDate", "تاريخ بداية الأقساط", 3],
        ["phaseEnabled", "أقساط بمرحلتين", 6],
        ["phasePayment", "قسط المرحلة الأولى", 6],
        ["phaseCount", "عدد الأولى", 6],
      ],
      financialNotes: [["notes", "ملاحظة", 12]],
    };
    const orders=cfg.design.fillOrders ||= {};
    const scope=ContractTemplates.scopeKey();
    const independent={...groups,...(orders[scope] ||= clone(groups))};
    for (const [group, fields] of Object.entries(independent))
      for (const [id, title, span] of fields) {
        const input = $(id);
        if (!input) continue;
        const label = input.closest("label");
        if (span <= 3) label.classList.add("short-field");
        label.style.setProperty("--entry-span", "span " + span);
        label.dataset.field = id;
        let caption=label.querySelector(":scope > span:not(.entry-date)");
        if(!caption){caption=document.createElement("span");for(const node of [...label.childNodes])if(node.nodeType===3)node.remove();label.prepend(caption);}
        caption.textContent = title;
        input.setAttribute("aria-label", title);
        label.title =
          id === "count"
            ? "عدد الأقساط شاملاً القسط الأخير"
            : id === "phaseCount"
              ? "عدد أقساط المرحلة الأولى"
              : id === "phaseSecondCount"
                ? "عدد أقساط المرحلة الثانية"
                : title;
        $(group).append(label);
      }
    $("buyer").dataset.arranged = "1";
    $("notes").rows = 1;
  }
  tab(name) {
    if (name === "fill") this.requiredSettings();
    const tabs = [...document.querySelectorAll("[data-settings-tab]")];
    if (!tabs.some((b) => b.dataset.settingsTab === name)) name = "device";
    for (const button of tabs) {
      const active = button.dataset.settingsTab === name;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-settings-panel]")) {
      panel.hidden = panel.dataset.settingsPanel !== name;
      panel.open = true;
    }
    this.activeTab = name;
    if (name === "staff") StaffConsole.refresh();
    $("settingsContent").scrollTop = 0;
  }
  open(name = this.activeTab || "device") {
    $("openSettings").click();
    this.tab(name);
    if (name === "vehicle") Images.vehiclePanel();
    if (name === "company") Services.companyPanel();
  }
  init() {
    $("buyerCard")
      .querySelector(".card-heading")
      .append($("customerPhotoTools"));
    $("companyInputs").parentElement.append($("companyDynamic"));
    $("templateActions").append($("openDesign"));
    const newTemplate = document.createElement("button");
    newTemplate.textContent = "إضافة قالب عقد من عقد موجود";
    newTemplate.onclick = () => ContractTemplates.open();
    $("templateActions").append(newTemplate);
    $("fillSettings").append($("formulaDetails"));
    $("vehicleSettings").append($("vehicleImageSettings"));
    for (const button of document.querySelectorAll("[data-settings-tab]"))
      button.onclick = () => this.tab(button.dataset.settingsTab);
    $("settingsTabs").onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const tabs = [...$("settingsTabs").querySelectorAll("button")],
        at = tabs.indexOf(document.activeElement),
        next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : (at + (e.key === "ArrowLeft" ? 1 : -1) + tabs.length) %
                tabs.length;
      tabs[next].click();
      tabs[next].focus();
    };
    $("settingsShortcut").onclick = () => this.open();
    $("validation").tabIndex = 0;
    $("validation").title = "اضغط لعرض الملاحظات كاملة";
    $("validation").onclick = () => {
      const errors = d.standaloneBook ? [] : [...calculate(d).errors, ...Services.formulaErrors];
      if (errors.length) Feedback.notice(errors.join("\n"));
    };
    $("validation").onkeydown = (e) => {
      if (e.key === "Enter") $("validation").click();
    };
    this.tab("device");
    this.arrangeFields();
  }
}
const Workspace = new WorkspaceUI();
