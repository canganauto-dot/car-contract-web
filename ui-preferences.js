const UIPreferences = {
  key: "contract-ui-v1",
  defaults: {version:2, theme:"cloud", fontSize:18},
  // Soul Keyboard presets, in the same display order.
  themes: {
    "pure-white": ["Pure White", "light", "#ffffff", "#ffffff", "#202124", "#62666b", "#d5dae0", "#eceef1"],
    "pure-black": ["Pure Black", "dark", "#000000", "#17191c", "#f4f5f7", "#b1b5bb", "#5b6169", "#171a1f"],
    silver: ["Silver", "light", "#bfc4cb", "#e2e5e9", "#24282d", "#565d65", "#8e99a5", "#c3c8cf"],
    midnight: ["Midnight", "dark", "#101b2d", "#243a56", "#eef5ff", "#a1b8d7", "#91c4ff", "#315b8a"],
    forest: ["Forest", "dark", "#13251e", "#2b493b", "#ecf7ef", "#a6c7b1", "#94d8aa", "#387653"],
    plum: ["Plum", "dark", "#281d32", "#493451", "#faedff", "#cfb1dc", "#ddb5f3", "#805790"],
    cloud: ["Cloud", "light", "#e9eff7", "#ffffff", "#182b45", "#516683", "#598bcb", "#b2c7e5"],
    sand: ["Sand", "light", "#f2ebdd", "#fff9ec", "#403527", "#7e6a50", "#ae7c43", "#d8bd91"],
    graphite: ["Graphite", "dark", "#111214", "#292b2f", "#f1f2f4", "#a5abb5", "#9faaba", "#252a32"],
    "deep-ocean": ["Deep Ocean", "dark", "#081a21", "#16343d", "#e3f5fa", "#95b9c5", "#67c8df", "#174653"],
    ember: ["Ember", "dark", "#211513", "#3c2824", "#fbece5", "#c9a89a", "#e7ac8c", "#57352b"],
    aurora: ["Aurora", "dark", "#101b28", "#304a56", "#ecfff8", "#9cd8cc", "#66e5bc", "#355381"],
    porcelain: ["Porcelain", "light", "#f2f0ea", "#fffefa", "#303f49", "#758691", "#adc8d8", "#d3ddd8"],
    "neon-ink": ["Neon Ink", "dark", "#12101d", "#29223d", "#f6f1ff", "#bea5ea", "#d4ee6a", "#54356f"],
    rose: ["Rose", "light", "#f5e9ef", "#fff7fb", "#492a3b", "#876375", "#b76b94", "#dcaac4"],
  },
  previousThemes: {
    light:"cloud", "light-olive":"porcelain", "light-sand":"sand",
    dark:"midnight", "dark-teal":"deep-ocean", "dark-plum":"plum",
  },
  luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  },
  validate(raw, fallback = this.defaults) {
    let theme = raw?.theme;
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (Object.hasOwn(this.previousThemes, theme)) theme = this.previousThemes[theme];
    if (!Object.hasOwn(this.themes, theme)) theme = fallback.theme;
    let size = raw?.fontSize;
    if (Number.isFinite(size) && raw.version === 1)
      size = (size + 4) * (Number.isFinite(raw.scale) ? raw.scale : 100) / 100;
    const fontSize = Number.isFinite(size) ? Math.max(12, Math.min(26, Math.round(size))) : fallback.fontSize;
    return {version:2, theme, fontSize};
  },
  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key));
      if (saved && (!seed.offline || saved.appearanceId === seed.appearanceId)) return this.validate(saved);
      const old = !seed.offline && localStorage.getItem("contract-theme");
      if (!cfg.design?.uiDefaults && old) return this.validate({theme:old});
    } catch {}
    return {...this.defaults};
  },
  apply(value = this.value) {
    const root = document.documentElement;
    root.style.setProperty("--ui-font", value.fontSize + "px");
    if (root.dataset.palette === value.theme) return;
    const [, mode, background, key, text, secondary, pressed, zone] = this.themes[value.theme];
    root.dataset.palette = value.theme;
    root.dataset.theme = mode;
    const contrastInk = this.luminance(pressed) > 0.179 ? "#000000" : "#ffffff";
    for (const [name, color] of Object.entries({
      surface:key, canvas:background, ink:text, secondary,
      accent:pressed, "accent-ink":contrastInk, zone,
    })) root.style.setProperty("--ui-" + name, color);
  },
  set(key, value) {
    this.value = this.validate({...this.value, [key]:value});
    this.apply();
    try {
      const stored = seed.offline ? {...this.value, appearanceId:seed.appearanceId} : this.value;
      localStorage.setItem(this.key, JSON.stringify(stored));
    } catch {
      $("saveStatus").textContent = "تعذّر حفظ تفضيلات المظهر على هذا الجهاز";
    }
  },
  toggleWorkbench() {
    const workbench = $("workbench");
    workbench.hidden = !workbench.hidden;
    document.body.classList.toggle("workbench-closed", workbench.hidden);
    $("workspaceToggle").setAttribute("aria-expanded", String(!workbench.hidden));
    if (startReady) FillDesigner.apply();
  },
  controls() {
    const grid = document.createElement("div");
    grid.className = "ui-settings-grid";
    const picker = document.createElement("fieldset");
    picker.id = "ui-theme";
    picker.className = "theme-picker";
    const legend = document.createElement("legend");
    legend.textContent = "الثيم";
    const tiles = document.createElement("div");
    tiles.className = "theme-tiles";
    for (const [id, [name, , background, key, text, , , zone]] of Object.entries(this.themes)) {
      const tile = document.createElement("label");
      tile.className = "theme-tile";
      for (const [role, color] of Object.entries({background, key, ink:text, zone}))
        tile.style.setProperty("--tile-" + role, color);
      const choice = document.createElement("input");
      choice.type = "radio";
      choice.name = "ui-theme";
      choice.value = id;
      choice.checked = this.value.theme === id;
      choice.onchange = () => this.set("theme", choice.value);
      const face = document.createElement("span");
      face.className = "theme-tile-face";
      const title = document.createElement("span");
      title.lang = "en";
      title.dir = "ltr";
      title.textContent = name;
      face.append(title);
      tile.append(choice, face);
      tiles.append(tile);
    }
    picker.append(legend, tiles);
    const sizeLabel = document.createElement("label");
    const size = document.createElement("input");
    const output = document.createElement("output");
    size.id = "ui-fontSize";
    size.type = "range";
    size.dir = "ltr";
    size.min = "12";
    size.max = "26";
    size.value = this.value.fontSize;
    output.htmlFor = size.id;
    output.textContent = size.value + " px";
    size.oninput = () => {
      this.set("fontSize", Number(size.value));
      output.textContent = size.value + " px";
    };
    sizeLabel.append("حجم خط الملء", output, size);
    sizeLabel.className = "theme-font-size";
    grid.append(picker, sizeLabel);
    return grid;
  },
  showOfflineAppearance() {
    const dialog = document.createElement("dialog");
    dialog.className = "appearance-dialog app-ui";
    const title = document.createElement("h2");
    title.textContent = "المظهر";
    title.id = "offline-appearance-title";
    dialog.setAttribute("aria-labelledby", title.id);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "إغلاق";
    close.onclick = () => dialog.close();
    dialog.append(title, this.controls(), close);
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    document.body.append(dialog);
    dialog.showModal();
  },
  init() {
    this.defaults = this.validate(cfg.design?.uiDefaults);
    if (seed.offline) this.key = "contract-offline-ui-v1";
    this.value = this.read();
    this.apply();

    const toggle = document.createElement("button");
    toggle.id = "workspaceToggle";
    toggle.title = "إظهار / إخفاء المستندات المفتوحة";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", "true");
    toggle.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m3-11v6"/></svg>';
    toggle.onclick = () => this.toggleWorkbench();
    $("homeButton").after(toggle);
    if (seed.offline && seed.workspaceCollapsed) this.toggleWorkbench();
    $("themeToggle").innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.3-3.5 1 1 0 0 1 .7-1.7h2.5a3.5 3.5 0 0 0 3.5-3.5A9 9 0 0 0 12 3Z"/><path stroke-linecap="round" stroke-width="2.4" d="M7.5 11h.01M10 7.5h.01M14 7.5h.01M17 10.5h.01"/></svg>';
    $("themeToggle").title = "المظهر";
    $("themeToggle").setAttribute("aria-label", "المظهر");
    $("themeToggle").onclick = () => seed.offline ? this.showOfflineAppearance() : Workspace.open("appearance");

    if (!seed.offline) {
      const tab = document.createElement("button");
      tab.id = "tab-appearance";
      tab.dataset.settingsTab = "appearance";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "appearanceSettings");
      tab.textContent = "المظهر";
      $("tab-device").after(tab);
      const panel = document.createElement("section");
      panel.id = "appearanceSettings";
      panel.dataset.settingsPanel = "appearance";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.hidden = true;
      panel.append(this.controls());
      $("settingsContent").append(panel);
      tab.onclick = () => Workspace.tab("appearance");
    }
    // Mark UI islands explicitly; the preview/print document tree is never an island.
    for (const selector of [
      "#toolbar",
      "#fillPanel",
      "#editorPanel",
      "#workbench",
      "#homeScreen",
      "#settingsDrawer",
      "#pageRail",
      ".preview-controls",
      "#boxColorPalette",
      ".app-menu",
      "#shapePicker",
      "#tokenSuggestions",
      "#menu",
    ])
      document
        .querySelectorAll(selector)
        .forEach((n) => n.classList.add("app-ui"));
    const markDialogs = () =>
      document.querySelectorAll("dialog:not(.app-ui)").forEach((n) => {
        n.classList.add("app-ui");
        const h = n.querySelector("h2,h3");
        if (h) {
          h.id ||= "dialog-title-" + crypto.randomUUID();
          n.setAttribute("aria-labelledby", h.id);
        }
        n.querySelectorAll("button").forEach((b) => {
          if (!b.getAttribute("aria-label") && b.title)
            b.setAttribute("aria-label", b.title);
        });
      });
    new MutationObserver(markDialogs).observe(document.body, {
      childList: true,
    });
    markDialogs();
    const drawer = $("settingsDrawer");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "الإعدادات");
    drawer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        $("closeSettings").click();
      }
      if (e.key !== "Tab") return;
      const controls = [
        ...drawer.querySelectorAll(
          'button,input,select,textarea,[tabindex="0"]',
        ),
      ].filter((n) => !n.disabled && n.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    });
    new MutationObserver(() => {
      if (drawer.hidden) {
        this.settingsOpener?.focus({preventScroll:true});
      } else {
        this.settingsOpener = document.activeElement;
        $("closeSettings").focus();
      }
    }).observe(drawer, {attributes:true, attributeFilter:["hidden"]});
  },
};
