const Exchange = {
  template(scene, archived = false) {
    if (scene.exchangeTemplate) {
      const page = this.paymentLayout(scene.exchangeTemplate);
      return archived ? page : this.separateFieldLabels(this.vehicleLayout(page));
    }
    const nodes = [],
      ink = "#203c48";
    const text = (key, name, html, x, y, w, h, options = {}) =>
      nodes.push({
        id: "exchange-" + key,
        type: "text",
        name,
        html,
        x,
        y,
        w,
        h,
        z: 10,
        fontFamily: "Amiri",
        fontSize: 17,
        lineHeight: 1.05,
        color: ink,
        align: "right",
        ...options,
      });
    const block = (key, name, x, y, w, h) =>
      nodes.push({
        id: "exchange-bg-" + key,
        type: "shape",
        name,
        x,
        y,
        w,
        h,
        z: -45,
        shape: "round",
        radius: 1.4,
        fill: "#f0f1f2",
        strokeWidth: 0,
      });
    const heading = { weight: "700", align: "center", fontSize: 20 };
    const header = scene.pages
      .find((p) => p.id === 1)
      ?.nodes.find((n) => n.binding === "company");
    if (header)
      nodes.push({
        ...clone(header),
        id: "exchange-form",
        firstFormHeader: true,
      });
    const approvedHeader =
      scene.pages.find((p) => p.id === 1)?.nodes.filter((n) => n.paperHeader) ||
      [];
    nodes.push(
      ...(approvedHeader.length
        ? approvedHeader.map((n) => ({ ...clone(n), id: "exchange-" + n.id }))
        : PaperLayout.header("exchange")),
    );
    text(
      "meta",
      "العدد والتاريخ",
      "العدد: ⁦{{number}}⁩   التاريخ: ⁦{{date}}⁩   الساعة: ⁦{{contractTime}}⁩",
      12,
      30,
      112,
      5,
      { fontSize: 15 },
    );
    text(
      "organizer",
      "المنظّم والفرع",
      "المنظّم: {{organizer}}   ·   الفرع: {{branch}}",
      128,
      30,
      70,
      5,
      { fontSize: 15 },
    );
    text("title", "عنوان العقد", "عقد استبدال مركبة", 12, 36, 186, 9, {
      ...heading,
      fontSize: 26,
    });
    block("seller", "خلفية الطرف الأول", 12, 46, 186, 11);
    text(
      "seller",
      "الطرف الأول",
      "الطرف الأول: {{manager}}، المدير المفوض لـ{{company}} إضافةً لوظيفته.",
      15,
      48,
      180,
      7,
      { weight: "700" },
    );
    block("buyer", "خلفية الطرف الثاني", 12, 59, 186, 14);
    text(
      "buyer",
      "الطرف الثاني",
      "الطرف الثاني: {{buyer}}    ·    رقم الهوية: {{buyerId}}    ·    تاريخها: {{buyerIdDate}}",
      15,
      60,
      180,
      6,
      {},
    );
    text(
      "address",
      "عنوان المشتري وهاتفه",
      "جهة الإصدار: {{buyerIdFrom}}    ·    العنوان: {{buyerAddress}} {{district}} {{street}} {{house}}    ·    الهاتف: {{buyerPhone}}",
      15,
      66.5,
      180,
      6,
      {},
    );
    text(
      "intro",
      "مقدمة الاستبدال",
      "لرغبة الطرف الثاني في استبدال مركبته القديمة بالمركبة المملوكة للطرف الأول، وموافقة الطرف الأول على الاستبدال، اتفق الطرفان على ما يأتي:",
      12,
      76,
      186,
      11,
    );
    for (const [old, x] of [
      [true, 107],
      [false, 12],
    ]) {
      const k = old ? "old" : "new";
      const field = (key) =>
        "{{" + (old ? "old" + key[0].toUpperCase() + key.slice(1) : key) + "}}";
      block(k, "خلفية المركبة " + (old ? "القديمة" : "الجديدة"), x, 88, 91, 34);
      text(
        k + "-heading",
        "عنوان المركبة",
        old ? "مركبة الطرف الثاني (القديمة)" : "مركبة الطرف الأول (الجديدة)",
        x + 2,
        89,
        87,
        7,
        heading,
      );
      const lines = [
        "نوع السيارة: " + field("car") + "   ·   الموديل: " + field("model"),
        "اللوحة: " + field("plate") + "   ·   اللون: " + field("color"),
        "العداد: " + field("mileage"),
        "الشاصي: " + field("vin"),
      ];
      lines.forEach((line, i) =>
        text(
          k + "-" + i,
          "بيانات المركبة",
          line,
          x + 3,
          97 + i * 5.8,
          85,
          5.8,
          {},
        ),
      );
    }
    text(
      "clauses-title",
      "عنوان بنود العقد",
      "بنود العقد",
      12,
      124,
      186,
      7,
      heading,
    );
    const clauses = [
      "تبقى ملكية المركبة للطرف الأول حتى تسديد كامل المبلغ.",
      "استلم الطرف الثاني المركبة بعد فحصها وأقرّ بخلوها من العيوب.",
      "في حال تأخر الطرف الثاني عن دفع أي قسط، يُفسخ العقد تلقائياً وتُعاد المركبة للطرف الأول، وتُستحق جميع الأقساط المتبقية فوراً.",
      "إذا أُلغي العقد بسبب التأخر في الدفع، لا يحق للطرف الثاني استرجاع ما دفعه، ويلتزم بتعويض الطرف الأول عن مدة الاستخدام.",
      "للطرف الأول استرجاع المركبة والتصرف بها دون الرجوع للطرف الثاني عند الإخلال بالدفع.",
      "يسلّم الطرف الثاني شيكات بقيمة المتبقي عند التوقيع، وتُعاد إليه بعد سدادها.",
      "يلتزم الطرف الثاني بتأمين شامل باسم الطرف الأول لدى شركة تأمين.",
      "إذا لم يستلم الطرف الثاني المركبة خلال أسبوع من التوقيع يُمهل أسبوعاً آخر، ثم يُفسخ العقد تلقائياً ويحق للطرف الأول بيعها.",
      "يتحمّل الطرف الثاني المسؤولية عن الأضرار ومخالفة شروط العقد، بما في ذلك الرسوم القانونية وأتعاب المحاماة.",
      "تُطبّق قوانين جمهورية العراق وتختص محكمة بغداد/الكرادة بالنظر في أي نزاع.",
      "تسري شروط العقد السابق للمركبة القديمة عند وجود مبالغ أو أقساط مستمرة بعد الاستبدال.",
    ];
    const clause = (i, y, body) =>
      text("clause-" + i, "البند " + i, body, 15, y, 180, 6, {
        clauseNumber: i,
      });
    clause(1, 132, clauses[0]);
    clause(2, 138, clauses[1]);
    block("payment", "خلفية تفاصيل الدفع", 12, 145, 186, 33);
    text(
      "payment-title",
      "تفاصيل الدفع",
      "٣. تفاصيل الدفع:   المبلغ الكلي: {{total}}   ·   المقدمة: {{deposit}}   ·   المتبقي: {{remaining}} د.ع.",
      15,
      146,
      180,
      6,
      { weight: "700" },
    );
    text("payments", "الدفعات", "{{exchangeExtras}}", 15, 152, 180, 6, {
    });
    text("plan", "مواعيد الأقساط", "{{exchangePlan}}", 15, 158, 180, 6, {
    });
    text("last", "القسط الأخير", "{{exchangeLast}}", 15, 164, 180, 6, {
    });
    clauses.slice(2).forEach((s, i) => clause(i + 4, 181 + i * 5.65, s));
    text(
      "execution",
      "تحرير العقد",
      "حُرّر العقد يوم {{day}} الموافق {{date}} في تمام الساعة {{contractTime}}.",
      14,
      233,
      182,
      6,
      {},
    );
    text("warranty", "الضمان والصيانة", "{{warrantyText}}", 12, 241, 186, 18, {
      fontSize: 16,
      lineHeight: 1.06,
    });
    block("notes", "خلفية الملاحظات", 12, 260, 186, 12);
    text("notes", "الملاحظات", "الملاحظات: {{notes}}", 15, 261, 180, 11, {
      fontSize: 15,
    });
    text(
      "seller-sign",
      "توقيع الطرف الأول",
      "الطرف الأول (البائع)<br>{{manager}}",
      12,
      276,
      79,
      13,
      { align: "center" },
    );
    text(
      "buyer-sign",
      "توقيع الطرف الثاني",
      "الطرف الثاني<br>{{buyer}}",
      119,
      276,
      79,
      13,
      { align: "center" },
    );
    return (scene.exchangeTemplate = this.separateFieldLabels(this.vehicleLayout(this.paymentLayout({
      id: 1,
      name: "عقد الاستبدال",
      nodes,
      paperLayout: 3,
    }))));
  },
  fitFontLayout(page) {
    for (const node of page.nodes) {
      if (["exchange-meta", "exchange-address-buyerIdFrom"].includes(node.id))
        node.fitSingleLine = true;
      if (/^exchange-(old|new)-heading$/.test(node.id) && node.w === 28 && node.fontSize === 16)
        node.fontSize = 15;
    }
  },
  flowClauses(paper) {
    // The stock lower block shares one column but some clauses now take two lines.
    const clauses = [...paper.querySelectorAll('[data-node^="exchange-clause-"]')]
      .filter(el => /^exchange-clause-(?:[4-9]|1[0-2])$/.test(el.dataset.node))
      .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
    const first = clauses[0];
    if (!first || parseFloat(first.style.top) !== 186.46 ||
        clauses.some(el => el.style.left !== first.style.left || el.style.width !== first.style.width)) return;
    const block = document.createElement("div");
    block.className = "exchange-clause-flow";
    Object.assign(block.style, { left: first.style.left, top: first.style.top, width: first.style.width });
    first.before(block);
    block.append(...clauses);
  },
  vehicleLayout(page) {
    if (page.stackedVehicleRows) return page;
    const nodes = new Map(page.nodes.map(node => [node.id, node]));
    const oldBox = nodes.get("exchange-bg-old"), newBox = nodes.get("exchange-bg-new");
    const intro = nodes.get("exchange-intro"), clauses = nodes.get("exchange-clauses-title");
    if (!oldBox || !newBox || !intro || !clauses) return page;

    const x = Math.min(oldBox.x, newBox.x);
    const right = Math.max(oldBox.x + oldBox.w, newBox.x + newBox.w);
    const y = Math.max(Math.min(oldBox.y, newBox.y), intro.y + intro.h);
    const gap = 2, width = right - x;
    const height = (clauses.y - 2 - y - gap) / 2;
    if (height < 14 || width < 140) return page;

    const titleWidth = 28, inset = 3;
    const dataX = x + inset, dataRight = right - inset - titleWidth - gap;
    const rowHeight = (height - 2) / 2;
    const groups = [
      {kind:"old", box:oldBox, title:"مركبة الطرف الثاني<br>(القديمة)"},
      {kind:"new", box:newBox, title:"مركبة الطرف الأول<br>(الجديدة)"},
    ].map(({kind, box, title}) => {
      const prefix = "exchange-" + kind + "-";
      const key = name => kind === "old" ? "old" + name[0].toUpperCase() + name.slice(1) : name;
      return {
        box, title, heading:nodes.get(prefix + "heading"),
        rows:[
          [nodes.get(prefix + "0-" + key("car")), nodes.get(prefix + "0-" + key("model")), nodes.get(prefix + "1-" + key("color"))],
          [nodes.get(prefix + "3"), nodes.get(prefix + "1-" + key("plate")), nodes.get(prefix + "2")],
        ],
      };
    });
    if (groups.some(group => !group.heading || group.rows.flat().some(node=>!node))) return page;

    const shares = [[0.48, 0.25, 0.27], [0.49, 0.28, 0.23]];
    groups.forEach(({box, heading, title, rows}, i) => {
      const top = y + i * (height + gap);
      Object.assign(box, {x, y:top, w:width, h:height});
      Object.assign(heading, {
        x:right-inset-titleWidth, y:top+1, w:titleWidth, h:height-2,
        html:title, verticalAlign:"middle",
      });
      rows.forEach((fields, row) => {
        let edge = dataRight;
        const available = dataRight - dataX - 2 * gap;
        fields.forEach((field, column) => {
          const w = available * shares[row][column];
          Object.assign(field, {x:edge-w, y:top+1+row*rowHeight, w, h:rowHeight, verticalAlign:"middle"});
          edge -= w + gap;
        });
      });
    });
    page.stackedVehicleRows = true;
    return page;
  },
  separateFieldLabels(page) {
    if (page.separateExchangeLabels) return page;
    const fieldId = /^exchange-(?:seller$|buyer-|address-|(?:old|new)-[0-3](?:-|$))/;
    page.nodes = page.nodes.flatMap(field => {
      if (field.type !== "text" || !fieldId.test(field.id) || field.id.endsWith("-label")) return [field];
      const match = /^([^:<]+:)\s*(\{\{.+)$/s.exec(field.html || "");
      if (!match) return [field];
      const [, title, value] = match;
      const gap = 1;
      const labelWidth = Math.min(field.w * .44, Math.max(7, title.length * 1.15));
      const label = {
        ...field,
        id: field.id + "-label",
        name: "عنوان " + title.slice(0,-1),
        html: title,
        x: field.x + field.w - labelWidth,
        w: labelWidth,
        fontSize: 14,
        weight: "400",
        align: "right",
        verticalAlign: "middle",
        underlineEnabled: false,
        textDecoration: "none",
        fillEnabled: false,
        strokeEnabled: false,
      };
      const valueNode = {
        ...field,
        html: value,
        w: field.w - labelWidth - gap,
        fontSize: Math.min(field.fontSize || 17, field.id === "exchange-seller" ? 15 : 18),
        weight: "650",
        align: "center",
        verticalAlign: "middle",
      };
      return [label, valueNode];
    });
    page.separateExchangeLabels = true;
    return page;
  },
  paymentLayout(page) {
    if (!page.fixedExchangeFields) {
      const fields = {
        buyer: [
          ["الطرف الثاني", "buyer", 0.48],
          ["رقم الهوية", "buyerId", 0.29],
          ["تاريخ الإصدار", "buyerIdDate", 0.23],
        ],
        address: [
          ["محل الإصدار", "buyerIdFrom", 0.27],
          ["العنوان", "buyerAddress", 0.24],
          ["محلة", "district", 0.1],
          ["زقاق", "street", 0.1],
          ["دار", "house", 0.09],
          ["الهاتف", "buyerPhone", 0.2],
        ],
      };
      for (const kind of ["old", "new"]) {
        const key = (k) =>
          kind === "old" ? "old" + k[0].toUpperCase() + k.slice(1) : k;
        fields[kind + "-0"] = [
          ["نوع السيارة", key("car"), 0.64],
          ["الموديل", key("model"), 0.36],
        ];
        fields[kind + "-1"] = [
          ["اللوحة", key("plate"), 0.55],
          ["اللون", key("color"), 0.45],
        ];
      }
      page.nodes = page.nodes.flatMap((n) => {
        const parts = fields[n.id.replace(/^exchange-/, "")];
        if (!parts) return [n];
        let edge = n.x + n.w;
        return parts.map(([title, key, fraction]) => {
          const w = n.w * fraction;
          edge -= w;
          return {
            ...n,
            id: n.id + "-" + key,
            name: title,
            x: edge,
            w,
            html: title + ": {{" + key + "}}",
          };
        });
      });
      page.fixedExchangeFields = true;
    }
    if (!page.exchangePaymentVersion) {
      page.nodes = page.nodes.filter(
        (n) =>
          !["exchange-payments", "exchange-plan", "exchange-last"].includes(
            n.id,
          ),
      );
      const n = page.nodes.find((n) => n.id === "exchange-payment-title");
      if (n)
        Object.assign(n, {
          html: "{{exchangePaymentText}}",
          h: 32,
          fontSize: 17,
          lineHeight: 1.1,
          weight: "400",
        });
      page.exchangePaymentVersion = 1;
    }
    return page;
  },
  context(ctx, r) {
    ctx.note = d.notes || "";
    EditorEnhancements.exchangeContext(ctx, r);
    const extras = d.extras.filter((x) => amount(x.amount) > 0);
    ctx.exchangeExtras = extras
      .map(
        (x) =>
          (x.label || "دفعة") +
          ": " +
          money(amount(x.amount)) +
          " د.ع. " +
          dateLabel(x.date),
      )
      .join("   ·   ");
    ctx.exchangePlan =
      r.remaining > 0
        ? r.phase
          ? ctx.phaseFirstLine + "   ·   " + ctx.phaseSecondLine
          : "عدد الأقساط شاملاً الأخير: " +
            r.count +
            "   ·   القسط الدوري: " +
            money(r.payment) +
            " د.ع.   ·   بدءاً من " +
            ctx.firstDate +
            "   ·   كل " +
            r.interval +
            " شهر"
        : "";
    ctx.exchangeLast =
      r.count > 0
        ? "القسط الأخير: " +
          money(r.last) +
          " د.ع.   ·   تاريخ السداد: " +
          ctx.lastDate
        : "";
  },
};
