// Shape and rasterize document text with one bundled CPU renderer and one font.
// Native text remains available for accessibility, copying and the editing caret.
const DocumentInk = {
  cache:new Map(), bytes:0,
  async init() {
    const prefix="assets/vendor/canvaskit.";
    const binary=seed.offline && globalThis.contractPack?.[prefix+"wasm"];
    if(seed.offline && (!binary || !globalThis.contractPack?.[prefix+"js"]))throw Error("ملف الأوفلاين ينقصه محرّك الرسم. نزّل نسخة HTML جديدة من زر التنزيل في الموقع.");
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=WebResources.url(prefix+"js");script.onload=resolve;script.onerror=reject;
      document.head.append(script);
    });
    const options={locateFile:()=>WebResources.url(prefix+"wasm")};
    if(binary){
      const encoded=binary.slice(binary.indexOf(",")+1);
      if(Uint8Array.fromBase64)options.wasmBinary=Uint8Array.fromBase64(encoded);
      else{
        const raw=atob(encoded),bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        options.wasmBinary=bytes;
      }
    }
    const k=await CanvasKitInit(options);
    const face=Array.from($("contractFontStyles").sheet.cssRules).find(rule=>rule.style?.getPropertyValue("src"));
    const encoded=face.style.getPropertyValue("src").match(/base64,([\w+/=]+)/)[1];
    this.fonts=k.TypefaceFontProvider.Make();
    this.fonts.registerFont(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),"Alyamama");
    this.k=k;
  },
  runs(element,base) {
    const runs=[];
    const add=(text,style)=>{if(text)runs.push({text,style});};
    const walk=(el,parent)=>{
      if(el.nodeType===Node.TEXT_NODE){add(el.data,parent);return;}
      if(el.tagName==="BR"){add("\n",parent);return;}
      const block=el!==element && ["DIV","P"].includes(el.tagName);
      if(block && runs.length && !runs.at(-1).text.endsWith("\n"))add("\n",parent);
      const css=el.style, style={...parent};
      if(css.fontSize){
        const m=css.fontSize.match(/([\d.]+)(em|%|px)/g);
        const unit=m?.[css.fontSize.startsWith("clamp(")?1:0];
        if(unit)style.size=unit.endsWith("px") ? parseFloat(unit) : parseFloat(unit)*parent.size/(unit.endsWith("%")?100:1);
      }
      if(css.color)style.color=css.color;
      if(el!==element && css.backgroundColor)style.bg=css.backgroundColor;
      if(["B","STRONG"].includes(el.tagName))style.weight="700";
      if(css.fontWeight && css.fontWeight!=="inherit")style.weight=css.fontWeight;
      if(["I","EM"].includes(el.tagName) || css.fontStyle)style.italic=(css.fontStyle || "italic")!=="normal";
      if(el.tagName==="U" || css.textDecorationLine.includes("underline"))style.underline=true;
      if(["S","STRIKE"].includes(el.tagName) || css.textDecorationLine.includes("line-through"))style.strike=true;
      if(css.textDecorationColor)style.decorationColor=css.textDecorationColor;
      for(const child of el.childNodes)walk(child,style);
      if(block && el.nextSibling && !runs.at(-1)?.text.endsWith("\n"))add("\n",style);
    };
    walk(element,base);
    return runs;
  },
  raster(runs,width,lineHeight,align,rtl) {
    const cacheKey=JSON.stringify([width,lineHeight,align,rtl,runs]);
    const hit=this.cache.get(cacheKey);
    if(hit){this.cache.delete(cacheKey);this.cache.set(cacheKey,hit);return hit;}
    const k=this.k, toStyle=s=>({
      fontFamilies:["Alyamama"], fontSize:s.size*.8, heightMultiplier:lineHeight/.8,halfLeading:true,
      fontStyle:{weight:s.weight==="bold" || Number(s.weight)>=600?k.FontWeight.Bold:k.FontWeight.Normal,
        slant:s.italic?k.FontSlant.Italic:k.FontSlant.Upright},
      fontVariations:[{axis:"wght",value:s.weight==="bold"?700:Number(s.weight)||400}],
      color:k.parseColorString(s.color),...(s.bg?{backgroundColor:k.parseColorString(s.bg)}:{}),
      decoration:(s.underline?k.UnderlineDecoration:0)|(s.strike?k.LineThroughDecoration:0),
      decorationColor:k.parseColorString(s.decorationColor || s.color)
    });
    const alignment={center:k.TextAlign.Center,left:k.TextAlign.Left,right:k.TextAlign.Right,justify:k.TextAlign.Justify};
    const style=new k.ParagraphStyle({textStyle:toStyle(runs[0].style),textAlign:alignment[align] || k.TextAlign.Start,
      textDirection:rtl?k.TextDirection.RTL:k.TextDirection.LTR});
    const builder=k.ParagraphBuilder.MakeFromFontProvider(style,this.fonts);
    let paragraph,surface,image;
    try{
      for(const run of runs){builder.pushStyle(new k.TextStyle(toStyle(run.style)));builder.addText(run.text);builder.pop();}
      paragraph=builder.build();paragraph.layout(width);
      const height=Math.max(1,paragraph.getHeight()), visible=Math.min(297*MM,height);
      const scale=Math.min(3,2048/width,3072/visible);
      surface=k.MakeSurface(Math.max(1,Math.ceil(width*scale)),Math.max(1,Math.ceil(visible*scale)));
      if(!surface)throw Error("تعذّر رسم مساحة النص "+width+" × "+visible);
      const canvas=surface.getCanvas();canvas.clear(k.TRANSPARENT);canvas.scale(scale,scale);canvas.drawParagraph(paragraph,0,0);
      image=surface.makeImageSnapshot();
      const png=image.encodeToBytes(), blocks=[];
      for(let i=0;i<png.length;i+=8192)blocks.push(String.fromCharCode(...png.subarray(i,i+8192)));
      const result={url:"data:image/png;base64,"+btoa(blocks.join("")),height,visible};
      this.cache.set(cacheKey,result);this.bytes+=result.url.length+cacheKey.length;
      while(this.bytes>12_000_000 && this.cache.size>1){
        const oldest=this.cache.keys().next().value;
        this.bytes-=this.cache.get(oldest).url.length+oldest.length;this.cache.delete(oldest);
      }
      return result;
    }finally{image?.delete();surface?.dispose();paragraph?.delete();builder.delete();}
  },
  paint(source,width,node,cell=false) {
    if(!source?.textContent.trim() || width<1)return;
    if(!Number.isFinite(width))throw Error("عرض غير صالح: "+node.id+" / "+node.type+" / "+node.w);
    const base={size:EditorSettings.display("fontSize",node.fontSize),weight:node.weight || "400",color:node.color || "#172c35",italic:node.fontStyle==="italic"};
    const runs=this.runs(source,base);
    if(!runs.length)return;
    const ink=this.raster(runs,Math.round(width*64)/64,EditorSettings.display("lineHeight",node.lineHeight),
      source.style.textAlign || node.align || (node.type==="shape"?"center":"right"),node.direction!=="ltr");
    const img=document.createElement("img");
    img.className="document-ink";img.alt="";img.setAttribute("aria-hidden","true");img.src=ink.url;img.draggable=false;
    img.style.height=ink.visible+"px";
    if(cell){
      const native=document.createElement("span");native.className="ink-source";
      native.append(...source.childNodes);source.append(native,img);
    }else{
      source.classList.add("ink-source");source.style.setProperty("--ink-height",ink.height+"px");source.after(img);
    }
  },
  ordinal(el,n) {
    const host=document.createElement("div"), source=document.createElement("span");
    host.className="ink-ordinal";source.textContent=el.dataset.clauseNumber;
    host.append(source);el.append(host);this.paint(source,4.4*MM,{...n,align:"center"});
  },
  apply(el,n,pageId) {
    if(!this.k || n.type==="image")return;
    const width=roundMM(n.w)*MM-2*(parseFloat(el.style.borderWidth) || 0);
    if(n.type!=="table"){
      const source=el.querySelector(".node-content"), inset=n.type==="shape"?.76:1;
      this.paint(source,width*inset,n);
      const img=source?.nextElementSibling;
      if(img?.classList.contains("document-ink")){
        const height=(roundMM(n.h)*MM-2*(parseFloat(el.style.borderWidth)||0))*inset;
        const free=Math.max(0,height-parseFloat(img.style.height));
        const align=el.dataset.valign;
        Object.assign(img.style,{position:"absolute",left:"0",top:(align==="middle"?free/2:align==="bottom"?free:0)+"px",width:width*inset+"px"});
      }
      return;
    }
    const table=el.querySelector("table");if(!table?.rows.length)return;
    const {grid,positions}=App.tableGrid(table);
    const count=Math.max(...grid.map(row=>row.length)), cols=Array.from(table.querySelectorAll("col"));
    const widths=Array.from({length:count},(_,i)=>{
      const size=cols[i]?.style.width || "";
      return size.endsWith("%")?parseFloat(size)*width/100:size.endsWith("mm")?parseFloat(size)*MM:size.endsWith("px")?parseFloat(size):width/count;
    });
    const schedule=pageId<0, smart=n.liveTable || n.tableSetup;
    const padding=schedule?1.2*MM:n.directory || n.letterGrid?2.4*MM:smart?2*MM:12;
    for(const row of table.rows)for(const cell of row.cells){
      const x=positions.get(cell).x;
      const bold=cell.tagName==="TH" && (smart || n.letterGrid) || n.directory && !x || cell.closest("tfoot");
      this.paint(cell,widths.slice(x,x+cell.colSpan).reduce((sum,w)=>sum+w,0)-padding-1,
        {...n,weight:bold?"700":n.weight,lineHeight:schedule || n.directory || n.letterGrid?1.05:smart?1.1:n.lineHeight,
          align:cell.style.textAlign || (schedule || n.letterGrid?"center":n.align) || "center",direction:table.dir},true);
    }
  }
};
