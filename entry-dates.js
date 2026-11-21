// Keep the form's native ISO values for schedules, JSON and archive comparisons.
const EntryDates = {
  sync(root = document) {
    const scope=root===document ? "#toolbar .entry-date, #fillPanel .entry-date" : ".entry-date";
    for(const wrap of root.querySelectorAll(scope)) {
      const original=wrap.lastElementChild;
      if(!original || original.type==="date") continue;
      this.bindings?.get(original)?.controller.abort();
      const before=this.bindings?.get(original);
      if(before?.tabIndex==null)original.removeAttribute("tabindex");else original.setAttribute("tabindex",before.tabIndex);
      original.removeAttribute("aria-hidden");
      wrap.replaceWith(original);
      this.bindings?.delete(original);
    }
    const selector=root===document ? '#toolbar input[type=date], #fillPanel input[type=date]' : 'input[type=date]';
    for (const native of root.querySelectorAll(selector)) {
      if (!native.parentElement.classList.contains("entry-date")) this.attach(native);
      const text=native.parentElement.querySelector(".date-text");
      if (document.activeElement!==text) text.value=dateLabel(native.value);
      text.classList.toggle("missing-value",native.classList.contains("missing-value"));
      if(native.hasAttribute("aria-required")) text.setAttribute("aria-required","true");
      else text.removeAttribute("aria-required");
    }
  },
  attach(native) {
    const wrap=document.createElement("span"), text=document.createElement("input");
    wrap.className="entry-date";
    const label=native.getAttribute("aria-label") || native.closest("label")?.textContent.trim() || "التاريخ";
    text.className="date-text";
    text.type="text"; text.inputMode="numeric"; text.placeholder="dd/mm/yyyy"; text.dir="ltr";
    text.setAttribute("aria-label",label+" (dd/mm/yyyy)");
    native.before(wrap);
    wrap.append(text,native);
    const controller=new AbortController();
    (this.bindings ||= new WeakMap()).set(native,{controller,tabIndex:native.getAttribute("tabindex")});
    native.tabIndex=-1;
    native.setAttribute("aria-hidden","true");
    const commit=()=>{
      const value=normalizeDigits(text.value.trim());
      const parts=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
      let iso="";
      if(value){
        if(!parts) return false;
        const year=parts[3].length===2 ? "20"+parts[3] : parts[3];
        iso=year+"-"+parts[2].padStart(2,"0")+"-"+parts[1].padStart(2,"0");
        const day=new Date(iso+"T12:00:00Z");
        if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==iso||+year===0)return false;
      }
      if(native.value!==iso){
        native.value=iso; native.dispatchEvent(new Event("input",{bubbles:true}));native.dispatchEvent(new Event("change",{bubbles:true}));
      }
      return true;
    };
    text.oninput=event=>{
      text.removeAttribute("aria-invalid");
      if(event.isComposing) return;
      const caret=text.selectionStart;
      let value=normalizeDigits(text.value);
      if(caret===value.length && !event.inputType?.startsWith("delete")){
        // A typed slash can follow a separator that was inserted automatically.
        if(event.data==="/" && value.endsWith("//")) value=value.slice(0,-1);
        const parts=value.split("/");
        while(parts.length<3 && /^\d{2,}$/.test(parts.at(-1))){
          const digits=parts.pop();
          parts.push(digits.slice(0,2),digits.slice(2));
        }
        value=parts.join("/");
      }
      if(value!==text.value){
        const atEnd=caret===text.value.length;
        text.value=value;
        const next=atEnd ? value.length : caret;
        text.setSelectionRange(next,next);
      }

    };
    text.onblur=()=>{
      if(!commit()){text.setAttribute("aria-invalid","true");Feedback.notice("تاريخ غير صالح. أدخل اليوم/الشهر/السنة.");}
      text.value=dateLabel(native.value);
    };
    text.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();text.blur()}};
    native.addEventListener("input",()=>text.value=dateLabel(native.value),{signal:controller.signal});
    text.value=dateLabel(native.value);
  }
};
