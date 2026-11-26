const get = (s) => document.querySelector(s),
  video = get("video"),
  out = get("output"),
  canvas = document.createElement("canvas"),
  ctx = canvas.getContext("2d", { willReadFrequently: true });
let stream,
  timer,
  generation = 0,
  promptInstall;
function stop() {
  generation++;
  clearTimeout(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  video.hidden = true;
}
function decode(image, w, h, maxSize = 2048) {
  if (!w || !h) return false;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const width = Math.round(w * scale),
    height = Math.round(h * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height),
    qr = jsQR(frame.data, frame.width, frame.height);
  if (!qr) return false;
  let id = qr.data;
  try {
    const u = new URL(id);
    id = u.searchParams.get("id") || u.searchParams.get("verify");
  } catch {}
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) {
    out.textContent = "الرمز المقروء لا يخص مستنداً.";
    return false;
  }
  stop();
  location.assign("../?verify=" + id);
  return true;
}
get("#camera").onclick = async () => {
  const running = !!stream;
  stop();
  if (running) {
    out.textContent = "توقفت الكاميرا.";
    return;
  }
  const ticket = generation;
  try {
    const cam = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    if (ticket !== generation) {
      cam.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = cam;
    video.srcObject = cam;
    video.hidden = false;
    await video.play();
    if (ticket !== generation) return;
    out.textContent = "وجّه الكاميرا نحو الرمز.";
    function scan() {
      if (ticket !== generation) return;
      try {
        if (!decode(video, video.videoWidth, video.videoHeight, 1280))
          timer = setTimeout(scan, 230);
      } catch {
        stop();
        out.textContent =
          "تعذّرت قراءة صورة الكاميرا. اختر صورة أو أعد تشغيل الكاميرا.";
      }
    }
    scan();
  } catch {
    if (ticket !== generation) return;
    stop();
    out.textContent = "تعذر فتح الكاميرا. تحقق من إذن الكاميرا أو اختر صورة.";
  }
};
get("#photo").onclick = () => {
  stop();
  get("#file").click();
};
get("#file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  stop();
  const ticket = generation;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (ticket !== generation) return;
    out.textContent = "لم نعثر على رمز مستند في الصورة.";
    decode(img, img.width, img.height);
  } catch {
    out.textContent = "تعذر فتح الصورة.";
  } finally {
    URL.revokeObjectURL(url);
    e.target.value = "";
  }
};
addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptInstall = e;
});
get("#install").onclick = async () => {
  if (promptInstall) {
    const request = promptInstall;
    promptInstall = null;
    await request.prompt();
    return;
  }
  if (!/Windows/i.test(navigator.userAgent)) {
    out.textContent =
      "من قائمة المتصفح اختر «إنشاء اختصار» أو «إضافة إلى الشاشة الرئيسية».";
    return;
  }
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob(
      [
        "[InternetShortcut]\r\nURL=" +
          new URL("index.html", location.href).href +
          "\r\n",
      ],
      {
        type: "application/octet-stream",
      },
    ),
  );
  link.href = url;
  link.download = "قارئ المستندات.url";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  out.textContent = "احفظ ملف الاختصار على سطح المكتب.";
};
navigator.serviceWorker?.register("../sw.js").catch(() => {});
