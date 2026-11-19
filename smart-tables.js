const SmartTables = {
  columns: [
    ["trim", "الطراز", 10],
    ["model", "الموديل", 4],
    ["type", "النوع", 8],
    ["specs", "المواصفات", 18],
    ["qty", "العدد", 4],
    ["price", "السعر", 10],
    ["fuel", "نوع الوقود", 8],
    ["attachments", "المرفقات", 12],
    ["notes", "الملاحظات", 18],
  ],
  parents: new Map(),
  snapshot(data) {
    const result = clone(data);
    for (const rows of Object.values(result.tableData || {}))
      for (const row of rows) {
        if (!row.priceLink) continue;
        const item = cfg.priceCatalogs
          ?.find((c) => c.id === row.priceLink.catalog)
          ?.items.find((i) => i.id === row.priceLink.item);
        if (item) Object.assign(row, item, { qty: row.qty || 1 });
        delete row.priceLink;
      }
    return result;
  },
  init() {
    $("homeCreate").hidden = true;
    $("newLetter").hidden = true;
    $("importArchive").hidden = true;
    const mark = document.createElement("strong");
    mark.id = "toolbarBrand";
    mark.textContent = "Contracts";
    $("toolbar").append(mark);
    const setup = document.createElement("button");
    setup.id = "tableSetupButton";
    setup.textContent = "إعدادات الجدول والأعمدة";
    setup.onclick = () => this.wizard(App.selected()[0]);
    $("tablePanel").prepend(setup);
    const catalog = document.createElement("button");
    catalog.id = "priceCatalogButton";
    catalog.textContent = "قوائم الأسعار المعتمدة";
    catalog.onclick = () => this.catalogs();
    $("catalogActions").append(catalog);
    const form = Workbench.form.bind(Workbench);
    Workbench.form = () => {
      if (this.committingCell) return;
      form();
      this.inputs();
    };
    this.inputs();
  },
  dialog(title) {
    const el = document.createElement("dialog");
    el.className = "smart-dialog";
    el.innerHTML =
      "<header><h3>" +
      esc(title) +
      '</h3><button type="button" aria-label="إغلاق">×</button></header><div class="smart-body"></div>';
    el.querySelector("header button").onclick = () => el.close();
    el.onclose = () => el.remove();
    document.body.append(el);
    return el;
  },
  wizard(existing) {
    const current = existing?.liveTable || existing?.tableSetup || {};
    const dialog = this.dialog("إضافة / إعداد جدول"),
      body = dialog.querySelector(".smart-body");
    body.innerHTML =
      '<div class="smart-grid"><label>قالب جاهز<select name="preset"><option value="custom">جدول مخصص</option><option value="vehicle">بيانات مركبة — مثل تخويل القيادة</option><option value="prices">أسعار السيارات</option></select></label><label>شكل الجدول<select name="style"><option value="grid">جدول مقسم</option><option value="cards">خانات منفصلة</option></select></label><label>المحتوى<select name="mode"><option value="fillable">قابل للملء</option><option value="fixed">ثابت — يحرر بمود التعديل</option></select></label><label>اتجاه الأعمدة<select name="direction"><option value="rtl">من اليمين لليسار</option><option value="ltr">من اليسار لليمين</option></select></label><label><input name="numbered" type="checkbox"> عمود ترقيم (ت)</label><label><input name="total" type="checkbox"> مجموع السعر × العدد</label><label>ارتفاع السطر / مم<input name="rowHeight" type="number" min="6" max="20" value="9"></label><label>الأسطر الأولية<input name="initialRows" type="number" min="1" max="30" value="3"></label></div><p>حدد الأعمدة وعدّل عرضها التقريبي بالأحرف. عرض الترقيم ثابت لرقمين.</p><div class="column-options"></div><p class="smart-error" role="alert"></p><button class="primary save-table" type="button">' +
      (existing ? "تطبيق الإعدادات" : "إضافة الجدول") +
      "</button>";
    const get = (name) => body.querySelector('[name="' + name + '"]');
    for (const [key, label, width] of this.columns) {
      const l = document.createElement("label");
      l.innerHTML =
        '<input type="checkbox" data-column="' +
        key +
        '">' +
        label +
        '<input type="number" min="2" max="50" value="' +
        (current.widths?.[key] || width) +
        '" aria-label="عرض ' +
        label +
        '" data-width="' +
        key +
        '">';
      l.querySelector("[type=checkbox]").checked = (
        current.columns || ["trim", "model", "price"]
      ).includes(key);
      body.querySelector(".column-options").append(l);
    }
    for (const name of [
      "style",
      "mode",
      "direction",
      "rowHeight",
      "initialRows",
    ])
      if (current[name] != null) get(name).value = current[name];
    get("numbered").checked = !!current.numbered;
    get("total").checked = !!current.total;
    get("preset").onchange = () => {
      if (get("preset").value === "prices") {
        for (const c of body.querySelectorAll("[data-column]"))
          c.checked = ["trim", "model", "price"].includes(c.dataset.column);
        get("total").checked = false;
      }
      if (get("preset").value === "vehicle") get("style").value = "cards";
    };
    body.querySelector(".save-table").onclick = () => {
      if (get("preset").value === "vehicle") {
        App.commitText();
        App.checkpoint();
        const page = App.current(),
          grid = TransferLetter.vehicleGrid(
            "vehicle-" + crypto.randomUUID(),
            20,
            85,
            170,
            45,
          );
        const holder = { nodes: [grid] };
        TransferLetter.cards(holder);
        page.nodes.push(...holder.nodes);
        App.selection = new Set(holder.nodes.map((n) => n.id));
        App.render();
        App.persist();
        dialog.close();
        return;
      }
      const columns = [...body.querySelectorAll("[data-column]:checked")].map(
        (el) => el.dataset.column,
      );
      if (!columns.length) {
        body.querySelector(".smart-error").textContent =
          "اختر عموداً واحداً على الأقل.";
        return;
      }
      const config = {
        ...current,
        columns,
        widths: Object.fromEntries(
          [...body.querySelectorAll("[data-width]")].map((el) => [
            el.dataset.width,
            Math.max(2, Math.min(50, Number(el.value) || 10)),
          ]),
        ),
        style: get("style").value,
        mode: get("mode").value,
        direction: get("direction").value,
        numbered: get("numbered").checked,
        total: columns.includes("price") && get("total").checked,
        rowHeight: Math.max(
          6,
          Math.min(20, Number(get("rowHeight").value) || 9),
        ),
        initialRows: Math.max(
          1,
          Math.min(30, Number(get("initialRows").value) || 3),
        ),
      };
      let node = existing;
      if (!node) node = App.create("table");
      else {
        App.commitText();
        App.checkpoint();
      }
      node.tableSetup = config;
      node.name =
        "جدول " +
        columns.map((k) => this.columns.find((c) => c[0] === k)[1]).join(" / ");
      node.w = 170;
      node.fill = "transparent";
      node.fontSize = 18;
      node.strokeWidth = 1;
      node.stroke = "#8299ad";
      node.direction = config.direction;
      node.radius = config.style === "cards" ? 1.5 : 0;
      if (config.mode === "fillable") {
        node.liveTable = config;
        node.html = this.html(
          node,
          Array.from({ length: config.initialRows }, () => ({})),
        );
        node.h =
          (config.initialRows + 1 + Number(config.total)) * config.rowHeight;
      } else {
        delete node.liveTable;
        node.html = this.html(
          { ...node, liveTable: config },
          Array.from({ length: config.initialRows }, () => ({})),
        );
        node.h =
          (config.initialRows + 1 + Number(config.total)) * config.rowHeight;
      }
      if (!existing) this.place(node, App.current());
      App.render();
      App.persist();
      dialog.close();
    };
    dialog.showModal();
  },
  rows(node) {
    const id = node.tableSource || node.id;
    return (d.tableData?.[id] || []).map((row) => {
      if (!row.priceLink) return row;
      const catalog = cfg.priceCatalogs?.find(
        (c) => c.id === row.priceLink.catalog,
      );
      const item = catalog?.items.find((i) => i.id === row.priceLink.item);
      return item ? { ...row, ...item, qty: row.qty || 1 } : row;
    });
  },
  html(node, rows, offset = 0, final = true, allRows = rows) {
    const c = node.liveTable || node.tableSetup;
    const cols = this.keys(c);
    const weights = cols.map((k) => (k === "serial" ? 2 : c.widths?.[k] || 10)),
      sum = weights.reduce((a, b) => a + b, 0);
    const label = (k) =>
      k === "serial" ? "ت" : this.columns.find((x) => x[0] === k)?.[1] || k;
    const td = (row, key, index) =>
      key === "serial"
        ? (row._serial ?? offset + index + 1)
        : key === "price" && row[key] !== "" && row[key] != null
          ? money(amount(row[key]))
          : (row[key] ?? "");
    return (
      '<table class="smart-document ' +
      (c.style === "cards" ? "smart-cards" : "") +
      '" dir="' +
      c.direction +
      '"><colgroup>' +
      weights
        .map(
          (w, i) =>
            '<col style="width:' +
            (c.numbered
              ? cols[i] === "serial"
                ? ((c.serialWidth || 8) / node.w) * 100
                : (((w / (sum - 2)) * (node.w - (c.serialWidth || 8))) /
                    node.w) *
                  100
              : (w / sum) * 100) +
            '%">',
        )
        .join("") +
      "</colgroup><thead><tr>" +
      cols.map((k) => "<th>" + esc(label(k)) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows
        .map(
          (r, i) =>
            '<tr style="height:' +
            this.rowHeight(node, r, offset + i) +
            'mm">' +
            cols.map((k) => "<td>" + esc(td(r, k, i)) + "</td>").join("") +
            "</tr>",
        )
        .join("") +
      "</tbody>" +
      (c.total && final
        ? '<tfoot><tr><th colspan="' +
          Math.max(1, cols.length - 1) +
          '">المجموع الكلي' +
          (cols.length === 1 ? " · " + money(this.total(allRows)) : "") +
          "</th>" +
          (cols.length > 1
            ? "<td>" + money(this.total(allRows)) + "</td>"
            : "") +
          "</tr></tfoot>"
        : "") +
      "</table>"
    );
  },
  keys(c) {
    const keys = c.numbered ? ["serial", ...c.columns] : [...c.columns];
    return c.columnOrder
      ? [
          ...c.columnOrder.filter((k) => keys.includes(k)),
          ...keys.filter((k) => !c.columnOrder.includes(k)),
        ]
      : keys;
  },
  total(rows) {
    return rows.reduce(
      (sum, r) =>
        sum +
        amount(r.price) * (r.qty === "" || r.qty == null ? 1 : amount(r.qty)),
      0,
    );
  },
  rowHeight(node, row, index = Number(row._serial || 1) - 1) {
    const c = node.liveTable || node.tableSetup,
      weights = c.columns.map((k) => c.widths?.[k] || 10),
      sum = weights.reduce((a, b) => a + b, 0);
    let height = Math.max(c.rowHeight, c.rowHeights?.[index + 1] || 0);
    for (let i = 0; i < c.columns.length; i++) {
      const fontSize =
        parseFloat(
          c.cellStyles?.[index + 1 + ":" + this.keys(c).indexOf(c.columns[i])]
            ?.fontSize,
        ) ||
        node.fontSize ||
        18;
      const width =
          ((node.w - (c.numbered ? c.serialWidth || 8 : 0)) * weights[i]) /
            sum -
          2,
        chars = Math.max(3, Math.floor(width / (fontSize * 0.264 * 0.5)));
      const lines = String(row[c.columns[i]] ?? "")
        .split("\n")
        .reduce(
          (n, line) => n + Math.max(1, Math.ceil(line.length / chars)),
          0,
        );
      height = Math.max(height, lines * fontSize * 0.264 * 1.15 + 2);
    }
    return Math.ceil(height);
  },
  place(n, page) {
    let at = 38;
    const gaps = [];
    for (const x of page.nodes
      .filter(
        (x) =>
          x.id !== n.id && x.type !== "image" && x.y < 275 && x.y + x.h > 38,
      )
      .sort((a, b) => a.y - b.y)) {
      if (x.y - 3 > at) gaps.push([at, x.y - 3 - at]);
      at = Math.max(at, x.y + x.h + 3);
    }
    if (at < 275) gaps.push([at, 275 - at]);
    const gap =
      gaps.find((g) => g[1] >= n.h) || gaps.sort((a, b) => b[1] - a[1])[0];
    if (gap) n.y = gap[0];
  },
  rowExtent(n, row) {
    return (
      this.rowHeight(n, row) +
      ((n.liveTable || n.tableSetup).style === "cards" ? 1 : 0.3)
    );
  },
  overhead(n, total) {
    const c = n.liveTable || n.tableSetup;
    return (
      Math.max(c.rowHeight, c.rowHeights?.[0] || 0) +
      c.rowHeight * Number(total) +
      (c.style === "cards" ? 1 : 0.3) * (2 + Number(total)) +
      1
    );
  },
  model(n) {
    if (!n.liveTable) {
      if (!n.tableSetup) return n;
      const holder = document.createElement("div");
      renderMarkup(holder, n.html, true);
      if (n.tableSetup.numbered || n.tableSetup.serialColumnIndex >= 0)
        holder.querySelectorAll("tbody tr").forEach((tr, i) => {
          const serial = n.tableSetup.numbered
            ? 0
            : n.tableSetup.serialColumnIndex;
          if (tr.cells[serial]) tr.cells[serial].textContent = i + 1;
        });
      const cols = n.tableSetup.columns,
        priceIndex = cols.indexOf("price") + Number(n.tableSetup.numbered),
        qtyIndex = cols.indexOf("qty");
      const rows = [...holder.querySelectorAll("tbody tr")].map((tr) => ({
        price: tr.cells[priceIndex]?.textContent || "",
        qty:
          qtyIndex < 0
            ? 1
            : tr.cells[qtyIndex + Number(n.tableSetup.numbered)]?.textContent ||
              1,
      }));
      const cell =
        holder.querySelector("tfoot td") || holder.querySelector("tfoot th");
      if (cell)
        cell.textContent =
          (cols.length + Number(n.tableSetup.numbered) === 1
            ? "المجموع الكلي · "
            : "") + money(this.total(rows));
      return { ...n, html: holder.innerHTML };
    }
    const rows =
      n.tableSlice ||
      (App.mode === "design"
        ? Array.from({ length: n.liveTable.initialRows }, () => ({}))
        : this.rows(n));
    const all = this.rows(n);
    return {
      ...n,
      h:
        n.tableHeight ||
        Math.max(
          n.liveTable.rowHeight * 2,
          rows.reduce(
            (sum, row) => sum + this.rowExtent(n, row),
            this.overhead(n, n.liveTable.total && n.tableFinal !== false),
          ),
        ),
      html: this.html(n, rows, n.tableOffset || 0, n.tableFinal !== false, all),
    };
  },
  expand(pages, design) {
    this.parents.clear();
    let nextId = 40000000;
    if (design) return pages;
    const output = [];
    for (const original of pages) {
      if (!original.nodes.some((n) => n.liveTable)) {
        output.push(original);
        continue;
      }
      const page = clone(original);
      output.push(page);
      let index = 0;
      for (const n of page.nodes.filter((n) => n.liveTable)) {
        const c = n.liveTable,
          rows = this.rows(n).flatMap((row, i) =>
            this.splitRow(
              n,
              { ...row, _serial: i + 1 },
              221 - this.overhead(n, c.total),
            ),
          );
        const below = page.nodes
          .filter(
            (x) =>
              x.id !== n.id &&
              x.y > n.y + 1 &&
              x.x < n.x + n.w &&
              x.x + x.w > n.x &&
              x.type !== "image",
          )
          .map((x) => x.y - 3);
        const limit = Math.min(276, ...below);
        const chunks = [];
        let chunk = [],
          used = 0,
          budget = Math.max(
            c.rowHeight,
            limit - n.y - this.overhead(n, c.total),
          );
        for (const row of rows) {
          const height = this.rowExtent(n, row);
          if (!chunks.length && !chunk.length && height > budget) {
            chunks.push([]);
            budget = 221 - this.overhead(n, c.total);
          }
          if (chunk.length && used + height > budget) {
            chunks.push(chunk);
            chunk = [];
            used = 0;
            budget = 221 - this.overhead(n, c.total);
          }
          chunk.push(row);
          used += height;
        }
        chunks.push(chunk);
        let offset = 0;
        chunks.forEach((chunk, i) => {
          const target = i
            ? { ...clone(n), id: n.id + "-part-" + i, tableSource: n.id, y: 55 }
            : n;
          target.tableSlice = chunk;
          target.tableOffset = offset;
          offset += chunk.length;
          target.tableFinal = i === chunks.length - 1;
          target.tableHeight = chunk.reduce(
            (sum, row) => sum + this.rowExtent(n, row),
            this.overhead(n, c.total && target.tableFinal),
          );
          if (i) {
            const id = nextId++;
            this.parents.set(id, original.id);
            output.push({
              id,
              name: original.name + " · تابع " + i,
              tableParent: original.id,
              paperLayout: 3,
              nodes: [
                ...clone(
                  original.nodes.filter((x) => x.type === "image" && x.z < 0),
                ),
                {
                  id: "continued-" + id,
                  type: "text",
                  x: 20,
                  y: 35,
                  w: 170,
                  h: 12,
                  fontSize: 20,
                  html: "تابع — العدد: {{number}} — {{date}}",
                  align: "center",
                },
                target,
              ],
            });
          }
        });
        index++;
      }
    }
    return output;
  },
  splitRow(n, row, budget) {
    if (this.rowExtent(n, row) <= budget) return [row];
    const c = n.liveTable,
      weights = c.columns.map((k) => c.widths?.[k] || 10),
      sum = weights.reduce((a, b) => a + b, 0);
    const parts = {};
    let count = 1;
    for (let i = 0; i < c.columns.length; i++) {
      const key = c.columns[i],
        text = String(row[key] ?? "");
      if (["price", "qty"].includes(key)) {
        parts[key] = [text];
        continue;
      }
      const width = ((n.w - (c.numbered ? 8 : 0)) * weights[i]) / sum - 2,
        chars = Math.max(
          3,
          Math.floor(width / ((n.fontSize || 18) * 0.264 * 0.5)),
        ),
        lines = Math.max(
          1,
          Math.floor((budget - 5) / ((n.fontSize || 18) * 0.264 * 1.15)),
        );
      const chunks = [];
      for (let at = 0; at < text.length; at += chars * lines)
        chunks.push(text.slice(at, at + chars * lines));
      parts[key] = chunks;
      count = Math.max(count, chunks.length);
    }
    return Array.from({ length: count }, (_, i) => ({
      ...row,
      ...Object.fromEntries(c.columns.map((k) => [k, parts[k][i] || ""])),
    }));
  },
  changed() {
    render();
    saveDraft();
  },
  inputs() {
    if (App.mode === "design" || Services.home) return;
    let root = $("smartTableInputs");
    if (
      root?.contains(document.activeElement) &&
      document.activeElement.matches("input,textarea")
    )
      return;
    root?.remove();
    const tables = (App.displayPages || [])
      .filter((p) => !p.tableParent)
      .flatMap((p) => p.nodes)
      .filter((n) => n.liveTable);
    document.body.classList.toggle("has-smart-tables", !!tables.length);
    if (!tables.length) return;
    root = document.createElement("section");
    root.id = "smartTableInputs";
    const host = d.standaloneBook ? $("bookFields") : $("fillPanel");
    host.append(root);
    for (const node of tables) {
      const section = document.createElement("section");
      section.className = "table-entry";
      const h = document.createElement("h4");
      h.textContent = node.name;
      section.append(h);
      const id = node.id;
      d.tableData ||= {};
      d.tableData[id] ||= [];
      const catalogRow = document.createElement("div");
      catalogRow.className = "table-entry-tools";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "قائمة الأسعار");
      select.add(new Option("اختر قائمة أسعار معتمدة", ""));
      const today = d.contractDate || new Date().toISOString().slice(0, 10);
      for (const c of cfg.priceCatalogs || [])
        if ((!c.from || c.from <= today) && (!c.to || c.to >= today))
          select.add(
            new Option(
              c.name +
                " · " +
                (c.category || "عام") +
                " · " +
                (c.from || "—") +
                " / " +
                (c.to || "—"),
              c.id,
            ),
          );
      select.value =
        d.priceCatalogId || cfg.bookPriceDefaults?.[d.standaloneBook] || "";
      const apply = document.createElement("button");
      apply.textContent = "اختيار الأصناف";
      apply.onclick = () => this.pickPrices(node, select.value);
      catalogRow.append(select, apply);
      section.append(catalogRow);
      const wrap = document.createElement("div");
      wrap.className = "table-entry-scroll";
      const table = document.createElement("table");
      table.innerHTML =
        "<thead><tr>" +
        node.liveTable.columns
          .map(
            (k) =>
              "<th>" +
              esc(this.columns.find((c) => c[0] === k)?.[1] || k) +
              "</th>",
          )
          .join("") +
        "<th></th></tr></thead><tbody></tbody>";
      const tbody = table.querySelector("tbody");
      const resolved = this.rows(node);
      d.tableData[id].forEach((row, i) => {
        const tr = document.createElement("tr");
        for (const key of node.liveTable.columns) {
          const td = document.createElement("td"),
            input = document.createElement("input");
          input.value = resolved[i]?.[key] ?? "";
          input.setAttribute(
            "aria-label",
            this.columns.find((c) => c[0] === key)?.[1] + " " + (i + 1),
          );
          input.maxLength = 500;
          input.inputMode = ["price", "qty", "model"].includes(key)
            ? "decimal"
            : "text";
          input.onchange = () => {
            if (row.priceLink) {
              Object.assign(row, resolved[i]);
              delete row.priceLink;
            }
            row[key] = input.value;
            // Keep the next cell mounted while the browser transfers focus.
            this.committingCell = true;
            try { this.changed(); }
            finally { this.committingCell = false; }
          };
          td.append(input);
          tr.append(td);
        }
        const remove = document.createElement("button");
        remove.textContent = "×";
        remove.title = "حذف السطر";
        remove.onclick = () => {
          d.tableData[id].splice(i, 1);
          this.changed();
        };
        const td = document.createElement("td");
        td.append(remove);
        tr.append(td);
        tbody.append(tr);
      });
      wrap.append(table);
      section.append(wrap);
      const add = document.createElement("button");
      add.textContent = "＋ سطر";
      add.onclick = () => {
        d.tableData[id].push({ qty: 1 });
        this.changed();
      };
      section.append(add);
      root.append(section);
    }
  },
  pickPrices(node, catalogId) {
    const catalog = cfg.priceCatalogs?.find((c) => c.id === catalogId);
    if (!catalog) {
      Feedback.notice("اختر قائمة أسعار سارية أولاً.");
      return;
    }
    const dialog = this.dialog("اختيار أصناف · " + catalog.name),
      body = dialog.querySelector(".smart-body");
    for (const item of catalog.items) {
      const label = document.createElement("label");
      label.className = "price-pick";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.item = item.id;
      input.checked = (d.tableData?.[node.id] || []).some(
        (r) =>
          r.priceLink?.catalog === catalog.id && r.priceLink?.item === item.id,
      );
      label.append(
        input,
        document.createTextNode(
          [item.trim, item.model, money(amount(item.price)) + " د.ع"].join(
            " · ",
          ),
        ),
      );
      body.append(label);
    }
    const all = document.createElement("label");
    all.innerHTML = '<input type="checkbox"> تحديد الكل';
    all.querySelector("input").onchange = (e) =>
      body
        .querySelectorAll("[data-item]")
        .forEach((c) => (c.checked = e.target.checked));
    body.prepend(all);
    const apply = document.createElement("button");
    apply.textContent = "اعتماد الأصناف المحددة";
    apply.onclick = () => {
      const selected = new Set(
        [...body.querySelectorAll("[data-item]:checked")].map(
          (c) => c.dataset.item,
        ),
      );
      const rows = d.tableData[node.id] || [];
      const existing = new Map(
        rows
          .filter((r) => r.priceLink?.catalog === catalog.id)
          .map((r) => [r.priceLink.item, r]),
      );
      d.tableData[node.id] = [
        ...rows.filter((r) => r.priceLink?.catalog !== catalog.id),
        ...catalog.items
          .filter((i) => selected.has(i.id))
          .map(
            (i) =>
              existing.get(i.id) || {
                ...clone(i),
                qty: 1,
                priceLink: { catalog: catalog.id, item: i.id },
              },
          ),
      ];
      d.priceCatalogId = catalog.id;
      this.changed();
      dialog.close();
    };
    body.append(apply);
    dialog.showModal();
  },
  catalogs() {
    const dialog = this.dialog("قوائم الأسعار والتصنيفات"),
      body = dialog.querySelector(".smart-body");
    const draft = clone(cfg.priceCatalogs || []),
      defaults = clone(cfg.bookPriceDefaults || {});
    let index = 0;
    const paint = () => {
      body.replaceChildren();
      const select = document.createElement("select");
      draft.forEach((c, i) =>
        select.add(new Option(c.name || "قائمة جديدة", String(i))),
      );
      select.value = String(index);
      select.onchange = () => {
        index = Number(select.value);
        paint();
      };
      const add = document.createElement("button");
      add.textContent = "＋ قائمة أسعار";
      add.onclick = () => {
        draft.push({
          id: crypto.randomUUID(),
          name: "قائمة جديدة",
          category: "",
          from: "",
          to: "",
          items: [],
        });
        index = draft.length - 1;
        paint();
      };
      body.append(select, add);
      const c = draft[index];
      if (c) {
        const fields = document.createElement("div");
        fields.className = "smart-grid";
        for (const [key, label, type] of [
          ["name", "اسم القائمة", "text"],
          ["category", "التصنيف", "text"],
          ["from", "سارية من", "date"],
          ["to", "سارية لغاية", "date"],
        ]) {
          const l = document.createElement("label");
          l.textContent = label;
          const input = document.createElement("input");
          input.type = type;
          input.value = c[key] || "";
          input.oninput = () => (c[key] = input.value);
          l.append(input);
          fields.append(l);
        }
        body.append(fields);
        const scroll = document.createElement("div");
        scroll.className = "table-entry-scroll";
        const table = document.createElement("table");
        table.innerHTML =
          "<thead><tr><th>الطراز</th><th>الموديل</th><th>النوع</th><th>المواصفات</th><th>السعر</th><th>الوقود</th><th></th></tr></thead><tbody></tbody>";
        c.items.forEach((item, i) => {
          const row = table.querySelector("tbody").insertRow();
          for (const key of [
            "trim",
            "model",
            "type",
            "specs",
            "price",
            "fuel",
          ]) {
            const input = document.createElement("input");
            input.value = item[key] || "";
            input.setAttribute("aria-label", key + " " + (i + 1));
            input.oninput = () => (item[key] = input.value);
            row.insertCell().append(input);
          }
          const remove = document.createElement("button");
          remove.textContent = "×";
          remove.onclick = () => {
            c.items.splice(i, 1);
            paint();
          };
          row.insertCell().append(remove);
        });
        scroll.append(table);
        body.append(scroll);
        const itemAdd = document.createElement("button");
        itemAdd.textContent = "＋ صنف / سعر";
        itemAdd.onclick = () => {
          c.items.push({
            id: crypto.randomUUID(),
            trim: "",
            model: "",
            type: "",
            price: "",
            fuel: "",
          });
          paint();
        };
        body.append(itemAdd);
      }
      const heading = document.createElement("h4");
      heading.textContent = "قائمة الأسعار الافتراضية لكل كتاب";
      body.append(heading);
      for (const t of [
        { id: 4, name: "تخويل قيادة" },
        { id: 0, name: "نقل ملكية" },
        ...(cfg.letterTemplates || []),
      ]) {
        const label = document.createElement("label");
        label.textContent = t.name;
        const choice = document.createElement("select");
        choice.add(new Option("بدون قائمة افتراضية", ""));
        draft.forEach((c) =>
          choice.add(new Option(c.name + " · " + c.category, c.id)),
        );
        choice.value = defaults[t.id] || "";
        choice.onchange = () => (defaults[t.id] = choice.value);
        label.append(choice);
        body.append(label);
      }
      const status = document.createElement("p");
      status.className = "smart-error";
      body.append(status);
      const save = document.createElement("button");
      save.className = "primary";
      save.textContent = "حفظ قوائم الأسعار";
      save.onclick = async () => {
        if (
          draft.some(
            (c) =>
              !c.name.trim() ||
              (c.from && c.to && c.from > c.to) ||
              c.items.some(
                (i) =>
                  !i.trim?.trim() ||
                  String(i.price).trim() === "" ||
                  !Number.isFinite(amount(i.price)) ||
                  amount(i.price) < 0,
              ),
          )
        ) {
          status.textContent =
            "راجع الأسماء والأسعار وفترات السريان؛ اسم الطراز والسعر مطلوبان.";
          return;
        }
        cfg.priceCatalogs = draft;
        cfg.bookPriceDefaults = defaults;
        await saveConfig();
        render();
        dialog.close();
      };
      body.append(save);
    };
    paint();
    dialog.showModal();
  },
};
