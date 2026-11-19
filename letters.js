const Letters = {
  async init() {
    const add = (id, label, fn) => {
      const b = document.createElement("button");
      b.id = id;
      b.textContent = label;
      b.onclick = fn;
      $("homeCreate").after(b);
    };
    add("newLetter", "كتاب جديد", () => this.choose());
    add("importArchive", "استيراد JSON للأرشيف", () => {
      $("contractJSON").click();
    });
    ContractFiles.load = async (file) => {
      try {
        if (file.size > 15000000) throw Error("ملف كبير جداً");
        const value = JSON.parse(await file.text());
        if (
          value.format !== "contracts-data" ||
          !value.data ||
          Array.isArray(value.data) ||
          typeof value.data !== "object"
        )
          throw Error("اختر ملف بيانات عقد JSON");
        await Services.openEntry({ data: normalizeData(value.data) });
        Services.saveCurrent(d);
        await Services.flush();
      } catch (e) {
        await Feedback.notice(e.message);
      }
    };
  },
  choose() {
    const dialog = document.createElement("dialog");
    dialog.innerHTML =
      '<form method="dialog"><h3>كتاب جديد</h3><label>نوع الكتاب<select id="letterChoice"><option value="4">تخويل قيادة</option><option value="0">نقل ملكية</option></select></label><label>الشركة<select id="letterCompany"></select></label><label>عنوان قالب جديد<input id="letterTitle" placeholder="لإضافة كتاب آخر"></label><label>نص الكتاب<textarea id="letterBody" rows="5" placeholder="يمكن استخدام {{buyer}} و{{car}} و{{company}}"></textarea></label><button value="cancel">إلغاء</button><button id="letterStart" type="button">إنشاء الكتاب</button></form>';
    document.body.append(dialog);
    for (const c of cfg.companies)
      $("letterCompany").add(new Option(c.name, c.id));
    for (const t of cfg.letterTemplates || [])
      $("letterChoice").add(new Option(t.name, String(t.id)));
    $("letterCompany").value = d.companyId;
    dialog.onclose = () => dialog.remove();
    $("letterStart").onclick = async () => {
      const company = $("letterCompany").value,
        title = $("letterTitle").value.trim(),
        body = $("letterBody").value;
      let id = Number($("letterChoice").value);
      if (title) {
        id =
          12000 +
          Math.max(0, ...(cfg.letterTemplates || []).map((t) => t.id - 12000)) +
          1;
        (cfg.letterTemplates ||= []).push({ id, name: title, body });
        await saveConfig();
      }
      await Services.createContract();
      d.standaloneBook = String(id);
      d.companyId = company;
      d.contractType = id === 0 ? "cash" : "installment";
      d.bookTitle = title || $("letterChoice").selectedOptions[0].text;
      d.bookBody =
        body || cfg.letterTemplates?.find((t) => t.id === id)?.body || "";
      d.pages = [id];
      App.scene = null;
      render();
      saveDraft();
      dialog.close();
    };
    dialog.showModal();
  },
  pages(scene, pages) {
    if (!d.standaloneBook) return pages.filter((p) => p.id < 12000);
    const id = Number(d.standaloneBook);
    if (id < 12000) return pages.filter((p) => p.id === id);
    let page = scene.pages.find((p) => p.id === id);
    if (!page) {
      const template = cfg.letterTemplates?.find((t) => t.id === id);
      const base = scene.pages.find((p) => p.id === 4);
      const text = (suffix, html, y, h, size = 23) => ({
        id: "letter-" + id + "-" + suffix,
        type: "text",
        name: suffix,
        html,
        x: 20,
        y,
        w: 170,
        h,
        fontSize: size,
        fontFamily: "Amiri",
        align: "center",
        color: "#203e55",
        lineHeight: 1.3,
      });
      page = {
        id,
        name: template?.name || d.bookTitle || "كتاب",
        nodes: [
          ...(base?.nodes
            .filter((n) => n.type === "image")
            .map((n) => ({ ...clone(n), id: "letter-" + id + "-" + n.id })) ||
            []),
          text("number", "العدد: {{number}}     التاريخ: {{date}}", 35, 12, 19),
          text(
            "title",
            esc(template?.name || d.bookTitle || "كتاب"),
            55,
            16,
            27,
          ),
          text("body", template?.body || "{{bookBody}}", 80, 140),
          text("signature", "المدير المفوض<br>{{manager}}", 244, 25),
        ],
      };
      scene.pages.push(page);
    }
    return [page];
  },
};
