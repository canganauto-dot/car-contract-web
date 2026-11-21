// Numeric domains shared by the property panel, mouse gestures and document output.
const EditorSettings = {
  paper: { w: 210, h: 297 },
  text: {
    fontSize: { min: 6, max: 96, step: 0.5, initial: 17 },
    lineHeight: { min: 0.8, max: 3, step: 0.05, initial: 1.2 },
    strokeWidth: { min: 0, max: 20, step: 0.5, initial: 0 },
    underlineWidth: { min: 0.25, max: 20, step: 0.25, initial: 1 },
    radius: { min: 0, max: 100, step: 0.5, initial: 0 },
    opacity: { min: 0, max: 1, step: 0.05, initial: 1 },
  },
  fill: {
    titleSize: { min: 8, max: 60 }, fontSize: { min: 8, max: 80 },
    buttonWidth: { min: 8, max: 1200 }, buttonHeight: { min: 8, max: 600 },
    wUnits: { min: 1, max: 6 }, hUnits: { min: 1, max: 3 },
    layer: { min: 1, max: 1000 },
  },
  number(value, range) {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(range.min, Math.min(range.max, numeric)) : null;
  },
  display(key, value) {
    const rule = this.text[key];
    return this.number(value, rule) ?? rule.initial;
  },
  inlineFontSize(value) {
    const rule = this.text.fontSize;
    const input = String(value ?? "").trim().toLowerCase();
    const inner = input.replace(/^clamp\(6px,\s*([\d.]+(?:em|rem|%)),\s*96px\)$/, "$1");
    const match = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|em|rem|%)?$/.exec(inner);
    if (!match) return "";
    const [, amount, unit = "px"] = match;
    if (unit === "px" || unit === "pt") {
      return this.number(Number(amount) * (unit === "pt" ? 96 / 72 : 1), rule) + "px";
    }
    return `clamp(${rule.min}px, ${amount}${unit}, ${rule.max}px)`;
  },
  input(input, range) {
    input.min = range.min;
    input.max = range.max;
    input.step = range.step ?? 1;
  },
  // A group scales proportionally. Its smallest member must keep at least 1 mm.
  geometry(box, nodes, handle = "se", locked = nodes.length === 1 && nodes[0].lockAspect) {
    const west = handle.includes("w"), north = handle.includes("n");
    let maxW = west ? box.x + box.w : this.paper.w - box.x;
    let maxH = north ? box.y + box.h : this.paper.h - box.y;
    let minW = box.w / Math.max(0.001, Math.min(...nodes.map(n => n.w)));
    let minH = box.h / Math.max(0.001, Math.min(...nodes.map(n => n.h)));
    if (locked && box.w > 0 && box.h > 0) {
      const ratio = box.w / box.h;
      minW = Math.max(minW, minH * ratio);
      minH = minW / ratio;
      maxW = Math.min(maxW, maxH * ratio);
      maxH = maxW / ratio;
    }
    const length = (min, max) => ({
      min: Math.min(Math.max(0, max), min), max: Math.max(0, max), step: "any",
    });
    return {
      x: length(0, this.paper.w - box.w), y: length(0, this.paper.h - box.h),
      w: length(minW, maxW), h: length(minH, maxH),
    };
  },
};
