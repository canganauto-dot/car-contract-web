const Letters = {
  pages(scene, pages, book=d.standaloneBook) {
    if (!book) return pages.filter((p) => p.id < 12000);
    const id = Number(book);
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
        fontFamily: CONTRACT_FONT,
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
