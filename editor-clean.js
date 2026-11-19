class ContractEditor {
  constructor() {
    this.mode = "fill";
    this.approved = null;
    this.draft = null;
    this.scene = null;
    this.page = 1;
    this.selection = new Set();
    this.history = [];
    this.future = [];
    this.gesture = null;
    this.editing = null;
    this.range = null;
    this.tableId = null;
    this.cells = [];
    this.scale = 1;
    this.loading = false;
    this.printing = false;
    this.draftQueue = Promise.resolve();
  }
  all() {
    return this.scene
      ? [
          ...this.scene.pages,
          ...(this.scene.companySheets || []),
          ...(this.scene.externalPages || []),
          ...(this.scene.exchangeTemplate ? [this.scene.exchangeTemplate] : []),
          ...(this.scene.transferLetter ? [this.scene.transferLetter] : []),
          ...(this.scene.cashTemplate ? [this.scene.cashTemplate] : []),
          ...(this.scene.scheduleTemplate ? [this.scene.scheduleTemplate] : []),
        ].flatMap((p) => p.nodes)
      : [];
  }
  node(id) {
    return this.current()?.nodes.find((n) => n.id === id) || this.all().find((n) => n.id === id);
  }
  pageOf(id) {
    const current = this.current();
    if (current?.nodes.some(n => n.id === id)) return current;
    const reference = this.scene?.companySheets?.find((p) =>
      p.nodes.some((n) => n.id === id),
    );
    if (reference) return reference;
    const external = this.scene?.externalPages?.find((p) =>
      p.nodes.some((n) => n.id === id),
    );
    if (external) return external;
    if (this.scene?.exchangeTemplate?.nodes.some((n) => n.id === id))
      return this.scene.exchangeTemplate;
    if (this.scene?.transferLetter?.nodes.some((n) => n.id === id))
      return this.scene.transferLetter;
    if (this.scene?.cashTemplate?.nodes.some((n) => n.id === id))
      return this.scene.cashTemplate;
    return this.scene?.scheduleTemplate?.nodes.some((n) => n.id === id)
      ? this.scene.scheduleTemplate
      : this.scene?.pages.find((p) => p.nodes.some((n) => n.id === id));
  }
  selected() {
    return [...this.selection].map((id) => this.node(id)).filter(Boolean);
  }
  element(id) {
    return $("pages").querySelector('[data-node="' + CSS.escape(id) + '"]');
  }
  current() {
    if (!this.scene) return;
    const ref = !d.standaloneBook && ContractTemplates.find(d.templateId, this.scene)?.pages.find(r => r.id === this.page);
    if (ref) return ContractTemplates.resolve(this.scene, ref);
    if (CompanySheets.ids.includes(this.page))
      return this.scene.companySheets?.find((p) => p.id === this.page);
    if (External.active())
      return this.scene.externalPages?.find((p) => p.id === this.page);
    if (this.page === 1 && d.contractType === "exchange")
      return this.scene.exchangeTemplate;
    if (this.page === 0) return this.scene.transferLetter;
    if (this.page === 1 && d.contractType === "cash")
      return this.scene.cashTemplate;
    return (
      (this.page < 0
        ? this.scene?.scheduleTemplate
        : this.scene?.pages.find((p) => p.id === this.page)) ||
      this.scene?.pages[0]
    );
  }
  checkpoint() {
    this.history.push(clone(this.scene));
    if (this.history.length > 35) this.history.shift();
    this.future = [];
  }
  persist() {
    if (this.mode !== "design") return;
    const payload = {
      version: 6,
      scene: clone(this.scene),
      printPages: [...d.pages],
      baseRevision: cfg.sharedRevision,
      scope: ContractTemplates.scopeKey(),
      updatedAt: Date.now(),
    };
    this.draft = payload;
    this.draftQueue = this.draftQueue
      .catch(() => {})
      .then(() => putDB("designDraft", payload))
      .then(() => ($("saveStatus").textContent = "مسودة التصميم محفوظة"))
      .catch(
        () => ($("saveStatus").textContent = "تعذر حفظ المسودة؛ احفظ نسخة"),
      );
  }
  async enter() {
    if (seed.offline) return;
    if (this.mode === "design") return;
    Services.home = false;
    document.body.classList.remove("home-mode");
    $("homeScreen").hidden = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await saveConfig();
    }
    this.commitText();
    this.approved = ContractTemplates.scoped(cfg.design || migrateLegacy(cfg));
    const stored = this.draft || (await getDB("designDraft"));
    if (stored?.version === 6 && stored.scope === ContractTemplates.scopeKey() && (!stored.baseRevision || stored.baseRevision === cfg.sharedRevision)) {
      this.scene = clone(stored.scene);
      if (stored.printPages)
        d.pages = [
          ...new Set([...d.pages, ...stored.printPages.filter((id) => id > 8)]),
        ];
    } else if (stored?.companies)
      this.scene = migrateLegacy(normalizeConfig(clone(stored)));
    else this.scene = clone(this.approved);
    this.mode = "design";
    editMode = true;
    this.history = [];
    this.future = [];
    this.selection.clear();
    this.tableId = null;
    document.body.classList.add("design-mode");
    $("editorPanel").hidden = false;
    $("settingsDrawer").hidden = true;
    $("shade").hidden = true;
    this.render();
    $("saveStatus").textContent = "تعديلاتك مسودة حتى الاعتماد";
  }
  leave() {
    this.commitText();
    if (this.gesture) this.cancelGesture();
    this.persist();
    this.mode = "fill";
    editMode = false;
    this.scene = clone(this.approved || cfg.design);
    this.approved = null;
    this.selection.clear();
    this.tableId = null;
    this.cells = [];
    document.body.classList.remove("design-mode");
    $("editorPanel").hidden = true;
    this.render();
  }
  async approve() {
    this.commitText();
    if (this.gesture) this.cancelGesture();
    await putDB("beforeApprovalBackup", {
      config: clone(cfg),
      time: Date.now(),
    });
    const scene = clone(this.scene);
    const originalDesign=cfg.design;
    const layout={};
    for(const key of ContractTemplates.layoutKeys)if(scene[key]!==undefined)layout[key]=clone(scene[key]);
    cfg.design={...originalDesign,documentLayouts:{...originalDesign.documentLayouts,[ContractTemplates.scopeKey()]:layout}};
    cfg.extraPages = scene.pages
      .filter((p) => p.id > 8)
      .map((p) => ({ id: p.id, name: p.name }));
    try {
      await saveConfig();
    } catch (error) {
      cfg.design = originalDesign;
      cfg.extraPages = this.approved.pages.filter(p => p.id > 8).map(p => ({id:p.id, name:p.name}));
      await Feedback.notice(error.message);
      return;
    }
    this.approved = scene;
    await this.draftQueue;
    await putDB("designDraft", null);
    this.draft = null;
    this.mode = "fill";
    editMode = false;
    this.scene = clone(scene);
    this.selection.clear();
    this.tableId = null;
    this.cells = [];
    document.body.classList.remove("design-mode");
    $("editorPanel").hidden = true;
    this.render();
    $("saveStatus").textContent = SharedDefaults.enabled ? "تم اعتماد التصميم في المشروع" : "تم اعتماد التصميم محلياً";
  }

  undo(redo = false) {
    this.commitText();
    const from = redo ? this.future : this.history,
      to = redo ? this.history : this.future;
    if (!from.length) return;
    to.push(clone(this.scene));
    this.scene = from.pop();
    this.selection = new Set([...this.selection].filter((id) => this.node(id)));
    this.cells = [];
    this.tableId = null;
    this.render();
    this.persist();
  }
  render() {
    if (!d) return;
    if (!this.scene) {
      this.scene = ContractTemplates.scoped(cfg.design || migrateLegacy(cfg));
    } else if (this.mode === "fill" && cfg.design)
      this.scene = ContractTemplates.scoped(cfg.design);
    if (!this.scene) return;
    Services.upgradeScene(this.scene);
    const scroll = $("canvas").scrollTop;
    this.scale = this.zoomScale();
    const balance = calculate(d);
    const { papers, displayPages } = this.documentPages(
      this.scene,
      this.mode === "design" && !this.printing,
      undefined,
      false,
      balance,
    );
    // Give the new sheets their final size before inserting them into the layout.
    const zoom = this.printing ? 1 : this.scale;
    for (const paper of papers.children) paper.style.zoom = zoom;
    $("pages").replaceChildren(papers);
    this.displayPages = displayPages;
    if (!this.displayPages.some((p) => p.id === this.page))
      this.page = this.displayPages[0]?.id || 1;
    this.updatePages();
    this.drawSelection();
    this.inspector();
    this.layers();
    TransferLetter.decorate(d, balance);
    Workspace.markMissing(balance);
    Workspace.paymentRows();
    $("contractNumber").value = d.number;
    $("validation").textContent = d.standaloneBook ? "" : [...balance.errors, ...Services.formulaErrors].join(
      "\n",
    );
    $("canvas").scrollTop = scroll;
    if (startReady && this.mode === "fill") saveDraft();
  }
  documentPages(scene, design, include = () => true, archived = false, balance = calculate(d)) {
    if(scene.documentLayouts)scene=ContractTemplates.scoped(scene);
    ctx = context(balance);
    const cash = d.contractType === "cash";
    PaperLayout.companyLines(co()).forEach(
      (line, i) => (ctx["headerCompany" + i] = line),
    );
    if (External.active()) External.context(ctx);
    if (d.contractType === "exchange") Exchange.context(ctx, balance);
    if (cash)
      Cash.context(ctx, balance, archived && !scene.cashTemplate?.fixedLayout);
    d.extras.forEach((x, i) => {
      ctx["extraLabel" + i] = x.label;
      ctx["extraMoney" + i] = money(amount(x.amount));
      ctx["extraWords" + i] = words(amount(x.amount));
      ctx["extraDate" + i] = dateLabel(x.date);
    });
    splitBills(balance.outstanding ?? balance.remaining).forEach((v, i) => {
      ctx["bill" + i] = money(v);
      ctx["billWords" + i] = words(v);
    });
    const papers = document.createDocumentFragment();
    let displayPages = External.active()
      ? External.pages(scene)
      : [
          ...scene.pages
            .filter(
              (p) =>
                (!cash || ![3, 6].includes(p.id)) &&
                (design || !d.noWarranty || ![2, 5].includes(p.id)),
            )
            .map((p) =>
              p.id === 1 &&
              d.contractType === "exchange" &&
              (!archived || scene.exchangeTemplate)
                ? Exchange.template(scene, archived)
                : cash && p.id === 1
                  ? archived && scene.cashTemplate
                    ? scene.cashTemplate
                    : Cash.template(scene)
                  : p,
            ),
          ...Schedule.pages(scene, design, archived),
          ...(!archived || scene.companySheets
            ? CompanySheets.pages(scene)
            : []),
          ...((TransferLetter.applies(d) || (design && TransferLetter.paymentContract(d))) &&
              (!archived || scene.transferLetter || TransferLetter.paymentContract(d) || d.standaloneBook)
            ? [archived && scene.transferLetter ? scene.transferLetter : TransferLetter.template(scene)]
            : []),
        ];
    if (External.active() && TransferLetter.applies(d))
      displayPages.push(archived && scene.transferLetter ? scene.transferLetter : TransferLetter.template(scene));
    displayPages = ContractTemplates.pages(scene, displayPages, design);
    const paymentTransfer = TransferLetter.paymentContract(d);
    if (paymentTransfer && TransferLetter.applies(d) && !displayPages.some(p=>p.id===0))
      displayPages.push(scene.transferLetter || TransferLetter.template(scene));
    if (!External.active() && ContractTemplates.find(d.templateId, scene)?.pages.some(r=>r.source==="external")) {
      const extra = {};
      External.context(extra);
      for (const [key, value] of Object.entries(extra)) if (key.startsWith("external")) ctx[key] = value;
    }
    displayPages = Letters.pages(scene, displayPages);
    if (!design) displayPages = displayPages.filter(p =>
      !Schedule.requiresGuarantor(p.id,d) &&
      (p.id !== 0 || !paymentTransfer || TransferLetter.applies(d)),
    );
    Workbench.pages(displayPages, scene);
    displayPages = SmartTables.expand(displayPages, design);
    const baseCtx = ctx;
    for (const page of displayPages) {
      if (!archived) EditorEnhancements.upgradePage(page);
      if (!archived && page.id >= 0) PaperLayout.apply(page);
      if (!include(page.tableParent ?? page.id)) continue;
      ctx = baseCtx;
      if (page.id < 0) ctx = { ...baseCtx, ...Schedule.values(page) };
      if (page.id === 0) ctx = {
        ...baseCtx,
        ...(External.active() ? {buyer:baseCtx.externalBuyer} : {}),
        cashTransferNote: TransferLetter.note(d, balance, baseCtx.cashTransferNote),
      };
      const paper = document.createElement("article");
      paper.className = "paper scene-page";
      paper.dataset.page = page.id;
      if (page.id < 0) paper.classList.add("schedule-page");
      for (const original of [...page.nodes].sort(
        (a, b) => (a.z || 0) - (b.z || 0),
      )) {
        const n = original;
        if (
          !design &&
          d.noWarranty &&
          (n.id === "warranty" ||
            (/\{\{warrantyText\}\}/.test(n.html || "") &&
              (n.html || "").trim() === "{{warrantyText}}"))
        )
          continue;
        if (
          (n.condition === "phase" && !(d.phaseEnabled && amount(d.phaseCount)>0 && amount(d.phasePayment)>0)) ||
          (n.condition === "standard" && d.phaseEnabled && amount(d.phaseCount)>0 && amount(d.phasePayment)>0)
        )
          continue;
        if (n.condition === "cargo" && (!["exchange","installment"].includes(d.contractType) || d.standaloneBook || page.id !== 1)) continue;
        const show =
          !n.condition ||
          ["phase", "standard"].includes(n.condition) ||
          (n.condition === "cargo" ? cargoClauseApplies(d) : n.condition.startsWith("cash-due-")
            ? archived && !scene.cashTemplate?.fixedLayout
              ? !!balance.cashRows?.[Number(n.condition.slice(9))]
              : balance.cashRows?.some(
                  (row, i) => (row.slot ?? i) === Number(n.condition.slice(9)),
                )
            : n.condition === "transfer-note"
              ? !!ctx.cashTransferNote?.trim()
              : n.condition === "agent"
                ? cfg.fixed.hasAgent
                : amount(d.extras[Number(n.condition.split("-")[1])]?.amount) >
                  0);
        if (show || design) {
          if (!design && n.hideEmpty && n.type === "image" && !Images.source(n))
            continue;
          if (
            d.standaloneBook &&
            d.bookNoCompany &&
            n.type === "image" &&
            ["company", "companySlot"].includes(n.binding)
          )
            continue;
          const element = this.renderNode(n);
          const ordinal =
            n.clauseNumber ||
            (!archived && page.id === 1 && /^البند (\d+)$/.exec(n.name)?.[1]);
          if (ordinal)
            element.dataset.clauseNumber =
              n.clauseDash ||
              (page.id === 1 && d.contractType === "installment")
                ? "-"
                : Number(ordinal).toLocaleString("ar-IQ") + ".";
          if (!show) element.style.opacity = ".3";
          paper.append(element);
        }
      }
      papers.append(paper);
    }
    ctx = baseCtx;
    return { papers, displayPages };
  }
  renderNode(n) {
    n = SmartTables.model(n);
    const el = document.createElement("div");
    el.className = "scene-node";
    el.dataset.node = n.id;
    el.dataset.type = n.type;
    if (n.vehicleCell) el.classList.add("vehicle-cell");
    if (n.liveTable || n.tableSetup) {
      el.classList.add("smart-node");
      if ((n.liveTable || n.tableSetup).style === "cards")
        el.classList.add("smart-card-node");
    }
    this.nodeStyle(el, n);
    if (n.headerCut && !n.firstFormHeader)
      el.style.clipPath = "inset(" + n.headerCut + "mm 0 0)";
    if (n.fontStyle) el.style.fontStyle = n.fontStyle;
    if (n.textDecoration && n.textDecoration !== "underline")
      el.style.textDecoration = n.textDecoration;
    if (
      n.type === "text" &&
      n.textDecoration === "underline" &&
      n.underlineEnabled !== false
    ) {
      el.classList.add("field-underlined");
      el.style.setProperty(
        "--field-underline",
        n.decorationColor || n.color || "#172c35",
      );
      el.style.setProperty(
        "--field-underline-width",
        (n.underlineWidth || 1) + "px",
      );
    }
    if (n.decorationColor) el.style.textDecorationColor = n.decorationColor;
    if (n.type === "text") {
      const content = document.createElement("div");
      content.className = "node-content";
      if (n.verticalAlign) {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        el.style.justifyContent = {
          top: "flex-start",
          middle: "center",
          bottom: "flex-end",
        }[n.verticalAlign];
        content.style.height = "auto";
        content.style.width = "100%";
        content.style.whiteSpace = "pre-wrap";
      }
      if (n.balanced) content.style.textWrapStyle = "balance";
      if (n.tokenRich) {
        const value = String(ctx[n.tokenRich.token] ?? "");
        let at = 0;
        n.tokenRich.runs.forEach((r, i) => {
          const span = document.createElement("span"),
            end =
              i === n.tokenRich.runs.length - 1 ? value.length : at + r.length;
          span.textContent = value.slice(at, end);
          Object.assign(span.style, r.style);
          content.append(span);
          at = end;
        });
      } else renderMarkup(content, n.html);
      if (n.fitLetterNote && !n.manualFontSize) TransferLetter.fitNote(content, n);

      const shortText = content.textContent.trim();
      if (shortText && shortText.split(/\s+/u).length <= 2 && !content.querySelector("br,table")) {
        content.classList.add("short-text-line");
        const measure = this.textMeasure ||= document.createElement("canvas").getContext("2d");
        measure.font = [el.style.fontStyle || "normal", el.style.fontWeight, el.style.fontSize, el.style.fontFamily].join(" ");
        const width = measure.measureText(shortText.replace(/\s+/gu, " ")).width;
        const available = n.w * MM - 2 * (parseFloat(el.style.borderWidth) || 0);
        if (available > 0 && width > available) {
          content.style.fontSize = (parseFloat(el.style.fontSize) * available / width * 0.98) + "px";
        }
      }
      el.append(content);
    } else if (n.type === "image") {
      const src = Images.source(n);
      if (src) {
        const img = document.createElement("img");
        let stock;
        if (n.firstFormHeader && n.cropHeight) {
          this.stockHeaders ||= ContractAssets.headers;
          const asset = this.stockHeaders[co().id];
          if (asset && src.length === asset.length && src.endsWith(asset.tail))
            stock = asset.image;
        }
        img.src = safeImage(stock || src);
        img.alt = n.name;
        img.draggable = false;
        img.style.objectFit = n.fit || "contain";
        if (!stock && (n.cropRatio || n.cropHeight))
          img.style.height = (n.cropRatio || n.cropHeight / n.h) * 100 + "%";
        el.append(img);
      } else {
        const blank = document.createElement("div");
        blank.className = "blank-image";
        blank.textContent = n.name + " · لم تُضف صورة";
        el.append(blank);
      }
    } else if (n.type === "shape") {
      el.innerHTML = shapeMarkup(n);
      const text = document.createElement("div");
      text.className = "shape-text";
      renderMarkup(text, n.html || esc(n.caption || ""));

      el.append(text);
    } else if (n.type === "table") {
      renderMarkup(el, n.html, true);
      const table = el.querySelector("table");
      if (table) {
        table.dir =
          n.liveTable?.direction ||
          n.tableSetup?.direction ||
          n.direction ||
          "rtl";
        TableTools.decorate(n, table);
      }
      if (n.letterGrid) el.classList.add("letter-grid");
      if (n.directory) el.classList.add("letter-directory");
      el.style.setProperty("--table-border", n.stroke || "#aebdc7");
      el.querySelectorAll("td,th").forEach(
        (c, i) => (c.dataset.cell = String(i)),
      );
    }
    return el;
  }
  nodeStyle(el, n) {
    if (n.cropHeight && !n.cropRatio) n.cropRatio = n.cropHeight / n.h;
    Object.assign(el.style, {
      left: n.x + "mm",
      top: n.y + "mm",
      width: n.w + "mm",
      height: n.h + "mm",
      zIndex: String(n.z || 0),
      opacity: String(n.type === "text" ? 1 : (n.opacity ?? 1)),
      fontFamily: n.fontFamily || "Sakkal Majalla",
      fontSize: (n.fontSize || 17) + "px",
      lineHeight: String(n.lineHeight || 1.2),
      fontWeight: n.weight || "400",
      color: n.color || "#172c35",
      textDecorationColor: n.decorationColor || n.color || "#172c35",
      textAlign: n.align || "right",
      direction: n.direction === "ltr" ? "ltr" : "rtl",
      background:
        n.type === "shape" || n.fillEnabled === false
          ? "transparent"
          : n.fill || "transparent",
      border:
        n.type === "shape" || n.strokeEnabled === false
          ? "none"
          : (n.strokeWidth || 0) +
            "px " +
            (n.dash || "solid") +
            " " +
            (n.stroke || "transparent"),
      borderRadius: (n.radius || 0) + "mm",
    });
  }
  zoomScale() {
    const value = $("zoom").value;
    return value === "fit"
      ? Math.min(1, Math.max(0.25, ($("canvas").clientWidth - 50) / (210 * MM)))
      : Number(value) || 1;
  }
  zoom() {
    this.scale = this.zoomScale();
    document
      .querySelectorAll(".paper")
      .forEach((p) => (p.style.zoom = this.printing ? 1 : this.scale));
    this.drawSelection();
  }
  updatePages() {
    const signature=JSON.stringify([this.page,d.noWarranty,TransferLetter.paidInFull(d),this.displayPages.map(p=>[p.id,p.name,Schedule.enabled(p.id)])]);
    if(this.railSignature===signature && $("selectAllPages")){
      applyPageVisibility();
      return;
    }
    this.railSignature=signature;
    const old = $("pagePreview").value;
    $("pagePreview").replaceChildren(new Option("كل الصفحات", "all"));
    for (const [index, p] of this.displayPages.entries())
      $("pagePreview").add(
        new Option(
          index + 1 + " · " + (p.id === 2 ? "الضمان" : p.name),
          String(p.id),
        ),
      );
    $("pagePreview").value = this.displayPages.some((p) => String(p.id) === old)
      ? old
      : "all";
    $("pageRail").replaceChildren();
    ContractFiles.rail();
    for (const [index, p] of this.displayPages.entries()) {
      const row = document.createElement("div");
      row.className = "page-item" + (p.id === this.page ? " active" : "");
      const button = document.createElement("button");
      button.innerHTML =
        '<span class="page-thumb">' +
        (index + 1) +
        "</span><small>" +
        esc(p.id === 2 ? "الضمان" : p.name) +
        "</small>";
      if (p.id === this.page) button.setAttribute("aria-current", "page");
      button.onclick = () => {
        this.commitText();
        $("pagePreview").value = String(p.id);
        this.changePage();
      };
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = Schedule.enabled(p.id);
      check.disabled = (d.noWarranty && [2, 5].includes(p.id)) ||
        (p.id === 0 && TransferLetter.paidInFull(d));
      check.title = "تضمين الصفحة في الطباعة";
      check.onchange = () => {
        if (p.id === 0 && TransferLetter.paymentContract(d)) {
          d[d.contractType + "TransferLetter"] = check.checked;
          render();
        } else if (p.id === 0) d.skipTransferLetter = !check.checked;
        else if (CompanySheets.ids.includes(p.id)) {
          const skip = new Set(
            (d.skipCompanySheets || "").split(",").filter(Boolean),
          );
          if (check.checked) skip.delete(String(p.id));
          else skip.add(String(p.id));
          d.skipCompanySheets = [...skip].join(",");
        } else if (p.id < 0) {
          const skip = new Set(
            (d.skipSchedule || "").split(",").filter(Boolean),
          );
          if (check.checked) skip.delete(String(p.id));
          else skip.add(String(p.id));
          d.skipSchedule = [...skip].join(",");
        } else
          d.pages = check.checked
            ? [...new Set([...d.pages, p.id])]
            : d.pages.filter((v) => v !== p.id);
        applyPageVisibility();
        Workspace.markMissing(calculate(d));
        saveDraft();
      };
      row.append(button, check);
      $("pageRail").append(row);
    }
    applyPageVisibility();
  }
  changePage() {
    this.commitText();
    if ($("pagePreview").value !== "all")
      this.page = Number($("pagePreview").value);
    this.selection.clear();
    this.cells = [];
    this.tableId = null;
    applyPageVisibility();
    this.updatePages();
    const target = $("pages").querySelector('[data-page="' + this.page + '"]');
    if (target)
      $("canvas").scrollTop +=
        target.getBoundingClientRect().top -
        $("canvas").getBoundingClientRect().top -
        45;
    this.inspector();
    this.layers();
    this.drawSelection();
  }
  select(id, toggle = false) {
    const p = this.pageOf(id);
    if (!p) return;
    if (this.page !== p.id) {
      this.selection.clear();
      this.page = p.id;
    }
    if (toggle) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else if (!this.selection.has(id) || this.selection.size === 0)
      this.selection = new Set([id]);
    this.tableId = null;
    this.cells = [];
    this.drawSelection();
    this.inspector();
    this.layers();
  }
  bounds(nodes = this.selected()) {
    if (!nodes.length) return null;
    const left = Math.min(...nodes.map((n) => n.x)),
      top = Math.min(...nodes.map((n) => n.y)),
      right = Math.max(...nodes.map((n) => n.x + n.w)),
      bottom = Math.max(...nodes.map((n) => n.y + n.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  drawSelection() {
    TableTools.clear();
    const layer = $("selectionLayer");
    if (!layer) return;
    layer.replaceChildren();
    document
      .querySelectorAll(".scene-node.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
    if (this.mode !== "design" || this.editing) return;
    const nodes = this.selected();
    if (!nodes.length) return;
    nodes.forEach((n) => this.element(n.id)?.classList.add("is-selected"));
    const paper = document.querySelector(
      '.paper[data-page="' + this.page + '"]',
    );
    if (!paper || !paper.getClientRects().length) return;
    const pr = paper.getBoundingClientRect(),
      bounds = this.bounds(),
      unit = pr.width / 210,
      canvas = $("canvas").getBoundingClientRect();
    const rect = {
      x: pr.left + bounds.x * unit,
      y: pr.top + bounds.y * unit,
      w: bounds.w * unit,
      h: bounds.h * unit,
    };
    if (rect.y + rect.h < canvas.top || rect.y > canvas.bottom) return;
    layer.style.clipPath =
      "inset(" +
      canvas.top +
      "px " +
      (innerWidth - canvas.right) +
      "px " +
      (innerHeight - canvas.bottom) +
      "px " +
      canvas.left +
      "px)";
    if (this.gesture?.guideX != null) {
      const guide = document.createElement("div");
      guide.className = "vertical-snap-guide";
      Object.assign(guide.style, {
        left: pr.left + this.gesture.guideX * unit + "px",
        top: pr.top + "px",
        height: pr.height + "px",
      });
      layer.append(guide);
    }
    const box = document.createElement("div");
    box.className = "selection-box";
    Object.assign(box.style, {
      left: rect.x + "px",
      top: rect.y + "px",
      width: rect.w + "px",
      height: rect.h + "px",
    });
    for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const button = document.createElement("button");
      button.className = "selection-handle handle-" + h;
      button.dataset.resize = h;
      button.setAttribute("aria-label", "تغيير الحجم " + h);
      box.append(button);
    }
    const label = document.createElement("span");
    label.className = "selection-label";
    label.textContent =
      nodes.length > 1 ? nodes.length + " عناصر" : nodes[0].name;
    box.append(label);
    layer.append(box);
    TableTools.refresh();
  }
  layers() {
    $("layersList").replaceChildren();
    if (this.mode !== "design") return;
    for (const n of [...(this.current()?.nodes || [])].sort(
      (a, b) => (b.z || 0) - (a.z || 0),
    )) {
      const button = document.createElement("button");
      button.className =
        "layer-item" + (this.selection.has(n.id) ? " active" : "");
      button.textContent =
        { text: "T", image: "▧", shape: "◇", table: "▦" }[n.type] +
        "  " +
        n.name;
      button.onclick = (e) => {
        this.commitText();
        if (!e.ctrlKey) this.selection.clear();
        this.select(n.id, e.ctrlKey);
      };
      $("layersList").append(button);
    }
  }
  inspector() {
    const nodes = this.selected(),
      n = nodes[0],
      single = nodes.length === 1;
    $("selectionCount").textContent = nodes.length
      ? nodes.length + " محدد"
      : "";
    BoxAppearance.sync(nodes);
    const opacity = document.querySelector('[data-prop="opacity"]');
    opacity.closest("label").hidden =
      !nodes.length ||
      nodes.some((item) => item.type === "text" || item.type === "table");
    opacity.dir = "ltr";
    opacity.setAttribute(
      "aria-valuetext",
      Math.round((n?.opacity ?? 1) * 100) + "% عتامة",
    );
    opacity.closest("label").querySelector("output").textContent =
      Math.round((n?.opacity ?? 1) * 100) + "%";
    TableTools.refresh();
    $("emptySelection").hidden = !!n;
    $("geometryPanel").hidden = !n;
    for (const [id, type] of [
      ["textPanel", "text"],
      ["imagePanel", "image"],
      ["tablePanel", "table"],
    ])
      $(id).hidden =
        !single ||
        (n.type !== type && !(type === "text" && n.type === "shape"));
    $("appearancePanel").hidden =
      !n || nodes.every((item) => item.type === "image");
    const textNode = nodes.find((item) =>
      ["text", "shape", "table"].includes(item.type),
    );
    if (!single && textNode) {
      $("textPanel").hidden = false;
      $("fontFamily").value = textNode.fontFamily || "Sakkal Majalla";
      $("fontSize").value = textNode.fontSize || 18;
      $("fontColor").value = this.hex(textNode.color || "#172c35");
      $("lineHeight").value = textNode.lineHeight || 1.2;
      $("variableLabel").disabled = true;
    }
    $("insertVariable").disabled = !single;
    if (!n) return;
    for (const button of document.querySelectorAll("[data-format]")) {
      const pair = {
        bold: ["weight", "700"],
        italic: ["fontStyle", "italic"],
        underline: ["textDecoration", "underline"],
        strikeThrough: ["textDecoration", "line-through"],
      }[button.dataset.format];
      button.classList.toggle(
        "active",
        !!pair && nodes.every((item) => item[pair[0]] === pair[1]),
      );
    }
    const bounds = this.bounds();
    $("nodeName").value = single ? n.name : "مجموعة عناصر";
    $("nodeName").disabled = !single;
    for (const input of document.querySelectorAll("[data-prop]")) {
      const key = input.dataset.prop;
      let value = ["x", "y", "w", "h"].includes(key) ? bounds[key] : n[key];
      if (key === "underlineWidth") value = n.underlineWidth ?? 1;
      if (key === "strokeWidth") value = n.strokeWidth ?? 0;
      if (input.type === "color") value = this.hex(value || "#ffffff");
      if (value != null)
        input.value = typeof value === "number" ? roundMM(value) : value;
      input.disabled =
        !single &&
        ![
          "x",
          "y",
          "w",
          "h",
          "fill",
          "stroke",
          "strokeWidth",
          "underlineWidth",
          "radius",
          "dash",
          "decorationColor",
        ].includes(key);
    }
    $("aspectLock").checked = single ? !!n.lockAspect : false;
    $("noFill").checked = !n.fill || n.fill === "transparent";
    if (single) {
      $("fontFamily").value = n.fontFamily || "Sakkal Majalla";
      $("fontSize").value = n.fontSize || 18;
      $("fontColor").value = this.hex(n.color || "#172c35");
      $("lineHeight").value = n.lineHeight || 1.2;
      $("textAlign").value = n.align || "right";
      if (n.type === "image") Images.options();
      document
        .querySelectorAll("[data-align]")
        .forEach((b) =>
          b.classList.toggle(
            "active",
            b.dataset.align === (n.align || "right") &&
              (b.dataset.valign || "top") === (n.verticalAlign || "top"),
          ),
        );
      const vars = $("insertVariable");
      vars.replaceChildren(new Option("اختر الخانة…", ""));
      for (const key of Object.keys(ctx))
        if (
          ![
            "extras",
            "pages",
            "customerPhoto",
            "updatedAt",
            "recordId",
          ].includes(key)
        )
          vars.add(
            new Option(
              (cfg.companyFields?.find((f) => f.key === key)?.label ||
                cfg.formulas?.find((f) => f.key === key)?.label ||
                this.scene.variableLabels?.[key] ||
                cfg.variableLabels?.[key] ||
                key) +
                " · " +
                key,
              key,
            ),
          );
      const token = String(n.html || "").match(/\{\{(\w+)\}\}/)?.[1];
      $("variableLabel").value = token
        ? this.scene.variableLabels?.[token] ||
          cfg.variableLabels?.[token] ||
          token
        : "";
      $("variableLabel").disabled = !token;
    }
  }
  hex(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    const m = String(color).match(/\d+/g);
    return m && m.length >= 3
      ? "#" +
          m
            .slice(0, 3)
            .map((v) => Number(v).toString(16).padStart(2, "0"))
            .join("")
      : "#ffffff";
  }
  property(key, value, related) {
    this.commitText();
    const nodes = this.selected();
    if (!nodes.length) return;
    this.checkpoint();
    if (["x", "y", "w", "h"].includes(key)) {
      const bounds = this.bounds(nodes);
      const b = {
          ...bounds,
          [key]: Math.max(
            key === "w" || key === "h" ? 1 : 0,
            Number(value) || 0,
          ),
        },
        lock = nodes.length === 1 && nodes[0].lockAspect;
      if (lock && key === "w") b.h = (b.w * bounds.h) / bounds.w;
      if (lock && key === "h") b.w = (b.h * bounds.w) / bounds.h;
      if (b.x + b.w > 210 || b.y + b.h > 297) {
        this.history.pop();
        $("saveStatus").textContent = "المقاس يتجاوز حدود الصفحة";
        this.inspector();
        return;
      }
      for (const n of nodes) {
        n.x = roundMM(b.x + ((n.x - bounds.x) * b.w) / bounds.w);
        n.y = roundMM(b.y + ((n.y - bounds.y) * b.h) / bounds.h);
        n.w = roundMM((n.w * b.w) / bounds.w);
        n.h = roundMM((n.h * b.h) / bounds.h);
      }
    } else
      for (const n of nodes) {
        if (
          n.type === "image" &&
          [
            "fontSize",
            "fontFamily",
            "color",
            "weight",
            "fontStyle",
            "textDecoration",
            "align",
            "highlight",
            "lineHeight",
          ].includes(key)
        )
          continue;
        n[key] = value;
        if (related) Object.assign(n, related);
        if (key === "fontSize") n.manualFontSize = true;
        if (n.tokenRich && ["fontSize", "fontFamily", "color"].includes(key))
          for (const r of n.tokenRich.runs) if (r.style) delete r.style[key];
        if (
          ["weight", "fontStyle", "textDecoration", "decorationColor"].includes(
            key,
          ) &&
          n.html
        ) {
          const temp = document.createElement("div");
          temp.innerHTML = safeMarkup(n.html, n.type === "table");
          const cssKey =
            key === "weight"
              ? "fontWeight"
              : key === "decorationColor"
                ? "textDecorationColor"
                : key;
          temp.querySelectorAll("*").forEach((el) => {
            el.style[cssKey] = "inherit";
          });
          if (key === "textDecoration")
            temp
              .querySelectorAll("u,s,strike")
              .forEach((el) => el.replaceWith(...el.childNodes));
          n.html = temp.innerHTML;
        }
        if (["fontSize", "fontFamily", "color"].includes(key) && n.html) {
          const temp = document.createElement("div");
          temp.innerHTML = safeMarkup(n.html, n.type === "table");
          temp.querySelectorAll("*").forEach((el) => (el.style[key] = ""));
          n.html = temp.innerHTML;
        }
      }
    this.render();
    this.persist();
  }
  pointerDown(e) {
    if (this.mode !== "design" || e.button !== 0) return;
    if (e.target.closest("#boxColorPalette,.box-color-tools")) return;
    const handle = e.target.closest("[data-resize]");
    if (handle) {
      e.preventDefault();
      this.commitText();
      this.beginGesture(e, handle.dataset.resize);
      return;
    }
    const el = e.target.closest("#pages [data-node]");
    if (this.editing) {
      if (
        this.editing.element.contains(e.target) ||
        e.target.closest("#textTools")
      )
        return;
      this.commitText();
    }
    const sheet = e.target.closest("#pages .paper");
    const target = el && this.node(el.dataset.node);
    const background =
      target && (target.z <= -45 || (target.w >= 205 && target.h >= 275));
    if (
      sheet &&
      (!el ||
        e.shiftKey ||
        (background &&
          !this.selection.has(target.id) &&
          !e.ctrlKey &&
          !e.metaKey))
    ) {
      e.preventDefault();
      const paperId = Number(sheet.dataset.page),
        rect = sheet.getBoundingClientRect(),
        unit = rect.width / 210;
      const saved = this.page === paperId ? [...this.selection] : [];
      this.page = paperId;
      this.tableId = null;
      this.cells = [];
      this.gesture = {
        marquee: true,
        pointer: e.pointerId,
        sheet,
        saved,
        add: e.ctrlKey || e.metaKey,
        x: (e.clientX - rect.left) / unit,
        y: (e.clientY - rect.top) / unit,
        target: el?.dataset.node,
      };
      $("canvas").setPointerCapture(e.pointerId);
      return;
    }
    if (!el) {
      if (e.target.closest("#canvas")) {
        this.selection.clear();
        this.tableId = null;
        this.cells = [];
        this.drawSelection();
        this.inspector();
        this.layers();
      }
      return;
    }
    if (this.tableId === el.dataset.node) {
      const cell = e.target.closest("td,th");
      if (cell) {
        e.preventDefault();
        TableTools.active = null;
        if (!e.ctrlKey) this.cells = [];
        const index = Number(cell.dataset.cell);
        this.cells = this.cells.includes(index)
          ? this.cells.filter((v) => v !== index)
          : [...this.cells, index];
        el.querySelectorAll("[data-cell]").forEach((c) =>
          c.classList.toggle(
            "picked-cell",
            this.cells.includes(Number(c.dataset.cell)),
          ),
        );
        TableTools.refresh();
        return;
      }
    }
    e.preventDefault();
    this.select(el.dataset.node, e.ctrlKey || e.metaKey);
    if (!(e.ctrlKey || e.metaKey)) this.beginGesture(e, "");
  }
  beginGesture(e, handle) {
    const nodes = this.selected();
    if (!nodes.length) return;
    const paper = document.querySelector(
        '.paper[data-page="' + this.page + '"]',
      ),
      rect = paper.getBoundingClientRect();
    this.gesture = {
      pointer: e.pointerId,
      handle,
      nodes: clone(nodes),
      bounds: this.bounds(nodes),
      neighbors: handle ? [] : (this.current()?.nodes || []).filter(n =>
        n.type === "text" && !this.selection.has(n.id) && this.element(n.id)?.getClientRects().length
      ),
      unit: rect.width / 210,
      sx: e.clientX,
      sy: e.clientY,
      scrollX: $("canvas").scrollLeft,
      scrollY: $("canvas").scrollTop,
      started: false,
    };
    $("canvas").setPointerCapture(e.pointerId);
  }
  pointerMove(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointer) return;
    if (g.marquee) {
      const rect = g.sheet.getBoundingClientRect(),
        unit = rect.width / 210;
      const x = Math.max(0, Math.min(210, (e.clientX - rect.left) / unit)),
        y = Math.max(0, Math.min(297, (e.clientY - rect.top) / unit));
      const left = Math.min(g.x, x),
        top = Math.min(g.y, y),
        right = Math.max(g.x, x),
        bottom = Math.max(g.y, y);
      if (!g.started && Math.hypot(right - left, bottom - top) < 1) return;
      g.started = true;
      const ids = new Set(g.add ? g.saved : []);
      for (const n of this.current().nodes) {
        if (
          !this.element(n.id) ||
          n.x > right ||
          n.x + n.w < left ||
          n.y > bottom ||
          n.y + n.h < top
        )
          continue;
        if (
          n.z <= -45 &&
          !(
            n.x >= left &&
            n.x + n.w <= right &&
            n.y >= top &&
            n.y + n.h <= bottom
          )
        )
          continue;
        ids.add(n.id);
      }
      this.selection = ids;
      this.drawSelection();
      if (!g.box) {
        g.box = document.createElement("div");
        g.box.className = "drag-marquee";
        g.sheet.append(g.box);
      }
      Object.assign(g.box.style, {
        left: left + "mm",
        top: top + "mm",
        width: right - left + "mm",
        height: bottom - top + "mm",
      });
      return;
    }
    let dx = (e.clientX - g.sx + $("canvas").scrollLeft - g.scrollX) / g.unit,
      dy = (e.clientY - g.sy + $("canvas").scrollTop - g.scrollY) / g.unit;
    if (!g.started && Math.hypot(dx, dy) < 0.6) return;
    if (!g.started) {
      this.checkpoint();
      g.started = true;
    }
    const b = { ...g.bounds },
      h = g.handle;
    if (!h) {
      b.x = Math.max(0, Math.min(210 - b.w, b.x + dx));
      b.y = Math.max(0, Math.min(297 - b.h, b.y + dy));
      g.guideX = null;
      if (!e.altKey) {
        let closest = 4 / g.unit; // A four-screen-pixel snap zone at any zoom.
        let correction = 0;
        for (const other of g.neighbors) {
          if (other.y > b.y + b.h + 30 || other.y + other.h < b.y - 30) continue;
          for (const side of [0, 1]) {
            const edge = other.x + side * other.w;
            const delta = edge - (b.x + side * b.w);
            const nextX = b.x + delta;
            if (Math.abs(delta) >= closest || nextX < 0 || nextX + b.w > 210) continue;
            closest = Math.abs(delta);
            g.guideX = edge;
            correction = delta;
          }
        }
        b.x += correction;
      }
    } else {
      if (h.includes("e")) b.w = Math.max(2, b.w + dx);
      if (h.includes("s")) b.h = Math.max(2, b.h + dy);
      if (h.includes("w")) {
        b.w = Math.max(2, b.w - dx);
        b.x = g.bounds.x + g.bounds.w - b.w;
      }
      if (h.includes("n")) {
        b.h = Math.max(2, b.h - dy);
        b.y = g.bounds.y + g.bounds.h - b.h;
      }
      if (
        h.length === 2 &&
        (e.shiftKey || (g.nodes.length === 1 && g.nodes[0].lockAspect))
      ) {
        const factor = Math.max(b.w / g.bounds.w, b.h / g.bounds.h);
        b.w = g.bounds.w * factor;
        b.h = g.bounds.h * factor;
        if (h.includes("w")) b.x = g.bounds.x + g.bounds.w - b.w;
        if (h.includes("n")) b.y = g.bounds.y + g.bounds.h - b.h;
      }
      if (b.x < 0 || b.y < 0 || b.x + b.w > 210 || b.y + b.h > 297) return;
    }
    for (const old of g.nodes) {
      const n = this.node(old.id);
      n.x = roundMM(b.x + ((old.x - g.bounds.x) * b.w) / g.bounds.w);
      n.y = roundMM(b.y + ((old.y - g.bounds.y) * b.h) / g.bounds.h);
      n.w = roundMM((old.w * b.w) / g.bounds.w);
      n.h = roundMM((old.h * b.h) / g.bounds.h);
      this.nodeStyle(this.element(n.id), n);
    }
    this.drawSelection();
  }
  endGesture(e) {
    if (!this.gesture || e.pointerId !== this.gesture.pointer) return;
    if (this.gesture.marquee) {
      const g = this.gesture;
      this.gesture = null;
      g.box?.remove();
      if (!g.started)
        this.selection = new Set(g.add ? g.saved : g.target ? [g.target] : []);
      this.drawSelection();
      this.inspector();
      this.layers();
      return;
    }
    const changed = this.gesture.started;
    this.gesture = null;
    if (changed) {
      this.inspector();
      this.persist();
    }
    this.drawSelection();
  }
  cancelGesture() {
    if (!this.gesture) return;
    if (this.gesture.marquee) {
      this.gesture.box?.remove();
      this.selection = new Set(this.gesture.saved);
      this.gesture = null;
      this.drawSelection();
      this.inspector();
      this.layers();
      return;
    }
    for (const old of this.gesture.nodes) Object.assign(this.node(old.id), old);
    if (this.gesture.started) this.history.pop();
    this.gesture = null;
    this.render();
  }
  editText(id, cellIndex = null) {
    this.commitText();
    const node = this.node(id);
    if (!node) return;
    if (node.liveTable) return SmartTables.wizard(node);
    const wrapper = this.element(id);
    let content;
    if (node.type === "table" && cellIndex != null) {
      const temp = document.createElement("div");
      temp.innerHTML = safeMarkup(node.html, true);
      const raw = temp.querySelectorAll("td,th")[cellIndex];
      content = wrapper.querySelectorAll("td,th")[cellIndex];
      if (!raw || !content) return;
      content.innerHTML = raw.innerHTML;
    } else if (node.type === "text" || node.type === "shape") {
      content = wrapper.querySelector(".node-content,.shape-text");
      content.innerHTML = safeMarkup(node.html);
    } else return;
    this.editing = {
      id,
      cellIndex,
      element: content,
      initial: content.innerHTML,
    };
    content.contentEditable = "true";
    wrapper.classList.add("is-editing");
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this.range = range.cloneRange();
    this.drawSelection();
  }
  commitText(cancel = false) {
    const edit = this.editing;
    if (!edit) return;
    const html = safeMarkup(edit.element.innerHTML),
      node = this.node(edit.id);
    this.editing = null;
    this.range = null;
    edit.element.removeAttribute("contenteditable");
    if (!cancel && node && (html !== safeMarkup(edit.initial) || edit.manualFontSize)) {
      this.checkpoint();
      if (node.type === "text" || node.type === "shape") {
        node.html = html;
        if (edit.manualFontSize) node.manualFontSize = true;
        delete node.tokenRich;
        delete node.caption;
      } else {
        const tmp = document.createElement("div");
        tmp.innerHTML = safeMarkup(node.html, true);
        tmp.querySelectorAll("td,th")[edit.cellIndex].innerHTML = html;
        node.html = safeMarkup(tmp.innerHTML, true);
      }
      this.persist();
    }
    this.render();
  }
  format(command, value) {
    if (command === "underline") {
      this.commitText();
      const nodes = this.selected().filter((n) => n.type !== "image");
      if (!nodes.length) return;
      const enabled = !nodes.every(
        (n) => n.textDecoration === "underline" && n.underlineEnabled !== false,
      );
      this.property("textDecoration", enabled ? "underline" : "none");
      for (const n of this.selected()) n.underlineEnabled = enabled;
      this.render();
      this.persist();
      return;
    }
    if (!this.editing && this.selection.size > 0) {
      const props = {
        bold: ["weight", "700", "400"],
        italic: ["fontStyle", "italic", "normal"],
        underline: ["textDecoration", "underline", "none"],
        strikeThrough: ["textDecoration", "line-through", "none"],
      };
      const prop = props[command];
      if (prop) {
        const [key, on, off] = prop;
        this.property(
          key,
          this.selected()
            .filter((n) => n.type !== "image")
            .every((n) => n[key] === on)
            ? off
            : on,
        );
      }
      return;
    }
    if (!this.editing) {
      const node = this.selected()[0];
      if (!node || !["text", "shape"].includes(node.type)) return;
      this.editText(node.id);
    }
    const content = this.editing.element;
    content.focus();
    if (this.range && content.contains(this.range.commonAncestorContainer)) {
      getSelection().removeAllRanges();
      getSelection().addRange(this.range);
    }
    if (command === "size") {
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontSize", false, "7");
      for (const el of content.querySelectorAll('font[size="7"]')) {
        el.removeAttribute("size");
        el.style.fontSize = value + "px";
      }
      if (this.editing.cellIndex == null) {
        content.style.removeProperty("font-size");
        this.editing.manualFontSize = true;
      }
    } else {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(command, false, value);
    }
    if (getSelection().rangeCount)
      this.range = getSelection().getRangeAt(0).cloneRange();
  }
  create(type, shape = "rect", src = "") {
    this.commitText();
    this.checkpoint();
    const page = this.current(),
      id = "node-" + crypto.randomUUID(),
      z = Math.max(0, ...page.nodes.map((n) => n.z || 0)) + 1;
    const n = {
      id,
      type,
      name:
        type === "text"
          ? "نص جديد"
          : type === "table"
            ? "جدول جديد"
            : type === "image"
              ? "صورة جديدة"
              : SHAPES[shape][0],
      x: 25,
      y: 40,
      w: type === "table" ? 150 : 65,
      h: type === "text" ? 15 : type === "table" ? 40 : 40,
      z,
      opacity: 1,
      fontSize: 20,
      fontFamily: "Sakkal Majalla",
      lineHeight: 1.2,
      color: "#213b47",
      align: "right",
      fill:
        type === "shape"
          ? "#d9eee9"
          : type === "table"
            ? "#ffffff"
            : "transparent",
      stroke: "#387b6e",
      strokeWidth: type === "shape" || type === "table" ? 1 : 0,
      radius: type === "table" ? 2 : shape === "round" ? 4 : 0,
      shape,
      src,
      fit: "contain",
      lockAspect: type === "image",
      html:
        type === "text"
          ? "اكتب النص هنا"
          : type === "table"
            ? "<table><tbody>" +
              Array.from(
                { length: 3 },
                () =>
                  "<tr>" +
                  Array.from({ length: 3 }, () => "<td>نص</td>").join("") +
                  "</tr>",
              ).join("") +
              "</tbody></table>"
            : "",
    };
    BoxAppearance.unify(n);
    page.nodes.push(n);
    this.selection = new Set([id]);
    this.render();
    this.persist();
    return n;
  }
  action(name) {
    if (name === "leave") return this.leave();
    if (name === "approve") return this.approve();
    if (name === "undo" || name === "redo") return this.undo(name === "redo");
    if (name === "table") return SmartTables.wizard();
    if (name === "text") return this.create(name);
    if (name === "image") return Images.choose();
    if (name === "replaceImage" && this.selected()[0]?.binding) {
      const n = this.selected()[0];
      if (n.binding === "customer") $("customerPhotoFile").click();
      else {
        Workspace.open(
          ["vehicleSlot", "receipt", "maintenance"].includes(n.binding) ||
            Images.legacyVehicleKey(n.slot)
            ? "vehicle"
            : "company",
        );
      }
      return;
    }
    if (name === "replaceImage") {
      this.imageTarget =
        name === "replaceImage" ? this.selected()[0]?.id : null;
      $("editorImageFile").click();
      return;
    }
    if (name === "shapes") {
      const button = document.querySelector("[data-action=shapes]"),
        r = button.getBoundingClientRect();
      $("shapePicker").style.top = r.bottom + 6 + "px";
      $("shapePicker").style.left =
        Math.max(8, Math.min(innerWidth - 280, r.left - 100)) + "px";
      $("shapePicker").hidden = !$("shapePicker").hidden;
      return;
    }
    this.commitText();
    if (name === "page") {
      this.checkpoint();
      const id = Math.max(8, ...this.scene.pages.map((p) => p.id)) + 1;
      const page = { id, name: "صفحة إضافية " + (id - 8), nodes: [] };
      const template = ContractTemplates.find(d.templateId,this.scene);
      if (template) {
        page.id = Math.max(id,...(this.scene.contractTemplates || []).flatMap(t=>t.pages.map(r=>r.id)).filter(v=>v<9000))+1;
        template.pages.push({id:page.id,source:d.contractType,page});
      } else this.scene.pages.push(page);
      d.pages.push(page.id);
      this.page = page.id;
      this.selection.clear();
      this.render();
      $("pagePreview").value = String(page.id);
      this.changePage();
      this.persist();
      return;
    }
    const nodes = this.selected();
    if (!nodes.length) return;
    if (name === "editText") return this.editText(nodes[0].id);
    if (name === "tableMode") {
      this.tableId = this.tableId === nodes[0].id ? null : nodes[0].id;
      this.cells = [];
      TableTools.refresh();
      $("saveStatus").textContent = this.tableId
        ? "تحرير الخلايا · Ctrl للتحديد · Escape للخروج"
        : "تحريك الجدول";
      return;
    }
    this.checkpoint();
    const page = this.current();
    if (name === "delete") {
      page.nodes = page.nodes.filter((n) => !this.selection.has(n.id));
      this.selection.clear();
    }
    if (name === "duplicate") {
      const copies = clone(nodes).map((n) => ({
        ...n,
        id: "node-" + crypto.randomUUID(),
        x: Math.min(210 - n.w, n.x + 5),
        y: Math.min(297 - n.h, n.y + 5),
        name: n.name + " · نسخة",
        z: Math.max(...page.nodes.map((n) => n.z || 0)) + 1,
      }));
      page.nodes.push(...copies);
      this.selection = new Set(copies.map((n) => n.id));
    }
    if (name === "front" || name === "back") {
      let z =
        name === "front"
          ? Math.max(...page.nodes.map((n) => n.z || 0)) + 1
          : Math.min(...page.nodes.map((n) => n.z || 0)) - nodes.length;
      nodes.forEach((n) => (n.z = z++));
    }
    if (name === "alignRight") {
      const right = Math.max(...nodes.map((n) => n.x + n.w));
      nodes.forEach((n) => (n.x = right - n.w));
    }
    if (name === "alignTop") {
      const top = Math.min(...nodes.map((n) => n.y));
      nodes.forEach((n) => (n.y = top));
    }
    this.render();
    this.persist();
  }
  tableGrid(table) {
    const grid = [],
      positions = new Map();
    [...table.rows].forEach((row, y) => {
      grid[y] ||= [];
      let x = 0;
      for (const cell of row.cells) {
        while (grid[y][x]) x++;
        positions.set(cell, { x, y });
        for (let dy = 0; dy < cell.rowSpan; dy++)
          for (let dx = 0; dx < cell.colSpan; dx++) {
            grid[y + dy] ||= [];
            grid[y + dy][x + dx] = cell;
          }
        x += cell.colSpan;
      }
    });
    return { grid, positions };
  }
  tableAction(kind, value) {
    this.commitText();
    const n = this.selected()[0];
    if (n?.type !== "table") return;
    if (n.liveTable) return SmartTables.wizard(n);
    const tmp = document.createElement("div");
    tmp.innerHTML = safeMarkup(n.html, true);
    const table = tmp.querySelector("table"),
      cells = [...table.querySelectorAll("td,th")],
      chosen = this.cells.map((i) => cells[i]).filter(Boolean),
      { grid, positions } = this.tableGrid(table);
    if (
      ["merge", "split", "rowHeight", "columnWidth"].includes(kind) &&
      !chosen.length
    ) {
      $("saveStatus").textContent = "فعّل تحرير الخلايا وحدد الخلايا أولاً";
      return;
    }
    this.checkpoint();
    if (kind === "merge") {
      const x0 = Math.min(...chosen.map((c) => positions.get(c).x)),
        y0 = Math.min(...chosen.map((c) => positions.get(c).y)),
        x1 = Math.max(...chosen.map((c) => positions.get(c).x + c.colSpan)),
        y1 = Math.max(...chosen.map((c) => positions.get(c).y + c.rowSpan));
      const region = new Set();
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) region.add(grid[y]?.[x]);
      if (
        region.has(undefined) ||
        [...region].some((c) => !chosen.includes(c)) ||
        chosen.some((c) => positions.get(c).x < x0 || positions.get(c).y < y0)
      ) {
        this.history.pop();
        $("saveStatus").textContent = "اختر مستطيلاً كاملاً من الخلايا للدمج";
        return;
      }
      const first = grid[y0][x0];
      for (const c of chosen)
        if (c !== first) {
          first.append(document.createElement("br"), ...c.childNodes);
          c.remove();
        }
      first.colSpan = x1 - x0;
      first.rowSpan = y1 - y0;
    } else if (kind === "split") {
      const selected = new Set(chosen),
        rows = [...table.rows],
        width = Math.max(...grid.map((r) => r.length));
      for (const c of chosen) {
        c.rowSpan = 1;
        c.colSpan = 1;
      }
      for (let y = 0; y < grid.length; y++) {
        const row = rows[y] || table.insertRow();
        const content = [];
        for (let x = 0; x < width; x++) {
          const cell = grid[y]?.[x];
          if (!cell) continue;
          const pos = positions.get(cell);
          if (pos.x === x && pos.y === y) content.push(cell);
          else if (selected.has(cell)) {
            const blank = document.createElement("td");
            blank.innerHTML = "<br>";
            content.push(blank);
          }
        }
        row.replaceChildren(...content);
      }
    } else if (kind === "row") {
      n.h = Math.min(297 - n.y, n.h + n.h / table.rows.length);
      const row = table.insertRow();
      for (let x = 0; x < Math.max(...grid.map((r) => r.length)); x++)
        row.insertCell().innerHTML = "<br>";
    } else if (kind === "column") {
      n.w = Math.min(
        210 - n.x,
        n.w + n.w / Math.max(...grid.map((r) => r.length)),
      );
      for (const row of table.rows) row.insertCell().innerHTML = "<br>";
    } else if (kind === "rowHeight") {
      const avg = n.h / table.rows.length;
      for (const c of chosen)
        table.rows[positions.get(c).y].style.height =
          Math.max(2, Number(value) || 2) + "mm";
      n.h = Math.max(
        n.h,
        [...table.rows].reduce(
          (sum, r) => sum + (parseFloat(r.style.height) || avg),
          0,
        ),
      );
    } else if (kind === "columnWidth") {
      const count = Math.max(...grid.map((r) => r.length)),
        old = table.querySelector("colgroup"),
        group = document.createElement("colgroup");
      for (let x = 0; x < count; x++) {
        const col = document.createElement("col");
        col.style.width = old?.children[x]?.style.width || n.w / count + "mm";
        if (chosen.some((c) => positions.get(c).x === x))
          col.style.width = Math.max(2, Number(value) || 2) + "mm";
        group.append(col);
      }
      old?.remove();
      table.prepend(group);
      n.w = Math.max(
        n.w,
        [...group.children].reduce(
          (sum, c) => sum + parseFloat(c.style.width),
          0,
        ),
      );
    }
    if (n.x + n.w > 210 || n.y + n.h > 297) {
      this.scene = this.history.pop();
      $("saveStatus").textContent = "المقاس يتجاوز الصفحة";
      this.render();
      return;
    }
    n.html = safeMarkup(table.outerHTML, true);
    this.cells = [];
    this.render();
    this.persist();
  }
  keyDown(e) {
    if (this.mode !== "design") return;
    if (e.key === "Escape") {
      if (this.gesture) this.cancelGesture();
      else if (this.editing) this.commitText(true);
      else {
        this.tableId = null;
        this.cells = [];
        this.selection.clear();
        this.drawSelection();
        this.inspector();
        $("shapePicker").hidden = true;
      }
      return;
    }
    if (e.target.closest("input,textarea,select,[contenteditable=true]"))
      return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && ["c", "x", "v"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const key = e.key.toLowerCase();
      if (key !== "v") {
        this.nodeClipboard = clone(this.selected());
        if (key === "x" && this.nodeClipboard.length) this.action("delete");
      } else if (this.nodeClipboard?.length) {
        this.checkpoint();
        const page = this.current();
        const copies = clone(this.nodeClipboard).map((n, i) => ({
          ...n,
          id: "node-" + crypto.randomUUID(),
          z: Math.max(0, ...page.nodes.map((x) => x.z || 0)) + i + 1,
        }));
        page.nodes.push(...copies);
        this.selection = new Set(copies.map((n) => n.id));
        this.render();
        this.persist();
      }
      return;
    }
    if (mod && ["z", "y", "d"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (e.key.toLowerCase() === "d") this.action("duplicate");
      else this.undo(e.key.toLowerCase() === "y" || e.shiftKey);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.action("delete");
    }
    if (e.key === "Enter" && this.selected()[0]?.type === "text")
      this.editText(this.selected()[0].id);
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
      this.selection.size
    ) {
      e.preventDefault();
      const b = this.bounds(),
        step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") this.property("x", Math.max(0, b.x - step));
      if (e.key === "ArrowRight")
        this.property("x", Math.min(210 - b.w, b.x + step));
      if (e.key === "ArrowUp") this.property("y", Math.max(0, b.y - step));
      if (e.key === "ArrowDown")
        this.property("y", Math.min(297 - b.h, b.y + step));
    }
  }
  async init() {
    this.draft = await getDB("designDraft");
    if (
      this.draft?.scene?.version === 6 &&
      !(this.draft.scene.billLayoutVersion >= 2)
    ) {
      arrangeBillPages(this.draft.scene);
      if (db)
        await putDB("designDraft", this.draft).catch(() => {
          $("saveStatus").textContent = "تعذر حفظ مسودة التصميم محلياً";
        });
    }
    const settingsButton = document.createElement("button");
    settingsButton.id = "openDesign";
    settingsButton.className = "primary";
    settingsButton.textContent = "تعديل تصميم العقد";
    if (!$("openDesign"))
      $("settingsDrawer").querySelector("header").after(settingsButton);
    $("openDesign").onclick = () => this.enter();
    $("settingsShortcut").onclick = () => $("openSettings").click();
    $("printShortcut").onclick = () => $("printAll").click();

    $("zoom").onchange = () => this.zoom();
    const iconPaths = {
      homeButton: "M3 11l9-8 9 8M5 10v11h14V10M9 21v-8h6v8",
      themeToggle: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12",
      customerUpload: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
      customerCapture:
        "M3 7h5l2-3h4l2 3h5v14H3zM16 14a4 4 0 1 0-8 0 4 4 0 0 0 8 0",
      front: "M8 8h13v13H8zM3 3h13v5M3 3v13h5",
      back: "M3 3h13v13H3zM16 8h5v13H8v-5",
      alignRight: "M21 2v20M5 5h12v5H5zM9 14h8v5H9z",
      alignTop: "M2 3h20M5 7h5v14H5zM14 7h5v10h-5z",
      replaceImage: "M3 3h18v18H3zM3 17l6-6 4 4M14 7h6m-3-3v6",
      settingsShortcut: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
      printShortcut: "M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z",
      exportShortcut: "M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8",
      text: "M4 4h16M12 4v16M8 20h8",
      image: "M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5",
      table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
      shapes: "M3 3h9v9H3zM16 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12",
      undo: "M9 5L3 11l6 6M3 11h11a6 6 0 0 1 6 6",
      redo: "M15 5l6 6-6 6M21 11H10a6 6 0 0 0-6 6",
      duplicate: "M8 8h13v13H8zM16 8V3H3v13h5",
      delete: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15",
    };
    for (const [id, path] of Object.entries(iconPaths)) {
      const b = $(id) || document.querySelector('[data-action="' + id + '"]');
      if (b) {
        b.setAttribute("aria-label", b.title || b.textContent);
        b.innerHTML =
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' +
          path +
          '"/></svg>';
      }
    }
    const signal = new AbortController().signal; // One registration per event for the lifetime of this document.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target.closest("#textTools")) {
          if (e.target.closest("button")) e.preventDefault();
          return;
        }
        if (!e.target.closest("#shapePicker,[data-action=shapes]"))
          $("shapePicker").hidden = true;
        this.pointerDown(e);
      },
      { signal },
    );
    document.addEventListener("pointermove", (e) => this.pointerMove(e), {
      signal,
    });
    document.addEventListener("pointerup", (e) => this.endGesture(e), {
      signal,
    });
    document.addEventListener("pointercancel", () => this.cancelGesture(), {
      signal,
    });
    document.addEventListener("keydown", (e) => this.keyDown(e), { signal });
    $("pages").addEventListener(
      "dblclick",
      (e) => {
        if (this.mode !== "design") return;
        const el = e.target.closest("[data-node]");
        if (!el) return;
        const n = this.node(el.dataset.node);
        if (n.type === "text" || n.type === "shape") this.editText(n.id);
        if (n.type === "table") {
          this.tableId = n.id;
          const cell = e.target.closest("[data-cell]");
          if (cell) this.editText(n.id, Number(cell.dataset.cell));
        }
      },
      { signal },
    );
    document.addEventListener(
      "selectionchange",
      () => {
        if (!this.editing) return;
        const sel = getSelection();
        if (sel.rangeCount && this.editing.element.contains(sel.anchorNode)) {
          this.range = sel.getRangeAt(0).cloneRange();
          const el =
              sel.anchorNode.nodeType === 1
                ? sel.anchorNode
                : sel.anchorNode.parentElement,
            cs = getComputedStyle(el);
          $("fontSize").value = Math.round(parseFloat(cs.fontSize));
          $("fontColor").value = this.hex(cs.color);
          for (const b of document.querySelectorAll("[data-format]")) {
            b.classList.toggle(
              "active",
              document.queryCommandState(b.dataset.format),
            );
          }
        }
      },
      { signal },
    );
    document.addEventListener(
      "paste",
      (e) => {
        if (!this.editing || !this.editing.element.contains(e.target)) return;
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain"),
        );
      },
      { signal },
    );
    document
      .querySelectorAll("[data-action]")
      .forEach((b) => (b.onclick = () => this.action(b.dataset.action)));
    document
      .querySelectorAll("[data-table]")
      .forEach((b) => (b.onclick = () => this.tableAction(b.dataset.table)));
    document
      .querySelectorAll("[data-prop]")
      .forEach(
        (input) =>
          (input.onchange = () =>
            this.property(
              input.dataset.prop,
              ["number", "range"].includes(input.type)
                ? Number(input.value)
                : input.value,
            )),
      );
    const opacityInput = document.querySelector('[data-prop="opacity"]');
    opacityInput.oninput = () => {
      const value = Math.max(0, Math.min(1, Number(opacityInput.value)));
      for (const n of this.selected()) {
        if (n.type === "text" || n.type === "table") continue;
        const el = this.element(n.id);
        if (el) el.style.opacity = value;
      }
      opacityInput.closest("label").querySelector("output").textContent =
        Math.round(value * 100) + "%";
      opacityInput.setAttribute(
        "aria-valuetext",
        Math.round(value * 100) + "% عتامة",
      );
    };
    $("nodeName").onchange = () => this.property("name", $("nodeName").value);
    $("aspectLock").onchange = () =>
      this.property("lockAspect", $("aspectLock").checked);
    $("noFill").onchange = () =>
      this.property("fill", $("noFill").checked ? "transparent" : "#ffffff");
    $("imageBinding").onchange = () => Images.bind($("imageBinding").value);
    document
      .querySelectorAll("[data-format]")
      .forEach((b) => (b.onclick = () => this.format(b.dataset.format)));
    $("fontFamily").onchange = () =>
      this.editing
        ? this.format("fontName", $("fontFamily").value)
        : this.property("fontFamily", $("fontFamily").value);
    const sizeInput = $("fontSize");
    sizeInput.oninput = () => {
      if (this.editing || !sizeInput.value || !sizeInput.validity.valid) return;
      for (const node of this.selected()) {
        if (node.type === "image") continue;
        const el = this.element(node.id);
        el?.style.setProperty("--preview-font-size", sizeInput.value + "px");
        el?.classList.add("preview-font-size");
      }
    };
    sizeInput.onblur = () => {
      for (const el of $("pages").querySelectorAll(".preview-font-size")) {
        el.classList.remove("preview-font-size");
        el.style.removeProperty("--preview-font-size");
      }
    };
    sizeInput.onchange = () => {
      const size = Math.max(6, Math.min(96, sizeInput.valueAsNumber || 18));
      sizeInput.value = size;
      if (this.editing) {
        const allText = document.createRange();
        allText.selectNodeContents(this.editing.element);
        const partial = this.range && !this.range.collapsed &&
          this.range.toString() !== allText.toString();
        if (this.editing.cellIndex != null || partial) {
          if (this.editing.cellIndex != null && this.range?.collapsed)
            this.range = allText;
          this.format("size", size);
          return;
        }
      }
      this.property("fontSize", size);
    };
    $("fontColor").onchange = () =>
      this.editing
        ? this.format("foreColor", $("fontColor").value)
        : this.property("color", $("fontColor").value);
    document
      .querySelectorAll("[data-align]")
      .forEach(
        (b) => (b.onclick = () => this.property("align", b.dataset.align)),
      );
    $("insertVariable").onchange = () => {
      const key = $("insertVariable").value;
      if (!key) return;
      const n = this.selected()[0];
      if (!n) return;
      if (!this.editing) this.editText(n.id);
      this.editing.element.focus();
      if (this.range) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(this.range);
      }
      document.execCommand("insertText", false, "{{" + key + "}}");
      this.commitText();
    };
    $("textAlign").onchange = () =>
      this.property("align", $("textAlign").value);
    $("lineHeight").onchange = () =>
      this.property(
        "lineHeight",
        Math.max(0.8, Math.min(3, Number($("lineHeight").value) || 1.2)),
      );
    $("variableLabel").onchange = () => {
      const token = this.selected()[0]?.html?.match(/\{\{(\w+)\}\}/)?.[1];
      if (token) {
        this.checkpoint();
        this.scene.variableLabels = {
          ...(this.scene.variableLabels || {}),
          [token]: $("variableLabel").value,
        };
        this.persist();
      }
    };
    $("rowHeight").onchange = () =>
      this.tableAction("rowHeight", $("rowHeight").value);
    $("columnWidth").onchange = () =>
      this.tableAction("columnWidth", $("columnWidth").value);
    $("shapesGrid").replaceChildren();
    for (const [key, [label]] of Object.entries(SHAPES)) {
      const button = document.createElement("button");
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = shapeMarkup({
        shape: key,
        fill: "#d9eee9",
        stroke: "#357b6d",
        strokeWidth: 1.4,
      });
      button.onclick = () => {
        this.create("shape", key);
        $("shapePicker").hidden = true;
      };
      $("shapesGrid").append(button);
    }
    $("editorImageFile").onchange = async () => {
      try {
        const file = $("editorImageFile").files[0];
        if (!file) return;
        const src = await readImage(file),
          img = new Image();
        img.src = src;
        await img.decode();
        if (this.imageTarget) {
          const n = this.node(this.imageTarget);
          if (n) {
            this.checkpoint();
            n.src = src;
            n.binding = "";
            delete n.cropHeight;
            delete n.cropRatio;
            this.render();
            this.persist();
          }
        } else {
          const n = this.create("image", "rect", src);
          n.h = Math.min(100, (n.w * img.height) / img.width);
          this.render();
          this.persist();
        }
      } catch (e) {
        Feedback.notice(e.message);
      } finally {
        $("editorImageFile").value = "";
        this.imageTarget = null;
      }
    };
    $("canvas").addEventListener("scroll", () => this.drawSelection(), {
      signal,
    });
    new ResizeObserver(() => {
      if (!this.gesture) this.zoom();
    }).observe($("canvas"));
    window.addEventListener(
      "beforeprint",
      () => {
        if (document.activeElement?.closest("#fillPanel, #toolbar")) document.activeElement.blur();
        this.commitText();
        Services.beforePrint();
        this.printing = true;
        this.render();
        PrintPlan.prepare();
        document.querySelectorAll(".paper").forEach((p) => {
          p.style.display = "block";
          p.style.zoom = "1";
        });
      },
      { signal },
    );
    window.addEventListener(
      "afterprint",
      () => {
        this.printing = false;
        this.render();
        applyPageVisibility();
        this.zoom();
        Services.afterPrint();
      },
      { signal },
    );
    this.configRef = cfg;
    this.render();
    await Services.init();
  }
}
