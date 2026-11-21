// Rich document text: sanitize the stored template, then resolve values without interpreting them as HTML.
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
        fontSize: EditorSettings.inlineFontSize(s.fontSize),
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        textDecoration: s.textDecoration || s.textDecorationLine,
        textDecorationColor: s.textDecorationColor,
        color: s.color,
        backgroundColor: s.backgroundColor,
        textAlign: s.textAlign,
        width: table && markupTableTags.has(el.tagName) ? s.width : "",
        height: table && markupTableTags.has(el.tagName) ? s.height : "",
      };
    if (el.tagName === "FONT") {
      styles.color = el.getAttribute("color") || styles.color;
      const legacySizes = {1:10, 2:13, 3:16, 4:18, 5:24, 6:32, 7:48};
      const oldSize = legacySizes[el.getAttribute("size")];
      if (!styles.fontSize && oldSize) styles.fontSize = oldSize + "px";
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
// Inline formatting may split a variable name across spans. Resolve complete names
// within a paragraph or cell, never across a deliberate line or table boundary.
function forEachTextBlock(root, process) {
  let nodes = [], length = 0;
  function flush() {
    if (!nodes.length) return;
    process(nodes.map(part => part.node.data).join(""),nodes);
    nodes=[];length=0;
  }
  function visit(parent) {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.length) { nodes.push({node, start: length}); length += node.length; }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const boundary = ["BR", "DIV", "P", "TD", "TH", "TR"].includes(node.tagName);
        if (boundary) flush();
        visit(node);
        if (boundary) flush();
      }
    }
  }
  visit(root);
  flush();
}
function resolveRichVariables(root, values) {
  forEachTextBlock(root,(text,nodes)=>{
    const matches = [...text.matchAll(/\{\{(\w+)\}\}/g)];
    let index = nodes.length - 1;
    for (const match of matches.reverse()) {
      const start = match.index, end = start + match[0].length;
      while (index > 0 && nodes[index].start >= end) index--;
      for (let i = index; i >= 0; i--) {
        const part = nodes[i], offset = start - part.start;
        const tail = part.node.data.slice(Math.max(0, end - part.start));
        if (offset >= 0) {
          part.node.data = part.node.data.slice(0, offset) + String(values[match[1]] ?? "") + tail;
          index = i;
          break;
        }
        part.node.data = tail;
      }
    }
  });
}
function documentTextContent(node, values) {
  const content = document.createElement("div");
  content.className = "node-content";
  const rich = node.tokenRich;
  if (!rich?.token || !Array.isArray(rich.runs) || !rich.runs.length) {
    let html=node.html || (rich?.token ? "{{" + rich.token + "}}" : "");
    if(node.id==="installmentIntro" && /^\s*\{\{count\}\}\s*$/.test(html))html="{{scheduleIntro}}";
    html=html.replace(/(?:تدفع\s+)?\{\{scheduleIntro\}\}(?:\s+كما يلي\s*[:：]?)?/g,"{{scheduleIntro}}");
    renderMarkup(content, html, false, values);
    emphasizePaperValues(content,node);
    return content;
  }
  const value = String(values[rich.token] ?? "");
  let at = 0;
  for (const [i, run] of rich.runs.entries()) {
    const span = document.createElement("span");
    const count = Math.max(0, Math.trunc(Number(run?.length)) || 0);
    const end = i === rich.runs.length - 1 ? value.length : Math.min(at + count, value.length);
    span.textContent = value.slice(at, end);
    for (const key of ["fontSize", "fontWeight", "fontStyle", "textDecoration", "textDecorationColor", "color", "backgroundColor"]) {
      const style = run?.style?.[key];
      if (style) span.style[key] = key === "fontSize" ? EditorSettings.inlineFontSize(style) : style;
    }
    content.append(span);
    at = end;
  }
  emphasizePaperValues(content,node);
  return content;
}
// Work on resolved text ranges so a saved rich-text span cannot split a semantic value.
function mapPaperRanges(root, pattern, replacement) {
  const ranges=[];
  forEachTextBlock(root,(text,parts)=>{
    for(const match of text.matchAll(pattern)){
      const start=match.index, end=start+match[0].length;
      const first=parts.find(p=>p.start+p.node.length>start);
      const last=parts.find(p=>p.start+p.node.length>=end);
      const value=replacement(match);
      if(value!==null)ranges.push({first,last,start,end,value});
    }
  });
  for(const {first,last,start,end,value} of ranges.reverse()){
    const range=document.createRange();
    range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);
    range.deleteContents();range.insertNode(value);
  }
}
function emphasizePaperValues(content,node) {
  if(!/scheduleIntro|warrantyText|warrantyYears|installmentIntro/.test((node.html || "")+" "+(node.tokenRich?.token || "")+" "+node.id))return;
  const span=text=>{
    const value=document.createElement("span");
    value.style.cssText="color:#b31824;font-weight:700;font-size:"+EditorSettings.display("fontSize",node.fontSize)*1.25+"px";
    value.textContent=text;
    return value;
  };
  mapPaperRanges(content,/(?<=عددها\s*\(\s*)[\d٠-٩۰-۹]+(?=\s*\))|[\d٠-٩۰-۹]+(?=\s*(?:سنوات|سنين|سنة))/gu,m=>span(m[0]));
}
// Isolate each numeric component so the day is read first from the right,
// even inside an LTR cell or next to Latin chassis identifiers.
function arabicPaperDates(root) {
  if(!/[\/.\-]/.test(root.textContent))return;
  mapPaperRanges(root,/(?<![\d٠-٩۰-۹])(?:([\d٠-٩۰-۹]{4})[-/.]([\d٠-٩۰-۹]{1,2})[-/.]([\d٠-٩۰-۹]{1,2})|([\d٠-٩۰-۹]{1,2})[-/.]([\d٠-٩۰-۹]{1,2})[-/.]([\d٠-٩۰-۹]{4}))(?![\d٠-٩۰-۹])/gu,
      ([original,year,month,day,d,m,y])=>{
        const parts=[day || d,month || m,year || y].map(normalizeDigits);
        if(!calendarDateParts(parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0")))return null;
        return document.createTextNode("\u2067"+parts.map(s=>"\u2066"+s.padStart(2,"0").replace(/\d/g,n=>"٠١٢٣٤٥٦٧٨٩"[n])+"\u2069").join("\u200f/\u200f")+"\u2069");
      });
}
function renderMarkup(target, value, table = false, values = ctx) {
  const html = String(value || "");
  const substitute = text => text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ""));
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
  if (root.textContent.includes("{{")) resolveRichVariables(root, values);
  const fragment = document.createDocumentFragment();
  while (root.firstChild) fragment.append(root.firstChild);
  target.replaceChildren(fragment);
}

// The fill form reads the same variable names the page renderer substitutes.
function documentVariables(page) {
  const keys = new Set();
  for (const node of page?.nodes || []) {
    if (node.tokenRich?.token) keys.add(node.tokenRich.token);
    const html = String(node.html || "");
    if (!html.includes("{") && !html.includes("&#")) continue;
    const collect=text=>{for(const match of text.matchAll(/\{\{(\w+)\}\}/g))keys.add(match[1]);};
    if(/[<&]/.test(html))forEachTextBlock(sanitizeMarkup(html,node.type==="table"),collect);
    else collect(html);
  }
  return keys;
}
