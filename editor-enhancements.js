const EditorEnhancements = {
  upgradePage(page) {
    if (page.id === 8 && !page.guarantorNotesVersion) {
      for (const n of page.nodes) {
        for (const key of ["html", "caption"])
          if (typeof n[key] === "string")
            n[key] = n[key].replace(/\{\{buyer([^}]*)\}\}/g, "{{guarantor$1}}");
        if (n.tokenRich?.token?.startsWith("buyer"))
          n.tokenRich.token = n.tokenRich.token.replace(/^buyer/, "guarantor");
      }
      page.guarantorNotesVersion = 1;
    }
    BoxAppearance.upgrade(page);
  },
  menu: null,
  index: 0,
  matches: [],
  range: null,
  init() {
    BoxAppearance.init();
    const menu = (this.menu = document.createElement("div"));
    menu.id = "tokenSuggestions";
    menu.hidden = true;
    document.body.append(menu);
    document.addEventListener("input", (e) => {
      if (e.target.closest("[contenteditable=true]")) this.suggest();
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (menu.hidden) return;
        if (
          ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.key === "Escape") {
            menu.hidden = true;
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            this.choose();
            return;
          }
          this.index =
            (this.index +
              (e.key === "ArrowDown" ? 1 : -1) +
              this.matches.length) %
            this.matches.length;
          this.paint();
        }
      },
      true,
    );
    document.addEventListener("pointerdown", (e) => {
      if (
        !menu.contains(e.target) &&
        !e.target.closest("[contenteditable=true]")
      )
        menu.hidden = true;
    });
    const grid = document.querySelector(".alignment-buttons");
    grid.replaceChildren();
    grid.classList.add("nine-align");
    for (const v of ["top", "middle", "bottom"])
      for (const h of ["right", "center", "left"]) {
        const b = document.createElement("button");
        b.dataset.align = h;
        b.dataset.valign = v;
        b.title =
          { right: "يمين", center: "وسط", left: "يسار" }[h] +
          " " +
          { top: "فوق", middle: "وسط", bottom: "تحت" }[v];
        b.setAttribute("aria-label", b.title);
        const x = { right: 12, center: 7, left: 2 }[h],
          y = { top: 3, middle: 9, bottom: 15 }[v];
        b.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="1" width="22" height="22" rx="2" opacity=".25"/><path d="M' +
          x +
          " " +
          y +
          'h9m-9 3h9m-9 3h9"/></svg>';
        b.onclick = () => App.property("align", h, {verticalAlign:v});
        grid.append(b);
      }
    $("canvas").addEventListener("scroll", () => {
      if (App.printing || App.editing) return;
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = requestAnimationFrame(() => {
        const top = $("canvas").getBoundingClientRect().top + 65;
        const papers = [...$("pages").children];
        const selected = papers.reduce(
          (best, p) =>
            Math.abs(p.getBoundingClientRect().top - top) <
            Math.abs(best.getBoundingClientRect().top - top)
              ? p
              : best,
          papers[0],
        );
        if (selected && App.page !== Number(selected.dataset.page)) {
          App.selection.clear();
          App.page = Number(selected.dataset.page);
          $("pagePreview").value = selected.dataset.page;
          [...$("pageRail").querySelectorAll(".page-item")].forEach((r, i) =>
            r.classList.toggle("active", App.displayPages[i]?.id === App.page),
          );
          App.inspector();
          App.layers();
        }
      });
    });
    $("loadContract").innerHTML =
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 2h10l6 6v14H4zM14 2v6h6M8 14l-2 2 2 2m8-4 2 2-2 2M13 12l-2 8"/></svg>';
  },
  suggest() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) {
      this.menu.hidden = true;
      return;
    }
    const r = sel.getRangeAt(0),
      node = r.startContainer;
    if (node.nodeType !== 3) {
      this.menu.hidden = true;
      return;
    }
    const match = node.textContent
      .slice(0, r.startOffset)
      .match(/\/\/([^\s{}]*)$/);
    if (!match) {
      this.menu.hidden = true;
      return;
    }
    const labels = { ...cfg.variableLabels, ...App.scene.variableLabels };
    for (const defs of Object.values(dataDefs))
      for (const [key, label] of defs) labels[key] = label;
    for (const f of cfg.companyFields || []) labels[f.key] = f.label;
    this.matches = Object.keys(context())
      .filter((k) =>
        (k + " " + (labels[k] || ""))
          .toLowerCase()
          .includes(match[1].toLowerCase()),
      )
      .map((k) => ({ key: k, label: labels[k] || k }))
      .sort((a, b) => (a.key === match[1] ? -1 : b.key === match[1] ? 1 : 0));
    if (!this.matches.length) {
      this.menu.hidden = true;
      return;
    }
    this.range = r.cloneRange();
    this.range.setStart(node, r.startOffset - match[0].length);
    this.index = 0;
    const box = r.getBoundingClientRect();
    this.menu.style.left =
      Math.min(Math.max(8, box.left), innerWidth - 290) + "px";
    this.menu.style.top = Math.min(box.bottom + 5, innerHeight - 260) + "px";
    this.menu.hidden = false;
    this.paint();
  },
  paint() {
    this.menu.replaceChildren();
    this.matches.slice(0, 80).forEach((item, i) => {
      const b = document.createElement("button");
      b.textContent = item.label + " · " + item.key;
      b.classList.toggle("active", i === this.index);
      b.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.index = i;
        this.choose();
      };
      this.menu.append(b);
    });
    this.menu.children[this.index]?.scrollIntoView({ block: "nearest" });
  },
  choose() {
    const item = this.matches[this.index];
    if (!item || !this.range) return;
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(this.range);
    document.execCommand("insertText", false, "{{" + item.key + "}}");
    this.menu.hidden = true;
    App.range = selection.getRangeAt(0).cloneRange();
  },
  exchangeFields() {
    const old = $("exchangePaymentFields");
    if (old) old.remove();
    if (d.contractType !== "exchange") return;
    const box = document.createElement("div");
    box.id = "exchangePaymentFields";
    box.className = "grid";
    for (const [key, label, options] of [
      ["exchangePayer", "جهة دفع الفرق", ["الطرف الأول", "الطرف الثاني"]],
      ["exchangeManual", "طريقة الوصف", ["تلقائي", "ملاحظة يدوية"]],
      ["exchangePaymentNote", "ملاحظة الدفع", null],
    ]) {
      const l = document.createElement("label"),
        span = document.createElement("span"),
        input = document.createElement(options ? "select" : "input");
      span.textContent = label;
      input.id = key;
      if (options)
        options.forEach((v, i) => input.add(new Option(v, String(i))));
      input.value = d[key] || "0";
      if (!options) input.value = d[key] || "";
      input.onchange = () => {
        d[key] = input.value;
        render();
      };
      l.append(span, input);
      box.append(l);
    }
    $("paymentInputs").closest(".payment-overview").before(box);
    $("deposit").closest("label").querySelector("span").textContent =
      "نقداً عند التوقيع";
  },
  exchangeContext(ctx, r) {
    const parts = [];
    const payer = d.exchangePayer === "1" ? "الطرف الثاني" : "الطرف الأول",
      payee = d.exchangePayer === "1" ? "الطرف الأول" : "الطرف الثاني";
    parts.push(
      "يدفع " +
        payer +
        " إلى " +
        payee +
        " مبلغ الفرق البالغ " +
        money(amount(d.total)) +
        " د.ع. على الشكل الآتي:",
    );
    if (d.exchangeManual !== "1") {
      if (amount(d.deposit) > 0)
        parts.push(
          "حيث سدد مبلغ " +
            money(amount(d.deposit)) +
            " د.ع. نقداً عند توقيع العقد.",
        );
      const extras = d.extras.filter((x) => amount(x.amount) > 0);
      if (extras.length)
        parts.push(
          "ويسدد المتبقي " +
            extras
              .map(
                (x) =>
                  "دفعة بقيمة " +
                  money(amount(x.amount)) +
                  " د.ع. بتاريخ " +
                  dateLabel(x.date),
              )
              .join("، ") +
            " .",
        );
      if (r.count > 0 && (r.payment > 0 || r.last > 0))
        parts.push(
          r.phase
            ? ctx.phaseFirstLine + "، " + ctx.phaseSecondLine
            : "وأقساط عددها " +
                r.count +
                " بقيمة " +
                money(r.payment) +
                " د.ع. من تاريخ " +
                ctx.firstDate +
                " إلى تاريخ القسط الأخير " +
                ctx.lastDate +
                "، وقيمة الأخير " +
                (r.last < 0 ? "-" : money(r.last)) +
                " د.ع.",
        );
    }
    if (d.exchangePaymentNote?.trim()) parts.push(d.exchangePaymentNote.trim());
    ctx.exchangePaymentText = parts.join("\n");
  },
};
