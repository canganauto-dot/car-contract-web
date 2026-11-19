/* Payment dates always use the original first-date anchor (including month-end). */
const Schedule = {
  rowsPerColumn: 36,
  get capacity() {
    return this.rowsPerColumn * 3;
  },
  rows(data) {
    const r = calculate(data),
      rows = [];
    const add = (label, value, date) =>
      rows.push({ label, value, date: date || "" });
    if (r.deposit > 0) add("المقدمة", r.deposit, data.depositDate);
    for (const x of data.extras || [])
      if (amount(x.amount) > 0)
        add(x.label || "دفعة إضافية", amount(x.amount), x.date);
    if (
      Number.isInteger(r.count) &&
      r.count <= 1200 &&
      Number.isInteger(r.interval) &&
      r.interval >= 1 &&
      r.interval <= 24
    )
      for (let i = 0; i < r.count; i++) {
        const last = i === r.count - 1;
        add(
          last ? "الأخير · " + (i + 1) : "قسط " + (i + 1),
          last
            ? r.last
            : r.phase && i < r.earlyCount
              ? r.earlyPayment
              : r.payment,
          addMonths(data.firstDate, i * r.interval),
        );
      }
    return rows.sort((a, b) =>
      (a.date || "9999").localeCompare(b.date || "9999"),
    );
  },
  template(scene) {
    if (scene.scheduleTemplate) {
      this.checkboxes(scene.scheduleTemplate);
      return scene.scheduleTemplate;
    }
    const text = (id, name, html, x, y, w, h, size) => ({
      id,
      type: "text",
      name,
      html,
      x,
      y,
      w,
      h,
      fontSize: size,
      align: "center",
      lineHeight: 1.1,
      z: 2,
    });
    const nodes = [
      {
        id: "schedule-form",
        type: "image",
        name: "فورمة الشركة",
        binding: "company",
        fit: "fill",
        x: 0,
        y: 0,
        w: 210,
        h: 297,
        z: -100,
      },
      text(
        "schedule-title",
        "عنوان الكشف",
        "كشف دفعات وأقساط العقد",
        5,
        30,
        200,
        8,
        26,
      ),
      text(
        "schedule-meta",
        "بيانات الكشف",
        "العقد {{number}}   ·   الزبون: {{buyer}}   ·   {{date}}   ·   {{schedulePage}}",
        5,
        40,
        200,
        7,
        18,
      ),
    ];
    for (let col = 0; col < 3; col++) {
      const body = Array.from({ length: this.rowsPerColumn }, (_, i) => {
        const k = col * this.rowsPerColumn + i;
        return (
          "<tr><td>{{scheduleLabel" +
          k +
          "}}</td><td>{{scheduleDate" +
          k +
          "}}</td><td>{{scheduleValue" +
          k +
          "}}</td></tr>"
        );
      }).join("");
      nodes.push({
        id: "schedule-col-" + col,
        name: "عمود الأقساط " + (col + 1),
        type: "table",
        x: 141 - col * 68,
        y: 50,
        w: 64,
        h: 231,
        fontSize: 14,
        lineHeight: 1.05,
        align: "center",
        stroke: "#a4b7bf",
        z: 3,
        html:
          "<table><thead><tr><th>الدفعة</th><th>التاريخ</th><th>المبلغ / د.ع.</th></tr></thead><tbody>" +
          body +
          "</tbody></table>",
      });
    }
    scene.scheduleTemplate = { id: -1, name: "كشف الأقساط", nodes };
    this.checkboxes(scene.scheduleTemplate);
    return scene.scheduleTemplate;
  },
  checkboxes(page) {
    for (const n of page.nodes) {
      if (!/^schedule-col-/.test(n.id) || n.paymentCheck) continue;
      const div = document.createElement("div");
      div.innerHTML = n.html;
      for (const row of div.querySelectorAll("tr")) {
        const head = !!row.querySelector("th"),
          cell = document.createElement(head ? "th" : "td");
        const index = /scheduleLabel(\d+)/.exec(row.textContent)?.[1];
        cell.textContent = head
          ? "✓"
          : index != null
            ? "{{scheduleCheck" + index + "}}"
            : "";
        cell.style.width = "9%";
        cell.style.fontFamily = "Arial";
        row.append(cell);
      }
      n.html = div.innerHTML;
      n.paymentCheck = true;
    }
  },
  pages(scene, design, archived = false) {
    if (d.contractType === "cash") {
      this.entries = [];
      return [];
    }
    this.entries = this.rows(d);
    const count = design ? 1 : Math.ceil(this.entries.length / this.capacity);
    return Array.from({ length: count }, (_, i) => {
      const template = this.template(scene);
      if (!archived) PaperLayout.apply(template);
      const rowCount = Math.min(
        this.capacity,
        this.entries.length - i * this.capacity,
      );
      return {
        ...template,
        nodes: design
          ? template.nodes
          : this.layout(
              template.nodes,
              Math.ceil(rowCount / this.rowsPerColumn),
            ),
        id: -i - 1,
        name: count === 1 ? "كشف الأقساط" : "كشف الأقساط · " + (i + 1),
      };
    });
  },
  layout(nodes, count) {
    if (count === 3) return nodes;
    const active = nodes.filter(
      (n) =>
        !/^schedule-col-[0-2]$/.test(n.id) || Number(n.id.slice(-1)) < count,
    );
    const columns = active.filter((n) => /^schedule-col-[0-2]$/.test(n.id));
    if (!columns.length) return active;
    const left = Math.min(...columns.map((c) => c.x));
    const right = Math.max(...columns.map((c) => c.x + c.w));
    const offset = (210 - left - right) / 2;
    return active.map((n) =>
      columns.includes(n) ? { ...n, x: n.x + offset } : n,
    );
  },
  values(page) {
    const start = (-page.id - 1) * this.capacity,
      rows = this.entries.slice(start, start + this.capacity);
    const values = {
      schedulePage:
        "صفحة " +
        -page.id +
        " / " +
        Math.max(1, Math.ceil(this.entries.length / this.capacity)),
    };
    for (let col = 0; col < 3; col++)
      for (let i = 0; i < this.rowsPerColumn; i++) {
        const k = col * this.rowsPerColumn + i,
          row = rows[k];
        values["scheduleLabel" + k] = row?.label || "";
        values["scheduleDate" + k] = row ? dateLabel(row.date) : "";
        values["scheduleValue" + k] = row ? (row.value < 0 ? "-" : money(row.value)) : "";
        values["scheduleCheck" + k] = row ? "□" : "";
      }
    return values;
  },
  requiresGuarantor(id, data) {
    return !data.standaloneBook && ["installment","exchange"].includes(data.contractType)
      && [6,8].includes(Number(id)) && !String(data.guarantor || "").trim();
  },
  enabled(id) {
    if (this.requiresGuarantor(id,d)) return false;
    if (SmartTables.parents.has(id))
      return this.enabled(SmartTables.parents.get(id));
    if (d.standaloneBook) return id === Number(d.standaloneBook);
    const ref = ContractTemplates.find()?.pages.find(p=>p.id===(id<0?-1:id));
    if (ref && ref.source !== d.contractType && id > 0 && !CompanySheets.ids.includes(id))
      return d.pages.includes(id) && !(d.noWarranty && [2,5].includes(id));
    if (id === 0 && TransferLetter.paymentContract(d)) return TransferLetter.applies(d);
    if (ref && id === 0) return !d.skipTransferLetter;
    if (d.contractType === "external" && !ref)
      return id === 0 ? TransferLetter.applies(d) && !d.skipTransferLetter : [1, 3].includes(id) && d.pages.includes(id);
    if (CompanySheets.ids.includes(id))
      return !(d.skipCompanySheets || "").split(",").includes(String(id));
    if (id === 0) return TransferLetter.applies(d) && !d.skipTransferLetter;
    if (
      d.contractType === "cash" &&
      (id < 0 ||
        id === 3 ||
        id === 6 ||
        id === 8 ||
        (id === 7 && (calculate(d).outstanding ?? calculate(d).remaining) <= 0))
    )
      return false;
    return id < 0
      ? !(d.skipSchedule || "").split(",").includes(String(id))
      : d.pages.includes(id) && !(d.noWarranty && [2, 5].includes(id));
  },
};
