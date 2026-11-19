/* Editor schema 6. One scene, one pointer state machine, one renderer.
   All geometry is stored in millimetres. Legacy settings are read only by migration. */
const CONTRACT_FONT = "Sakkal Majalla";
const MM = 96 / 25.4,
  PAGE_NAMES = [
    "العقد",
    "الضمان",
    "التنازل",
    "التخويل",
    "الصيانة",
    "الكفالة",
    "كمبيالات 1–2",
    "كمبيالات 3–4",
  ];
const SHAPES = {
  rect: ["مستطيل", "M3 3H97V97H3Z"],
  round: [
    "مستطيل دائري",
    "M16 3H84Q97 3 97 16V84Q97 97 84 97H16Q3 97 3 84V16Q3 3 16 3Z",
  ],
  ellipse: ["دائرة", "M50 3A47 47 0 1 1 49.99 3Z"],
  triangle: ["مثلث", "M50 3L97 97H3Z"],
  diamond: ["معين", "M50 3L97 50L50 97L3 50Z"],
  arrow: ["سهم", "M3 32H63V8L97 50L63 92V68H3Z"],
  star: ["نجمة", "M50 3L61 36L97 36L68 57L79 94L50 72L21 94L32 57L3 36L39 36Z"],
  hexagon: ["سداسي", "M25 3H75L98 50L75 97H25L2 50Z"],
  callout: ["فقاعة نص", "M3 3H97V74H45L25 97V74H3Z"],
  line: ["خط", "M3 50H97"],
};
const roundMM = (n) => Math.round(n * 100) / 100;
const markupTextTags = new Set([
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "STRIKE",
    "SPAN",
    "BR",
    "DIV",
    "P",
    "FONT",
]);
const markupTableTags = new Set(["TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "COLGROUP", "COL"]);
const preparedMarkup = new Map();
function sanitizeMarkup(value, table) {
  const root = document.createElement("div");
  root.innerHTML = String(value || "");
  for (const el of [...root.querySelectorAll("*")].reverse()) {
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(el.tagName)) {
      el.remove();
      continue;
    }
    if (!markupTextTags.has(el.tagName) && !(table && markupTableTags.has(el.tagName))) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const s = el.style,
      styles = {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        textDecoration: s.textDecoration,
        textDecorationColor: s.textDecorationColor,
        color: s.color,
        backgroundColor: s.backgroundColor,
        textAlign: s.textAlign,
        width: s.width,
        height: s.height,
      };
    if (el.tagName === "FONT") {
      styles.color = el.getAttribute("color") || styles.color;
      styles.fontFamily = el.getAttribute("face") || styles.fontFamily;
    }
    const spans = {
      rowspan: el.getAttribute("rowspan"),
      colspan: el.getAttribute("colspan"),
    };
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
    for (const [k, v] of Object.entries(styles)) if (v) el.style[k] = v;
    for (const [k, v] of Object.entries(spans))
      if (v && ["TD", "TH"].includes(el.tagName))
        el.setAttribute(k, Math.max(1, Math.min(100, Number(v) || 1)));
  }
  return root;
}
function safeMarkup(value, table = false) {
  return sanitizeMarkup(value, table).innerHTML;
}
function renderMarkup(target, value, table = false) {
  const html = String(value || "");
  const substitute = text => text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(ctx[key] ?? ""));
  if (!/[<&\0]/.test(html)) {
    target.textContent = substitute(html);
    return;
  }

  // Cache only sanitized template nodes. Resolved buyer and payment data never enter the cache.
  const canCache = !table && html.length <= 12000;
  let prepared = canCache && preparedMarkup.get(html);
  if (!prepared) {
    prepared = sanitizeMarkup(html, table);
    if (canCache) {
      if (preparedMarkup.size >= 96) preparedMarkup.delete(preparedMarkup.keys().next().value);
      preparedMarkup.set(html, prepared);
    }
  }
  const root = canCache ? prepared.cloneNode(true) : prepared;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.data.includes("{{")) node.data = substitute(node.data);
  }
  const fragment = document.createDocumentFragment();
  while (root.firstChild) fragment.append(root.firstChild);
  target.replaceChildren(fragment);
}
function templateOf(el, config = cfg) {
  return (
    config.edits?.[el.dataset.edit]?.text ??
    config.content?.[el.dataset.edit] ??
    el.dataset.template ??
    el.textContent
  );
}
function shapeMarkup(n) {
  if (n.fillEnabled === false || n.strokeEnabled === false)
    n = {
      ...n,
      fill: n.fillEnabled === false ? "none" : n.fill,
      stroke: n.strokeEnabled === false ? "none" : n.stroke,
    };
  if (n.shape === "rect" || n.shape === "round") {
    const radius = n.radius ?? (n.shape === "round" ? 4 : 0);
    return (
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="0.5" y="0.5" width="99" height="99" rx="' +
      Math.min(49, (radius / (n.w || 60)) * 100) +
      '" ry="' +
      Math.min(49, (radius / (n.h || 40)) * 100) +
      '" fill="' +
      esc(n.fill || "none") +
      '" stroke="' +
      esc(n.stroke || "#287865") +
      '" stroke-width="' +
      (Number(n.strokeWidth) || 0) +
      '" stroke-dasharray="' +
      (n.dash === "dashed" ? "6 4" : n.dash === "dotted" ? "2 3" : "") +
      '" vector-effect="non-scaling-stroke"/></svg>'
    );
  }
  return (
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="' +
    (SHAPES[n.shape]?.[1] || SHAPES.rect[1]) +
    '" fill="' +
    esc(n.shape === "line" ? "none" : n.fill || "none") +
    '" stroke="' +
    esc(n.stroke || "#287865") +
    '" stroke-width="' +
    (Number(n.strokeWidth) || 0) +
    '" stroke-dasharray="' +
    (n.dash === "dashed" ? "6 4" : n.dash === "dotted" ? "2 3" : "") +
    '" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'
  );
}
function tableTemplate(table) {
  const copy = table.cloneNode(true);
  copy
    .querySelectorAll("[data-edit]")
    .forEach(
      (el) =>
        (el.innerHTML =
          cfg.edits[el.dataset.edit]?.rich || esc(templateOf(el))),
    );
  return safeMarkup(copy.outerHTML, true);
}
function migrateLegacy(config) {
  const keep = cfg,
    preview = $("pagePreview").value;
  cfg = config;
  renderTemplate(true);
  document.querySelectorAll(".paper").forEach((p) => {
    p.style.display = "block";
    p.style.zoom = "1";
  });
  document.querySelectorAll(".extra-slot").forEach((el, i) => {
    el.dataset.condition = "extra-" + i;
    el.classList.remove("inactive");
    el.style.visibility = "visible";
  });
  document.querySelectorAll(".block[style*=visibility]").forEach((el) => {
    el.dataset.condition = "agent";
    el.style.visibility = "visible";
  });
  for (const item of config.tables || []) {
    const p = document.querySelector('.paper[data-page="' + item.page + '"]');
    if (p) {
      const t = document.createElement("table");
      t.className = "vehicle-table";
      t.style.cssText = "position:absolute;left:25mm;top:45mm;width:150mm";
      t.innerHTML = safeMarkup(item.html, true);
      p.append(t);
    }
  }
  document.querySelectorAll(".paper [data-edit]").forEach((el) => {
    const o = config.edits[el.dataset.edit] || {},
      cs = getComputedStyle(el),
      line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    el.style.fontSize =
      (o.size ||
        (el.closest(".clauses") ? 15 : parseFloat(cs.fontSize) * 1.4)) + "px";
    el.style.lineHeight =
      (o.lineHeight || (el.closest(".clauses") ? 14 : line)) + "px";
    el.style.transform =
      "translate(" + (Number(o.x) || 0) + "mm," + (Number(o.y) || 0) + "mm)";
    if (o.width) {
      el.style.width = o.width + "mm";
      el.style.flex = "none";
    }
    if (o.height) el.style.height = o.height + "mm";
    if (o.rich) renderMarkup(el, o.rich);
  });
  const scene = { version: 6, pages: [] };
  for (const p of document.querySelectorAll(".paper")) {
    p.querySelectorAll(
      "table,.block,.money-block,.fingerprint,.image-frame,img,.contract-notes",
    ).forEach((el, i) => {
      const old = config.frames?.[p.dataset.page + "-frame-" + i];
      if (old) {
        if (old.style) el.setAttribute("style", old.style);
        if (old.html && el.matches("table")) {
          const tmp = document.createElement("div");
          tmp.innerHTML = old.html;
          tmp
            .querySelectorAll("[data-edit]")
            .forEach((t) => (t.innerHTML = esc(templateOf(t, config))));
          el.innerHTML = safeMarkup(tmp.innerHTML, true);
        }
        if (old.src && el.matches("img")) el.src = safeImage(old.src);
      }
    });
    const rect = p.getBoundingClientRect(),
      pageId = Number(p.dataset.page),
      nodes = [],
      box = (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: roundMM((r.left - rect.left) / MM),
          y: roundMM((r.top - rect.top) / MM),
          w: roundMM(r.width / MM),
          h: roundMM(r.height / MM),
        };
      },
      visible = (el) => {
        const cs = getComputedStyle(el);
        return (
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          el.getBoundingClientRect().width > 0
        );
      };
    const add = (el, type, props = {}) => {
      if (!visible(el)) return;
      const cs = getComputedStyle(el),
        geo = box(el);
      if (geo.h < 0.3) geo.h = 2;
      nodes.push({
        id: el.dataset.edit || "node-" + crypto.randomUUID(),
        type,
        name: el.dataset.edit || props.name || type,
        ...geo,
        z: nodes.length,
        opacity: 1,
        condition: el.closest("[data-condition]")?.dataset.condition || "",
        nowrap: cs.whiteSpace === "nowrap",
        fontFamily: "Sakkal Majalla",
        fontSize: parseFloat(cs.fontSize),
        lineHeight:
          (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4) /
          parseFloat(cs.fontSize),
        color: cs.color,
        align: cs.textAlign,
        weight: cs.fontWeight,
        ...props,
      });
    };
    p.querySelectorAll(
      ".block,.money-block,.fingerprint,.contract-notes,.bill,.bill-field,.words-box",
    ).forEach((el) => {
      const cs = getComputedStyle(el),
        bg = cs.backgroundColor,
        border =
          parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth);
      if ((bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || border)
        add(el, "shape", {
          id: "decoration-" + crypto.randomUUID(),
          name: "إطار",
          shape: "rect",
          fill: bg,
          stroke: cs.borderBottomColor,
          strokeWidth: border,
          radius: parseFloat(cs.borderRadius) / MM,
          z: -50,
        });
    });
    p.querySelectorAll("img").forEach((img) => {
      const header = img.closest(".header-crop"),
        el = header || img;
      const binding =
        img.closest(".header-crop") || img.classList.contains("form-background")
          ? "company"
          : pageId === 2
            ? "receipt"
            : pageId === 5
              ? "maintenance"
              : "";
      add(el, "image", {
        name:
          binding === "company"
            ? "فورمة الشركة"
            : binding === "receipt"
              ? "الضمان"
              : binding === "maintenance"
                ? "صورة الصيانة"
                : "صورة",
        src: safeImage(img.src),
        binding,
        fit: header ? "fill" : getComputedStyle(img).objectFit || "contain",
        cropHeight: header ? 297 : null,
        z: -100,
        lockAspect: true,
      });
    });
    p.querySelectorAll(".image-frame").forEach((el) => {
      if (!el.querySelector("img"))
        add(el, "image", {
          name: pageId === 2 ? "الضمان" : "صورة الصيانة",
          binding: pageId === 2 ? "receipt" : "maintenance",
          src: "",
          fit: "contain",
          z: -100,
          lockAspect: true,
        });
    });
    p.querySelectorAll("table").forEach((t) =>
      add(t, "table", {
        name: "جدول المركبة",
        html: tableTemplate(t),
        fill: "#ffffff",
        stroke: "#aebdc7",
        strokeWidth: 1,
        radius: 2,
        fontSize: 17,
        lineHeight: 1.2,
      }),
    );
    p.querySelectorAll(".clauses li").forEach((li, i) => {
      const head = li.querySelector("b[data-edit]"),
        body = li.querySelector("span[data-edit]");
      if (head && body)
        add(li, "text", {
          name: "البند " + (i + 1),
          clauseNumber: i + 1,
          html:
            '<span style="color:#873638;font-weight:700">' +
            (config.edits[head.dataset.edit]?.rich ||
              esc(templateOf(head, config))) +
            "</span> " +
            (config.edits[body.dataset.edit]?.rich ||
              esc(templateOf(body, config))),
          fontSize: 15,
          lineHeight: 14 / 15,
          z: 10,
          fill: "transparent",
          strokeWidth: 0,
        });
    });
    p.querySelectorAll("[data-edit]").forEach((el) => {
      if (el.closest("table,.clauses")) return;
      const o = config.edits[el.dataset.edit] || {};
      let template = templateOf(el, config);
      const ex = el.dataset.edit.match(
        /^extra-(label|money|words|date)-(\d+)$/,
      );
      if (ex && !o.text)
        template =
          "{{extra" + ex[1][0].toUpperCase() + ex[1].slice(1) + ex[2] + "}}";
      add(el, "text", {
        name:
          o.name ||
          template
            .replace(
              /\{\{(\w+)\}\}/g,
              (_, k) => config.variableLabels?.[k] || k,
            )
            .slice(0, 45),
        html: o.rich
          ? safeMarkup(o.rich)
          : esc(template).replace(/\n/g, "<br>"),
        tokenRich: o.tokenRich || null,
        z: Number(o.z) || 10,
        fill: "transparent",
        strokeWidth: 0,
      });
    });
    for (const o of config.objects || []) {
      if (o.page !== pageId) continue;
      nodes.push({
        id: o.id,
        type: o.type === "image" ? "image" : "shape",
        name: o.name || "عنصر",
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        w: Number(o.width) || 30,
        h: Number(o.height) || 20,
        z: o.z ?? 20,
        opacity: o.opacity ?? 1,
        shape:
          o.shapeKind ||
          (o.type === "round"
            ? "round"
            : o.type === "ellipse"
              ? "ellipse"
              : o.type === "line"
                ? "line"
                : "rect"),
        fill: o.fill || "#d9eee9",
        stroke: o.stroke || "#237e71",
        strokeWidth: o.border ?? 1,
        dash: o.dash || "solid",
        src: o.src || "",
        fit: "contain",
        caption: o.caption || "",
        fontSize: o.captionSize || 18,
        fontFamily: "Sakkal Majalla",
        color: "#163f4b",
        lineHeight: 1.2,
        lockAspect: o.type === "image",
      });
    }
    scene.pages.push({
      id: pageId,
      name:
        PAGE_NAMES[pageId - 1] ||
        (config.extraPages || []).find((p) => p.id === pageId)?.name ||
        "صفحة إضافية",
      nodes,
    });
  }
  cfg = keep;
  $("pagePreview").value = preview;
  return scene;
}
