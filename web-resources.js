const WebResources = {
  url(path) {
    return globalThis.contractPack?.[path] || new URL(path,document.baseURI).href;
  },
  async pdf() {
    if (!this.pdfLoad) {
      this.pdfLoad = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = this.url("assets/vendor/pdf-lib-1.17.1.min.js");
        script.onload = () => resolve(PDFLib);
        script.onerror = () => {
          script.remove();
          this.pdfLoad = null;
          reject(Error("تعذر تحميل مكتبة PDF. أعد المحاولة."));
        };
        document.head.append(script);
      });
    }
    return this.pdfLoad;
  },
  styles() {
    const stylesheet = document.getElementById("documentStyles");
    if (!stylesheet) throw Error("تعذر تحميل تنسيق المستند.");
    return stylesheet.textContent;
  },
  async embedImages(paper) {
    await document.fonts.ready;
    const images = new Map();
    for (const image of paper.querySelectorAll("img")) {
      const url = image.getAttribute("src");
      if (!url || url.startsWith("data:")) continue;
      if (!images.has(url)) {
        const response = await fetch(url);
        if (!response.ok) throw Error("تعذر تحميل صورة المستند.");
        const blob = await response.blob();
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        images.set(url, data);
      }
      image.src = images.get(url);
    }
  },
};
