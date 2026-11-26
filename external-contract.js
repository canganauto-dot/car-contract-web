const External = {
  active() {
    return d.contractType === "external";
  },
  company() {
    return (
      cfg.companies.find(
        (c) => c.id === (d.externalBuyerCompany || d.externalSellerCompany),
      ) || co()
    );
  },
  build() {
    const groups = {
      externalSeller: $("externalSellerFields"),
      externalBuyer: $("externalBuyerFields"),
      externalOther: $("externalOtherFields"),
    };
    for (const fields of Object.values(groups)) fields.replaceChildren();
    for (const [key, label, type] of [
      ["externalSeller", "اسم البائع", "text"],
      ["externalSellerPhone", "الهاتف", "tel"],
      ["externalSellerId", "رقم الهوية", "text"],
      ["externalSellerAddress", "العنوان", "text"],
      ["externalBuyer", "اسم المشتري", "text"],
      ["externalBuyerPhone", "الهاتف", "tel"],
      ["externalBuyerId", "رقم الهوية", "text"],
      ["externalBuyerAddress", "العنوان", "text"],
      ["externalKeys", "بصمة / مفتاح", "text"],
      ["externalPurchaseDate", "تاريخ الشراء", "date"],
      ["externalWaiverDate", "تاريخ التنازل", "date"],
    ]) {
      const row = document.createElement("label"),
        span = document.createElement("span"),
        input = document.createElement("input");
      span.textContent = label;
      input.id = key;
      input.type = type;
      input.value = d[key] || "";
      input.onchange = () => {
        d[key] = input.value;
        render();
      };
      row.append(span, input);
      const group=groups[key.startsWith("externalSeller")?"externalSeller":key.startsWith("externalBuyer")?"externalBuyer":"externalOther"];
      if (["externalSeller", "externalBuyer"].includes(key)) row.classList.add("party-name");
      if (key.endsWith("Address")) row.classList.add("party-address");
      group.append(row);
      if (["externalSeller", "externalBuyer"].includes(key)) {
        const select = document.createElement("select");
        select.id = key + "Company";
        select.setAttribute("aria-label", "اختيار المدير المفوض · " + label);
        select.add(new Option("اختيار مدير مفوض…", ""));
        cfg.companies.forEach((c) =>
          select.add(new Option(c.manager + " · " + c.name, c.id)),
        );
        select.value = d[key + "Company"] || "";
        select.onchange = () => {
          d[key + "Company"] = select.value;
          const c = cfg.companies.find((c) => c.id === select.value);
          if (c) {
            d.companyId = c.id;
            $("companySelect").value = c.id;
            d[key] = c.manager;
            d[key + "Address"] = c.address || "";
            d[key + "Phone"] = c.phone || "";
          }
          this.build();
          render();
        };
        const managerField=document.createElement("label"),caption=document.createElement("span");
        managerField.className = "party-company";
        caption.textContent = "المدير المفوض";
        managerField.append(caption, select);
        group.append(managerField);
      }
    }
    const transferLabel = document.createElement("label"), transferToggle = document.createElement("input");
    transferLabel.className = "check";
    transferToggle.type = "checkbox"; transferToggle.id = "externalTransferLetter";
    transferToggle.checked = !!d.externalTransferLetter;
    transferToggle.onchange = () => {
      d.externalTransferLetter = transferToggle.checked;
      d.skipTransferLetter = !transferToggle.checked;
      render(); saveDraft();
    };
    transferLabel.append(transferToggle, document.createTextNode("طباعة نقل ملكية"));
    groups.externalOther.append(transferLabel);
    for (const key of ["externalSeller", "externalBuyer"]) {
      const hasManager = !!d[key + "Company"];
      $(key + "Id").closest("label").hidden = hasManager;
      groups[key].classList.toggle("has-manager", hasManager);
      groups[key].append($(key + "Company").closest("label"));
    }
  },
  decorate() {
    const active = this.active();
    for (const card of document.querySelectorAll("#cards > .external-party")) card.hidden = !active;
    $("buyerCard").hidden = active;
    for(const id of ["brand","warrantyYears","noWarranty"])
      $(id)?.closest("label").toggleAttribute("hidden",active || (id==="warrantyYears" && d.noWarranty));
    if (active) {
      $("guarantorCard").hidden = true;
      if ($("externalTransferLetter")) $("externalTransferLetter").checked = !!d.externalTransferLetter;
    }
  },
  context(ctx) {
    const selected = this.company();
    ctx.company = selected.fullName || "شركة " + selected.name;
    ctx.manager = selected.manager;
    for (const key of ["externalSeller", "externalBuyer"]) {
      const company = cfg.companies.find((c) => c.id === d[key + "Company"]);
      ctx[key] = company
        ? company.manager +
          " - المدير المفوض لـ" +
          (company.fullName || "شركة " + company.name) +
          " إضافةً لوظيفته"
        : d[key] || "";
      ctx[key + "Identity"] = company
        ? ""
        : "رقم الهوية: " + (d[key + "Id"] || "");
      ctx[key + "Name"] = company ? company.manager : d[key] || "";
    }
    ctx.externalWaiverPerson = d.externalSellerCompany
      ? d.externalBuyer
      : d.externalSeller;
    ctx.externalPurchaseDate = dateLabel(d.externalPurchaseDate || "");
    ctx.externalWaiverDate = dateLabel(d.externalWaiverDate || d.contractDate);
  },
  pages(scene) {
    if (scene.externalPages) return this.upgrade(scene.externalPages);
    const make = (id, name) => ({ id, name, paperLayout: 3, nodes: [] });
    const face = make(1, "العقد الخارجي"),
      waiver = make(3, "تعهد وتنازل · خارجي");
    const text = (p, key, html, x, y, w, h, opts = {}) =>
      p.nodes.push({
        id: "external-" + key,
        type: "text",
        name: key,
        html,
        x,
        y,
        w,
        h,
        z: 5,
        fontFamily: CONTRACT_FONT,
        fontSize: 20,
        lineHeight: 1.12,
        color: "#203c48",
        align: "right",
        ...opts,
      });
    const band = (p, key, y, h) =>
      p.nodes.push({
        id: "external-bg-" + key,
        name: key,
        type: "shape",
        shape: "round",
        x: 14,
        y,
        w: 182,
        h,
        z: -10,
        fill: "#f0f1f2",
        radius: 1.5,
        strokeWidth: 0,
      });
    text(face, "title", "عقد بيع وشراء", 14, 12, 182, 12, {
      align: "center",
      fontSize: 30,
      weight: "700",
    });
    text(
      face,
      "meta",
      "العدد: ⁦{{number}}⁩    التاريخ: ⁦{{date}}⁩    الساعة: ⁦{{contractTime}}⁩",
      14,
      26,
      182,
      7,
      { fontSize: 17 },
    );
    for (const [key, title, y] of [
      ["externalSeller", "الطرف الأول | البائع", 38],
      ["externalBuyer", "الطرف الثاني | المشتري", 63],
    ]) {
      band(face, key, y, 22);
      text(face, key, title + ": {{" + key + "}}", 17, y + 1, 176, 9, {
        weight: "700",
      });
      text(
        face,
        key + "-details",
        "العنوان: {{" + key + "Address}}    رقم الهاتف: {{" + key + "Phone}}",
        17,
        y + 11,
        176,
        8,
        {},
      );
    }
    text(
      face,
      "intro",
      "أولاً: بموجب هذا العقد باع الطرف الأول إلى الطرف الثاني المركبة وهي خالية من العيوب، وذلك بعد معاينتها، حسب ما يأتي:",
      14,
      88,
      182,
      14,
    );
    face.nodes.push(
      TransferLetter.grid(
        "external-vehicle",
        "تفاصيل المركبة",
        [
          ["نوع السيارة", "{{car}}"],
          ["رقم الشاصي", "{{vin}}"],
          ["رقم اللوحة / الموديل", "{{plate}} / {{model}}"],
          ["اللون / العداد", "{{color}} / {{mileage}}"],
          ["بصمة / مفتاح", "{{externalKeys}}"],
        ],
        14,
        104,
        182,
        34,
      ),
    );
    band(face, "payment", 141, 24);
    [
      ["مبلغ البيع", "total", "totalWords"],
      ["المبلغ الواصل", "deposit", "depositWords"],
      ["المبلغ المتبقي", "remaining", "remainingWords"],
    ].forEach(([title, key, words], i) =>
      text(
        face,
        "amount-" + i,
        title + ": {{" + key + "}} د.ع.    كتابةً: {{" + words + "}}",
        17,
        142 + i * 7.5,
        176,
        7.5,
        { fontSize: 18 },
      ),
    );
    text(face, "notes", "الملاحظات: {{notes}}", 14, 168, 182, 12, {
      fontSize: 18,
    });
    text(face, "terms-heading", "بنود العقد", 14, 181, 182, 7, {
      align: "center",
      weight: "700",
    });
    const terms = [
      "ثانياً: يتعهد الطرف الأول بتحويل ملكية المركبة المشار إليها في هذا العقد عند طلب الطرف الثاني، بعد تسديد كامل بدل المبيع.",
      "ثالثاً: يتعهد الطرف الثاني بترويج معاملة تسجيل المركبة خلال المدة القانونية المحددة في العقد المروري.",
      "رابعاً: البائع مسؤول عن دفع الغرامات المرورية والكمركية والضرائب وكل ما يترتب من ديون أو رسوم في دوائر الدولة حتى تاريخ ما قبل البيع (تاريخ العقد).",
      "خامساً: على الطرف الثاني تقديم مستمسكاته الرسمية لغرض نقل الملكية. ويتعهد الطرفان بتنظيم عقد أصولي خاص بدوائر المرور خلال شهرين والتأكد من عنوان كل منهما. وفي حال امتناع الطرف الثاني عن التسجيل ونقل الملكية خلال شهرين، يحق للطرف الأول وضع إشارة حجز على المركبة دون الحاجة إلى توجيه إنذار.",
      "سادساً: يتحمل الطرف الثاني كافة التبعات القانونية والغرامات التأخيرية، إن وجدت، من تاريخ استلام المركبة.",
      "سابعاً: إذا نكل أحد الطرفين يدفع الطرف الناكل ضمانات قدرها ٢٠٪ من سعر المركبة ويتحمل الدلالية المدفوعة.",
      "ثامناً: يعتبر العنوان المثبت لكل طرف محلاً معتبراً قانوناً للتبليغات القضائية، وتختص محاكم بغداد/الكرادة بأي نزاع ينشأ جراء توقيع العقد. نُظم هذا العقد في بغداد بتاريخ {{date}}.",
    ];
    text(face, "terms", terms.join("<br>"), 14, 190, 182, 73, {
      fontSize: 17,
      lineHeight: 1.1,
    });
    text(
      face,
      "sign-seller",
      "الطرف الأول · البائع<br>{{externalSeller}}",
      135,
      271,
      61,
      16,
      { align: "center" },
    );
    text(
      face,
      "sign-buyer",
      "الطرف الثاني · المشتري<br>{{externalBuyer}}",
      14,
      271,
      61,
      16,
      { align: "center" },
    );
    text(face, "sign-organizer", "المنظّم<br>{{organizer}}", 78, 271, 54, 16, {
      align: "center",
    });
    const form =
      scene.pages
        .find((p) => p.id === 3)
        ?.nodes.filter((n) => n.type === "image" && n.binding === "company") ||
      [];
    waiver.nodes.push(
      ...form.map((n) => ({
        ...clone(n),
        id: "external-waiver-form",
        headerCut: undefined,
      })),
    );
    text(
      waiver,
      "waiver-date",
      "التاريخ: {{externalWaiverDate}}",
      14,
      33,
      182,
      8,
    );
    text(waiver, "waiver-title", "م / تعهد وتنازل", 14, 48, 182, 12, {
      align: "center",
      fontSize: 28,
      weight: "700",
    });
    text(
      waiver,
      "waiver-body",
      "إني الموقع أدناه ({{externalSeller}}) أتعهد وأتنازل عن ملكية السيارة المذكورة تفاصيلها أدناه إلى {{company}}، وأتحمل كافة التبعات القانونية والعشائرية والغرامات المالية من تاريخ شرائي للسيارة بتاريخ {{externalPurchaseDate}} حتى تاريخ عدولي عنها بتاريخ {{externalWaiverDate}}، لأجله وقعت.",
      18,
      69,
      174,
      42,
      { fontSize: 23 },
    );
    waiver.nodes.push(
      TransferLetter.grid(
        "external-waiver-vehicle",
        "جدول المركبة",
        TransferLetter.vehicleFields.map(([label, key]) => [
          label,
          "{{" + key + "}}",
        ]),
        22,
        120,
        166,
        55,
      ),
    );
    text(
      waiver,
      "waiver-sign",
      "توقيع وبصمة المتنازل:<br>الاسم / {{externalSeller}}",
      110,
      198,
      84,
      30,
      { fontSize: 23 },
    );
    text(
      waiver,
      "waiver-manager",
      "المدير المفوض<br>{{manager}}",
      18,
      246,
      84,
      25,
      { align: "center", fontSize: 23 },
    );
    return (scene.externalPages = this.upgrade([face, waiver]));
  },
  upgrade(pages) {
    for (const p of pages) {
      if (p.externalLayout === 2) continue;
      for (const n of p.nodes) {
        if (n.id.startsWith("external-bg-")) {
          n.fill = "transparent";
          n.stroke = "#647782";
          n.strokeWidth = 0.8;
        }
        if (
          ["external-externalSeller", "external-externalBuyer"].includes(n.id)
        ) {
          n.fontSize = 19;
          n.h = 12;
        }
      }
      const add = (id, html, x, y, w, h, opts = {}) =>
        p.nodes.push({
          id,
          type: "text",
          name: id,
          html,
          x,
          y,
          w,
          h,
          fontFamily: CONTRACT_FONT,
          fontSize: 19,
          lineHeight: 1,
          align: "right",
          color: "#203c48",
          z: 5,
          ...opts,
        });
      if (p.id === 1) {
        p.nodes.push({
          id: "external-outline",
          type: "shape",
          name: "إطار العقد",
          x: 8,
          y: 7,
          w: 194,
          h: 283,
          z: -30,
          fill: "transparent",
          stroke: "#516671",
          strokeWidth: 1,
          radius: 2,
          shape: "round",
        });
        for (const [key, y] of [
          ["externalSeller", 38],
          ["externalBuyer", 63],
        ]) {
          const details = p.nodes.find(
            (n) => n.id === "external-" + key + "-details",
          );
          if (details) {
            details.y = y + 14;
            details.h = 7;
            details.fontSize = 17;
            details.html += "    {{" + key + "Identity}}";
          }
        }
        p.nodes = p.nodes.filter((n) => n.id !== "external-vehicle");
        p.nodes.push(
          TransferLetter.grid(
            "external-vehicle",
            "بيانات المركبة",
            [
              ["نوع السيارة", "{{car}}"],
              ["الموديل", "{{model}}"],
              ["رقم اللوحة", "{{plate}}"],
              ["الشاصي", "{{vin}}"],
              ["اللون", "{{color}}"],
            ],
            14,
            104,
            182,
            34,
          ),
        );
        TransferLetter.cards(p);
        for (const n of p.nodes) {
          if (n.vehicleCell) {
            n.fontSize = 17;
          }
          if (n.id === "external-sign-seller" || n.id === "external-sign-buyer")
            n.html = n.html
              .replace("{{externalSeller}}", "{{externalSellerName}}")
              .replace("{{externalBuyer}}", "{{externalBuyerName}}");
        }
        p.nodes = p.nodes.filter((n) => !/^external-vehicle-row-1-/.test(n.id));
        [
          ["الموديل", "model"],
          ["العداد", "mileage"],
          ["بصمة / مفتاح", "externalKeys"],
        ].forEach(([label, key], i) => {
          const x = 14 + (2 - i) * 61.33;
          add(
            "external-compact-" + key + "-title",
            label,
            x + 34.033,
            110.8,
            25.3,
            5.8,
            {
              align: "center",
              fontSize: 17,
              fill: "#294b58",
              color: "#fff",
              radius: 1.5,
            },
          );
          add(
            "external-compact-" + key,
            "{{" + key + "}}",
            x,
            110.8,
            32.033,
            5.8,
            {
              align: "center",
              fontSize: 18,
              fill: "#f1f4f5",
              stroke: "#ccd5d8",
              strokeWidth: 0.8,
              radius: 1.5,
            },
          );
        });
      } else {
        p.nodes = p.nodes.filter(
          (n) =>
            !n.id.startsWith("external-waiver-vehicle") &&
            n.id !== "external-waiver-form",
        );
        p.nodes.unshift({
          id: "external-waiver-form",
          type: "image",
          name: "ترويسة شركة المدير المفوض",
          binding: "company",
          x: 0,
          y: 0,
          w: 210,
          h: 297,
          z: -100,
          fit: "fill",
        });
        p.nodes.push(
          TransferLetter.grid(
            "external-waiver-vehicle",
            "بيانات المركبة",
            [...TransferLetter.vehicleFields, ["العداد", "mileage"]].map(
              ([label, key]) => [label, "{{" + key + "}}"],
            ),
            22,
            120,
            166,
            60,
          ),
        );
        TransferLetter.cards(p);
        for (const n of p.nodes)
          if (n.html)
            n.html = n.html.replaceAll(
              "{{externalSeller}}",
              "{{externalWaiverPerson}}",
            );
      }
      p.externalLayout = 2;
    }
    const face = pages.find(p => p.id === 1);
    if (face && !face.fixedFieldLayout) this.splitFaceFields(face);
    return pages;
  },
  splitFaceFields(face) {
    const rows = {};
    for (const [key,title] of [["externalSeller","الطرف الأول | البائع"],["externalBuyer","الطرف الثاني | المشتري"]]) {
      rows[key] = [[title,22],[key,78]];
      rows[key+"-details"] = [["العنوان",8],[key+"Address",34],["الهاتف",8],[key+"Phone",20],[key+"Identity",30]];
    }
    [["مبلغ البيع","total"],["الواصل","deposit"],["المتبقي","remaining"]].forEach(([title,key],i)=>{
      rows["amount-"+i]=[[title,13],[key,18],["د.ع.",6],["كتابةً",8],[key+"Words",55]];
    });
    rows.notes=[["الملاحظات",14],["notes",86]];
    rows.meta=[["العدد",12],["number",16],["التاريخ",12],["date",25],["الساعة",12],["contractTime",23]];
    const signatures={"sign-seller":["الطرف الأول · البائع","externalSellerName"],"sign-buyer":["الطرف الثاني · المشتري","externalBuyerName"],"sign-organizer":["المنظّم","organizer"]};
    face.nodes=face.nodes.flatMap(n=>{
      const id=n.id.replace(/^external-/,"");
      if(signatures[id]) return signatures[id].map((v,i)=>({...n,id:n.id+"-"+i,name:v,html:i?"{{"+v+"}}":v,y:n.y+i*n.h/2,h:n.h/2}));
      if(!rows[id]) return [n];
      const w=id==="meta"?Math.max(n.w,102):n.w;
      let right=n.x+n.w;
      return rows[id].map(([v,percent],i)=>{
        const width=w*percent/100;
        right-=width;
        return {...n,id:n.id+"-field-"+i,name:v,html:/^[a-zA-Z]/.test(v)?"{{"+v+"}}":v,x:right,w:width-.5,align:"center"};
      });
    });
    face.fixedFieldLayout=1;
  },
};
