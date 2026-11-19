const Cash = {
  buildInputs() {
    for (const id of [
      "cashReceived",
      "cashDueDate",
      "cashTransferNote",
      "cashSplit",
    ]) {
      const el = $(id),
        check = el.type === "checkbox";
      if (check) el.checked = d[id];
      else el.value = d[id] || "";
      el.onchange = () => {
        d[id] = check ? el.checked : el.value;
        this.decorate();
        render();
      };
    }
    $("cashTransferLetter").onchange = event => {
      if (!TransferLetter.paymentContract(d)) return;
      d[d.contractType + "TransferLetter"] = event.target.checked;
      render();
    };
    $("payAtTransfer").onchange = event => {
      if (!TransferLetter.paymentContract(d)) return;
      d[d.contractType + "PayAtTransfer"] = event.target.checked;
      render();
    };
    const rows = $("cashPaymentRows");
    rows.replaceChildren();
    d.cashPayments.forEach((row, i) => {
      const label = document.createElement("div");
      label.className = "cash-payment-row";
      const title = "الدفعة " + (i + 1);
      for (const key of ["amount", "date"]) {
        const el = document.createElement("input");
        el.id = "cash-" + key + "-" + i;
        el.setAttribute(
          "aria-label",
          (key === "amount" ? "مبلغ " : "تاريخ ") + title,
        );
        if (key === "date") el.type = "date";
        else {
          el.inputMode = "numeric";
          el.placeholder = "المبلغ";
        }
        el.value = row[key];
        el.onchange = () => {
          row[key] = el.value;
          render();
        };
        const field = document.createElement("label");
        const caption = document.createElement("span");
        caption.textContent = key === "amount" ? "قيمة " + title : "تاريخها";
        field.append(caption, el);
        if(key==="amount")Workspace.addRemovePayment(field,i,true);
        label.append(field);
      }
      rows.append(label);
    });
  },
  decorate() {
    if (!$("total") || !$("buyer")?.dataset.arranged) return;
    const cash = ["cash", "external"].includes(d.contractType);
    $("guarantorCard").hidden = cash;
    $("cashFields").hidden = !cash;
    $("extraEditors").hidden = cash;
    $("cards").classList.toggle("cash-form", cash);
    $("installmentInputs").hidden = cash;
    $("deposit").closest("label").hidden = cash;
    $("depositDate").closest("label").hidden = cash || amount(d.deposit) <= 0;
    if (!cash) {
      $("cashPaymentRows").hidden = true;
      return;
    }
    const outstanding = amount(d.total) > amount(d.cashReceived);
    $("cashSplitLabel").hidden = !outstanding;
    $("cashSingleDate").hidden = calculate(d).remaining <= 0;
    $("cashPaymentRows").hidden = d.contractType !== "cash" || !outstanding;
  },
  context(result, r, compact = false) {
    if (d.contractType !== "cash") return;
    for (let i = 0; i < 4; i++) {
      result["cashValue" + i] = "";
      result["cashWords" + i] = "";
      result["cashDate" + i] = "";
    }
    r.cashRows.forEach((row, position) => {
      const i = compact ? position : (row.slot ?? position);
      result["cashValue" + i] = money(row.value);
      result["cashWords" + i] = words(row.value);
      result["cashDate" + i] = dateLabel(row.date);
    });
    result.cashStatus = r.remaining > 0 && d.cashDueDate ? "تاريخ سداد المتبقي: " + dateLabel(d.cashDueDate) : "";
  },
  // The installment page owns the measurements. Cash changes bindings, never
  // measures customer data to decide where a label or a value should start.
  template(scene) {
    const previous = scene.cashTemplate;
    if (previous?.fixedLayout >= 2) return previous;
    if (previous?.fixedLayout === 1) {
      previous.nodes = previous.nodes.filter((n) => n.id !== "cash-transfer");
      const execution = previous.nodes.find((n) => n.id === "cash-clause-12");
      const base =
        execution || previous.nodes.find((n) => n.id === "cash-clause-11");
      if (base) {
        const y = execution ? execution.y : base.y + base.h + 0.53;
        const odometer = {
          ...clone(base),
          id: "cash-clause-12",
          clauseNumber: 12,
          name: "البند 12",
          y,
          html: this.odometer,
          h: Math.max(12, base.h),
        };
        if (execution)
          Object.assign(execution, {
            id: "cash-clause-13",
            clauseNumber: 13,
            name: "البند 13",
            y: y + odometer.h + 0.53,
          });
        previous.nodes.push(odometer);
      }
      previous.fixedLayout = 2;
      return previous;
    }
    const original = scene.pages.find((p) => p.id === 1);
    const old = new Map((previous?.nodes || []).map((n) => [n.id, n]));
    const nodes = [];
    const replacements = {
      "contract-title": [
        "title",
        old.get("cash-title")?.html || "عقد بيع وشراء سيارة",
      ],
      "deposit-label": ["paid-label", "الواصل:"],
      "payment-label": ["balance-label", "المتبقي:"],
      payment: ["balance", "{{remaining}}"],
      paymentWords: ["balance-words", "{{remainingWords}}"],
      "last-date": ["status", "{{cashStatus}}"],
      notes: ["notes", old.get("cash-notes")?.html || "الملاحظات: {{notes}}"],
    };
    const retired = new Set([
      "agreement",
      "installmentIntro",
      "installment-phase-one",
      "installment-phase-two",
      "depositDate",
      "last-label",
      "last",
      "lastWords",
    ]);
    const lastWords = original.nodes.find((n) => n.id === "lastWords");
    const clauseModels = original.nodes.filter(
      (n) =>
        n.type === "text" && (n.clauseNumber || /^البند \d+$/.test(n.name)),
    );
    const clauseSet = new Set(clauseModels);
    for (const source of original.nodes) {
      if (
        retired.has(source.id) ||
        clauseSet.has(source) ||
        source.condition === "phase"
      )
        continue;
      if (
        source.type === "shape" &&
        lastWords &&
        source.x === lastWords.x &&
        source.y === lastWords.y
      )
        continue;
      const n = clone(source);
      n.id = "cash-" + source.id;
      if (n.condition === "standard") n.condition = "";
      const extra = /^extra-(label|money|words|date)-(\d+)$/.exec(source.id);
      if (extra) {
        const [, field, i] = extra;
        const values = {
          label: "دفعة " + (Number(i) + 1) + ":",
          money: "{{cashValue" + i + "}}",
          words: "{{cashWords" + i + "}}",
          date: "{{cashDate" + i + "}}",
        };
        n.html = values[field];
        n.name =
          "دفعة السداد " +
          (Number(i) + 1) +
          " · " +
          {
            label: "العنوان",
            money: "المبلغ",
            words: "كتابة",
            date: "التاريخ",
          }[field];
        delete n.tokenRich;
      }
      if (n.condition?.startsWith("extra-"))
        n.condition = "cash-due-" + n.condition.slice(6);
      if (replacements[source.id]) {
        const [key, html] = replacements[source.id];
        n.id = "cash-" + key;
        n.html = html;
        n.name = html;
        delete n.tokenRich;
      }
      nodes.push(n);
    }
    this.addClauses(nodes, clauseModels, old);
    // Editor-created objects in an earlier cash design belong to this page.
    for (const n of old.values())
      if (!n.id.startsWith("cash-")) nodes.push(clone(n));
    return (scene.cashTemplate = {
      id: 1,
      name: "عقد الكاش",
      fixedLayout: 2,
      paperLayout: original.paperLayout,
      nodes,
    });
  },
  addClauses(nodes, models, old) {
    const base = models[0] || {
      x: 8,
      y: 45,
      w: 90.5,
      type: "text",
      fontSize: 15,
      lineHeight: 14 / 15,
      fontFamily: "Amiri",
      align: "justify",
      z: 10,
    };
    const oldText = old.get("cash-clauses");
    const parts = this.clauses.map(
      ([title, body]) =>
        '<span style="color:#873638;font-weight:700">' +
        esc(title) +
        ":</span> " +
        esc(body),
    );
    if (oldText?.html) {
      const div = document.createElement("div");
      div.innerHTML = safeMarkup(oldText.html);
      const lines = [...div.children];
      if (lines.length && lines.every((el) => el.tagName === "DIV")) {
        parts.length = 0;
        for (const line of lines) {
          const first = document
            .createTreeWalker(line, NodeFilter.SHOW_TEXT)
            .nextNode();
          if (first)
            first.textContent = first.textContent.replace(
              /^\s*[\d٠-٩۰-۹]+[.)ـ-]\s*/,
              "",
            );
          parts.push(line.innerHTML);
        }
      } else if (div.textContent.trim())
        parts.splice(0, parts.length, div.innerHTML);
    }
    parts.push(this.odometer);
    parts.push(
      '<b style="color:#873638">تحرير العقد:</b> ' +
        (old.get("cash-execution")?.html ||
          "حُرّر هذا العقد بحضور الطرفين في محافظة بغداد يوم {{day}} الموافق {{date}}، في تمام الساعة {{contractTime}}."),
    );
    // Only the cash legal text has a different length. Measure it once using
    // representative date fields so that filling a contract never moves it.
    const ruler = document.createElement("div");
    ruler.className = "paper scene-page";
    ruler.style.cssText =
      "position:fixed;left:-300vw;top:0;visibility:hidden;display:block;zoom:1";
    document.body.append(ruler);
    let y = base.y;
    try {
      parts.forEach((html, i) => {
        const n = {
          ...clone(base),
          id: "cash-clause-" + (i + 1),
          name: "البند " + (i + 1),
          clauseNumber: i + 1,
          clauseDash: true,
          html,
          y,
        };
        const el = App.renderNode(n);
        const content = el.firstElementChild;
        content.innerHTML = safeMarkup(html)
          .replace(/\{\{day\}\}/g, "الثلاثاء")
          .replace(/\{\{date\}\}/g, "28/12/2026")
          .replace(/\{\{contractTime\}\}/g, "14:55");
        content.style.height = "auto";
        ruler.append(el);
        n.h = roundMM(content.getBoundingClientRect().height / MM);
        nodes.push(n);
        y = roundMM(y + n.h + 0.53);
      });
    } finally {
      ruler.remove();
    }
  },
  odometer:
    '<b style="color:#873638">عداد المسافات:</b> يقر البائع بأن قراءة عداد المسافات المذكورة صحيحة وأنها تعكس الكيلومترات المقطوعة فعلياً، ويؤكد عدم التلاعب بها خلال فترة حيازته للمركبة.',
  clauses: [
    [
      "البيع والمعاينة",
      "باع الطرف الأول (البائع) للطرف الثاني (المشتري) المركبة المبيّنة تفاصيلها في هذا العقد، بعد معاينتها وقبول المشتري بحالتها الراهنة عند التوقيع.",
    ],
    [
      "الفحص والاستلام",
      "استلم المشتري المركبة بعد فحصها بالكامل، ويُعدّ استلامه لها إقراراً منه بخلوّها من العيوب.",
    ],
    [
      "تحويل الملكية",
      "يلتزم البائع بنقل ملكية المركبة إلى المشتري عند طلبه، بعد دفع كامل ثمن البيع المتفق عليه.",
    ],
    [
      "التسجيل والرسوم",
      "يلتزم المشتري بإتمام معاملة التسجيل ودفع جميع مصاريف التسجيل والرسوم المرورية خلال المدة القانونية المحددة في العقد المروري.",
    ],
    [
      "التزامات البائع",
      "يتحمّل البائع الغرامات المرورية والرسوم الجمركية والضرائب والديون المستحقة على المركبة حتى تاريخ توقيع العقد، ويضمن سلامة ملكيته القانونية لها.",
    ],
    [
      "المستندات المطلوبة",
      "يلتزم المشتري بتقديم المستمسكات الرسمية اللازمة لنقل الملكية إلى البائع ودوائر المرور المختصة ويتحمّل مسؤولية صحتها. ويتعهّد الطرفان بإتمام عقد التسجيل الرسمي خلال شهرين. وفي حال تأخّر المشتري، يحقّ للبائع وضع إشارة حجز على المركبة دون إنذار مسبق.",
    ],
    [
      "المسؤوليات القانونية",
      "يتحمّل المشتري التبعات القانونية والغرامات المتعلقة بالمركبة اعتباراً من تاريخ استلامها.",
    ],
    [
      "جزاءات الإخلال",
      "إذا أخلّ أحد الطرفين بالتزاماته، يدفع الطرف المخالف تعويضاً يعادل ٢٠٪ من قيمة المركبة، ويتحمّل أتعاب الوساطة (الدلالية).",
    ],
    [
      "استرجاع المركبة",
      "لا يحقّ للمشتري استرجاع المركبة إلا لعيب مصنعي. وإذا رغب في استرجاعها لأي سبب آخر، يلتزم بدفع ٢٠٪ من قيمتها.",
    ],
    [
      "المستندات المستلمة",
      "يقرّ المشتري باستلام مستندات المركبة، ومنها رخصة التسجيل (السنوية)، والملصق، واللوحات المرورية، وبصمات التشغيل. وبعد التوقيع لا يحقّ له المطالبة بأي مستندات أخرى.",
    ],
    [
      "التبليغات القضائية",
      "يُعدّ عنوان كل طرف المثبت في العقد عنواناً قانونياً للتبليغات القضائية، وتختص محاكم بغداد/الكرادة بالنظر في أي نزاع ينشأ عن هذا العقد.",
    ],
  ],
};
