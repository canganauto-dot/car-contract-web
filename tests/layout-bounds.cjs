async function overflowingText(papers) {
  return papers.evaluateAll(pages => pages.flatMap(paper =>
    [...paper.querySelectorAll(".scene-node[data-type=text] > .node-content")].flatMap(content => {
      const node = content.parentElement;
      if (!content.textContent.trim() || !node.getClientRects().length) return [];
      // A Range includes the font's ascent and descent, even outside a valid line box.
      const probe = content.cloneNode(true);
      Object.assign(probe.style, { position: "absolute", visibility: "hidden",
        width: getComputedStyle(content).width, height: "auto" });
      node.append(probe);
      const overflow = probe.getBoundingClientRect().height > node.getBoundingClientRect().height + 2;
      probe.remove();
      return overflow ? [node.dataset.node] : [];
    }),
  ));
}

module.exports = overflowingText;
