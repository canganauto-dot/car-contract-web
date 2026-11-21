const UnifiedDirectory = {
  page(scene) {
    if (
      Array.isArray(scene.companySheets) &&
      scene.companySheets.length === 1 &&
      scene.companySheets[0]?.id === 9002
    )
      return scene.companySheets;
    const p = {
      id: 9002,
      name: "دليل الشركة والصيانة",
      paperLayout: 3,
      nodes: [],
    };
    const t = (id, html, x, y, w, h, size = 17, opts = {}) =>
      p.nodes.push({
        id: "guide-" + id,
        name: id,
        type: "text",
        html,
        x,
        y,
        w,
        h,
        fontSize: size,
        fontFamily: CONTRACT_FONT,
        lineHeight: 1,
        align: "center",
        color: "#203e55",
        z: 3,
        ...opts,
      });
    const box = (id, x, y, w, h) =>
      p.nodes.push({
        id: "guide-box-" + id,
        name: id,
        type: "shape",
        shape: "round",
        x,
        y,
        w,
        h,
        radius: 1,
        fill: "transparent",
        stroke: "#a9bac8",
        strokeWidth: 0.6,
        z: 2,
      });
    p.nodes.push({
      id: "guide-map",
      name: "خارطة مائية",
      type: "image",
      src: CompanySheetData.map,
      x: 15,
      y: 63,
      w: 180,
      h: 180,
      fit: "contain",
      opacity: 0.17,
      z: 0,
    });
    t("title", "دليل الشركة ومراكز الصيانة", 12, 9, 186, 11, 29, {
      weight: "700",
    });
    t("hotline", "6881   ·   www.luluatalbakhet.com", 12, 21, 186, 7, 18);
    t("service", "مراكز الصيانة", 12, 31, 186, 7, 21, { weight: "700" });
    const centers = [...DirectorySource.centers];
    if (!centers.some((c) => c.name.includes("الحلة")))
      centers.push({
        name: "الحلة · شركة الرشاد",
        address: "شارع 60 · قرب مجسر الثورة",
        contact: "07830032800 / 07730032800",
      });
    const numbers = new Set(
      centers.flatMap((c) => c.contact.match(/0\d{10}/g) || []),
    );
    centers.forEach((c, i) => {
      const x = 12 + (2 - (i % 3)) * 63,
        y = 40 + Math.floor(i / 3) * 22;
      box("center" + i, x, y, 60, 20);
      t("city" + i, c.name, x + 1, y, 58, 6, 17, { weight: "700" });
      t("address" + i, c.address, x + 1, y + 6, 58, 7, 14, {
      });
      t("phone" + i, c.contact, x + 1, y + 13, 58, 7, 15, {
      });
    });
    const groups = new Map();
    for (const r of DirectorySource.rows) {
      if (numbers.has(r[3])) continue;
      const group = r[0];
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(r);
    }
    let col = 0,
      y = 133;
    for (const [group, rows] of groups) {
      if (y + 8 + rows.length * 7 > 275) {
        col++;
        y = 133;
      }
      const x = col ? 12 : 108;
      t("group" + col + y, group, x, y, 90, 7, 20, {
        weight: "700",
        fill: "#e4ebf0",
      });
      y += 8;
      for (const r of rows) {
        box("row" + col + y, x, y, 90, 7);
        t(
          "entry" + col + y,
          r[1] + " · " + (r[2] === "—" ? "" : r[2] + " · ") + r[3],
          x + 1,
          y,
          88,
          7,
          16,
          {},
        );
        y += 7.3;
      }
      y += 3;
    }
    scene.companySheetsVersion = 3;
    return (scene.companySheets = [p]);
  },
};
