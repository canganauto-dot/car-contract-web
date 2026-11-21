/* Two detachable notes per A4 page. All frames, guides and text are ordinary
   editable scene nodes. Keep existing field IDs, bindings and rich text. */
function arrangeBillPages(scene) {
  if (scene.billLayoutVersion >= 2) return;
  arrangeBillFrames(scene);
  const firstPage = scene.pages.find((page) => page.id === 7);
  const secondPage = scene.pages.find((page) => page.id === 8);
  const halfHeight = 148.5;
  function noteIndex(node, page) {
    const standard = /^modern-bill-([0-3])-/.exec(node.id);
    if (standard) return Number(standard[1]);
    // A page-wide background or a guide spanning the cut belongs to the sheet.
    if (node.y < halfHeight && node.y + node.h > halfHeight) return null;
    return (page.id - 7) * 2 + Number(node.y >= halfHeight);
  }
  if (firstPage) {
    const master = firstPage.nodes.filter(
      (node) => noteIndex(node, firstPage) === 0,
    );
    function copyNote(index) {
      const copies = clone(master);
      for (const node of copies) {
        const key = node.id.replace(/^modern-bill-0-/, "");
        node.id = "modern-bill-" + index + "-" + key;
        node.y += (index % 2) * halfHeight;
        for (const prop of ["html", "caption", "name"]) {
          if (typeof node[prop] === "string")
            node[prop] = node[prop].replace(
              /\{\{(bill(?:Words)?)0\}\}/g,
              (_, stem) => "{{" + stem + index + "}}",
            );
        }
        if (typeof node.tokenRich?.token === "string")
          node.tokenRich.token = node.tokenRich.token.replace(
            /^(bill(?:Words)?)0$/,
            (_, stem) => stem + index,
          );
      }
      return copies;
    }
    firstPage.nodes = firstPage.nodes.filter(
      (node) => noteIndex(node, firstPage) !== 1,
    );
    firstPage.nodes.push(...copyNote(1));
    if (secondPage) {
      secondPage.nodes = secondPage.nodes.filter(
        (node) => noteIndex(node, secondPage) === null,
      );
      secondPage.nodes.push(...copyNote(2), ...copyNote(3));
    }
  }
  scene.billLayoutVersion = 2;
}

function arrangeBillFrames(scene) {
  if (scene.billLayoutVersion >= 1) return;
  for (const page of scene.pages) {
    if (![7, 8].includes(page.id)) continue;
    const fields = new Map(page.nodes.map((n) => [n.id, n]));
    for (let half = 0; half < 2; half++) {
      const prefix = "modern-bill-" + ((page.id - 7) * 2 + half) + "-";
      if (!page.nodes.some((n) => n.id.startsWith(prefix))) continue;
      const top = 7 + half * 148.5;
      // Only remove the automatically traced outlines of the old note.
      const oldStrokes = [
        "rgb(174, 189, 199)",
        "rgb(209, 220, 225)",
        "rgb(155, 171, 181)",
      ];
      page.nodes = page.nodes.filter(
        (n) =>
          !(
            n.type === "shape" &&
            n.id.startsWith("decoration-") &&
            n.name === "إطار" &&
            n.z === -50 &&
            oldStrokes.includes(n.stroke) &&
            (n.y < 148.5 ? 0 : 1) === half
          ),
      );
      const teal = "#285760",
        ink = "#182d35",
        muted = "#455f66";
      function shape(key, name, x, y, w, h, line = false, fill = "none") {
        page.nodes.push({
          id: prefix + key,
          name,
          type: "shape",
          shape: line ? "line" : "round",
          x,
          y: top + y,
          w,
          h,
          z: line ? -35 : -40,
          opacity: 1,
          radius: line ? 0 : 2.5,
          stroke: line ? "#7d9599" : "#647f85",
          strokeWidth: line ? 0.85 : 1.15,
          fill,
        });
      }
      function text(key, x, y, w, h, fontSize, options = {}) {
        const n = fields.get(prefix + key);
        if (!n) return; // Respect previously removed fields.
        Object.assign(n, {
          x,
          y: top + y,
          w,
          h,
          fontSize,
          lineHeight: 1.12,
          align: "right",
          direction: "rtl",
          weight: "400",
          color: ink,

          ...options,
        });
      }
      const caption = { color: muted, weight: "700" };
      const numeric = { direction: "ltr" };
      function field(key, x, y, w, h, size = 19, options = {}) {
        text(key + "-label", x, y, w, 5, 15, caption);
        text(key, x, y + 5, w, h, size, options);
      }
      shape(
        "heading-frame",
        "إطار عنوان الكمبيالة وتواريخها",
        10,
        0,
        190,
        17,
        false,
        "#f4f8f8",
      );
      text("title", 155, 3.1, 39, 11, 31, { weight: "700", color: teal });
      field("due", 109, 2.4, 38, 7, 18);
      field("place", 61, 2.4, 41, 8, 19);
      field("date", 16, 2.4, 37, 7, 19, numeric);

      shape("money-frame", "إطار المبلغ", 10, 19, 190, 20);
      field("amount", 146, 21, 48, 10, 25, {
        ...numeric,
        weight: "700",
        color: teal,
      });
      field("words", 16, 21, 123, 12, 20);

      shape("terms-frame", "إطار نص التعهد", 10, 41, 190, 36);
      text("promise", 16, 43.2, 178, 11.6, 18);
      text("order", 16, 55.1, 178, 12.1, 18, { weight: "700" });
      text("received", 16, 68.8, 178, 6.5, 18);

      shape("customer-frame", "إطار الزبون والتوقيع والبصمة", 65, 79, 135, 55);
      shape("witness-frame", "إطار الشاهدين", 10, 79, 52, 55);
      // Replace only the old dotted placeholders with writable ruled spaces.
      for (const [key, label] of [
        ["signature", "التوقيع"],
        ["witness1", "الشاهد الأول"],
        ["witness2", "الشاهد الثاني"],
      ]) {
        const n = fields.get(prefix + key);
        if (n?.html === label + "<br>........................") n.html = label;
      }
      text("signature", 120, 81, 74, 7, 19, caption);
      shape("signature-line", "سطر توقيع الزبون", 120, 100, 74, 1, true);
      text("thumb", 71, 81, 43, 6, 17, { ...caption, align: "center" });
      shape("thumb-box", "مساحة بصمة الإبهام", 81, 86.5, 23, 19);
      field("name", 120, 106, 74, 8, 20);
      field("id", 71, 106, 43, 8, 19, numeric);
      field("id-place", 71, 120, 78, 8, 18);
      field("id-date", 154, 120, 40, 8, 18, numeric);

      for (const [key, y] of [
        ["witness1", 82],
        ["witness2", 109],
      ]) {
        text(key, 15, y, 42, 7, 19, { ...caption, align: "center" });
        shape(key + "-line", "سطر توقيع الشاهد", 16, y + 18, 40, 1, true);
      }
    }
  }
  scene.billLayoutVersion = 1;
}
