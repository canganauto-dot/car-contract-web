const ContractFiles = {
  folder: null,
  entry: null,
  shots: [],
  stream: null,
  customer(data) {
    return data.contractType === "external"
      ? data.externalBuyerCompany
        ? data.externalSeller
        : data.externalSellerCompany
          ? data.externalBuyer
          : data.externalBuyer || data.externalSeller
      : data.buyer;
  },
  name(data, ext) {
    const company =
      cfg.companies.find(
        (c) =>
          c.id ===
          (data.externalBuyerCompany ||
            data.externalSellerCompany ||
            data.companyId),
      )?.name || "";
    return (
      [
        this.customer(data) || "عقد",
        data.number,
        data.contractDate,
        company,
        (data.vin || "").slice(-9),
      ]
        .filter(Boolean)
        .join(" - ")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") +
      "." +
      ext
    );
  },
  pack(data) {
    data = SmartTables.snapshot(data);
    const defaults = fresh(),
      values = {};
    for (const [k, v] of Object.entries(data))
      if (
        k !== "signedFile" &&
        k !== "updatedAt" &&
        (JSON.stringify(v) !== JSON.stringify(defaults[k]) ||
          /Date$|Time$|^companyId$/.test(k))
      )
        values[k] = v;
    return JSON.stringify({
      format: "contracts-data",
      origin: seed.offline || data.offlineNumber ? "offline" : "online",
      version: 1,
      data: values,
    });
  },
  paintTransferQrAction() {
    const action = $("transferQrAction");
    $("manageQr").hidden=!Cloud.enabled||!SalesForms.managesBranches;
    if(action)action.hidden=App.mode!=="fill"||!App.displayPages.some(p=>p.nodes.some(n=>n.binding==="documentQR"));
  },
  async save(data = d) {
    App.commitText();
    await Services.flush();
    download(this.name(data, "json"), this.pack(data), "application/json");
  },
  async load(file) {
    try {
      if (file.size > 15000000) throw Error("حجم الملف أكبر من الحد المسموح");
      const text=await file.text(), value = JSON.parse(text);
      if (
        value.format !== "contracts-data" ||
        !value.data ||
        Array.isArray(value.data) ||
        typeof value.data !== "object"
      )
        throw Error("اختر ملف بيانات عقد JSON");
      const data=normalizeData(value.data);
      if(!data.recordId)data.recordId="import-"+await PagesTemplates.hash(new TextEncoder().encode(text));
      const offline=value.origin==="offline" || (!value.origin && !data.offlineNumber && !seed.offline &&
        await Feedback.ask("هل أُنشئ ملف JSON القديم باستخدام النسخة غير المتصلة؟ يُضاف -F إلى عدد مستندات النسخة غير المتصلة."));
      await BranchNumbers.imported(data,offline);
      await DocumentQR.registerPending(data);
      if(await Services.openEntry({data})){
        Services.saveCurrent(d);
        await Services.flush();
      }
    } catch (e) {
      await Feedback.notice(e.message);
    }
  },
  async init() {
    this.folder = await getDB("signedDirectory");
    $("exportShortcut").title = "حفظ بيانات العقد JSON";
    $("exportShortcut").onclick = () => this.save();
    $("loadContract").onclick = () => $("contractJSON").click();
    $("contractJSON").onchange = (e) => {
      if (e.target.files[0]) this.load(e.target.files[0]);
      e.target.value = "";
    };
    $("fillPrint").onclick = () => $("printAll").click();
    $("issueTransferQr").onclick = () => DocumentQR.issueSelected().catch(e=>Feedback.notice(e.message));
    $("manageQr").onclick=()=>DocumentQR.manage();
    $("signedFolder").onclick = async () => {
      try {
        this.folder = await showDirectoryPicker({ mode: "readwrite" });
        await putDB("signedDirectory", this.folder);
        $("signedStatus").textContent = "مجلد الحفظ: " + this.folder.name;
      } catch (e) {
        if (e.name !== "AbortError") Feedback.notice(e.message);
      }
    };
    $("signedDevice").onclick = () => $("signedInput").click();
    $("signedInput").onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (files.length) await this.attach(files);
    };
    $("signedCamera").onclick = async () => {
      try {
        this.stream?.getTracks().forEach(track=>track.stop());
        const opening=this.cameraOpening=Symbol(),stream=await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
        if(this.cameraOpening!==opening || !$("signedDialog").open){stream.getTracks().forEach(t=>t.stop());return;}
        this.stream=stream;$("signedVideo").hidden=false;
        $("signedVideo").srcObject = stream;
        await $("signedVideo").play();
        $("signedCapture").hidden = false;
      } catch (e) {
        Feedback.notice("تعذر فتح الكاميرا. يمكنك تحميل السكان من الجهاز.");
      }
    };
    $("signedCapture").onclick = () => {
      const v = $("signedVideo"),
        c = document.createElement("canvas");
      if (!v.videoWidth) return;
      const ratio=210/297, width=Math.min(v.videoWidth,v.videoHeight*ratio), height=width/ratio;
      c.width=Math.round(width);c.height=Math.round(height);
      c.getContext("2d").drawImage(v,(v.videoWidth-width)/2,(v.videoHeight-height)/2,width,height,0,0,c.width,c.height);
      this.shots.push(c.toDataURL("image/jpeg", 0.9));
      this.showShots();
    };
    $("signedFinish").onclick = () => this.attach(this.shots);
    $("signedClose").onclick = () => $("signedDialog").close();
    $("signedDialog").onclose = () => {
      this.cameraOpening=null;$("signedVideo").hidden=true;
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      $("signedVideo").srcObject = null;
    };
    $("layoutPrint").onclick = () => this.editLayout();
  },
  showShots() {
    const list = $("signedShots");
    list.replaceChildren();
    this.shots.forEach((src, i) => {
      const b = document.createElement("button");
      b.textContent = "حذف الصفحة " + (i + 1);
      b.onclick = () => {
        this.shots.splice(i, 1);
        this.showShots();
      };
      list.append(b);
    });
    $("signedFinish").disabled = !this.shots.length;
  },
  open(entry) {
    this.entry = entry;
    $("signedVideo").hidden=true;
    this.shots = [];
    this.showShots();
    $("signedStatus").textContent = this.folder
      ? "مجلد الحفظ: " + this.folder.name
      : "اختر مجلد النسخ الممسوحة ضوئياً لحفظ النسخة، أو ستُنزل إلى الجهاز.";
    $("signedCapture").hidden = true;
    $("signedDialog").showModal();
  },
  async attach(files) {
    try {
      await WebResources.pdf();
      const entry = this.entry;
      if (!entry) return;
      let directoryAllowed = false;
      if (this.folder) {
        try {
          let permission = await this.folder.queryPermission({
            mode: "readwrite",
          });
          if (permission !== "granted")
            permission = await this.folder.requestPermission({
              mode: "readwrite",
            });
          directoryAllowed = permission === "granted";
        } catch {
          directoryAllowed = false;
        }
      }
      const pdf = await PDFLib.PDFDocument.create();
      for (const file of files) {
        if (typeof file !== "string" && file.size > 50000000)
          throw Error("ملف السكان كبير جداً");
        const type = typeof file === "string" ? "image/jpeg" : file.type;
        const bytes =
          typeof file === "string"
            ? await (await fetch(file)).arrayBuffer()
            : await file.arrayBuffer();
        if (type === "application/pdf") {
          const source = await PDFLib.PDFDocument.load(bytes);
          for (const p of await pdf.copyPages(source, source.getPageIndices()))
            pdf.addPage(p);
        } else if (/^image\/(png|jpeg)$/.test(type)) {
          const im =
            type === "image/png"
              ? await pdf.embedPng(bytes)
              : await pdf.embedJpg(bytes);
          const p = pdf.addPage(PDFLib.PageSizes.A4),
            size = im.scaleToFit(p.getWidth(), p.getHeight());
          p.drawImage(im, {
            x: (p.getWidth() - size.width) / 2,
            y: (p.getHeight() - size.height) / 2,
            ...size,
          });
        } else throw Error("اختر PDF أو صورة JPG / PNG");
      }
      if (!pdf.getPageCount()) return;
      const blob = new Blob([await pdf.save()], { type: "application/pdf" }),
        name = this.name(entry.data, "pdf");
      if(Cloud.enabled){
        await Cloud.file(entry,"signed_pdf",blob);entry.cloudSigned=true;delete entry.signedFile;
        $("signedDialog").close();Archive.refresh();await Feedback.notice("حُفظت النسخة الموقّعة في أرشيف الفرع.");return;
      }
      let saved = false;
      if (this.folder && directoryAllowed) {
        const f = await this.folder.getFileHandle(name, { create: true }),
          w = await f.createWritable();
        await w.write(blob);
        await w.close();
        saved = true;
      }
      if (!saved) download(name, blob, "application/pdf");
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      entry.signedFile = { name, dataUrl, savedToDirectory: saved };
      entry.updatedAt = Date.now();
      await Services.persistLibrary();
      $("signedDialog").close();
      Archive.refresh();
      await Feedback.notice(
        saved
          ? "تم حفظ النسخة الموقعة داخل المجلد وربطها بالعقد."
          : "تم تنزيل النسخة الموقعة وربطها بالعقد.",
      );
    } catch (e) {
      await Feedback.notice(e.message);
    }
  },
  rail() {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "selectAllPages";
    input.title = "تحديد / إلغاء تحديد جميع الصفحات";
    input.setAttribute("aria-label", input.title);
    input.checked = App.displayPages
      .filter((p) => !(d.noWarranty && [2, 5].includes(p.id)))
      .every((p) => Schedule.enabled(p.id));
    input.onchange = () => {
      for (const item of $("pageRail").querySelectorAll(
        "input[type=checkbox]:not(#selectAllPages):not(:disabled)",
      ))
        if (item.checked !== input.checked) {
          item.checked = input.checked;
          item.dispatchEvent(new Event("change"));
        }
    };
    const label = document.createElement("label");
    label.className = "rail-heading";
    input.setAttribute("aria-label", input.title);
    label.append(input);
    $("pageRail").prepend(label);
  },
  editLayout() {
    const pages = [...$("pages").children];
    const data = PrintPlan.arrange(pages, d, false, "duplex", App.scene, true);
    let keys = data.map(
      (p) => p.dataset.printKey || "blank:" + crypto.randomUUID(),
    );
    const names = new Map(
      data.map((p) => [
        p.dataset.printKey,
        App.displayPages.find((x) => String(x.id) === p.dataset.page)?.name ||
          "ظهر فارغ",
      ]),
    );
    const dialog = $("printLayoutDialog"),
      list = $("printLayoutRows");
    const draw = () => {
      list.replaceChildren();
      keys.forEach((key, i) => {
        const row = document.createElement("div");
        row.className = "layout-row";
        const label = document.createElement("span");
        label.textContent =
          i +
          1 +
          " · " +
          (i % 2 ? "ظهر" : "وجه") +
          " · " +
          (key.startsWith("blank:") ? "فارغ" : names.get(key) || key);
        row.append(label);
        for (const [title, fn] of [
          [
            "↑",
            () => {
              if (i) {
                [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]];
                draw();
              }
            },
          ],
          [
            "↓",
            () => {
              if (i < keys.length - 1) {
                [keys[i + 1], keys[i]] = [keys[i], keys[i + 1]];
                draw();
              }
            },
          ],
          [
            "＋ فراغ",
            () => {
              keys.splice(i + 1, 0, "blank:" + crypto.randomUUID());
              draw();
            },
          ],
        ]) {
          const b = document.createElement("button");
          b.textContent = title;
          b.onclick = fn;
          row.append(b);
        }
        if (key.startsWith("blank:")) {
          const b = document.createElement("button");
          b.textContent = "حذف";
          b.onclick = () => {
            keys.splice(i, 1);
            draw();
          };
          row.append(b);
        }
        list.append(row);
      });
    };
    draw();
    $("printLayoutSave").onclick = () => {
      App.checkpoint();
      App.scene.printLayouts ??= {};
      App.scene.printLayouts[d.templateId || d.contractType] = keys;
      App.persist();
      dialog.close();
    };
    $("printLayoutReset").onclick = () => {
      App.checkpoint();
      if (App.scene.printLayouts) delete App.scene.printLayouts[d.templateId || d.contractType];
      App.persist();
      dialog.close();
      this.editLayout();
    };
    $("printLayoutClose").onclick = () => dialog.close();
    dialog.showModal();
  },
};
