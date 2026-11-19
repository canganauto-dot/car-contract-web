const OfflineEdition = {
  init() {
    if (seed.offline) {
      document.body.classList.add("offline-edition");
      const home = $("homeScreen");
      const title = document.createElement("h2");
      title.textContent = "إنشاء مستند";
      const actions = document.createElement("div");
      for (const [name,id] of [["إضافة عقد","workNew"],["إضافة كتاب","workLetter"]]) {
        const button = document.createElement("button");
        button.textContent = name;
        button.onclick = () => $(id).click();
        actions.append(button);
      }
      // Keep archive elements mounted for existing internal refresh handlers.
      const panel = document.createElement("section");
      panel.className = "offline-home";
      panel.append(title,actions);
      home.prepend(panel);
      return;
    }
    const button = document.createElement("button");
    button.id = "offlineEdition";
    button.type = "button";
    button.title = "تنزيل نسخة HTML للعمل بدون إنترنت";
    button.setAttribute("aria-label",button.title);
    button.innerHTML = Archive.icon("download");
    $("loadContract").after(button);
    button.onclick = async () => {
      button.disabled = true;
      try { await this.download(); }
      catch (error) { await Feedback.notice("تعذّر إنشاء النسخة. " + error.message); }
      finally { button.disabled = false; }
    };
  },
  async resource(path) {
    const response = await fetch(path,{cache:"no-store"});
    if (!response.ok) throw Error("تعذّر تحميل " + path);
    return response;
  },
  async download() {
    // Export the settings that actually produced the open form, including its fill layout.
    const config = clone(cfg);
    const workspaceCollapsed = $("workbench").hidden;
    const appearanceId = crypto.randomUUID();
    config.fixed = {...cfg.fixed, organizer:"", prefix:"", branch:"", nextNumber:1};
    config.setupComplete = false;
    config.design.uiDefaults = clone(UIPreferences.value);
    const html = await (await this.resource("index.html")).text();
    const page = new DOMParser().parseFromString(html,"text/html");
    await Promise.all([...page.querySelectorAll('link[rel="stylesheet"][href]')].map(async link => {
      const style = page.createElement("style");
      if (link.id) style.id = link.id;
      style.textContent = await (await this.resource(link.getAttribute("href"))).text();
      link.replaceWith(style);
    }));
    const scripts = [...page.querySelectorAll("script[src]")];
    const contents = await Promise.all(scripts.map(async script => {
      const path = script.getAttribute("src");
      const code = await (await this.resource(path)).text();
      if (!path.endsWith("/seed.js")) return code;
      const at = code.indexOf("\nconst ContractAssets=");
      if (at < 0) throw Error("تعذرت قراءة موارد القوالب.");
      return "const ContractSeed=" + JSON.stringify({offline:true,appearanceId,workspaceCollapsed,config}) + ";" + code.slice(at);
    }));
    // Package the same resources used by the running site. Keep executable code
    // intact and resolve its media URLs against the exported asset directory.
    const manifest = await (await this.resource(".web-build.json")).json();
    const resources = new Map();
    const paths = manifest.files.filter(path => path.startsWith("assets/media/") ||
      /^assets\/vendor\/.*\.(js|mjs)$/.test(path));
    await Promise.all(paths.map(async path=>{
      const response = await this.resource(path);
      let blob = await response.blob();
      if (/\.m?js$/.test(path)) blob = new Blob([blob],{type:"text/javascript"});
      const encoded = await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(reader.error);
        reader.readAsDataURL(blob);
      });
      resources.set(path,encoded);
    }));
    const urls = Object.fromEntries([...resources].filter(([path])=>path.startsWith("assets/vendor/")));
    const resourceScript=page.createElement("script");
    resourceScript.textContent="globalThis.contractPack="+JSON.stringify(urls)+";";
    scripts[0].before(resourceScript);
    scripts.forEach((script,i)=>{
      script.removeAttribute("src");
      script.removeAttribute("defer");
      // Media references in template data and static sheet definitions can
      // also be consumed directly by images and CSS, outside safeImage().
      script.textContent=contents[i].replace(/assets\/media\/[a-f0-9]{64}\.(?:png|jpg|webp)/g,path=>{
        if(!resources.has(path)) throw Error("صورة القالب مفقودة: "+path);
        return resources.get(path);
      }).replace(/<\/script/gi,"<\\/script");
    });
    const file = new Blob(["<!doctype html>\n",page.documentElement.outerHTML],{type:"text/html;charset=utf-8"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "Contracts-" + today() + ".html";
    link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),60000);
  }
};
