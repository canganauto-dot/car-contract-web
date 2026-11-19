const PrintPlan = {
  mode() {
    return $("printSides")?.value || "simplex";
  },
  arrange(papers, data, face = false, mode = this.mode(), scene = App.scene, layoutEditor = false) {
    if (data.standaloneBook)
      return [...papers]
        .filter(
          (p) =>
            Number(p.dataset.page) === Number(data.standaloneBook) ||
            (!face && SmartTables.parents.get(Number(p.dataset.page)) ===
              Number(data.standaloneBook)),
        )
        .map((p) => p.cloneNode(true));
    const cash = data.contractType === "cash";
    const includeTransfer = !TransferLetter.paymentContract(data) || layoutEditor || TransferLetter.applies(data);
    const original = [...papers].filter(p => {
      const id = Number(p.dataset.page);
      return (!face || id === 1) && !Schedule.requiresGuarantor(id, data) && !(data.noWarranty && id === 2) &&
        (id !== 0 || includeTransfer);
    });
    const byId = new Map(original.map(p => [Number(p.dataset.page), p]));
    const ordered = [],
      external = data.contractType === "external";
    if (external) mode = "duplex";
    if (!external && byId.has(1)) {
      for (let copy = 0; copy < 2; copy++) {
        ordered.push({ p: byId.get(1), single: !byId.has(2) || face });
        if (!face && byId.has(2)) ordered.push({ p: byId.get(2) });
      }
    }
    for (const p of original) {
      const id = Number(p.dataset.page);
      if (!external && (id === 1 || (id === 2 && byId.has(1)))) continue;
      if (id === 9002 && byId.has(5)) continue;
      const cashTransfer = id === 0 && cash;
      const count = cashTransfer && TransferLetter.paidInFull(data) ? 2 : 1;
      for (let i = 0; i < count; i++)
        ordered.push({ p, single: cashTransfer || [3, 4, 6, 7, 8].includes(id) || face });
      if (id === 5 && byId.has(9002)) ordered.push({ p: byId.get(9002) });
    }
    const counts = new Map();
    const keyed = new Map();
    for (const item of ordered) {
      const id = item.p.dataset.page;
      const count = (counts.get(id) || 0) + 1;
      counts.set(id,count);
      item.key = id + ":" + count;
      keyed.set(item.key,item);
    }
    const custom = !face && scene?.printLayouts?.[data.templateId || data.contractType];
    const sequence = [];
    for (const key of custom || []) {
      if (keyed.has(key)) {
        sequence.push(keyed.get(key));
        keyed.delete(key);
      } else if (mode === "duplex" && key.startsWith("blank:") && !key.startsWith("blank:auto-")) {
        sequence.push({blank:key});
      }
    }
    sequence.push(...keyed.values());
    const result = [];
    let blankIndex = 0;
    const blank = (key = "blank:auto-" + blankIndex++) => {
      const sheet = document.createElement("article");
      sheet.className = "paper print-blank";
      sheet.dataset.blank = "true";
      sheet.dataset.printKey = key;
      result.push(sheet);
    };
    const emit = item => {
      const sheet = item.p.cloneNode(true);
      sheet.dataset.printKey = item.key;
      sheet.classList.remove("print-skip");
      sheet.style.display = "block";
      sheet.style.zoom = "1";
      result.push(sheet);
    };
    const pairedBacks = new Map();
    if (mode === "duplex" && !external && !face) {
      for (const [front,back] of [[1,2],[5,9002]]) {
        if (!byId.has(front) || !byId.has(back)) continue;
        for (const item of ordered.filter(i=>Number(i.p.dataset.page)===front)) {
          const copy=item.key.split(":")[1];
          const partner=ordered.find(i=>i.key===back+":"+copy);
          if(partner)pairedBacks.set(item.key,partner);
        }
      }
    }
    const backs=new Set(pairedBacks.values());
    for (const item of sequence) {
      if(item.blank){blank(item.blank);continue;}
      if(backs.has(item))continue;
      const partner=pairedBacks.get(item.key);
      if(mode==="duplex" && (item.single || partner) && result.length%2)blank();
      emit(item);
      if(partner)emit(partner);
      else if(mode==="duplex" && item.single)blank();
    }
    if(mode==="duplex" && result.length%2)blank();
    // The printer leaves the last sheet's reverse unused. Batch printing pads
    // between documents separately when a new sheet needs to start.
    if (cash && !layoutEditor && result.at(-2)?.dataset.page === "0" &&
        result.at(-1)?.dataset.printKey?.startsWith("blank:auto-")) result.pop();
    return result;
  },
  prepare() {
    if (Services.home) return;
    const originals = [...$("pages").children].filter((p) =>
      Schedule.enabled(Number(p.dataset.page)),
    );
    $("pages").replaceChildren(...this.arrange(originals, d));
  },
};
