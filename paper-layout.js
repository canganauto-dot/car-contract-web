const PaperLayout = {
  companyLines(company) {
    const full = (company.fullName || "شركة " + company.name).trim();
    const first = full.match(/^(.*?)(?=\s+للتجارة|\s+للوكالات|\s+لتجارة)/);
    const last = full.match(
      /\s+(محدودة المسؤولية|ذات المسؤولية المحدودة|المحدودة)$/,
    );
    if (first && last) {
      const middle = full.slice(first[0].length, last.index).trim();
      if (middle) return [first[0], middle, last[1]];
    }
    const words = full.split(/\s+/);
    const lines = [];
    for (let i = 3; i > 0; i--) {
      const count = Math.ceil(words.length / i);
      lines.push(words.splice(0, count).join(" "));
    }
    return lines;
  },
  header(page, y = 0, compact = false) {
    const prefix = "hdr-" + (page === 0 ? "transfer" : page) + "-" + y + "-";
    const part = (key, props) => ({
      id: prefix + key,
      paperHeader: true,
      z: 2,
      ...props,
    });
    const height = compact ? 13 : 22;
    return [
      part("portrait", {
        type: "image",
        name: "صورة الزبون في الهيدر",
        binding: "customer",
        x: 12,
        y: y + 2,
        w: compact ? 13 : 20,
        h: height,
        fit: "contain",
        hideEmpty: true,
      }),
      part("logo", {
        type: "image",
        name: "شعار الشركة في الهيدر",
        binding: "companySlot",
        slot: "headerLogo",
        x: 80,
        y: y + 2,
        w: 50,
        h: height,
        fit: "contain",
        hideEmpty: true,
      }),
      ...[0, 1, 2].map((i) =>
        part("name-" + i, {
          type: "text",
          name: "اسم الشركة · سطر " + (i + 1),
          html: "{{headerCompany" + i + "}}",
          x: 135,
          y: y + (compact ? 1.4 : 3) + i * (compact ? 4.3 : 6.4),
          w: 65,
          h: compact ? 4.6 : 6.7,
          fontFamily: "Amiri",
          fontSize: compact ? 15 : 21,
          weight: "700",
          lineHeight: 1,
          align: "center",
          color: "#19394e",
        }),
      ),
    ];
  },
  apply(p) {
    if (!p.nodes || p.paperLayout === 3) return;
    this.previous(p);
    for (const n of p.nodes) {
      delete n.headerCut;
      if (n.binding === "company" && n.y < 2 && n.w > 195) {
        if (p.id === 1 && n.cropHeight) n.firstFormHeader = true;
        continue;
      }
      if (n.marginVersion) continue;
      // The artwork may bleed to the sheet edge. All editable content stays inside.
      const left = Math.max(12, n.x),
        right = Math.min(198, n.x + n.w);
      if (right > left) {
        n.x = roundMM(left);
        n.w = roundMM(right - left);
      }
      if (n.h < 270)
        n.y = roundMM(
          Math.max(n.paperHeader ? 5 : 8, Math.min(n.y, 289 - n.h)),
        );
      n.marginVersion = 1;
    }
    if (p.id === 1) this.alignFace(p);
    p.paperLayout = 3;
  },
  alignFace(p) {
    const prefix = p.nodes.some((n) => n.id === "cash-title") ? "cash-" : "";
    const bands = ["seller", "buyer", "car", "payment"]
      .map((key) => p.nodes.find((n) => n.id === prefix + "section-bg-" + key))
      .filter(Boolean);
    for (const [i, b] of bands.entries()) {
      const next = bands[i + 1];
      b.x = 106;
      b.w = 92;
      if (next && next.y > b.y) b.h = roundMM(Math.min(b.h, next.y - b.y - 2));
    }
    const notes = p.nodes.find((n) => n.id === prefix + "section-bg-notes");
    if (notes) {
      notes.x = 12;
      notes.w = 186;
    }
    const clauses = p.nodes
      .filter((n) => n.clauseNumber || /^البند \d+$/.test(n.name))
      .sort((a, b) => a.y - b.y);
    if (!clauses.length) return;
    let title = p.nodes.find(
      (n) =>
        n.type === "text" &&
        (n.html || "")
          .replace(/<[^>]*>/g, "")
          .trim()
          .replace(/[:：]/g, "") === "بنود العقد",
    );
    if (!title) {
      title = {
        id: prefix + "clause-heading",
        type: "text",
        name: "عنوان بنود العقد",
        html: "بنود العقد",
        z: 11,
        fontFamily: "Amiri",
        fontSize: 20,
        weight: "700",
        lineHeight: 1,
      };
      p.nodes.push(title);
    }
    Object.assign(title, { x: 12, y: 45, w: 86, h: 6.5, align: "center" });
    const ruler = document.createElement("article");
    ruler.className = "paper";
    ruler.style.cssText =
      "position:fixed;left:-400vw;top:0;visibility:hidden;display:block;zoom:1";
    document.body.append(ruler);
    try {
      const sizes = clauses.map((n) => n.fontSize || 15);
      const bottom =
        (p.nodes.find((n) => n.id === prefix + "warranty")?.y || 228) - 3;
      let y;
      for (let pass = 0; pass < 8; pass++) {
        y = 53;
        ruler.replaceChildren();
        for (const [i, n] of clauses.entries()) {
          Object.assign(n, {
            x: 12,
            w: 86,
            y,
            fontSize: n.manualFontSize ? sizes[i] : sizes[i] * (1 - pass * 0.035),
          });
          const el = App.renderNode(n),
            content = el.firstElementChild;
          content.style.height = "auto";
          ruler.append(el);
          n.h = roundMM(content.getBoundingClientRect().height / MM);
          y += n.h + 0.75;
        }
        if (y <= bottom) break;
      }
    } finally {
      ruler.remove();
    }
  },
  previous(p) {
    if (p.paperLayout === 2 || !p.nodes) return;
    const previous = p.paperLayout === 1;
    if (p.id !== 1) {
      TransferLetter.cards(p);
      p.nodes = p.nodes.filter((n) => !n.paperHeader);
      // Keep the letter stationery and footer, suppress the printed branding in its top strip.
      for (const n of p.nodes) {
        if (n.binding === "company" && n.y < 2 && n.w > 195) n.headerCut = 28;
        if (previous && [7, 8].includes(p.id)) {
          const half = n.y < 148.5 ? 0 : 148.5;
          if (n.h <= 148.5 && n.y + n.h <= half + 148.5) {
            n.y = roundMM(half + 7 + (n.y - half - 18) / 0.925);
            n.h = roundMM(n.h / 0.925);
            if (n.fontSize) n.fontSize = roundMM(n.fontSize / 0.925);
          }
        }
        if (
          previous &&
          [2, 5].includes(p.id) &&
          ["receipt", "maintenance"].includes(n.binding)
        )
          Object.assign(n, { x: 8, y: 8, w: 194, h: p.id === 2 ? 238 : 281 });
      }
      p.paperLayout = 2;
      return;
    }
    if (previous) {
      this.contractFace(p);
      p.paperLayout = 2;
      return;
    }
    for (const n of p.nodes) {
      if (n.type === "image" && n.binding === "company" && n.y < 2 && n.w > 195)
        n.headerCut = 28;
    }
    const clauses = p.nodes
      .filter((n) => n.clauseNumber || /^البند \d+$/.test(n.name))
      .sort((a, b) => a.y - b.y);
    const warranty = p.nodes.find(
      (n) => n.id === "warranty" || n.id === "cash-warranty",
    );
    if (clauses.length > 1 && warranty) {
      const last = clauses[clauses.length - 1];
      const extra = Math.min(
        3,
        Math.max(0, (warranty.y - 9 - last.y - last.h) / (clauses.length - 1)),
      );
      clauses.forEach((n, i) => (n.y = roundMM(n.y + i * extra)));
    }
    p.nodes.push(
      ...this.header(p.id === 1 && p.name === "عقد الكاش" ? "cash" : p.id),
    );
    this.contractFace(p);
    p.paperLayout = 2;
  },
  contractFace(p) {
    const cash = p.nodes.some((n) => n.id === "cash-title");
    const prefix = cash ? "cash-" : "";
    const id = (n) => n.id.slice(prefix.length);
    // Replace only the generated decorations. Preserve the fingerprint and user-created shapes.
    p.nodes = p.nodes.filter(
      (n) =>
        !id(n).startsWith("section-bg-") &&
        !(id(n).startsWith("decoration-") && n.y < 264) &&
        !(cash && (n.id === "cash-clause-1" || n.id === "cash-agreement")),
    );
    const regions = [
      [
        "seller",
        "الطرف الأول",
        /^(seller-intro|(?:value|label)-(?:sellerAddress|sellerPhone|agent|agencyNo|agencyDate|agencyFrom))$/,
      ],
      [
        "buyer",
        "الطرف الثاني",
        /^(?:value|label)-(?:buyer.*|district|street|house)$/,
      ],
      [
        "car",
        "المركبة",
        /^(?:value|label)-(?:car|color|model|plate|mileage|vin)$/,
      ],
      [
        "payment",
        "الدفع",
        /^(?:total.*|deposit.*|extra-.*|payment.*|last.*|balance.*|paid-label|status|installment.*)$/,
      ],
      ["notes", "الملاحظة", /^notes$/],
    ];
    for (const [key, name, match] of regions) {
      const items = p.nodes.filter(
        (n) => n.type === "text" && match.test(id(n)),
      );
      if (!items.length) continue;
      const x = Math.min(...items.map((n) => n.x)) - 1.3,
        y = Math.min(...items.map((n) => n.y)) - 0.8;
      const right = Math.max(...items.map((n) => n.x + n.w)) + 1.3,
        bottom = Math.max(...items.map((n) => n.y + n.h)) + 0.8;
      p.nodes.push({
        id: prefix + "section-bg-" + key,
        name: "خلفية " + name,
        type: "shape",
        shape: "round",
        x,
        y,
        w: right - x,
        h: bottom - y,
        z: -45,
        radius: 1.4,
        fill: "#f0f1f2",
        strokeWidth: 0,
      });
    }
    const meta = p.nodes.find((n) => id(n) === "meta-number");
    if (meta)
      Object.assign(meta, {
        x: 8,
        w: 107,
        align: "right",
        nowrap: true,
        html: "العدد: \u2066{{number}}\u2069    التاريخ: \u2066{{date}}\u2069    الساعة: \u2066{{contractTime}}\u2069",
      });
    if (cash) {
      const clauses = p.nodes
        .filter((n) => n.clauseNumber)
        .sort((a, b) => a.y - b.y);
      const dy = clauses.length ? clauses[0].y - 45 : 0;
      for (const n of clauses) {
        n.y = roundMM(n.y - dy);
        n.clauseDash = true;
      }
    }
  },
};
