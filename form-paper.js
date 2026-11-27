// One coordinate system for editable controls, the published sheet and the A4 PDF.
const FormPaper = {
  width:794,height:1123,ink:"#172f43",muted:"#4c6574",line:"#c2d0d6",accent:"#17576a",
  sectionColors:{
    "بيانات الاستمارة":"#293e5c","المشتري":"#2b405e","الكفيل":"#2b4560","البائع":"#2b4960",
    "المركبة":"#294d61","المركبة القديمة":"#294b61","المركبة الجديدة":"#285162",
    "الدفع":"#265462","الدفعات":"#255864","الملاحظة":"#245c64","الأقساط":"#235d62",
    "تفاصيل إضافية":"#22605f","الاعتماد":"#21645e","البائع والتوقيع":"#20675c"
  },
  layout(f){
    const v=f.data,selected=v.companyId||f.company||Cloud.company.id;
    const company=cfg.companies.find(c=>c.id===selected)||{id:selected,name:Cloud.brands.find(c=>c.id===selected)?.name||""};
    const types=SalesForms.types,external=v.contractType==="external",exchange=v.contractType==="exchange",cash=v.contractType==="cash";
    const lists={companyId:Cloud.brands.map(c=>[c.id,c.name]),contractType:Object.entries(types),branch:Cloud.company.branches.map(b=>[b.name,b.name]),
      brand:[["auto","تلقائي"],["changan","شانجان"],["deepal","ديبال"]],exchangePayer:[["0","الطرف الأول"],["1","الطرف الثاني"]]};
    const sheets=[];let sheet,y;
    const text=(x,y,w,h,value,size=18,align="right",bold=false,color=this.ink)=>sheet.push({kind:"text",x,y,w,h,value,size,align,bold,color});
    const rect=(x,y,w,h,fill="#fff",stroke=this.line)=>sheet.push({kind:"rect",x,y,w,h,fill,stroke});
    const newPage=()=>{
      sheet=[];sheets.push(sheet);y=98;
      const logo=company.imageValues?.headerLogo??ContractAssets.logos?.[selected];
      if(logo)sheet.push({kind:"logo",x:38,y:28,w:115,h:49,src:logo});
      text(167,26,587,35,company.name,27,"right",true);
      text(167,60,587,24,"استمارة مبيعات  /  "+(types[v.contractType]||""),19,"right",false,this.muted);
      rect(38,88,718,2,this.accent,null);
    };
    // Measurements are page pixels. Weighted columns reserve room for actual values.
    const headingHeight=18,rowHeight=26,sectionGap=8;
    const rowY=index=>y+headingHeight+index*rowHeight;
    const advance=rows=>{y=rowY(rows)+sectionGap;};
    const field=(key,label,x,y,w,h=rowHeight,type="text",band=Math.min(w*.44,Math.max(48,Math.ceil((label.length*6+6)/24)*24)))=>{
      const raw=key==="branch"?f.branch:key==="companyId"?selected:SalesForms.value(v,key);
      sheet.push({kind:"field",key,label,type,x,y,w:w-band,h,value:raw??"",options:lists[key]});
      if(band){rect(x+w-band,y,band,h,"#40596b",null);text(x+w-band+1,y,band-2,h,label,15,"center",true,"#ffffff");}
    };
    const lane=(title,x,top,w)=>{
      const color=this.sectionColors[title];
      rect(x,top,w,headingHeight,color,null);
      rect(x+w-3,top,3,headingHeight,"#4aa79c",null);
      text(x+9,top,w-19,headingHeight,title,15,"right",true,"#ffffff");
      sheet.at(-1).section={x,y:top,w,title};
    };
    const grid=(defs,x,top,width,h=rowHeight)=>{
      const units=defs.reduce((n,d)=>n+(d[3]||1),0);let edge=x+width;
      for(const [key,label,type,weight] of defs){
        const w=width*(weight||1)/units;edge-=w;field(key,label,edge,top,w,h,type);
      }
    };
    const left=32,wide=730,half=362,right=left+wide-half;
    newPage();
    grid([["companyId","الشركة",null,4],["contractType","نوع العقد",null,3],["branch","الفرع",null,3]],left,y,wide,30);y+=38;
    const party=(role,title,x,externalParty=false)=>{
      lane(title,x,y,half);
      const k=externalParty?"external"+role:role.toLowerCase();
      const name=k,phone=k+"Phone",id=k+"Id",address=k+"Address";
      grid([[name,title]],x,rowY(0),half);
      grid([[phone,"الهاتف","tel"]],x,rowY(1),half);
      const identity=[[id,"الهوية","text",.62]];
      if(!externalParty)identity.push([k+"IdDate","تاريخها","date",.38]);
      grid(identity,x,rowY(2),half);
      if(!externalParty)grid([[k+"IdFrom","محلها"]],x,rowY(3),half);
      grid([[address,"العنوان"]],x,rowY(externalParty?3:4),half);
      if(!externalParty){
        const keys=k==="buyer"?["district","street","house"]:["guarantorDistrict","guarantorStreet","guarantorHouse"];
        grid(keys.map((key,i)=>[key,["محلة","زقاق","دار"][i]]),x,rowY(5),half);
      }
    };
    party("Buyer","المشتري",right,external);
    party("Guarantor","الكفيل",left);advance(6);
    if(external){
      lane("البائع",left,y,wide);
      grid([["externalSeller","البائع"],["externalSellerPhone","الهاتف","tel"]],left,rowY(0),wide);
      grid([["externalSellerId","الهوية"],["externalSellerAddress","العنوان"]],left,rowY(1),wide);advance(2);
    }
    const vehicle=(old,x,w)=>{
      const key=k=>old?"old"+k[0].toUpperCase()+k.slice(1):k,compact=w===half;
      lane(old?"المركبة القديمة":exchange?"المركبة الجديدة":"المركبة",x,y,w);
      const short=1.7;
      const car=[key("car"),"المركبة","car",5],color=[key("color"),"اللون","text",short],model=[key("model"),"الموديل","number",short];
      const plate=[key("plate"),"اللوحة","plate",3.4],mileage=[key("mileage"),"العداد","number",short],vin=[key("vin"),"الشاصي","vin",5+short];
      const guarantee=external?["externalKeys","بصمة / مفتاح","text",2]:["warrantyYears","الضمان","number",short];
      const lines=compact?[[car],[plate,model],[mileage,color],[vin]]:[[car,color,model],[plate,mileage],[vin,guarantee]];
      if(compact&&!old)lines[2].push(guarantee);
      lines.forEach((defs,i)=>grid(defs,x,rowY(i),w));
    };
    if(exchange){vehicle(true,right,half);vehicle(false,left,half);}else vehicle(false,left,wide);
    advance(exchange?4:3);
    lane("الدفع",left,y,wide);
    grid([["total","المبلغ الكلي","money",2],["formFees","الرسوم","money",1]],left,rowY(0),wide);
    grid([[cash||external?"cashReceived":"deposit","الواصل","money",2],["depositDate","تاريخه","date",1]],left,rowY(1),wide);y=rowY(2);
    if(exchange){grid([["exchangeOldDebt","ذمة المركبة القديمة"]],left,y,wide);y+=26;}
    y+=8;lane("الدفعات",right,y,half);lane("الملاحظة",left,y,half);
    const list=cash||external?"cashPayments":"extras";
    for(let i=0;i<4;i++)grid([[list+"."+i+".amount","الدفعة "+(i+1),"money",.62],[list+"."+i+".date","التاريخ","date",.38]],right,rowY(i),half);
    field("notes","الملاحظة",left,rowY(0),half,104,"textarea",0);advance(4);
    const installment=!external&&!cash&&(!exchange||v.exchangeManual!=="1");
    if(installment){
      lane("الأقساط",left,y,wide);
      grid([["payment","القسط","money",1.45],["count","عددها","number",.85],["formInstallmentNote","ملاحظة الأقساط","text",3.4]],left,rowY(0),wide);advance(1);
    }
    const terms=[];
    if(exchange)terms.push(["exchangePayer","دافع الفرق"],["exchangeManual","تسوية يدوية","manual"],["exchangePaymentNote","طريقة الدفع"]);
    if(installment)terms.push(...dataDefs.installmentInputs.filter(([k])=>!["count","payment"].includes(k)&&(v.phaseEnabled||!["phasePayment","phaseCount","phaseSecondCount"].includes(k))),["intervalMonths","الفاصل بالأشهر","number"]);
    if(cash||external)terms.push(["cashDueDate","تاريخ سداد الرصيد","date"]);
    if(!external)terms.push(...dataDefs.noteInputs.filter(([k])=>k!=="warrantyYears"));
    else terms.push(["externalPurchaseDate","تاريخ شراء المركبة","date"],["externalWaiverDate","تاريخ التنازل","date"]);
    const used=new Set(sheets.flat().filter(c=>c.key).map(c=>c.key));
    for(const [id,spec] of Object.entries(cfg.design?.fillAppearance?.["contract:"+v.contractType]||{})){
      const key=spec.binding||id;
      if(spec.kind==="field"&&!spec.hidden&&!used.has(key)&&!terms.some(d=>d[0]===key)&&key!=="number"&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)&&!Object.hasOwn(Object.prototype,key))
        terms.push(["bookValues."+key,spec.title||key,spec.type||"text"]);
    }
    if(terms.length){lane("تفاصيل إضافية",left,y,wide);y+=headingHeight;}
    for(let i=0;i<terms.length;i+=3){if(y+26>980)newPage();grid(terms.slice(i,i+3),left,y,wide);y+=26;}
    if(y>980){const k=(980-138)/(y-138);for(const item of sheet){if(item.y>=138){item.y=138+(item.y-138)*k;item.h*=k;if(item.section)item.section.y=item.y;}}}
    // Place signatures directly after the final row, with a consistent writing area.
    y+=12;lane("الاعتماد",right,y,half);lane("البائع والتوقيع",left,y,half);
    rect(right,rowY(0),half,88);rect(left,rowY(0),half,88);
    const seller=v.formSellerId||"";
    lists.formSellerId=[["",(!seller&&f.author_name)||Cloud.account?.name||""]];
    if(seller)lists.formSellerId.push([seller,f.sellerDisplay||f.author_name||""]);
    field("formSellerId","البائع",left+8,y+30,half-16,28);
    text(left+12,y+64,half-26,24,"التوقيع",16,"right",false,this.muted);
    rect(left+22,y+88,half-87,1,this.line,null);
    if(f.rejected_at){
      if(ContractAssets.rejectStamp)sheet.push({kind:"logo",src:ContractAssets.rejectStamp,x:right+half-93,y:y+24,w:70,h:59});
      else text(right+half-105,y+35,100,38,"مرفوضة",23,"center",true,"#a52c3a");
      sheet.push({kind:"text",x:right+9,y:y+28,w:half-125,h:68,value:f.rejection_note||"",size:16,align:"right",color:this.ink,multi:true});
    }else if(f.approved){
      sheet.push({kind:"logo",src:"assets/media/be239c2d2d9d6204824d16f6d7d51f5885a8319f2d7236bf2f96cffb4206b545.png",x:right+half-93,y:y+24,w:70,h:57});
      text(right+half-143,y+81,132,23,f.approved_by||"",17,"center",true);
      if(f.approval_note)sheet.push({kind:"text",x:right+9,y:y+30,w:half-148,h:64,value:f.approval_note,size:16,align:"right",color:this.ink,multi:true});
    }
    // Use the available writing area on shorter forms. Signatures stay with
    // their content, and custom multi-page forms retain their page breaks.
    if(sheets.length===1){
      const start=98,edge=y+106,scale=Math.min(1.26,(this.height-42-start)/(edge-start));
      for(const item of sheet)if(item.y>=start){
        item.y=start+(item.y-start)*scale;item.h*=scale;
        if(item.section)item.section.y=start+(item.section.y-start)*scale;
      }
    }
    return sheets;
  },
  logos:new Map(),
  logo(src){
    if(!this.logos.has(src)){
      if(this.logos.size>=6)this.logos.delete(this.logos.keys().next().value);
      const img=new Image();img.src=src;
      const decoded=img.decode().then(()=>img).catch(error=>{if(this.logos.get(src)===decoded)this.logos.delete(src);throw error;});
      this.logos.set(src,decoded);
    }
    return this.logos.get(src);
  },
  async draw(sheet,values,scale=2){
    await WebResources.loadDocumentFont();
    const canvas=document.createElement("canvas");canvas.width=this.width*scale;canvas.height=this.height*scale;
    const ctx=canvas.getContext("2d");ctx.scale(scale,scale);ctx.fillStyle="#fff";ctx.fillRect(0,0,this.width,this.height);ctx.direction="rtl";ctx.textBaseline="middle";
    const write=(s,value,size,align,color,bold,multi=false)=>{
      ctx.save();ctx.beginPath();ctx.rect(s.x,s.y,s.w,s.h);ctx.clip();ctx.textAlign=align;ctx.fillStyle=color;if(s.type==="plate")ctx.direction=Plate.direction(value);if(s.type==="vin"||s.type==="tel")ctx.direction="ltr";
      let rows,lineHeight;
      for(;;){
        ctx.font=(bold?"700 ":"400 ")+size+"px Alyamama";lineHeight=size*1.18;rows=[];
        for(const para of String(value).split(/\r?\n/)){let line="";for(const ch of para){if(multi&&line&&ctx.measureText(line+ch).width>s.w-8){rows.push(line);line="";}line+=ch;}rows.push(line);}
        if(!multi||rows.length*lineHeight<=s.h||size<=8)break;size--;
      }
      const x=align==="center"?s.x+s.w/2:s.x+s.w-3,step=Math.min(lineHeight,s.h/rows.length);
      rows.forEach((r,i)=>ctx.fillText(r,x,multi?s.y+(i+.5)*step:s.y+s.h*.53,Math.max(1,s.w-5)));ctx.restore();
    };
    for(const s of sheet){
      if(s.kind==="rect"){ctx.fillStyle=s.fill;ctx.fillRect(s.x,s.y,s.w,s.h);if(s.stroke){ctx.strokeStyle=s.stroke;ctx.strokeRect(s.x+.5,s.y+.5,s.w-1,s.h-1);}}
      if(s.kind==="text")write(s,s.value,s.size,s.align,s.color,s.bold,s.multi);
      if(s.kind==="logo"&&/^(?:data:image\/(?:png|jpeg|webp);base64,|(?:\.\/)?assets\/media\/)/i.test(s.src)){
        const img=await this.logo(s.src);const k=Math.min(s.w/img.width,s.h/img.height);ctx.drawImage(img,s.x+(s.w-img.width*k)/2,s.y+(s.h-img.height*k)/2,img.width*k,img.height*k);
      }
      if(s.kind!=="field")continue;
      ctx.fillStyle="#fff";ctx.fillRect(s.x,s.y,s.w,s.h);ctx.strokeStyle="#b2c4cc";ctx.strokeRect(s.x+.5,s.y+.5,s.w-1,s.h-1);
      if(values){let v=s.options?s.options.find(([k])=>k===s.value)?.[1]||s.value:s.value;
        if(s.type==="checkbox"||s.type==="manual")v=(s.type==="manual"?v==="1":v===true)?"✓":"";
        if(s.type==="plate")v=Plate.clean(v);
        if(s.type==="date")v=String(v).replace(/^(\d{4})-(\d{2})-(\d{2})$/,"$3/$2/$1");
        write(s,v,18,"center",this.ink,true,s.type==="textarea");
      }
    }return canvas;
  },
  editor(f,readOnly){
    return this.layout(f).map(sheet=>{
      const page=document.createElement("article");page.className="sales-paper";page.ariaLabel="استمارة مبيعات A4";
      const paint=async()=>{
        const notice=Activity.indicator("جارٍ رسم الاستمارة");page.prepend(notice);
        await Activity.afterPaint();if(!page.isConnected)return;
        try{const canvas=await this.draw(sheet,readOnly);notice.replaceWith(canvas);}
        catch(error){
          if(!page.isConnected)return;
          const retry=document.createElement("button");retry.type="button";retry.textContent="إعادة المحاولة";
          notice.replaceChildren(document.createTextNode("تعذّر رسم الاستمارة. "+error.message),retry);
          retry.onclick=()=>{notice.remove();paint();};
        }
      };
      paint();
      const groups=new Map(),sections=sheet.filter(s=>s.section).map(s=>s.section);
      page.classList.toggle("paper-editable",!readOnly);
      const groupFor=s=>{
        const mid=s.x+s.w/2;
        const section=sections.filter(b=>b.y<s.y&&mid>=b.x&&mid<=b.x+b.w).at(-1);
        const name=section?.title||"بيانات الاستمارة";
        if(!groups.has(name)){
          const group=document.createElement("div");group.className="paper-group";
          const heading=document.createElement("h2");heading.textContent=name;group.style.setProperty("--section-ink",this.sectionColors[name]);
          group.append(heading);page.append(group);groups.set(name,group);
        }
        return groups.get(name);
      };
      for(const s of sheet.filter(s=>s.kind==="field")){
        const input=s.options?SalesForms.select(s.label,s.options,s.value):document.createElement(s.type==="textarea"?"textarea":"input");
        input.setAttribute("aria-label",s.label);input.dataset.key=s.key;
        if(readOnly){const val=s.options?s.options.find(([k])=>k===s.value)?.[1]:s.value;const item=document.createElement("span");item.className="paper-sr";item.textContent=s.label+" "+(val??"");input.disabled=true;input.className="paper-sr";input.value=s.value;page.append(input,item);continue;}
        if(s.type==="checkbox"||s.type==="manual"){input.type="checkbox";input.checked=s.type==="manual"?s.value==="1":!!s.value;}
        else{if(["date","tel"].includes(s.type))input.type=s.type;if(["money","number"].includes(s.type))input.inputMode="numeric";if(s.type==="car")input.setAttribute("list","salesCars");input.value=s.value;}
        if(s.type==="plate")Plate.bind(input);
        if(s.type==="tel"||s.type==="vin")input.dir="ltr";
        if(s.key==="formSellerId")SalesForms.sellerOptions(input,f);
        if(s.key==="branch")input.disabled=!!f.version;
        if(s.key==="companyId"&&(f.revising||f.first_release))input.disabled=true;
        const wrap=document.createElement("label"),caption=document.createElement("span");
        wrap.className="paper-field";caption.textContent=s.label;wrap.append(caption,input);groupFor(s).append(wrap);
        if(s.type==="textarea"||s.type==="vin"||s.key==="exchangeOldDebt"||["buyer","guarantor","car","oldCar","formInstallmentNote"].includes(s.key))wrap.classList.add("paper-wide");
        Object.assign(wrap.style,{left:s.x/this.width*100+"%",top:s.y/this.height*100+"%",width:s.w/this.width*100+"%",height:s.h/this.height*100+"%"});
        input.oninput=()=>{
          if(s.key==="formSellerId")f.sellerDisplay=input.selectedOptions[0]?.text;
          if(s.key==="branch"||s.key==="companyId"){delete f.data.formSellerId;delete f.sellerDisplay;}
          if(s.key==="branch")f.branch=input.value;
          else SalesForms.set(f.data,s.key,s.type==="manual"?(input.checked?"1":"0"):s.type==="checkbox"?input.checked:input.value);
          if(s.key==="firstDate")f.data.firstAuto=false;
          if(s.key==="depositDate")f.data.depositAuto=false;
          if(s.key.startsWith("cashPayments."))f.data.cashSplit=f.data.cashPayments.some(r=>r?.amount);
          SalesForms.dirty();
          if(["companyId","contractType","phaseEnabled","exchangeManual","branch"].includes(s.key))
            Activity.transition("form-fields","جارٍ تحديث خانات الاستمارة",()=>{
              if(SalesForms.active===f&&page.isConnected)SalesForms.edit();
            }).catch(error=>SalesForms.status.textContent=error.message);
        };
        if(s.type==="date"){
          EntryDates.attach(input);const wrap=input.parentElement;wrap.classList.add("paper-date");
          wrap.firstElementChild.placeholder="يوم/شهر/سنة";wrap.firstElementChild.dataset.key=s.key;delete input.dataset.key;
        }
      }return page;
    });
  }
};
