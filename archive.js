const Archive = {
  selected: new Set(),
  visible: [],
  metrics: new WeakMap(),
  tables: new Map(),
  paths: {
    settings:"M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    share:"M8 12l8-6M8 12l8 6M8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    history:"M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l4 2",
    edit:"m4 16 12-12 4 4L8 20H4zM14 6l4 4",
    bell:"M4 17h16l-2-3V9a6 6 0 0 0-12 0v5z M10 20a2 2 0 0 0 4 0",
    mute:"M3 3l18 18 M7 7a6 6 0 0 0-1 3v4l-2 3h12 M18 13V9a6 6 0 0 0-8-6 M10 20h4",
    scan:"M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M6 12h12",
    add:"M12 5v14M5 12h14",
    refresh:"M20 10a8 8 0 1 0-1 7M20 4v6h-6",
    logout:"M10 4H4v16h6M9 12h12m-5-5 5 5-5 5",
    staff: "M15.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M4 21v-2a8 7 0 0 1 16 0v2",
    camera:"M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    shutter:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0",
    upload:"M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
    search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    filter: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M9 15v6",
    print: "M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z",
    face: "M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h5",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    close: "M6 6l12 12M18 6 6 18",
    check: "m4 12 5 5L20 6",
    pending: "M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h5",
    trash: "M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 9v9M14 9v9",
  },
  icon(name) {
    return (
      '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' +
      this.paths[name] +
      '"/></svg>'
    );
  },
  labelButton(button,icon,label){
    button.title=button.ariaLabel=label;
    button.innerHTML=this.icon(icon);
    return button;
  },
  init() {
    for (const el of document.querySelectorAll("[data-archive-icon]"))
      el.innerHTML = this.icon(el.dataset.archiveIcon);
    $("filterToggle").onclick = () => {
      const form = $("archiveFilters");
      form.hidden = !form.hidden;
      $("filterToggle").setAttribute("aria-expanded", String(!form.hidden));
    };
    const refresh = () => this.refresh();
    $("archiveSearch").oninput = refresh;
    $("archiveFilters").oninput = refresh;
    $("archiveFilters").onreset = () => setTimeout(refresh, 0);
    $("archiveFilters").onsubmit = (event) => event.preventDefault();
    $("allArchive").onchange = (e) =>
      this.selectRows(this.visible, e.target.checked);
    for (const b of document.querySelectorAll("[data-output]"))
      b.onclick = () => this.run(this.selectedRows(), b.dataset.output);
    $("viewClose").onclick = () => $("archiveViewer").close();
    $("archiveViewer").onclose = () => ArchiveOutput.clearViewer();
    $("viewEdit").onclick = () => {
      const entry = ArchiveOutput.entry;
      if (!entry) return;
      $("archiveViewer").close();
      Services.openEntry(entry);
    };
    $("viewPrint").onclick = () => this.handlePrintShortcut();
    $("viewCopy").onclick = () => {
      const entry = ArchiveOutput.entry;
      if (entry)
        download(
          ContractFiles.name(entry.data, "json"),
          ContractFiles.pack(entry.data),
          "application/json",
        );
    };
    $("viewSave").onclick = () =>
      ArchiveOutput.file
        ? ArchiveOutput.downloadFile()
        : this.run(
            ArchiveOutput.rows,
            ArchiveOutput.face ? "downloadFace" : "download",
          );
  },
  signed(entry) {
    const f = entry.signedFile ?? entry.data?.signedFile;
    const url = typeof f === "string" ? f : f?.dataUrl;
    return typeof url === "string" &&
      /^data:(application\/pdf|image\/(?:png|jpeg));base64,/i.test(url)
      ? url
      : "";
  },
  config(entry) {
    return entry.snapshot?.config || Services.library.configs?.[entry.configKey] || entry.config || cfg;
  },
  types: {
    installment: "أقساط",
    cash: "نقدي",
    external: "خارجي",
    exchange: "استبدال",
  },
  type(entry) {
    const raw = entry.data.contractType || entry.contractType || "installment";
    return (
      Object.keys(this.types).find(
        (key) => key === raw || this.types[key] === raw,
      ) || raw
    );
  },
  balances(data) {
    const { total, deposit, extras, remaining: unscheduled, outstanding } = calculate(data);
    const paid = outstanding === undefined ? deposit + extras : deposit;
    const remaining = outstanding ?? unscheduled;
    const valid = total > 0 && Number.isFinite(paid) && remaining >= 0 && unscheduled >= 0;
    return {
      total,
      paid,
      remaining,
      valid,
      status: !valid
        ? "unknown"
        : remaining === 0
          ? "full"
          : paid === 0
            ? "unpaid"
            : "partial",
    };
  },
  entryMetrics(data) {
    // The archive replaces a document snapshot when it changes.
    let metrics = this.metrics.get(data);
    if (!metrics) this.metrics.set(data, metrics = {});
    return metrics;
  },
  matches(entry, f) {
    const data = entry.data;
    if (f.company && f.company !== String(data.companyId)) return false;
    if (f.kind && f.kind !== this.type(entry) && f.kind !== data.templateId) return false;
    if (
      (f.fromDate && (!data.contractDate || data.contractDate < f.fromDate)) ||
      (f.toDate && (!data.contractDate || data.contractDate > f.toDate))
    )
      return false;
    const metrics = this.entryMetrics(data);
    if (f.query) {
      metrics.searchable ??= normalizeDigits([
        data.buyer, data.externalSeller, data.externalBuyer,
        data.number, data.car, data.vin, data.plate,
      ].join(" ")).toLocaleLowerCase();
      if (!metrics.searchable.includes(f.query)) return false;
    }
    if (!f.payment && !f.minAmount && !f.maxAmount) return true;
    const b = metrics.balance ??= this.balances(data);
    if (
      f.payment === "remaining"
        ? !(b.valid && b.remaining > 0)
        : f.payment && f.payment !== b.status
    )
      return false;
    if ((f.minAmount || f.maxAmount) && !b.valid) return false;
    return (
      (!f.minAmount || b[f.basis] >= amount(f.minAmount)) &&
      (!f.maxAmount || b[f.basis] <= amount(f.maxAmount))
    );
  },
  refresh() {
    const entries = Services.library.entries.filter(
      (e) => (!Cloud.formsReady || e.kind==="printed") && !!e.data.standaloneBook === (Workbench.archiveKind === "books"),
    );
    const form = $("archiveFilters"),
      select = form.elements.company,
      previous = select.value;
    const companies = new Map(cfg.companies.map((c) => [String(c.id), c.name]));
    for (const e of entries) {
      const id = String(e.data.companyId || "");
      if (id && !companies.has(id))
        companies.set(
          id,
          this.config(e).companies?.find((c) => String(c.id) === id)?.name ||
            id,
        );
    }
    const companyOptions = JSON.stringify([...companies]);
    if (companyOptions !== this.companyOptions) {
      this.companyOptions = companyOptions;
      select.replaceChildren(
        new Option("كل الشركات", ""),
        ...Array.from(companies, ([id, name]) => new Option(name, id)),
      );
      select.value = companies.has(previous) ? previous : "";
    }
    const typeFilter = form.elements.kind, previousType = typeFilter.value;
    const templates = JSON.stringify(cfg.design?.contractTemplates?.map(({ id, name }) => [id, name]));
    if (templates !== this.templateOptions) {
      this.templateOptions = templates;
      ContractTemplates.list(typeFilter);
      typeFilter.value = previousType;
    }
    const f = Object.fromEntries(new FormData(form));
    const n = Object.entries(f).filter(([k, v]) => k !== "basis" && v).length;
    $("filterCount").textContent = n ? String(n) : "";
    f.query = normalizeDigits(
      $("archiveSearch").value.trim(),
    ).toLocaleLowerCase();
    const badDate = f.fromDate && f.toDate && f.fromDate > f.toDate;
    const badAmount =
      [f.minAmount, f.maxAmount].some(
        (v) => v && !Number.isFinite(amount(v)),
      ) ||
      (f.minAmount && f.maxAmount && amount(f.minAmount) > amount(f.maxAmount));
    $("archiveStatus").textContent = badDate
      ? "تاريخ النهاية يسبق تاريخ البداية."
      : badAmount
        ? "راجع حدود المبلغ المدخلة."
        : "";
    this.visible =
      badDate || badAmount
        ? []
        : entries
            .filter((e) => this.matches(e, f))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    const ids = new Set(this.visible.map((e) => e.id));
    for (const id of this.selected) if (!ids.has(id)) this.selected.delete(id);
    for (const kind of ["printed", "draft"])
      this.table(
        kind,
        this.visible.filter((e) => e.kind === kind),
        !!(n || f.query),
      );
    this.selectionState();
  },
  table(kind, rows, filtered) {
    const printed = kind === "printed",
      box = $(kind + "Archive");
    const count = $(kind + "Count");
    if (count.textContent !== String(rows.length)) count.textContent = rows.length;
    let table = this.tables.get(kind);
    if (!table) {
      box.innerHTML = '<table class="archive-list"><thead><tr><th class="tickcol"><input type="checkbox"></th>' +
        '<th class="ordinal">#</th><th>اسم الزبون</th><th>العدد</th><th>التاريخ والوقت</th>' +
        (printed ? '<th class="statecol">موقّع</th>' : "") +
        '<th>الموظف</th></tr></thead><tbody></tbody></table><p class="archive-empty" hidden></p>';
      const all = box.querySelector("th input");
      table = { all, body:box.querySelector("tbody"), empty:box.querySelector(".archive-empty"), nodes:new Map() };
      all.dataset.group = kind;
      all.setAttribute("aria-label", printed ? "تحديد كل العقود المطبوعة" : "تحديد كل العقود المعلقة");
      all.onchange = () => this.selectRows(table.rows, all.checked);
      this.tables.set(kind, table);
    }
    table.rows = rows;
    const ids = new Set(rows.map(e => e.id));
    for (const [id, row] of table.nodes) {
      if (ids.has(id)) continue;
      row.remove();
      table.nodes.delete(id);
    }
    rows.forEach((entry, i) => {
      const signed = printed && (!!entry.cloudSigned || !!this.signed(entry));
      let row = table.nodes.get(entry.id);
      if (!row || row.entry !== entry || row.document !== entry.data || row.signed !== signed) {
        const updated = this.makeRow(entry, printed, signed);
        if (row) row.replaceWith(updated);
        row = updated;
        table.nodes.set(entry.id, row);
      }
      const ordinal = String(rows.length - i);
      if (row.cells[1].textContent !== ordinal) row.cells[1].textContent = ordinal;
      if (table.body.children[i] !== row) table.body.insertBefore(row, table.body.children[i] || null);
    });
    table.empty.hidden = !!rows.length;
    if (!rows.length)
      table.empty.textContent = filtered
        ? "لا توجد عقود تطابق البحث."
        : printed
          ? "لا توجد عقود مطبوعة بعد."
          : "لا توجد عقود معلّقة.";
  },
  makeRow(entry, printed, signed) {
    const row = document.createElement("tr"), data = entry.data;
    row.dataset.entry = entry.id;
    row.entry = entry;
    row.document = data;
    row.signed = signed;
    row.innerHTML = '<td class="tickcol"><input type="checkbox"></td><td class="ordinal"></td>' +
      '<td><button class="archive-open"></button></td><td><bdi></bdi></td><td><time dir="ltr"></time></td>' +
      (printed ? '<td class="statecol"></td>' : "");
    const check = row.querySelector("input"), open = row.querySelector("button");
    row.checkbox = check;
    check.checked = this.selected.has(entry.id);
    row.classList.toggle("is-picked", check.checked);
    check.setAttribute("aria-label", "تحديد عقد " + data.number);
    check.onchange = () => this.selectRows([entry], check.checked);
    open.textContent = (data.contractType === "external"
      ? [data.externalSeller, data.externalBuyer].filter(Boolean).join(" / ") : data.buyer) || "عقد غير مكتمل";
    row.querySelector("bdi").textContent = data.number;
    row.querySelector("time").textContent = entry.updatedAt ? SalesForms.time(entry.updatedAt) :
      [dateLabel(data.contractDate),data.contractTime].filter(Boolean).join(" ");
    row.insertCell().textContent = entry.seller || data.organizer || entry.config?.fixed?.organizer || "—";
    if (printed) {
      const status = row.cells[5];
      status.innerHTML = this.icon(signed ? "check" : "close");
      status.classList.add(signed ? "state-ok" : "state-missing");
      status.title = signed ? "النسخة الموقّعة موجودة" : "لم تُرفع النسخة الموقّعة";
      status.setAttribute("aria-label", status.title);
      const upload = document.createElement("button");
      upload.className = "upload-signed";
      upload.title = signed ? "تحديث النسخة الموقعة" : "رفع النسخة الموقعة";
      upload.setAttribute("aria-label", upload.title);
      upload.innerHTML =
        '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 2h10l6 6v14H4zM14 2v6h6M12 18v-7m-3 3 3-3 3 3"/></svg>';
      upload.onclick = () => ContractFiles.open(entry);
      status.append(upload);
    }
    open.onclick = () => this.run([entry], "view");
    row.onclick = event => {
      if (!event.target.closest("button,.tickcol,.remove-draft")) open.click();
    };
    const metrics = this.entryMetrics(data), b = metrics.balance ??= this.balances(data);
    row.title = this.types[this.type(entry)] || "";
    if (b.valid) row.title += " · الواصل " + money(b.paid) + " · الباقي " + money(b.remaining) + " د.ع";
    return row;
  },
  selectedRows() {
    return this.visible.filter((e) => this.selected.has(e.id));
  },
  selectRows(rows, checked) {
    for (const e of rows)
      checked ? this.selected.add(e.id) : this.selected.delete(e.id);
    this.selectionState();
  },
  selectionState() {
    const setState = (box, count, total) => {
      box.checked = count > 0 && count === total;
      box.indeterminate = count > 0 && count < total;
      box.disabled = total === 0;
    };
    const previous = this.paintedSelection || new Set();
    let selectedDrafts = 0, selectedVisible = 0;
    for (const [kind, table] of this.tables) {
      let count = 0;
      for (const id of this.selected) {
        const row = table.nodes.get(id);
        if (!row) continue;
        count++;
        if (!previous.has(id)) {
          row.checkbox.checked = true;
          row.classList.add("is-picked");
        }
      }
      for (const id of previous) {
        const row = table.nodes.get(id);
        if (this.selected.has(id) || !row) continue;
        row.checkbox.checked = false;
        row.classList.remove("is-picked");
      }
      setState(table.all, count, table.rows.length);
      if (kind === "draft") selectedDrafts = count;
      selectedVisible += count;
    }
    setState($("allArchive"), selectedVisible, this.visible.length);
    this.paintedSelection = new Set(this.selected);
    const deleteButton = $("deletePickedDrafts");
    if (deleteButton) deleteButton.hidden = !selectedDrafts;
    $("pickedCount").textContent = this.selected.size
      ? "المحدّد " + this.selected.size
      : "";
    for (const b of document.querySelectorAll("[data-output]"))
      b.disabled = this.busy || !this.selected.size;
  },
  async remove(entry) {
    if (
      this.busy ||
      entry.kind !== "draft" ||
      !(await Feedback.ask("حذف العقد المعلّق " + entry.data.number + "؟"))
    )
      return;
    await Services.flush();
    if(Cloud.enabled){try{await Cloud.write("remove",entry.data);}catch(error){await Feedback.notice(error.message);return;}}
    const active = entry.id === "draft:" + d.recordId;
    if (active) {
      d = fresh();
      await putDB("draft", clone(d));
    }
    Services.library.entries = Services.library.entries.filter(
      (e) => e.id !== entry.id,
    );
    await Services.persistLibrary();
    if (active) await Services.showHome();
    this.refresh();
  },
  handlePrintShortcut() {
    if ($("archiveViewer").open) {
      if (ArchiveOutput.printFrame) ArchiveOutput.printFile();
      else if (ArchiveOutput.rows.length)
        this.run(ArchiveOutput.rows, ArchiveOutput.face ? "face" : "print");
      return true;
    }
    if (!this.selected.size) return false;
    this.run(this.selectedRows(), "print");
    return true;
  },
  async run(rows, action) {
    if (this.busy || !rows.length) return;
    this.busy = true;
    this.selectionState();
    $("archiveStatus").textContent = "";
    try {
      if (action === "view") await ArchiveOutput.view(rows[0]);
      else {if(Cloud.enabled)for(const entry of rows)await Cloud.materialize(entry);await ArchiveOutput.output(rows, action);}
    } catch (e) {
      const message = "تعذّر فتح المستند أو تجهيزه. " + e.message;
      $("archiveStatus").textContent = message;
      if ($("archiveViewer").open) $("viewTitle").textContent = message;
    } finally {
      this.busy = false;
      this.selectionState();
    }
  },
};
