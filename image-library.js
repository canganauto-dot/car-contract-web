/* Separate image registries: company slots, vehicle slots, static nodes and customer data. */
class ImageLibrary {
  ensure() {
    cfg.companyImageSlots ||= [];
    this.stockLogos ||= ContractAssets.logos;
    if (
      !(cfg.deletedCompanyImageSlots || []).includes("headerLogo") &&
      !cfg.companyImageSlots.some((s) => s.id === "headerLogo")
    )
      cfg.companyImageSlots.push({
        id: "headerLogo",
        label: "شعار الشركة · وسط الهيدر",
      });
    for (const c of cfg.companies) {
      c.imageValues ||= {};
      if (
        !(cfg.deletedCompanyImageSlots || []).includes("headerLogo") &&
        !Object.hasOwn(c.imageValues, "headerLogo")
      )
        c.imageValues.headerLogo = this.stockLogos[c.id] || "";
    }
    cfg.vehicleImageSlots ||= [
      { id: "receipt", label: "صورة الضمان" },
      { id: "maintenance", label: "صورة الصيانة" },
    ];
    for (const s of cfg.vehicleImageSlots)
      if (s.id === "receipt" && s.label === "صورة الاستلام")
        s.label = "صورة الضمان";
    cfg.vehicleImages ||= { changan: {}, deepal: {} };
    for (const car of cfg.cars) car.id ||= "car-" + crypto.randomUUID();
    if (!cfg.imageSeparationVersion) {
      cfg.vehicleImageHistory ||= [];
      for (const brand of ["changan", "deepal"])
        for (const slot of ["receipt", "maintenance"]) {
          const oldKey = slot + (brand === "deepal" ? "Deepal" : "Changan"),
            active =
              cfg.companies.find((c) => c.id === d?.companyId) ||
              cfg.companies[0];
          cfg.vehicleImages[brand] ||= {};
          if (!(slot in cfg.vehicleImages[brand]))
            cfg.vehicleImages[brand][slot] =
              active?.imageValues?.[oldKey] ?? cfg.assets[oldKey] ?? "";
          for (const c of cfg.companies) {
            const src = c.imageValues?.[oldKey];
            if (
              src &&
              src !== cfg.vehicleImages[brand][slot] &&
              !cfg.vehicleImageHistory.some(
                (x) => x.brand === brand && x.slot === slot && x.src === src,
              )
            )
              cfg.vehicleImageHistory.push({ brand, slot, src, label: c.name });
            if (c.imageValues) delete c.imageValues[oldKey];
          }
        }
      cfg.companyImageSlots = cfg.companyImageSlots.filter(
        (s) =>
          !this.legacyVehicleKey(s.id) && !this.legacyVehicleKey(s.builtin),
      );
      cfg.imageSeparationVersion = 1;
    }
  }
  legacyVehicleKey(id) {
    return /^(receipt|maintenance)(Changan|Deepal)$/.exec(id || "")?.[1] || "";
  }
  companySlot(id, label, builtin = "") {
    if ((cfg.deletedCompanyImageSlots || []).includes(id)) return;
    if (!cfg.companyImageSlots.some((s) => s.id === id))
      cfg.companyImageSlots.push({ id, label, builtin });
    for (const c of cfg.companies) {
      c.imageValues ||= {};
      if (!(id in c.imageValues))
        c.imageValues[id] = builtin === "company" ? c.background || "" : "";
    }
  }
  scan() {
    this.ensure();
    for (const n of App.all())
      if (n.binding === "company")
        this.companySlot("letterhead", "فورمة الشركة", "company");
  }
  vehicleSource(slot) {
    const car = cfg.cars.find((c) =>
        [c.name, ...(c.aliases || [])].some(
          (name) => normalizeName(name) === normalizeName(d.car),
        ),
      ),
      brand = selectedBrand(),
      model =
        car && car.brand === brand ? cfg.vehicleImages["car:" + car.id] : null;
    return model && Object.hasOwn(model, slot)
      ? model[slot]
      : cfg.vehicleImages[brand]?.[slot] || "";
  }
  source(n) {
    if (
      (cfg.deletedCompanyImageSlots || []).includes(
        n.binding === "company" ? "letterhead" : n.slot,
      )
    )
      return "";
    if (n.binding === "customer") return d.customerPhoto || "";
    if (n.binding === "company")
      return (
        (n.id === "external-waiver-form" ? External.company() : co())
          .background || ""
      );
    if (n.binding === "companySlot")
      return this.legacyVehicleKey(n.slot)
        ? this.vehicleSource(this.legacyVehicleKey(n.slot))
        : co().imageValues?.[n.slot] || "";
    if (n.binding === "vehicleSlot") return this.vehicleSource(n.slot);
    if (["receipt", "maintenance"].includes(n.binding))
      return this.vehicleSource(n.binding);
    return n.src || "";
  }
  choose() {
    this.scan();
    for (const [id, slots] of [
      ["existingImageSlot", cfg.companyImageSlots],
      ["existingVehicleSlot", cfg.vehicleImageSlots],
    ]) {
      const select = $(id);
      select.replaceChildren(new Option("خانة جديدة", ""));
      for (const s of slots) select.add(new Option(s.label, s.id));
    }
    $("newImageSlotLabel").value = "";
    $("newVehicleSlotLabel").value = "";
    $("companyImageCreate").hidden = true;
    $("vehicleImageCreate").hidden = true;
    $("imageTypeDialog").showModal();
  }
  insert(binding, slot = "") {
    const slots =
        binding === "vehicleSlot"
          ? cfg.vehicleImageSlots
          : cfg.companyImageSlots,
      n = App.create("image");
    Object.assign(n, {
      binding,
      slot,
      name:
        binding === "customer"
          ? "صورة الزبون"
          : slots.find((s) => s.id === slot)?.label || "صورة",
      w: binding === "customer" ? 32 : 60,
      h: binding === "customer" ? 40 : 35,
    });
    App.render();
    App.persist();
    $("imageTypeDialog").close();
    this.companyPanel();
    this.vehiclePanel();
  }
  options() {
    const select = $("imageBinding");
    select.replaceChildren(
      new Option("صورة ثابتة", ""),
      new Option("صورة الزبون", "customer"),
    );
    for (const [label, slots, prefix] of [
      ["حسب الشركة", cfg.companyImageSlots, "company:"],
      ["حسب المركبة", cfg.vehicleImageSlots, "vehicle:"],
    ]) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const s of slots) group.append(new Option(s.label, prefix + s.id));
      select.append(group);
    }
    const n = App.selected()[0];
    select.value =
      n?.binding === "company"
        ? "company:letterhead"
        : n?.binding === "companySlot"
          ? this.legacyVehicleKey(n.slot)
            ? "vehicle:" + this.legacyVehicleKey(n.slot)
            : "company:" + n.slot
          : n?.binding === "vehicleSlot"
            ? "vehicle:" + n.slot
            : ["receipt", "maintenance"].includes(n?.binding)
              ? "vehicle:" + n.binding
              : n?.binding || "";
  }
  bind(value) {
    App.commitText();
    const n = App.selected()[0];
    if (!n) return;
    App.checkpoint();
    if (value === "") {
      n.src = this.source(n);
      n.binding = "";
      delete n.slot;
    } else if (value.startsWith("company:")) {
      n.slot = value.slice(8);
      n.binding = n.slot === "letterhead" ? "company" : "companySlot";
    } else if (value.startsWith("vehicle:")) {
      n.slot = value.slice(8);
      n.binding = "vehicleSlot";
    } else n.binding = value;
    App.render();
    App.persist();
  }
  card(slot, src, save, { inherited = false, reset = null } = {}) {
    const card = document.createElement("article");
    card.className = "image-library-card";
    const title = document.createElement("strong");
    title.textContent = slot.label;
    const img = document.createElement("img");
    img.alt = slot.label;
    if (src) img.src = safeImage(src);
    else img.hidden = true;
    const status = document.createElement("small");
    status.textContent = inherited
      ? "تستخدم صورة العلامة التجارية"
      : src
        ? "صورة مخصصة"
        : "لم تُضف صورة";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.hidden = true;
    file.onchange = async () => {
      try {
        if (file.files[0]) save(await readImage(file.files[0]));
      } catch (e) {
        Feedback.notice(e.message);
      } finally {
        file.value = "";
      }
    };
    const actions = document.createElement("div");
    actions.className = "row-buttons";
    const upload = document.createElement("button");
    upload.textContent = "تحميل صورة";
    upload.onclick = () => file.click();
    const remove = document.createElement("button");
    remove.textContent = "إزالة";
    remove.onclick = () => save("");
    actions.append(upload, remove);
    if (reset) {
      const button = document.createElement("button");
      button.textContent = "صورة العلامة";
      button.onclick = reset;
      actions.append(button);
    }
    card.append(title, img, status, actions, file);
    return card;
  }
  companyPanel() {
    if (!$("companyImageValues")) return;
    this.ensure();
    const c =
      cfg.companies.find((c) => c.id === $("settingsCompany").value) || co();
    $("companyImageValues").replaceChildren();
    for (const slot of cfg.companyImageSlots) {
      const src =
        slot.builtin === "company" ? c.background : c.imageValues?.[slot.id];
      $("companyImageValues").append(
        this.card(slot, src, (value) => {
          c.imageValues ||= {};
          c.imageValues[slot.id] = value;
          if (slot.builtin === "company") c.background = value;
          if(Cloud.enabled)Cloud.saveBrand(c).catch(e=>Feedback.notice(e.message));
          this.companyPanel();
          render();
          scheduleConfig();
        }),
      );
      const remove = document.createElement("button");
      remove.textContent = "حذف خانة الصورة";
      remove.onclick = () => {
        cfg.deletedCompanyImageSlots = [
          ...new Set([...(cfg.deletedCompanyImageSlots || []), slot.id]),
        ];
        cfg.companyImageSlots = cfg.companyImageSlots.filter(
          (s) => s.id !== slot.id,
        );
        for (const company of cfg.companies) {
          delete company.imageValues?.[slot.id];
          if (slot.builtin === "company") company.background = "";
        }
        this.companyPanel();
        render();
        scheduleConfig();
      };
      $("companyImageValues").lastElementChild.append(remove);
    }
  }
  vehiclePanel() {
    if (!$("vehicleImageValues")) return;
    this.ensure();
    const selector = $("vehicleImageTarget"),
      old = selector.value;
    selector.replaceChildren(
      new Option("شانجان · الصورة الافتراضية", "changan"),
      new Option("ديبال · الصورة الافتراضية", "deepal"),
    );
    for (const c of cfg.cars)
      selector.add(new Option(c.name + " · صورة خاصة", "car:" + c.id));
    if ([...selector.options].some((o) => o.value === old))
      selector.value = old;
    const key = selector.value,
      car = cfg.cars.find((c) => "car:" + c.id === key),
      values = cfg.vehicleImages[key] || {},
      defaults = car ? cfg.vehicleImages[car.brand] || {} : {};
    $("vehicleImageValues").replaceChildren();
    for (const slot of cfg.vehicleImageSlots) {
      const inherited = !!car && !Object.hasOwn(values, slot.id),
        src = inherited ? defaults[slot.id] : values[slot.id];
      const refresh = () => {
        this.vehiclePanel();
        render();
        scheduleConfig();
      };
      $("vehicleImageValues").append(
        this.card(
          slot,
          src,
          (value) => {
            cfg.vehicleImages[key] ||= {};
            cfg.vehicleImages[key][slot.id] = value;
            refresh();
          },
          {
            inherited,
            reset: car
              ? () => {
                  delete cfg.vehicleImages[key]?.[slot.id];
                  refresh();
                }
              : null,
          },
        ),
      );
    }
    $("vehicleImageHistory").hidden = !(cfg.vehicleImageHistory || []).length;
    const history = $("vehicleHistoryList");
    history.replaceChildren();
    for (const item of cfg.vehicleImageHistory || []) {
      const button = document.createElement("button");
      button.textContent =
        item.label +
        " · " +
        (item.brand === "deepal" ? "ديبال" : "شانجان") +
        " · " +
        (item.slot === "receipt" ? "الضمان" : "الصيانة");
      button.onclick = () => {
        cfg.vehicleImages[item.brand][item.slot] = item.src;
        selector.value = item.brand;
        this.vehiclePanel();
        render();
        scheduleConfig();
      };
      history.append(button);
    }
  }
  init() {
    this.scan();
    $("vehicleImageTarget").onchange = () => this.vehiclePanel();
    $("chooseVehicleImage").onclick = () => {
      $("vehicleImageCreate").hidden = false;
      $("companyImageCreate").hidden = true;
    };
    $("insertVehicleImage").onclick = () => {
      let id = $("existingVehicleSlot").value;
      if (!id) {
        const label = $("newVehicleSlotLabel").value.trim();
        if (!label) return Feedback.notice("اكتب اسم خانة الصورة.");
        id = "vehicle_" + crypto.randomUUID().slice(0, 8);
        cfg.vehicleImageSlots.push({ id, label });
        scheduleConfig();
      }
      this.insert("vehicleSlot", id);
    };
    this.vehiclePanel();
  }
}
const Images = new ImageLibrary();
