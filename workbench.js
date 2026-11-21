const Workbench = {
  archiveKind: "contracts",
  ready: false,
  tiles: new Map(),
  async init() {
    document.body.classList.add("has-workbench");
    const rail = document.createElement("aside");
    rail.id = "workbench";
    rail.innerHTML =
      '<div class="work-create" role="group" aria-label="إنشاء مستند"><button id="workNew">إضافة عقد</button><button id="workLetter">إضافة كتاب</button></div><h2 id="workListTitle">المستندات المفتوحة</h2><div id="workItems" role="group" aria-labelledby="workListTitle"></div>';
    document.body.append(rail);
    $("workNew").onclick = () => Services.createContract();
    $("workLetter").onclick = () => this.choose();
    rail.setAttribute("aria-label", "مساحة العمل");
    Letters.choose = () => this.choose();
    $("newLetter").textContent = "إضافة كتاب";
    $("newLetter").onclick = () => this.choose();
    for (const method of ["createContract", "openEntry"]) {
      const original = Services[method].bind(Services);
      Services[method] = async (...args) => {
        if (this.switching) return;
        this.switching = true;
        this.paint();
        $("cards").inert = true;
        try {
          await original(...args);
          this.paint();
          return true;
        } finally {
          this.switching = false;
          $("cards").inert = false;
        }
      };
    }
    const refresh = Archive.refresh.bind(Archive);
    Archive.refresh = () => {
      refresh();
      this.labels();
      this.paint();
    };
    const tabs = document.createElement("div");
    tabs.id = "archiveKinds";
    tabs.innerHTML =
      '<button data-kind="contracts">أرشيف العقود</button><button data-kind="books">أرشيف الكتب</button><button id="exportExcel">تصدير كشف Excel</button>';
    $("archiveSearch").closest("div").before(tabs);
    for (const b of tabs.querySelectorAll("[data-kind]"))
      b.onclick = () => {
        this.archiveKind = b.dataset.kind;
        Archive.selected.clear();
        Archive.refresh();
      };
    $("exportExcel").onclick = () =>
      ExcelExport.save(
        Archive.selected.size ? Archive.selectedRows() : Archive.visible,
      );
    this.ready = true;
    this.paint();
    this.form();
    Archive.refresh();
    EntryDates.sync();
  },
  labels() {
    for (const [id, label] of [
      ["printedArchive", "المطبوعة"],
      ["draftArchive", "المعلقة"],
    ]) {
      const h = $(id).parentElement.querySelector("h2");
      const heading = (this.archiveKind === "books" ? "الكتب " : "العقود ") + label + " ";
      for (const n of h.childNodes)
        if (n.nodeType === 3 && n.textContent !== heading) n.textContent = heading;
    }
    for (const b of document.querySelectorAll("[data-kind]"))
      b.classList.toggle("active", b.dataset.kind === this.archiveKind);
  },
  paint() {
    const host = $("workItems");
    if (!host) return;
    const entries = Services.library.entries.filter(e => e.kind === "draft");
    const current = !Services.home && d.recordId ? "draft:" + d.recordId : "";
    if (current && Services.pendingData?.recordId === d.recordId && !entries.some(e => e.id === current)) {
      const printed = Services.library.entries.find(e => e.kind === "printed" && e.data.recordId === d.recordId);
      if (!printed || Services.fingerprint(printed.data) !== Services.fingerprint(d))
        entries.unshift({id:current,kind:"draft",data:d});
    }
    const ids = new Set(entries.map(entry => entry.id));
    for (const [id, tile] of this.tiles) {
      if (ids.has(id)) continue;
      tile.node.remove();
      this.tiles.delete(id);
    }
    entries.forEach((entry, index) => {
      const active = entry.id === current;
      const data = active ? d : entry.data;
      let tile = this.tiles.get(entry.id);
      if (!tile) {
        tile = this.makeTile();
        this.tiles.set(entry.id, tile);
      }
      tile.entry = entry;
      tile.active = active;
      tile.node.classList.toggle("active", active);
      const title = [data.standaloneBook ? data.bookTitle : ContractTemplates.find(data.templateId)?.name || "عقد",
        ContractFiles.customer(data) || "جديد", data.number, entry.note].filter(Boolean).join(" · ");
      if (tile.open.title !== title) tile.open.title = tile.open.textContent = title;
      if (tile.number !== data.number) {
        tile.number = data.number;
        for (const button of tile.actions.children)
          button.setAttribute("aria-label", button.title + " · " + data.number);
      }
      if (host.children[index] !== tile.node) host.insertBefore(tile.node, host.children[index] || null);
    });
  },
  makeTile() {
    const node = document.createElement("div");
    node.className = "work-tile";
    const open = document.createElement("button");
    open.className = "work-name";
    const actions = document.createElement("div");
    actions.className = "work-actions";
    const tile = {node, open, actions};
    const historical = () => tile.entry.id.startsWith("revision:");
    open.onclick = () => historical() ? Archive.run([tile.entry], "view") : Services.openEntry(tile.entry);
    const add = (icon, label, run) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = label;
      button.innerHTML = Archive.icon(icon);
      button.onclick = run;
      actions.append(button);
    };
    add("print", "طباعة", async () => {
      const entry = tile.entry;
      if (historical()) return Archive.run([entry], "print");
      if (!tile.active && !(await Services.openEntry(entry))) return;
      $("printAll").click();
    });
    add("download", "تصدير JSON", () => ContractFiles.save(tile.active ? d : tile.entry.data));
    add("trash", "حذف", () => Archive.remove(tile.entry));
    node.append(open, actions);
    return tile;
  },
  async start(id) {
    if (!(await Services.createContract())) return;
    d.templateId = "";
    d.standaloneBook = String(id);
    d.bookTitle =
      id === 4
        ? "تخويل قيادة"
        : id === 0
          ? "نقل ملكية"
          : cfg.letterTemplates?.find((t) => t.id === id)?.name || "كتاب";
    d.bookBody = cfg.letterTemplates?.find((t) => t.id === id)?.body || "";
    d.contractType = id === 0 ? "cash" : "installment";
    d.pages = [id];
    render();
    saveDraft();
  },
  choose() {
    const dialog = document.createElement("dialog");
    dialog.className = "letter-picker";
    dialog.innerHTML =
      '<h3>إضافة كتاب</h3><div class="letter-options"></div><h4>كتب معلقة</h4><div class="letter-pending"></div><button class="close">إغلاق</button>';
    document.body.append(dialog);
    for (const t of [
      { id: 4, name: "تخويل قيادة" },
      { id: 0, name: "نقل ملكية" },
      ...(cfg.letterTemplates || []),
    ]) {
      const b = document.createElement("button");
      b.textContent = t.name;
      b.onclick = async () => {
        dialog.close();
        await this.start(t.id);
      };
      dialog.querySelector(".letter-options").append(b);
    }
    const entries = Services.library.entries.filter(
      (e) => e.kind === "draft" && e.data.standaloneBook,
    );
    for (const entry of entries) {
      const b = document.createElement("button");
      b.textContent =
        (entry.data.bookTitle || "كتاب") +
        " · " +
        (entry.data.buyer || entry.data.number);
      b.onclick = async () => {
        dialog.close();
        await Services.openEntry(entry);
      };
      dialog.querySelector(".letter-pending").append(b);
    }
    dialog.querySelector(".close").onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  },
  pages(pages, scene) {
    for (const page of pages) {
      if (
        page.id === 1 &&
        d.contractType === "cash" &&
        !page.cashHeaderSynced
      ) {
        const source = scene.pages.find((p) => p.id === 1);
        const headers =
          source?.nodes.filter((n) => /^hdr-.*-name-[012]$/.test(n.id)) || [];
        if (headers.length) {
          page.nodes = page.nodes.filter(
            (n) => !/^hdr-.*-name-[012]$/.test(n.id),
          );
          page.nodes.push(...clone(headers));
        } else
          page.nodes.push(
            ...PaperLayout.header("cash").filter((n) =>
              /-name-[012]$/.test(n.id),
            ),
          );
        page.cashHeaderSynced = true;
      }
    }
  },
  switchBook(id) {
    const types = [
      { id: 4, name: "تخويل قيادة" },
      { id: 0, name: "نقل ملكية" },
      ...(cfg.letterTemplates || []),
    ];
    const type = types.find((t) => t.id === id);
    if (!type) return;
    App.commitText();
    // Keep type-specific free text and all shared/hidden values, including table data.
    d.bookBodies ||= {};
    d.bookBodies[d.standaloneBook] = d.bookBody || "";
    d.templateId = "";
    d.standaloneBook = String(id);
    d.bookTitle = type.name;
    d.bookBody = d.bookBodies[id] ?? type.body ?? "";
    d.contractType = id === 0 ? "cash" : "installment";
    d.pages = [id];
    App.page = id;
    App.scene = null;
    render();
    saveDraft();
    $("saveStatus").textContent =
      "تم تغيير الكتاب؛ البيانات الأخرى محفوظة عند الرجوع إليه";
  },
  form() {
    const isBook = !!d.standaloneBook;
    $("archiveContractType").closest("label").hidden = isBook;
    let bookType = $("bookType");
    if (!bookType) {
      const label = document.createElement("label");
      label.className = "book-type-control";
      label.append(document.createTextNode("نوع الكتاب"));
      bookType = document.createElement("select");
      bookType.id = "bookType";
      label.append(bookType);
      $("archiveContractType").closest("label").after(label);
      bookType.onchange = () => this.switchBook(Number(bookType.value));
    }
    bookType.closest("label").hidden = !isBook;
    if (isBook) {
      const types = [
        { id: 4, name: "تخويل قيادة" },
        { id: 0, name: "نقل ملكية" },
        ...(cfg.letterTemplates || []),
      ];
      if (bookType.length !== types.length || types.some((t,i) =>
          bookType.options[i].value !== String(t.id) || bookType.options[i].text !== t.name))
        bookType.replaceChildren(...types.map(t => new Option(t.name, t.id)));
      bookType.value = d.standaloneBook;
    }
    document.body.classList.toggle("book-work", isBook && !Services.home);
    let panel = $("bookFields");
    if (!isBook) {
      panel?.remove();
      this.bookPanel=null; this.bookSchema=null;
      return;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "bookFields";
      $("cards").before(panel);
    }
    const page = App.displayPages?.find(
      (p) => p.id === Number(d.standaloneBook),
    );
    const keys = new Set(["number", "contractDate"]);
    for (const key of documentVariables(page))
      keys.add(key === "date" ? "contractDate" : key);
    const labels = {};
    for (const defs of Object.values(dataDefs))
      for (const [key, label] of defs) labels[key] = label;
    Object.assign(labels, cfg.variableLabels, App.scene?.variableLabels);
    const bookOrders=cfg.design.bookFillOrders ||= {};
    const scope=ContractTemplates.scopeKey();
    const savedOrder=bookOrders[scope] ||= [...FieldStudio.sorted(keys)];
    const orderedKeys=[...savedOrder.filter(key=>keys.has(key)),...FieldStudio.sorted(keys).filter(key=>!savedOrder.includes(key))];
    const values = context();
    const managed=FillLayout.bindings();
    const fields = [];
    for (const key of orderedKeys) {
      const spec = FieldStudio.fields()[key];
      if (managed.has(key) || !FieldStudio.applies(spec) || spec?.hidden || ["company","vehicle"].includes(spec?.source)) continue;
      const dynamic = !(key in d) && (spec || !(key in values) || Object.hasOwn(d.bookValues || {},key));
      if (
        (!(key in d) && !dynamic) ||
        typeof d[key] === "object" ||
        typeof d[key] === "boolean" ||
        ["companyId", "standaloneBook"].includes(key)
      )
        continue;
      fields.push({ key, spec, dynamic, label:spec?.label || (key==="cashTransferNote"?"ملاحظة نقل الملكية":labels[key]) ||
        {number:"العدد",contractDate:"التاريخ",bookBody:"محتوى الكتاب"}[key] || key });
    }
    const schema = JSON.stringify([scope, d.bookTitle, cfg.companies.map(c => [c.id,c.name]),
      fields.map(({key,label,spec,dynamic}) => [key,label,spec?.source,dynamic])]);
    const fieldValue = ({key,spec,dynamic}) => (key==="number" && d.numberUnconfirmed ? d.numberRequest :
      dynamic ? d.bookValues?.[key] ?? spec?.value : d[key]) ?? "";
    if (this.bookPanel === panel && this.bookSchema === schema) {
      $("bookCompany").value = d.bookNoCompany ? "none" : d.companyId;
      for (const field of fields) {
        const input = $("bookInput-" + field.key);
        if (!input || document.activeElement === input) continue;
        if (field.spec?.source === "toggle") input.checked = !!d.bookValues?.[field.key];
        else if (input.value !== String(fieldValue(field))) input.value = fieldValue(field);
      }
      return;
    }
    this.bookPanel=panel; this.bookSchema=schema;
    panel.replaceChildren();
    const company = document.createElement("select");
    company.id="bookCompany";
    company.add(new Option("بدون شركة", "none"));
    for (const c of cfg.companies) company.add(new Option(c.name, c.id));
    company.value = d.bookNoCompany ? "none" : d.companyId;
    company.onchange = () => {
      d.bookNoCompany = company.value === "none";
      if (!d.bookNoCompany) d.companyId = company.value;
      render();saveDraft();
    };
    const title = document.createElement("h3");
    title.textContent = d.bookTitle;
    const companyLabel=document.createElement("label"), companyCaption=document.createElement("span");
    companyCaption.textContent="الشركة";companyLabel.append(companyCaption,company);panel.append(title,companyLabel);
    for (const field of fields) {
      const {key,spec,dynamic} = field;
      const l = document.createElement("label");
      l.textContent = field.label;
      const input = document.createElement(
        key === "bookBody" ? "textarea" : "input",
      );
      input.id = "bookInput-" + key;
      input.value = fieldValue(field);
      if (/Date$/.test(key)) input.type = "date";
      if (spec?.source === "toggle") {input.type="checkbox"; input.checked=!!d.bookValues?.[key];}
      input.onchange = () => {
        if (spec?.source === "toggle") (d.bookValues ||= {})[key]=input.checked;
        else if (dynamic) (d.bookValues ||= {})[key] = input.value;
        else d[key] = input.value;
        render();
        saveDraft();
      };
      l.append(input);
      if(key==="number")BranchNumbers.bind(input);
      panel.append(l);
    }
    const print = document.createElement("button");
    print.id = "bookPrint";
    print.textContent = "طباعة الكتاب";
    print.onclick = () => $("printAll").click();
    panel.append(print);
  },
};
