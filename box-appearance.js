/* One appearance model for text boxes and rectangular shapes. Colors include alpha. */
const BoxAppearance = {
  labels: {
    color: "لون النص",
    fill: "تعبئة البوكس",
    stroke: "لون الإطار",
    decorationColor: "لون التسطير",
  },
  icons: {
    color: '<path d="m6 17 6-14 6 14M8 12h8M4 21h16"/>',
    fill: '<path d="m7 3 11 11-7 7L1 11l7-7M3 12h13M19 14s4 4 4 6a3 3 0 0 1-6 0c0-2 2-6 2-6Z"/>',
    stroke:
      '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m13 11 7-7 2 2-7 7-3 1Z"/>',
    decorationColor: '<path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>',
  },
  unify(n) {
    if (n.type === "shape" && ["rect", "round"].includes(n.shape)) {
      n.type = "text";
      n.radius ??= n.shape === "round" ? 4 : 0;
      n.html ||= n.caption ? esc(n.caption) : "";
      n.verticalAlign ||= "middle";
      delete n.caption;
    }
    if (n.highlight) {
      if (!n.fill || n.fill === "transparent") n.fill = n.highlight;
      delete n.highlight;
    }
  },
  upgrade(page) {
    for (const n of page.nodes) this.unify(n);
    if (!page.plainTitlesVersion) {
      for (const n of page.nodes) {
        const old = AppearanceOriginals[n.id];
        const title =
          n.type === "text" &&
          ((/(?:title|heading|guide-service|guide-group)/.test(n.id) &&
            !/label|frame|box/.test(n.id)) ||
            (page.id === 9002 && n.fill && n.fill !== "transparent" && n.html));
        if (
          page.contrastVersion === 1 &&
          (n.fill === "#234863" || n.color === "#ffffff")
        ) {
          n.color = old?.color || (page.id === 9002 ? "#203e55" : "#172c35");
          if (n.fill === "#234863") n.fill = old?.fill || "transparent";
          if (n.html)
            n.html = n.html.replace(
              /(?<![-\w])color\s*:\s*#ffffff/gi,
              "color:" + n.color,
            );
        }
        if (page.id !== 1 && title) {
          n.fill = "transparent";
          n.color = old?.color || "#203e55";
        }
      }
      page.plainTitlesVersion = 1;
    }
  },
  parse(value) {
    if (!value || value === "transparent" || value === "none")
      return { hex: "#ffffff", alpha: 0 };
    if (/^#[\da-f]{8}$/i.test(value))
      return {
        hex: value.slice(0, 7),
        alpha: parseInt(value.slice(7), 16) / 255,
      };
    if (/^#[\da-f]{6}$/i.test(value)) return { hex: value, alpha: 1 };
    if (/^#[\da-f]{3}$/i.test(value))
      return {
        hex: "#" + [...value.slice(1)].map((c) => c + c).join(""),
        alpha: 1,
      };
    const parts = value.match(/[\d.]+/g);
    if (parts?.length >= 3)
      return {
        hex:
          "#" +
          parts
            .slice(0, 3)
            .map((c) =>
              Math.max(0, Math.min(255, Math.round(Number(c))))
                .toString(16)
                .padStart(2, "0"),
            )
            .join(""),
        alpha: parts.length > 3 ? Number(parts[3]) : 1,
      };
    return { hex: "#172c35", alpha: 1 };
  },
  rgba(hex, alpha) {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((c) => parseInt(c, 16));
    return alpha >= 1 ? hex : `rgba(${rgb.join(",")},${alpha})`;
  },
  init() {
    this.buttons = {};
    this.recent = [];
    // Retain hidden legacy inputs for existing inspector code, with no second visible color UI.
    $("fontColor").hidden = true;
    for (const key of ["fill", "stroke", "decorationColor"])
      document.querySelector(`[data-prop="${key}"]`).closest("label").hidden =
        true;
    $("noFill").closest("label").hidden = true;
    const tools = document.createElement("div");
    tools.className = "box-color-tools";
    for (const [key, label] of Object.entries(this.labels)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "box-color-button";
      b.dataset.colorKey = key;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-haspopup", "dialog");
      b.title = label;
      b.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' +
        this.icons[key] +
        "</svg><span>" +
        label +
        "</span><i></i><small>⌄</small>";
      b.onpointerdown = (e) => e.preventDefault();
      b.onclick = () =>
        !this.popup.hidden && this.key === key
          ? this.close()
          : this.open(key, b);
      const row = document.createElement("div");
      row.className = "box-color-row";
      if (key !== "color") {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.dataset.colorToggle = key;
        check.setAttribute("aria-label", "تفعيل " + label);
        check.onchange = () => {
          App.commitText();
          App.checkpoint();
          const prop =
            key === "decorationColor" ? "underlineEnabled" : key + "Enabled";
          for (const n of App.selected()) {
            n[prop] = check.checked;
            if (check.checked && key === "decorationColor")
              n.textDecoration = "underline";
            if (check.checked && key === "stroke" && !n.strokeWidth)
              n.strokeWidth = 1;
            if (check.checked && (!n[key] || n[key] === "transparent"))
              n[key] = key === "fill" ? "#e7edf2" : "#172c35";
          }
          App.render();
          App.persist();
        };
        row.append(check);
      }
      b.setAttribute("aria-expanded", "false");
      b.querySelector("small").innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
      row.append(b);
      if (key === "stroke" || key === "decorationColor")
        this.lineControls(row, key);
      tools.append(row);
      this.buttons[key] = b;
    }
    $("appearancePanel").querySelector("h3").textContent = "الإطار والزوايا";
    const section = (this.section = document.createElement("section"));
    section.id = "boxColorsPanel";
    section.innerHTML = "<h3>ألوان البوكس</h3>";
    section.append(tools);
    $("textPanel").before(section);
    const popup = (this.popup = document.createElement("div"));
    popup.id = "boxColorPalette";
    popup.hidden = true;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "اختيار اللون والشفافية");
    popup.innerHTML =
      '<header><strong></strong><button type="button" class="palette-close" aria-label="إغلاق">×</button></header><div class="palette-section">ألوان النسق</div><div class="palette-swatches theme-colors"></div><div class="palette-section">ألوان أساسية</div><div class="palette-swatches standard-colors"></div><div class="palette-section recent-label">الألوان الأخيرة</div><div class="palette-swatches recent-colors"></div><button type="button" class="palette-none">بدون لون / شفاف</button><div class="palette-custom"><label>لون مخصص<input class="palette-native" type="color"></label><label>HEX<input class="palette-hex" dir="ltr" maxlength="7" aria-label="رمز اللون"></label></div><label class="palette-alpha">العتامة <output>0%</output><input type="range" min="0" max="100" value="0" aria-label="العتامة"></label><div class="palette-preview"><span>معاينة</span></div><footer><button type="button" class="palette-apply">تطبيق</button><button type="button" class="palette-cancel">إلغاء</button></footer>';
    document.body.append(popup);
    popup.querySelector('[type="range"]').dir = "rtl";
    const theme = [
      "#ffffff",
      "#172c35",
      "#e7edf2",
      "#234863",
      "#4472c4",
      "#5b9bd5",
      "#70ad47",
      "#ffc000",
      "#ed7d31",
      "#a64d79",
    ];
    const shade = (hex, f) => {
      const rgb = hex
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16));
      return (
        "#" +
        rgb
          .map((v) =>
            Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
      );
    };
    for (const f of [0, 0.8, 0.55, 0.25, -0.25, -0.5])
      for (const hex of theme)
        this.swatch(popup.querySelector(".theme-colors"), shade(hex, f));
    for (const hex of [
      "#c00000",
      "#ff0000",
      "#ffc000",
      "#ffff00",
      "#92d050",
      "#00b050",
      "#00b0f0",
      "#0070c0",
      "#002060",
      "#7030a0",
    ])
      this.swatch(popup.querySelector(".standard-colors"), hex);
    popup.querySelector(".palette-native").oninput = (e) =>
      this.setHex(e.target.value);
    popup.querySelector(".palette-hex").oninput = (e) => {
      if (/^#[\da-f]{6}$/i.test(e.target.value)) this.setHex(e.target.value);
    };
    popup.querySelector("[type=range]").oninput = (e) => {
      this.alpha = Number(e.target.value) / 100;
      this.preview();
    };
    popup.querySelector(".palette-none").onclick = () => {
      this.alpha = 0;
      popup.querySelector("[type=range]").value = 0;
      this.preview();
    };
    popup.querySelector(".palette-apply").onclick = () => this.apply();
    for (const b of popup.querySelectorAll(".palette-close,.palette-cancel"))
      b.onclick = () => this.close();
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (
          !popup.hidden &&
          !popup.contains(e.target) &&
          !e.target.closest(".box-color-button")
        )
          this.close();
      },
      true,
    );
    popup.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === "Tab") {
        const focusable = [...popup.querySelectorAll("button,input")].filter(
          (n) => !n.disabled,
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    this.sync(App.selected());
  },
  lineControls(row, key) {
    const outline = key === "stroke";
    const name = outline ? "الإطار" : "التسطير";
    const prop = outline ? "strokeWidth" : "underlineWidth";
    const width = document.querySelector(`[data-prop="${prop}"]`);
    const label = width.closest("label");
    width.setAttribute("aria-label", "سمك " + name + " بالبكسل");
    label.replaceChildren("سمك", width);
    label.title = width.getAttribute("aria-label");

    const slider = document.createElement("input");
    slider.type = "range";
    slider.dir = "rtl";
    slider.max = "100";
    slider.setAttribute("aria-label", "عتامة " + name);
    const output = document.createElement("output");
    const showValue = () => {
      output.value = slider.value + "%";
      slider.setAttribute("aria-valuetext", output.value);
    };
    const update = (commit) => {
      if (commit) {
        App.commitText();
        App.checkpoint();
      }
      for (const n of App.selected()) {
        const current = n[key];
        const color = current && current !== "transparent" && current !== "none"
          ? current : (outline ? "#172c35" : n.color || "#172c35");
        const value = this.rgba(this.parse(color).hex, Number(slider.value) / 100);
        const line = outline
          ? { stroke: value, strokeEnabled: true, strokeWidth: n.strokeWidth || 1 }
          : { decorationColor: value, textDecoration: "underline", underlineEnabled: true };
        if (commit) Object.assign(n, line);
        else {
          const target = App.element(n.id);
          if (!target) continue;
          if (outline && n.type === "shape") {
            const svg = target.querySelector("svg");
            if (svg) svg.outerHTML = shapeMarkup({ ...n, ...line });
          } else if (outline) {
            target.style.border = line.strokeWidth + "px " + (n.dash || "solid") + " " + value;
          } else {
            target.classList.add("field-underlined");
            target.style.setProperty("--field-underline", value);
          }
        }
      }
      showValue();
      if (commit) {
        App.render();
        App.persist();
      }
    };
    slider.oninput = () => update(false);
    slider.onchange = () => update(true);
    slider.onpointercancel = () => App.render();
    row.classList.add("line-controls");
    row.append(slider, output, label);
  },
  swatch(parent, hex) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "palette-swatch";
    b.style.backgroundColor = hex;
    b.title = hex;
    b.setAttribute("aria-label", "لون " + hex);
    b.dataset.hex = hex;
    b.onclick = () => {
      this.alpha = this.alpha || 1;
      this.popup.querySelector("[type=range]").value = Math.round(
        this.alpha * 100,
      );
      this.setHex(hex);
    };
    parent.append(b);
  },
  sync(nodes) {
    if (!this.buttons) return;
    this.section.hidden =
      !nodes.length || nodes.every((n) => n.type === "image");
    for (const [key, b] of Object.entries(this.buttons)) {
      const values = nodes.map(
        (n) =>
          n[key] ||
          (key === "color"
            ? "#172c35"
            : key === "decorationColor"
              ? n.color || "#172c35"
              : "transparent"),
      );
      const mixed = new Set(values).size > 1;
      b.disabled = !nodes.length;
      const row = b.parentElement;
      const check = row.querySelector("[data-color-toggle]");
      const slider = row.querySelector('[type="range"]');
      if (slider) {
        const amounts = values.map(value => Math.round(this.parse(value).alpha * 100));
        const mixedAlpha = new Set(amounts).size > 1;
        slider.value = amounts[0] ?? 0;
        row.querySelector("output").value = mixedAlpha ? "—" : slider.value + "%";
        slider.setAttribute("aria-valuetext", mixedAlpha ? "عتامة مختلفة" : slider.value + "%");
      }
      if (check) {
        const on = (n) =>
          key === "decorationColor"
            ? n.textDecoration === "underline" && n.underlineEnabled !== false
            : n[key + "Enabled"] !== false &&
              !!n[key] &&
              n[key] !== "transparent" &&
              (key !== "stroke" || n.strokeWidth > 0);
        check.checked = nodes.length > 0 && nodes.every(on);
        check.indeterminate = nodes.some(on) && !nodes.every(on);
      }
      b.classList.toggle("mixed", mixed);
      b.querySelector("i").style.background = values[0] || "transparent";
      b.title = this.labels[key] + (mixed ? " · ألوان متعددة" : "");
    }
  },
  open(key, button) {
    if (!App.selected().length) return;
    if (!this.popup.hidden) this.close();
    this.key = key;
    this.anchor = button;
    button.setAttribute("aria-expanded", "true");
    this.previewNodes = App.selected().map((n) => ({
      id: n.id,
      node: clone(n),
    }));
    this.ids = App.selected().map((n) => n.id);
    this.range = App.editing && App.range ? App.range.cloneRange() : null;
    const node = App.selected()[0];
    let value =
      node[key] ||
      (key === "color"
        ? "#172c35"
        : key === "decorationColor"
          ? node.color || "#172c35"
          : "transparent");
    if (key === "color" && this.range) {
      const el =
        this.range.startContainer.nodeType === 1
          ? this.range.startContainer
          : this.range.startContainer.parentElement;
      value = getComputedStyle(el).color;
    }
    const parsed = this.parse(value);
    this.alpha = parsed.alpha;
    this.popup.querySelector("strong").textContent = this.labels[key];
    this.popup.querySelector("[type=range]").value = Math.round(
      this.alpha * 100,
    );
    const rec = this.popup.querySelector(".recent-colors");
    rec.replaceChildren();
    this.recent.forEach((c) => this.swatch(rec, c));
    this.popup.querySelector(".recent-label").hidden = !this.recent.length;
    this.popup.hidden = false;
    this.setHex(parsed.hex);
    const rect = button.getBoundingClientRect();
    this.popup.style.left =
      Math.max(8, Math.min(innerWidth - 300, rect.left)) + "px";
    this.popup.style.top =
      Math.max(
        8,
        Math.min(innerHeight - this.popup.offsetHeight - 8, rect.bottom + 5),
      ) + "px";
    this.popup.querySelector(".palette-close").focus();
  },
  setHex(hex) {
    this.hex = hex;
    this.popup.querySelector(".palette-native").value = hex;
    this.popup.querySelector(".palette-hex").value = hex;
    this.preview();
  },
  preview() {
    const value = this.rgba(this.hex, this.alpha);
    this.popup.querySelector("output").textContent =
      Math.round(this.alpha * 100) + "%";
    const el = this.popup.querySelector(".palette-preview span");
    el.style.cssText = "";
    if (this.key === "color") el.style.color = value;
    else if (this.key === "fill") el.style.background = value;
    else if (this.key === "stroke") el.style.border = "3px solid " + value;
    else {
      el.style.borderBottom = "3px solid " + value;
    }
    // Preview on DOM copies only: one history checkpoint on Apply, none on Cancel.
    if (!this.range || this.key !== "color")
      for (const item of this.previewNodes || []) {
        const target = App.element(item.id);
        if (!target) continue;
        const n = { ...item.node, [this.key]: value };
        if (this.key === "fill" || this.key === "stroke")
          n[this.key + "Enabled"] = true;
        if (this.key === "stroke" && !n.strokeWidth) n.strokeWidth = 1;
        App.nodeStyle(target, n);
        if (n.type === "shape") {
          const svg = target.querySelector("svg");
          if (svg) svg.outerHTML = shapeMarkup(n);
        }
        if (this.key === "decorationColor") {
          target.classList.add("field-underlined");
          target.style.setProperty("--field-underline", value);
        }
      }
    for (const b of this.popup.querySelectorAll(".palette-swatch"))
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.hex.toLowerCase() === this.hex.toLowerCase()),
      );
  },
  apply() {
    const value = this.rgba(this.hex, this.alpha),
      key = this.key,
      range = this.range;
    if (App.editing && range && !range.collapsed && key === "color") {
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      App.range = range;
      if (key === "color") App.format("foreColor", value);
      else {
        const wrapper = document.createElement("span");
        wrapper.style.textDecoration = "underline";
        wrapper.style.textDecorationColor = value;
        wrapper.append(range.cloneContents());
        App.editing.element.focus();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("insertHTML", false, wrapper.outerHTML);
        if (selection.rangeCount)
          App.range = selection.getRangeAt(0).cloneRange();
      }
    } else {
      App.selection = new Set(this.ids);
      App.property(key, value);
      for (const n of App.selected()) {
        if (key === "fill" || key === "stroke") n[key + "Enabled"] = true;
        if (key === "decorationColor") {
          n.underlineEnabled = true;
          n.textDecoration = "underline";
        }
      }
      App.render();
      App.persist();
      // A chosen outline should be visible even for a new, borderless text box.
      if (
        key === "stroke" &&
        this.alpha > 0 &&
        App.selected().some((n) => !n.strokeWidth)
      ) {
        for (const n of App.selected()) if (!n.strokeWidth) n.strokeWidth = 1;
        App.render();
        App.persist();
      }
    }
    this.recent = [
      this.hex,
      ...this.recent.filter((c) => c !== this.hex),
    ].slice(0, 10);
    this.close();
    this.sync(App.selected());
  },
  close() {
    this.popup.hidden = true;
    this.anchor?.setAttribute("aria-expanded", "false");
    for (const item of this.previewNodes || []) {
      const n = App.node(item.id),
        target = App.element(item.id);
      if (n && target) {
        App.nodeStyle(target, n);
        if (n.type === "shape") {
          const svg = target.querySelector("svg");
          if (svg) svg.outerHTML = shapeMarkup(n);
        }
        target.classList.toggle(
          "field-underlined",
          n.type === "text" &&
            n.textDecoration === "underline" &&
            n.underlineEnabled !== false,
        );
        target.style.setProperty(
          "--field-underline",
          n.decorationColor || n.color || "#172c35",
        );
      }
    }
    this.previewNodes = null;
    this.anchor?.focus({ preventScroll: true });
  },
};
