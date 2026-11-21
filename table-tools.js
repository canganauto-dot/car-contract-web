/* Table design editing. Geometry is stored in mm; browser controls never enter exports. */
const TableTools = {
  init() {
    this.ready = true;
    const panel = document.createElement("div");
    panel.id = "tableCellTools";
    panel.innerHTML =
      '<p class="hint">حدد خلية أو دائرة صف/عمود. اسحب ↔ أو ↕ لتغيير المقاس؛ الأسهم بلوحة المفاتيح تغيّره 1 مم.</p><div class="properties-grid"><label>تعبئة الخلية<input id="cellFill" type="color"></label><label>لون نص الخلية<input id="cellInk" type="color"></label><label>حجم نص الخلية<input id="cellSize" type="number" min="6" max="96"></label></div><div class="row-buttons"><button id="tableInsertColumn">عمود إلى اليمين</button><button id="tableDeleteColumn">حذف العمود</button><button id="tableInsertRow">صف أسفل المحدد</button><button id="tableDeleteRow">حذف الصف</button></div>';
    $("tablePanel").append(panel);
    for (const [id, prop] of [
      ["cellFill", "backgroundColor"],
      ["cellInk", "color"],
      ["cellSize", "fontSize"],
    ])
      $(id).onchange = (e) => {
        if (prop !== "fontSize") return this.style(prop, e.target.value);
        const size = EditorSettings.number(e.target.value, EditorSettings.text.fontSize);
        if (size === null) return this.refresh();
        this.style(prop, size + "px");
      };
    EditorSettings.input($("cellSize"), EditorSettings.text.fontSize);
    for (const [id, kind] of [
      ["tableInsertColumn", "insertColumn"],
      ["tableDeleteColumn", "deleteColumn"],
      ["tableInsertRow", "insertRow"],
      ["tableDeleteRow", "deleteRow"],
    ])
      $(id).onclick = () => this.structure(kind);
  },
  clear() {
    document
      .querySelectorAll(".table-editor-control")
      .forEach((n) => n.remove());
  },
  templateHTML(n, table) {
    const original=sanitizeMarkup(n.html,true).querySelectorAll("td,th"), copy=table.cloneNode(true);
    for(const cell of copy.querySelectorAll("td,th")){
      const source=original[cell.dataset.cell];
      if(source)cell.replaceChildren(...[...source.childNodes].map(child=>child.cloneNode(true)));
    }
    return safeMarkup(copy.outerHTML,true);
  },
  info() {
    const n = App.selected()[0];
    if (
      App.mode !== "design" ||
      n?.type !== "table" ||
      App.selection.size !== 1 ||
      App.editing
    )
      return null;
    const element = App.element(n.id),
      table = element?.querySelector("table");
    if (!table) return null;
    const map = App.tableGrid(table);
    return {
      n,
      element,
      table,
      ...map,
      cells: [...table.querySelectorAll("td,th")],
      unit: element.closest(".paper").getBoundingClientRect().width / 210,
    };
  },
  refresh() {
    this.clear();
    if (!this.ready) return;
    const info = this.info();
    if (!info) return;
    const { n, table, grid, cells, positions, unit } = info;
    if (this.nodeId !== n.id) {
      this.active = null;
      this.nodeId = n.id;
    }
    const chosen = App.cells.map((i) => cells[i]).filter(Boolean);
    cells.forEach((c, i) =>
      c.classList.toggle("picked-cell", App.cells.includes(i)),
    );
    const c = chosen[0],
      style = c && getComputedStyle(c);
    for (const id of ["cellFill", "cellInk", "cellSize"]) $(id).disabled = !c;
    if (style) {
      $("cellFill").value = BoxAppearance.parse(style.backgroundColor).hex;
      $("cellInk").value = BoxAppearance.parse(style.color).hex;
      $("cellSize").value = parseFloat(style.fontSize);
    }
    const dims = c && this.dimensions(info);
    for (const [id, axis] of [["columnWidth", "column"], ["rowHeight", "row"]]) {
      const field = $(id);
      field.disabled = !c;
      if (!c) { field.value = ""; continue; }
      const indices = this.selectedAxes(info, axis);
      const sizes = axis === "column" ? dims.widths : dims.heights;
      EditorSettings.input(field, this.sizeRange(info, axis, indices, dims));
      field.value = indices.every(i => roundMM(sizes[i]) === roundMM(sizes[indices[0]])) ? roundMM(sizes[indices[0]]) : "";
    }
    const pos = c && positions.get(c);
    for (const id of [
      "tableInsertColumn",
      "tableDeleteColumn",
      "tableInsertRow",
      "tableDeleteRow",
    ])
      $(id).disabled = !pos;
    if (App.tableId !== n.id) return;
    const rect = table.getBoundingClientRect(),
      layer = $("selectionLayer"),
      cols = Math.max(...grid.map((r) => r.length));
    const boundary = [];
    // Prefer colgroup geometry: it remains accurate in the presence of merged cells.
    const colElements = [...table.querySelectorAll("col")];
    const widths = Array.from({ length: cols }, (_, x) => {
      if (colElements[x]?.getBoundingClientRect().width)
        return colElements[x].getBoundingClientRect().width;
      const cell =
        grid.map((r) => r[x]).find((c) => c?.colSpan === 1) || grid[0][x];
      return cell.getBoundingClientRect().width / cell.colSpan;
    });
    const rtl = getComputedStyle(table).direction === "rtl";
    let edge = rtl ? rect.right : rect.left;
    for (let x = 0; x < cols; x++) {
      const width = widths[x],
        next = edge + (rtl ? -width : width);
      this.control(
        layer,
        (edge + next) / 2,
        rect.top - 13,
        "اختيار العمود " + (x + 1),
        "column",
        () => this.select("column", x),
        this.active?.axis === "column" && this.active.index === x,
      );
      this.handle(
        layer,
        next,
        rect.top + 10,
        "column",
        x,
        width / unit,
        info,
        rtl,
      );
      boundary.push(next);
      edge = next;
    }
    [...table.rows].forEach((row, y) => {
      const r = row.getBoundingClientRect();
      this.control(
        layer,
        rect.right + 13,
        r.top + r.height / 2,
        "اختيار الصف " + (y + 1),
        "row",
        () => this.select("row", y),
        this.active?.axis === "row" && this.active.index === y,
      );
      this.handle(
        layer,
        rect.left + 12,
        r.bottom,
        "row",
        y,
        r.height / unit,
        info,
        rtl,
      );
    });
  },
  control(layer, x, y, label, axis, click, selected = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "table-editor-control table-pick";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.setAttribute("aria-pressed", String(selected));
    b.style.left = x + "px";
    b.style.top = y + "px";
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => {
      e.stopPropagation();
      click();
    };
    layer.append(b);
    return b;
  },
  handle(layer, x, y, axis, index, size, info, rtl) {
    const b = this.control(
      layer,
      x,
      y,
      (axis === "column" ? "عرض العمود" : "ارتفاع الصف") +
        " " +
        (index + 1) +
        " · اسحب أو استخدم الأسهم",
      axis,
      () => {},
    );
    b.className = "table-editor-control table-resize " + axis;
    b.innerHTML =
      axis === "column"
        ? '<svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 3v18M8 7l4-4 4 4m-8 10 4 4 4-4"/></svg>';
    b.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
        return;
      e.preventDefault();
      e.stopPropagation();
      const delta = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1;
      this.resize(axis, index, size + delta);
    };
    b.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      const start = axis === "column" ? e.clientX : e.clientY,
        current = this.dimensions(info),
        original = info.table.cloneNode(true),
        oldW = info.element.style.width,
        oldH = info.element.style.height;
      let value = size;
      const move = (ev) => {
        const delta =
          (((axis === "column" ? ev.clientX : ev.clientY) - start) /
            info.unit) *
          (axis === "column" && rtl ? -1 : 1);
        value = EditorSettings.number(size + delta, this.sizeRange(info, axis, [index], current));
        this.previewResize(info, axis, index, value, current);
      };
      const finish = (ev) => {
        b.removeEventListener("pointermove", move);
        b.removeEventListener("pointerup", finish);
        b.removeEventListener("pointercancel", cancel);
        info.table.replaceWith(original);
        info.element.style.width = oldW;
        info.element.style.height = oldH;
        if (ev.type !== "pointercancel")
          this.resize(axis, index, value, current);
        else this.refresh();
      };
      const cancel = () => finish({ type: "pointercancel" });
      b.addEventListener("pointermove", move);
      b.addEventListener("pointerup", finish);
      b.addEventListener("pointercancel", cancel);
    };
  },
  dimensions(info) {
    const { table, grid, unit, n } = info;
    const cols = [...table.querySelectorAll("col")],
      count = Math.max(...grid.map((r) => r.length)),
      config = n.liveTable,
      keys = config ? SmartTables.keys(config) : [];
    return {
      widths: Array.from({ length: count }, (_, x) => {
        if (config?.explicitWidths) {
          const stored=keys[x]==="serial" ? config.serialWidth || 8 : config.widths?.[keys[x]];
          if(Number.isFinite(stored) && stored>0)return stored;
        }
        const c = cols[x];
        if (c?.style.width.endsWith("mm")) return parseFloat(c.style.width);
        if (unit>0 && c?.getBoundingClientRect().width)
          return c.getBoundingClientRect().width / unit;
        const cell =
          grid.map((r) => r[x]).find((c) => c?.colSpan === 1) || grid[0][x];
        return unit>0 && cell?.getBoundingClientRect().width
          ? cell.getBoundingClientRect().width / cell.colSpan / unit : n.w/count;
      }),
      heights: [...table.rows].map(
        (r, i) =>
          config?.rowHeights?.[i] ||
          (r.style.height.endsWith("mm")
            ? parseFloat(r.style.height)
            : r.getBoundingClientRect().height / unit),
      ),
    };
  },
  setDimensions(table, widths, heights) {
    table.querySelector("colgroup")?.remove();
    const group = document.createElement("colgroup");
    for (const w of widths) {
      const c = document.createElement("col");
      c.style.width = roundMM(w) + "mm";
      group.append(c);
    }
    table.prepend(group);
    [...table.rows].forEach((r, i) => {
      if (heights[i]) r.style.height = roundMM(heights[i]) + "mm";
    });
  },
  previewResize(info, axis, index, value, dims) {
    const widths = [...dims.widths],
      heights = [...dims.heights];
    (axis === "column" ? widths : heights)[index] = value;
    this.setDimensions(info.table, widths, heights);
    info.element.style.width = widths.reduce((s, v) => s + v, 0) + "mm";
    info.element.style.height = heights.reduce((s, v) => s + v, 0) + "mm";
  },
  sizeRange(info, axis, indices, dims) {
    const columns = axis === "column";
    const sizes = columns ? dims.widths : dims.heights;
    const extent = columns ? EditorSettings.paper.w - info.n.x : EditorSettings.paper.h - info.n.y;
    const occupied = sizes.reduce((sum, size, i) => sum + (indices.includes(i) ? 0 : size), 0);
    const max = Math.max(0, (extent - occupied) / indices.length);
    return {min: Math.min(3, max), max, step: "any"};
  },
  selectedAxes(info, axis) {
    return [...new Set(App.cells.map(i => info.positions.get(info.cells[i]))
      .filter(Boolean).map(p => axis === "column" ? p.x : p.y))];
  },
  resize(axis, index, value, dims) {
    const info = this.info();
    if (!info) return;
    dims ||= this.dimensions(info);
    const widths = [...dims.widths], heights = [...dims.heights];
    const sizes = axis === "column" ? widths : heights;
    const indices = Array.isArray(index) ? index : [index];
    if (!indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= sizes.length)) return;
    const next = EditorSettings.number(value, this.sizeRange(info, axis, indices, dims));
    if (next === null || indices.every(i => sizes[i] === next)) return this.refresh();
    for (const i of indices) sizes[i] = next;
    const w = widths.reduce((sum, size) => sum + size, 0), h = heights.reduce((sum, size) => sum + size, 0);
    App.checkpoint();
    this.setDimensions(info.table, widths, heights);
    if (axis === "column") info.n.w = roundMM(w);
    else info.n.h = roundMM(h);
    if (info.n.liveTable) {
      const c = info.n.liveTable;
      if (axis === "column") {
        c.widths ||= {};
        const keys = SmartTables.keys(c);
        keys.forEach((k, i) => {
          if (k === "serial") c.serialWidth = widths[i];
          else c.widths[k] = widths[i];
        });
        c.explicitWidths = true;
      } else c.rowHeights = heights.map(roundMM);
    } else info.n.html = this.templateHTML(info.n,info.table);
    this.save();
  },
  select(axis, index) {
    const info = this.info();
    if (!info) return;
    this.active = { axis, index };
    App.tableId = info.n.id;
    App.cells = info.cells.flatMap((c, i) => {
      const p = info.positions.get(c);
      return (
        axis === "column"
          ? p.x <= index && index < p.x + c.colSpan
          : p.y <= index && index < p.y + c.rowSpan
      )
        ? [i]
        : [];
    });
    this.refresh();
  },
  style(prop, value) {
    const info = this.info();
    if (!info || !App.cells.length) return;
    App.checkpoint();
    for (const i of App.cells) {
      const cell = info.cells[i];
      if (!cell) continue;
      cell.style[prop] = value;
      if (info.n.liveTable) {
        const pos = info.positions.get(cell),
          c = info.n.liveTable;
        c.cellStyles ||= {};
        const key = pos.y + ":" + pos.x;
        (c.cellStyles[key] ||= {})[prop] = value;
      }
    }
    if (!info.n.liveTable) info.n.html = this.templateHTML(info.n,info.table);
    this.save();
  },
  async confirm(message) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "app-ui table-confirm";
      const title = document.createElement("h3");
      title.textContent = message;
      const actions = document.createElement("div");
      actions.className = "row-buttons";
      let answer = false;
      for (const [name, value] of [
        ["إلغاء", false],
        ["حذف", true],
      ]) {
        const b = document.createElement("button");
        b.textContent = name;
        b.onclick = () => {
          answer = value;
          dialog.close();
        };
        actions.append(b);
      }
      dialog.append(title, actions);
      dialog.onclose = () => {
        dialog.remove();
        resolve(answer);
      };
      document.body.append(dialog);
      dialog.showModal();
      actions.firstChild.focus();
    });
  },
  async structure(kind) {
    const info = this.info();
    if (!info || !App.cells.length) return;
    const { n, table, grid, positions, cells } = info,
      pos = positions.get(cells[App.cells[0]]);
    if (!pos) return;
    const axis = kind.endsWith("Column") ? "column" : "row",
      index =
        this.active?.axis === axis
          ? this.active.index
          : axis === "column"
            ? pos.x
            : pos.y,
      remove = kind.startsWith("delete");
    const width = Math.max(...grid.map((r) => r.length)),
      height = table.rows.length,
      count = axis === "column" ? width : height;
    if (remove && count <= 1)
      return Feedback.notice("يجب أن يبقى صف وعمود واحد على الأقل.");
    if (
      remove &&
      !(await this.confirm(
        "حذف " +
          (axis === "column" ? "العمود" : "الصف") +
          " المحدد ومحتواه؟ يمكن التراجع بـ Ctrl+Z.",
      ))
    )
      return;
    if (App.node(n.id) !== n) return;
    if (n.liveTable) return this.liveStructure(info, kind, index);
    if (!remove && (axis === "column" ? 210 - n.x - n.w : 297 - n.y - n.h) < 3)
      return Feedback.notice(
        "لا توجد مساحة كافية؛ صغّر الجدول أو انقله أولاً.",
      );
    // Fixed tables preserve spans, styles and content in all unaffected cells.
    const dims = this.dimensions(info),
      rtl = getComputedStyle(table).direction === "rtl";
    App.checkpoint();
    if (axis === "column") {
      const at = remove ? index : index + (rtl ? 0 : 1);
      if (remove) {
        for (const cell of new Set(grid.map((r) => r[index]).filter(Boolean))) {
          if (cell.colSpan > 1) cell.colSpan--;
          else cell.remove();
        }
        dims.widths.splice(at, 1);
      } else {
        const expanded = new Set();
        [...table.rows].forEach((row, y) => {
          const crossing =
            at > 0 && grid[y]?.[at - 1] === grid[y]?.[at] ? grid[y][at] : null;
          if (crossing) {
            if (!expanded.has(crossing)) {
              crossing.colSpan++;
              expanded.add(crossing);
            }
            return;
          }
          const cell = document.createElement("td");
          cell.innerHTML = "<br>";
          const next = [...row.cells].find((c) => positions.get(c)?.x >= at);
          row.insertBefore(cell, next || null);
        });
        const available = 210 - n.x - n.w;
        if (available < 3) {
          App.history.pop();
          return Feedback.notice(
            "لا توجد مساحة لعمود جديد؛ صغّر الجدول أولاً.",
          );
        }
        dims.widths.splice(at, 0, Math.min(15, available));
      }
    } else {
      const at = remove ? index : index + 1,
        rows = [...table.rows];
      if (remove) {
        for (const cell of new Set(grid[index])) {
          const p = positions.get(cell);
          if (p.y < index) {
            cell.rowSpan--;
          } else if (cell.rowSpan > 1) {
            cell.rowSpan--;
            const target = rows[index + 1];
            const next = [...target.cells].find(
              (c) => positions.get(c)?.x > p.x,
            );
            target.insertBefore(cell, next || null);
          }
        }
        rows[index].remove();
        dims.heights.splice(index, 1);
      } else {
        const available = 297 - n.y - n.h;
        if (available < 3) {
          App.history.pop();
          return Feedback.notice("لا توجد مساحة لصف جديد؛ صغّر الجدول أولاً.");
        }
        const row = document.createElement("tr");
        rows[index].after(row);
        const expanded = new Set();
        for (let x = 0; x < width; x++) {
          const above = grid[index][x],
            p = positions.get(above);
          if (p.y + above.rowSpan > at) {
            if (!expanded.has(above)) {
              above.rowSpan++;
              expanded.add(above);
            }
            continue;
          }
          const c = row.insertCell();
          c.innerHTML = "<br>";
        }
        dims.heights.splice(at, 0, Math.min(8, available));
      }
    }
    this.setDimensions(table, dims.widths, dims.heights);
    n.w = roundMM(dims.widths.reduce((s, v) => s + v, 0));
    n.h = roundMM(dims.heights.reduce((s, v) => s + v, 0));
    n.html = this.templateHTML(n,table);
    // Keep price/quantity column mappings aligned so existing totals remain live.
    if (n.tableSetup && axis === "column") {
      const c = n.tableSetup,
        visualAt = remove ? index : index + (rtl ? 0 : 1),
        at = visualAt - Number(c.numbered);
      if (remove && c.numbered && index === 0) c.numbered = false;
      else if (!remove && c.numbered && visualAt === 0) {
        c.columns.unshift("custom-" + crypto.randomUUID(), "serial");
        c.numbered = false;
        c.serialColumnIndex = 1;
      } else if (at >= 0)
        c.columns.splice(
          at,
          remove ? 1 : 0,
          ...(remove ? [] : ["custom-" + crypto.randomUUID()]),
        );
      if (Number.isInteger(c.serialColumnIndex))
        c.serialColumnIndex = c.columns.indexOf("serial");
      if (!c.columns.includes("price")) c.total = false;
    }
    App.cells = [];
    this.active = null;
    this.save();
  },
  liveStructure(info, kind, index) {
    const c = info.n.liveTable,
      axis = kind.endsWith("Column") ? "column" : "row",
      remove = kind.startsWith("delete");
    const keys = SmartTables.keys(c),
      dims = this.dimensions(info);
    if (axis === "row" && index === 0)
      return Feedback.notice(
        "هذا صف عناوين الجدول. عدّل الأعمدة من إعدادات الجدول.",
      );
    if (axis === "row" && index > c.initialRows)
      return Feedback.notice("صف المجموع مرتبط بإعداد المجموع الكلي.");
    if (axis === "column" && keys[index] === "serial" && remove) {
      App.checkpoint();
      c.numbered = false;
      c.columnOrder = keys.filter((k) => k !== "serial");
      info.n.w = Math.max(3, info.n.w - dims.widths[index]);
      this.shiftStyles(c, "column", index, true);
      this.save();
      return;
    }
    if (axis === "column" && !remove) {
      const addedWidth = Math.min(15, 210 - info.n.x - info.n.w);
      if (addedWidth < 3)
        return Feedback.notice("لا توجد مساحة لعمود جديد؛ صغّر الجدول أولاً.");
      const dialog = SmartTables.dialog("إضافة عمود إلى يمين المحدد"),
        body = dialog.querySelector(".smart-body"),
        select = document.createElement("select");
      select.setAttribute("aria-label", "العمود الجديد");
      for (const [key, label] of SmartTables.columns)
        if (!c.columns.includes(key)) select.add(new Option(label, key));
      if (!select.options.length) {
        dialog.remove();
        return Feedback.notice("كل الأعمدة المتاحة موجودة بالفعل.");
      }
      const b = document.createElement("button");
      b.textContent = "إضافة العمود";
      b.onclick = () => {
        if (App.node(info.n.id) !== info.n) return dialog.close();
        App.checkpoint();
        const at = index + (c.direction === "ltr" ? 1 : 0);
        c.columnOrder = [...keys];
        c.columnOrder.splice(at, 0, select.value);
        c.columns.push(select.value);
        c.widths ||= {};
        keys.forEach((key, i) => {
          if (key === "serial") c.serialWidth = dims.widths[i];
          else c.widths[key] = dims.widths[i];
        });
        c.widths[select.value] = addedWidth;
        c.explicitWidths = true;
        info.n.w = roundMM(dims.widths.reduce((a, b) => a + b, 0) + addedWidth);
        this.shiftStyles(c, "column", at, false);
        dialog.close();
        this.save();
      };
      body.append(select, b);
      dialog.showModal();
      return;
    }
    if (axis === "column" && c.columns.length <= 1)
      return Feedback.notice("يجب أن يبقى عمود بيانات واحد على الأقل.");
    if (axis === "row" && remove && c.initialRows <= 1)
      return Feedback.notice("يجب أن يبقى صف قابل للملء واحد على الأقل.");
    App.checkpoint();
    if (axis === "column") {
      c.columns = c.columns.filter((k) => k !== keys[index]);
      c.columnOrder = keys.filter((_, i) => i !== index);
      info.n.w = Math.max(3, info.n.w - dims.widths[index]);
      this.shiftStyles(c, axis, index, true);
    } else {
      c.initialRows = Math.max(1, c.initialRows + (remove ? -1 : 1));
      this.shiftStyles(c, axis, remove ? index : index + 1, remove);
      if (c.rowHeights)
        c.rowHeights.splice(
          remove ? index : index + 1,
          remove ? 1 : 0,
          ...(remove ? [] : [c.rowHeight]),
        );
    }
    // Template operations never delete entered customer rows or hidden column values.
    App.cells = [];
    this.active = null;
    this.save();
  },
  shiftStyles(c, axis, at, remove) {
    const out = {};
    for (const [key, value] of Object.entries(c.cellStyles || {})) {
      let [y, x] = key.split(":").map(Number);
      const v = axis === "column" ? x : y;
      if (remove && v === at) continue;
      if (v >= at) {
        if (axis === "column") x += remove ? -1 : 1;
        else y += remove ? -1 : 1;
      }
      out[y + ":" + x] = value;
    }
    c.cellStyles = out;
  },
  decorate(n, table) {
    const c = n.liveTable;
    if (!c) return;
    for (const [key, style] of Object.entries(c.cellStyles || {})) {
      const [y, x] = key.split(":").map(Number),
        cell = table.rows[y]?.cells[x];
      if (!cell) continue;
      for (const prop of ["color", "backgroundColor", "fontSize"]) {
        const value = style[prop];
        if (
          typeof value === "string" &&
          ((prop === "fontSize" && /^\d+(\.\d+)?px$/.test(value)) ||
            (prop !== "fontSize" && /^#[\da-f]{6}$/i.test(value)))
        )
          cell.style[prop] = prop === "fontSize" ? EditorSettings.inlineFontSize(value) : value;
      }
    }
    [...table.rows].forEach((row, i) => {
      if (c.rowHeights?.[i]) row.style.height = c.rowHeights[i] + "mm";
    });
  },
  save() {
    App.render();
    App.persist();
    this.refresh();
  },
};
