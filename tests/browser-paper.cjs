const assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const os=require("node:os");
const path=require("node:path");
const {chromium,firefox}=require("playwright");
const serve=require("./server.cjs");

(async()=>{
  const host=await serve(path.resolve(__dirname,"../dist"),{sampleFaces:"missing"});
  async function sample(engine,options){
    const browser=await engine.launch(options);
    try{
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      await page.goto(host.url);await page.waitForFunction(()=>startReady);
      await page.locator("#setupTitle").fill("موظف العقود");await page.locator("#setupBranch").fill("فرع تجريبي");
      await page.locator("#setupOrganizer").fill("اختبار تجريبي");await page.locator("#setupForm button").click();
      const search=await page.locator("#archiveSearch").evaluate(el=>{
        const box=el.getBoundingClientRect(),frame=el.closest("label").getBoundingClientRect();
        return box.top>=frame.top && box.bottom<=frame.bottom && box.right<=frame.right+.5 && box.left>=frame.left-.5;
      });
      assert(search,"archive search fits its container");
      await page.locator("#workNew").click();await page.waitForFunction(()=>!Services.home && d.recordId);
      await page.addStyleTag({content:"#pages>.paper{content-visibility:visible!important;zoom:1!important}"});
      const output=await page.evaluate(()=>{
        Object.assign(d,{number:"T-2",total:"1200000",deposit:"200000",payment:"100000",count:"10",firstDate:"2026-12-05",
          firstAuto:false,buyer:"اختبار المستند",contractDate:"2026-11-05",contractTime:"10:30"});
        App.scene=null;render();
        const face=$("pages").querySelector('.paper[data-page="1"]');
        const intro=face.querySelector('[data-node="installmentIntro"]');
        const count=[...intro.querySelectorAll(".node-content span")].find(s=>s.textContent==="10" && s.style.color);
        if(!count || !count.style.color || parseFloat(count.style.fontSize)<=parseFloat(intro.style.fontSize))throw Error("installment emphasis");
        assertPhrase();
        function assertPhrase(){
          const plain=intro.textContent.replace(/[\u200f\u2066-\u2069]/g,"").trim();
          if(plain!=="تدفع اقساط شهرية عددها ( 10 ) تبدأ بتاريخ: ٠٥/١٢/٢٠٢٦")throw Error(plain);
          const warranty=face.querySelector('[data-node="warranty"]');
          if(![...warranty.querySelectorAll(".node-content span")].some(s=>s.textContent==="5" && s.style.color && parseFloat(s.style.fontSize)>parseFloat(warranty.style.fontSize)))throw Error("warranty emphasis");
          // Exercise a date split by inline formatting and an older LTR template wrapper.
          const sample=document.createElement("div");
          sample.innerHTML="⁦2026/<b>12</b>/05⁩";arabicPaperDates(sample);
          const value=sample.textContent,k=DocumentInk.k;
          const builder=k.ParagraphBuilder.MakeFromFontProvider(new k.ParagraphStyle({
            textDirection:k.TextDirection.RTL,textStyle:{fontFamilies:["Alyamama"],fontSize:20}
          }),DocumentInk.fonts);
          builder.addText(value);
          const paragraph=builder.build();
          try{
            paragraph.layout(300);
            const x=digits=>{const i=value.indexOf(digits);return paragraph.getRectsForRange(i,i+digits.length,k.RectHeightStyle.Tight,k.RectWidthStyle.Tight)[0].rect[0];};
            if(!(x("٠٥")>x("١٢") && x("١٢")>x("٢٠٢٦")))throw Error("date day must be rightmost");
          }finally{paragraph.delete();builder.delete();}
        }
        const faces=["installment","cash","external","exchange"].flatMap(kind=>{
          d.contractType=kind;App.scene=null;render();
          return [...$("pages").querySelectorAll(".paper")].map(paper=>{
            const pr=paper.getBoundingClientRect();
            return [kind+":"+paper.dataset.page,[...paper.querySelectorAll(".scene-node")].map(el=>[
              el.dataset.node,el.style.left,el.style.top,el.style.width,el.style.height,
              [...el.querySelectorAll(".document-ink")].map(img=>[img.getAttribute("src"),img.style.height]),
              Array.from(el.querySelectorAll(".document-ink,td,th"),part=>{
                if(!part.getClientRects().length)return [0,0,0,0];
                const box=part.getBoundingClientRect();return [box.x-pr.x,box.y-pr.y,box.width,box.height];
              })]),pr.width,pr.height];
          });
        });
        d.contractType="installment";App.scene=null;render();return faces;
      });
      await page.locator('#pages .paper[data-page="1"]').first().screenshot({path:path.join(os.tmpdir(),"contract-paper-"+engine.name()+".png")});
      const printable=await page.evaluate(async()=>{
        const face=$("pages").querySelector('.paper[data-page="1"]').cloneNode(true);
        const bytes=new Uint8Array(await ArchiveOutput.raster(face));
        return bytes[0]===255 && bytes[1]===216 && bytes.length>10000;
      });
      assert(printable,"A4 PDF image can be encoded by "+engine.name());
      return output.map(([id,nodes,w,h])=>[id,nodes.map(([name,x,y,width,height,images,boxes])=>[name,x,y,width,height,createHash("sha256").update(JSON.stringify(images)).digest("hex"),boxes]),Math.round(w),Math.round(h)]);
    }finally{await browser.close();}
  }
  try{
    const edge=await sample(chromium,{channel:"msedge"}), gecko=await sample(firefox,{});
    assert(edge.length>12);
    for(let i=0;i<edge.length;i++){
      const [sheet,nodes,width,height]=edge[i];
      assert.deepEqual([gecko[i][0],gecko[i][2],gecko[i][3]],[sheet,width,height]);
      assert.equal(gecko[i][1].length,nodes.length);
      nodes.forEach((node,j)=>{
        const other=gecko[i][1][j], label=sheet+" "+node[0];
        assert.deepEqual(other.slice(0,-1),node.slice(0,-1),label);
        assert.equal(other[6].length,node[6].length,label);
        node[6].forEach((rect,part)=>rect.forEach((v,axis)=>{
          assert(Math.abs(v-other[6][part][axis])<=1,label+" geometry "+v+" vs "+other[6][part][axis]);
        }));
      });
    }
    console.log("PASS Edge and Firefox agree on four contract layouts, text rasters and page size; RTL dates and archive search verified");
  }finally{host.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
