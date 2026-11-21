// Shared A4 output for the editor, preview, archive, offline edition and printing.
class DocumentSceneRenderer {
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
      if(!archived && page.id===1 && !d.standaloneBook && d.contractType==="exchange")Exchange.numberClauses(page);
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
          const element = this.renderNode(n,page.id);
          const ordinal =
            n.clauseNumber ||
            (!archived && page.id === 1 && /^البند (\d+)$/.exec(n.name)?.[1]);
          if (ordinal)
            element.dataset.clauseNumber =
              n.clauseDash ||
              (page.id === 1 && d.contractType === "installment")
                ? "-"
                : Number(ordinal).toLocaleString("ar-IQ") + ".";
          if(ordinal)DocumentInk.ordinal(element,n);
          if (!show) element.style.opacity = ".3";
          paper.append(element);
        }
      }
      papers.append(paper);
    }
    ctx = baseCtx;
    return { papers, displayPages };
  }
  renderNode(n,pageId) {
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
        EditorSettings.display("underlineWidth", n.underlineWidth) + "px",
      );
    }
    if (n.decorationColor) el.style.textDecorationColor = n.decorationColor;
    if (n.type === "text") {
      el.dataset.valign = n.verticalAlign || (n.vehicleCell ? "middle" : "top");
      el.append(documentTextContent(n, ctx));
    } else if (n.type === "image") {
      const src = Images.source(n);
      if (src) {
        const img = document.createElement("img");
        let stock;
        if (n.firstFormHeader && n.cropHeight) {
          const asset = ContractAssets.headers[co().id];
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
      el.dataset.valign = n.verticalAlign || "middle";
      text.append(documentTextContent({ ...n, html: n.html || esc(n.caption || "") }, ctx));
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
    if(n.type!=="image")arabicPaperDates(el);
    DocumentInk.apply(el,n,pageId);
    return el;
  }
  nodeStyle(el, n) {
    if (n.cropHeight && !n.cropRatio) n.cropRatio = n.cropHeight / n.h;
    Object.assign(el.style, {
      left: roundMM(n.x) + "mm",
      top: roundMM(n.y) + "mm",
      width: roundMM(n.w) + "mm",
      height: roundMM(n.h) + "mm",
      zIndex: String(n.z || 0),
      opacity: String(n.type === "text" ? 1 : EditorSettings.display("opacity", n.opacity)),
      fontFamily: CONTRACT_FONT,
      fontSize: EditorSettings.display("fontSize", n.fontSize) + "px",
      lineHeight: String(EditorSettings.display("lineHeight", n.lineHeight)),
      fontWeight: n.weight || "400",
      color: n.color || "#172c35",
      textDecorationColor: n.decorationColor || n.color || "#172c35",
      textAlign: n.align || (n.type === "shape" ? "center" : "right"),
      direction: n.direction === "ltr" ? "ltr" : "rtl",
      background:
        n.type === "shape" || n.fillEnabled === false
          ? "transparent"
          : n.fill || "transparent",
      border:
        n.type === "shape" || n.strokeEnabled === false
          ? "none"
          : EditorSettings.display("strokeWidth", n.strokeWidth) +
            "px " +
            (n.dash || "solid") +
            " " +
            (n.stroke || "transparent"),
      borderRadius: EditorSettings.display("radius", n.radius) + "mm",
    });
  }
}
