const TransferLetter = {
  paymentContract(data) {
    return !data.standaloneBook && ["cash", "exchange"].includes(data.contractType);
  },
  paidInFull(data) {
    if (!this.paymentContract(data)) return false;
    const total = amount(data.total);
    const received = data.contractType === "cash" ? cashTerms(data).cashReceived : data.deposit;
    return total > 0 && amount(received) === total;
  },
  applies(data) {
    if (data.standaloneBook) return Number(data.standaloneBook) === 0;
    if (this.paymentContract(data))
      return this.paidInFull(data) || !!data[data.contractType + "TransferLetter"];
    return data.contractType === "external" && !!data.externalTransferLetter;
  },
  automaticNote(data, balance) {
    if (!this.paymentContract(data) || !this.applies(data) || this.paidInFull(data) ||
        !data[data.contractType + "PayAtTransfer"] || !(balance.remaining > 0)) return "";
    return "متبقي مبلغ قدره " + money(balance.remaining) + " د.ع. يسدّد عند التحويل.";
  },
  note(data, balance, customText = data.cashTransferNote) {
    return [this.automaticNote(data, balance), String(customText || "").trim()].filter(Boolean).join("\n");
  },
  decorate(data, balance) {
    const paymentContract = this.paymentContract(data);
    const paid = this.paidInFull(data);
    const enabled = this.applies(data);
    $("cashTransferOption").hidden = !paymentContract;
    $("cashTransferLetter").checked = paymentContract && enabled;
    $("cashTransferLetter").disabled = paid;
    $("cashTransferLetter").title = paid ? "يطبع تلقائياً عند اكتمال السداد" : "";
    $("payAtTransferOption").hidden = !(paymentContract && enabled && !paid && balance.remaining > 0);
    $("payAtTransfer").checked = !!data[data.contractType + "PayAtTransfer"];
    const text = this.automaticNote(data, balance);
    $("transferAutomaticNote").textContent = text;
    $("transferAutomaticNote").hidden = !text;
    $("transferNoteField").hidden = !!data.standaloneBook || !enabled;
  },
  agents: [
    ["التاجيات", "رائد خضير", "77143949780"],
    ["الحسينية", "ثائر عبد الزهرة", "78410090110"],
    ["ملعب الشعب", "رائد حسين", "07736391679"],
    ["الرستمية", "اثير جعفر", "07714285090"],
    ["البصرة", "أنور القيسي", "07705697678"],
    ["المحافظات", "زيد سعد", "07714322031"],
    ["أربيل", "نياز عبدالله", "07503274000"],
    ["الموصل", "وسام", "07716948820"],
    ["السليمانية", "مدير الفرع: وميم", "07949637187"],
  ],
  vehicleFields: [
    ["نوع السيارة", "car"],
    ["الموديل", "model"],
    ["اللوحة", "plate"],
    ["الشاصي", "vin"],
    ["اللون", "color"],
  ],
  grid(id, name, rows, x, y, w, h) {
    // The first column is on the right in the RTL paper. Keep the split in
    // the editable table itself so exports and cell resizing use the same widths.
    const html =
      '<table><colgroup><col style="width:22%"><col style="width:78%"></colgroup><tbody>' +
      rows
        .map(
          ([label, value]) =>
            "<tr><th>" + label + "</th><td>" + value + "</td></tr>",
        )
        .join("") +
      "</tbody></table>";
    return {
      id,
      name,
      type: "table",
      letterGrid: true,
      x,
      y,
      w,
      h,
      z: 5,
      fontFamily: "Sakkal Majalla",
      fontSize: 21,
      lineHeight: 1.05,
      color: "#164577",
      align: "center",
      stroke: "#b5b5b5",
      strokeWidth: 1,
      radius: 0,
      fill: "transparent",
      html,
    };
  },
  vehicleGrid(id, x, y, w, h, values = new Map()) {
    const rows = this.vehicleFields.map(([label, key]) => [
      label,
      values.get(key) || "{{" + key + "}}",
    ]);
    return this.grid(id, "بيانات المركبة", rows, x, y, w, h);
  },
  cards(page) {
    page.nodes = page.nodes.flatMap((n) => {
      if (!n.letterGrid || !n.html?.includes("{{car}}")) return [n];
      const table = document.createElement("div");
      table.innerHTML = safeMarkup(n.html, true);
      const rows = [...table.querySelectorAll("tr")],
        step = n.h / rows.length;
      const labelWidth = n.w * 0.24,
        gap = 2,
        valueWidth = n.w - labelWidth - gap;
      return rows.flatMap((row, i) =>
        [...row.cells].map((cell, j) => ({
          id: n.id + "-row-" + i + "-" + j,
          type: "text",
          vehicleCell: true,
          name:
            (row.cells[0].textContent || "المركبة") +
            (j ? " · القيمة" : " · العنوان"),
          x: j ? n.x : n.x + n.w - labelWidth,
          y: n.y + i * step,
          w: j ? valueWidth : labelWidth,
          h: step - 1,
          z: n.z,
          html: cell.innerHTML,
          fontFamily: n.fontFamily,
          fontSize: n.fontSize,
          lineHeight: 1,
          align: "center",
          weight: j ? "500" : "700",
          color: j ? "#193c49" : "#ffffff",
          fill: j ? "#f1f4f5" : "#294b58",
          stroke: j ? "#ccd5d8" : "#294b58",
          strokeWidth: 0.8,
          radius: 1.5,
        })),
      );
    });
  },
  upgradeVehicleTables(scene) {
    if (scene.letterVehicleLayout === 2) return;
    for (const p of scene.pages) {
      if (p.id === 1) continue;
      for (const n of p.nodes) {
        if (
          n.type !== "table" ||
          !n.html?.includes("{{vin}}") ||
          !n.html.includes("{{car}}")
        )
          continue;
        const el = document.createElement("div");
        el.innerHTML = safeMarkup(n.html, true);
        const values = new Map();
        for (const td of el.querySelectorAll("td")) {
          const key = this.vehicleFields.find(([, key]) =>
            td.textContent.includes("{{" + key + "}}"),
          )?.[1];
          if (key) values.set(key, td.innerHTML);
        }
        const grid = this.vehicleGrid(n.id, n.x, n.y, n.w, n.h, values);
        Object.assign(n, {
          html: grid.html,
          letterGrid: true,
          align: "center",
          radius: 0,
          stroke: grid.stroke,
          color: grid.color,
        });
      }
      if (p.id === 2 && p.nodes.some((n) => n.id === "receipt-vehicle")) {
        p.nodes = p.nodes.filter((n) => n.id !== "receipt-vehicle");
        const caption = p.nodes.find((n) => n.id === "receipt-details");
        if (caption)
          Object.assign(caption, {
            html: "نوع السيارة: {{car}} · الشاصي: {{vin}} · التاريخ: {{date}}",
            y: 249.2,
          });
        const img = p.nodes.find((n) => n.binding === "receipt");
        if (img) Object.assign(img, { x: 8, y: 8, w: 194, h: 238 });
      }
    }
    scene.letterVehicleLayout = 2;
  },
  template(scene) {
    const old = scene.transferLetter;
    if (old?.layoutVersion === 3) return old;
    if (old?.layoutVersion === 2) return this.arrangeBlocks(old);
    const nodes = [];
    function text(key, name, html, x, y, w, h, options = {}) {
      nodes.push({
        id: "transfer-" + key,
        type: "text",
        name,
        html,
        x,
        y,
        w,
        h,
        z: 5,
        fontSize: 20,
        fontFamily: "Sakkal Majalla",
        align: "right",
        lineHeight: 1.1,
        color: "#202a35",
        ...options,
      });
    }
    nodes.push({
      id: "transfer-letterhead",
      name: "فورمة الشركة",
      type: "image",
      binding: "company",
      x: 0,
      y: 0,
      w: 210,
      h: 297,
      fit: "fill",
      z: -100,
      opacity: 0.65,
    });
    text("date", "التاريخ", "التاريخ: {{date}}", 18, 32, 182, 6, {
      fontSize: 16,
    });
    text(
      "to",
      "الجهة المخاطبة",
      "إلى / السيد {{transferAddressee}} المحترم",
      15,
      39,
      180,
      8,
      { align: "center", weight: "700", color: "#164577", fontSize: 23 },
    );
    text("subject", "موضوع الكتاب", "م / تخويل نقل ملكية", 15, 50, 180, 9, {
      align: "center",
      fontSize: 25,
      weight: "700",
      color: "#164577",
    });
    text(
      "intro",
      "نص الكتاب",
      "لا مانع لدينا من نقل ملكية المركبة المدرجة تفاصيلها أدناه إلى:",
      20,
      63,
      170,
      8,
      { weight: "700", align: "center" },
    );
    nodes.push(this.vehicleGrid("transfer-vehicle", 20, 97, 170, 46));
    nodes.push({
      id: "transfer-note-frame",
      name: "إطار الملاحظة",
      type: "shape",
      shape: "rect",
      x: 20,
      y: 147,
      w: 170,
      h: 25,
      z: 1,
      radius: 0,
      fill: "none",
      stroke: "#aaaaaa",
      strokeWidth: 1,
      condition: "transfer-note",
    });
    text("note-heading", "عنوان الملاحظة", "الملاحظة:", 23, 148, 163, 6, {
      fontSize: 16,
      weight: "700",
      condition: "transfer-note",
    });
    text(
      "note",
      "ملاحظة نقل الملكية",
      "{{cashTransferNote}}",
      23,
      153.5,
      164,
      17.7,
      {
        color: "#b00020",
        fontSize: 24,
        weight: "700",
        condition: "transfer-note",
        fitLetterNote: true,
      },
    );
    text("directory", "عنوان قائمة الوكلاء", "وكلاء الشركة", 45, 174, 120, 6, {
      align: "center",
      weight: "700",
      fontSize: 16,
    });
    const oldAgents = old?.nodes.find((n) => n.id === "transfer-agents");
    const agentTable = document.createElement("div");
    agentTable.innerHTML = safeMarkup(oldAgents?.html || "", true);
    const saved = agentTable.querySelector("tbody");
    const rows = saved?.rows.length
      ? saved.innerHTML
      : this.agents
          .map(
            ([place, name, phone]) =>
              "<tr><td>" +
              place +
              "</td><td>" +
              name +
              "</td><td>" +
              phone +
              "</td></tr>",
          )
          .join("");
    nodes.push({
      id: "transfer-agents",
      name: "دليل الوكلاء",
      type: "table",
      directory: true,
      x: 47,
      y: 181,
      w: 116,
      h: 62,
      z: 5,
      fontFamily: "Sakkal Majalla",
      fontSize: 16,
      lineHeight: 1.05,
      align: "center",
      radius: 0,
      stroke: "#8d8d8d",
      strokeWidth: 1,
      fill: "transparent",
      html: "<table><tbody>" + rows + "</tbody></table>",
    });
    text(
      "manager",
      "توقيع المدير المفوض",
      "المدير المفوض<br>{{manager}}",
      17,
      261,
      58,
      14,
      { align: "center", weight: "700", fontSize: 17 },
    );
    text(
      "organizer",
      "توقيع المنظّم",
      "المنظّم: {{organizer}}",
      133,
      261,
      64,
      12,
      { fontSize: 17 },
    );
    for (const n of old?.nodes || [])
      if (!n.id.startsWith("transfer-")) nodes.push(clone(n));
    return (scene.transferLetter = this.arrangeBlocks({
      id: 0,
      name: "كتاب نقل الملكية",
      layoutVersion: 2,
      nodes,
    }));
  },
  arrangeBlocks(page) {
    page.nodes = page.nodes.filter((n) => n.id !== "transfer-parties");
    const set = (key, properties) => {
      const node = page.nodes.find((n) => n.id === "transfer-" + key);
      if (node) Object.assign(node, properties);
    };
    set("date", { x: 155, y: 30, w: 43, h: 6, align: "center" });
    set("to", { x: 12, y: 38, w: 186, h: 10, align: "center", fontSize: 27 });
    set("subject", {
      x: 12,
      y: 51,
      w: 186,
      h: 11,
      align: "center",
      fontSize: 31,
    });
    set("intro", {
      x: 14,
      y: 65,
      w: 182,
      h: 8,
      align: "center",
      fontSize: 22,
      html: "لا مانع لدينا من نقل ملكية المركبة المدرجة تفاصيلها أدناه إلى:",
    });
    page.nodes.push({
      id: "transfer-buyer",
      type: "text",
      name: "اسم المشتري",
      html: "{{buyer}}",
      x: 18,
      y: 76,
      w: 174,
      h: 10,
      z: 5,
      fontFamily: "Sakkal Majalla",
      fontSize: 28,
      weight: "700",
      lineHeight: 1.05,
      align: "center",
      color: "#164577",
    });
    set("vehicle", { x: 20, y: 90, w: 170, h: 50, fontSize: 25 });
    set("note-heading", { align: "center" });
    set("note", { align: "center" });
    set("directory", { fontSize: 19, h: 7 });
    set("agents", { y: 183, h: 60 });
    set("manager", {
      x: 16,
      y: 254,
      w: 74,
      h: 21,
      fontSize: 24,
      align: "center",
      weight: "700",
    });
    set("organizer", {
      x: 120,
      y: 254,
      w: 74,
      h: 21,
      fontSize: 21,
      align: "center",
      html: "المنظّم<br>{{organizer}}",
    });
    page.layoutVersion = 3;
    return page;
  },
  fitNote(content, n) {
    if (!content.textContent.trim()) return;
    const probe = content.cloneNode(true);
    Object.assign(probe.style, {
      position: "fixed",
      top: "0",
      left: "-300vw",
      visibility: "hidden",
      direction: "rtl",
      width: n.w + "mm",
      height: "auto",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      fontFamily: CONTRACT_FONT,
      fontSize: n.fontSize + "px",
      fontWeight: n.weight,
      lineHeight: String(n.lineHeight),
    });
    document.body.append(probe);
    try {
      const styled = [...probe.querySelectorAll("[style]")].filter(
        (el) => el.style.fontSize,
      );
      const fonts = styled.map((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      let size = n.fontSize;
      while (size > 8 && probe.getBoundingClientRect().height > n.h * MM) {
        probe.style.fontSize = --size + "px";
        styled.forEach(
          (el, index) =>
            (el.style.fontSize = (fonts[index] * size) / n.fontSize + "px"),
        );
      }
      if (size < n.fontSize) {
        content.style.fontSize = size + "px";
        // Rich-text spans must shrink with the node, or their fixed sizes defeat fitting.
        [...content.querySelectorAll("[style]")]
          .filter((el) => el.style.fontSize)
          .forEach((el, index) => {
            el.style.fontSize = (fonts[index] * size) / n.fontSize + "px";
          });
      }
    } finally {
      probe.remove();
    }
  },
};
