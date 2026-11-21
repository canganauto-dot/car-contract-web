"use strict";
const $ = (id) => document.getElementById(id),
  clone = (x) => JSON.parse(JSON.stringify(x)),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const seed = ContractSeed,
  KEY = seed.offline ? "car-contract-offline-v1" : "car-contract-suite-v4";
let cfg = clone(seed.config),
  d = null,
  db = null,
  editMode = false,
  saveTimer = null,
  writeQueue = Promise.resolve(),
  startReady = false;
function today() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return p.year + "-" + p.month + "-" + p.day;
}
function timeNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
function fresh() {
  return {
    recordId: "",
    customerPhoto: "",
    contractType: "installment",
    templateId: "",
    exchangePayer: "0",
    exchangeManual: "0",
    exchangePaymentNote: "",
    skipTransferLetter: false,
    externalTransferLetter: false,
    cashTransferLetter: false,
    exchangeTransferLetter: false,
    cashPayAtTransfer: false,
    exchangePayAtTransfer: false,
    skipCompanySheets: "",
    transferDealer: "",
    externalSeller: "",
    externalSellerAddress: "",
    externalSellerPhone: "",
    externalBuyer: "",
    externalBuyerAddress: "",
    externalBuyerPhone: "",
    externalKeys: "",
    externalPurchaseDate: "",
    externalWaiverDate: "",
    externalSellerCompany: "",
    externalBuyerCompany: "",
    externalSellerId: "",
    externalBuyerId: "",
    ...cashTerms({}),
    phaseEnabled: false,
    phaseCount: "",
    phasePayment: "",
    phaseSecondCount: "",
    intervalMonths: "1",
    depositAuto: true,
    companyId: cfg.companies[0].id,
    initialCompanyId: "",
    number: "",
    numberBranch: "",
    numberRequest: "",
    numberUnconfirmed:false,
    offlineNumber: false,
    contractDate: today(),
    contractTime: timeNow(),
    manualContractDate: false,
    manualContractTime: false,
    buyer: "",
    buyerId: "",
    buyerIdDate: "",
    buyerIdFrom: "مديرية الجنسية والمعلومات المدنية",
    buyerAddress: "",
    district: "",
    street: "",
    house: "",
    buyerPhone: "",
    car: "",
    oldCar: "",
    oldVin: "",
    oldModel: "",
    oldColor: "",
    oldMileage: "",
    oldPlate: "",
    brand: "auto",
    color: "",
    model: "",
    plate: "",
    mileage: "",
    vin: "",
    total: "",
    deposit: "",
    standaloneBook: "",
    bookBody: "",
    bookTitle: "",
    bookNoCompany: false,
    bookValues: {},
    tableData: {},
    priceCatalogId: "",
    depositDate: today(),
    count: "",
    payment: "",
    firstDate: addMonths(today(), 1),
    firstAuto: true,
    skipSchedule: "",
    warrantyYears: "5",
    noWarranty: false,
    notes: "",
    guarantor: "",
    guarantorId: "",
    guarantorIdDate: "",
    guarantorIdFrom: "مديرية الجنسية والمعلومات المدنية",
    guarantorAddress: "",
    guarantorPhone: "",
    guarantorDistrict: "",
    guarantorStreet: "",
    guarantorHouse: "",
    extras: Array.from({ length: 4 }, (_, i) => ({
      enabled: false,
      label: i ? "دفعة إضافية" : "تكملة مقدمة",
      amount: "",
      date: today(),
    })),
    pages: [1, 2, 3, 4, 5, 6, 7, 8],
    updatedAt: Date.now(),
  };
}
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(KEY, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("store");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function getDB(key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    const r = db.transaction("store").objectStore("store").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function putDB(key, value) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(Error("التخزين المحلي غير متاح"));
    const tx = db.transaction("store", "readwrite");
    tx.objectStore("store").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function safeImage(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^assets\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(s)) return s;
  const full = /^[A-Za-z0-9+/=\s]{128,}$/.test(s)
    ? "data:image/png;base64," + s.replace(/\s/g, "")
    : s;
  if (
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(full) ||
    full.length > 18000000
  )
    throw Error(
      "الصورة يجب أن تكون PNG أو JPG أو WebP بصيغة Base64 وحجم مناسب.",
    );
  return full;
}
function normalizeName(s) {
  return normalizeDigits(s)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s_-]/g, "");
}
function detectBrand(name) {
  const n = normalizeName(name);
  if (!n) return "";
  const found = cfg.cars.find((c) =>
    [c.name, ...(c.aliases || [])].some((a) => normalizeName(a) === n),
  );
  if (found) return found.brand;
  if (/changan|شانجان|شنجان/.test(n)) return "changan";
  if (/deepal|ديبال|ديبل/.test(n) || /^(s0?[57]|g318)$/.test(n))
    return "deepal";
  return "";
}
function cargoClauseApplies(data) {
  if (data.standaloneBook || !["installment","exchange"].includes(data.contractType)) return false;
  const name = normalizeName(data.car || "");
  return !!name && cfg.cars.some(car => car.cargo === true &&
    [car.name,...(car.aliases || [])].some(alias => normalizeName(alias) === name));
}
function selectedBrand() {
  return d.brand === "auto" ? detectBrand(d.car) || "changan" : d.brand;
}
function resolveCar() {
  const s = normalizeDigits($("car").value).trim();
  const ordinal = /^\d+$/.test(s)
    ? Number(s)
    : Number((s.match(/^(\d+)\s*[·.\-]/) || [])[1]);
  const car = cfg.cars.find((c) => c.order === ordinal);
  d.car = car ? car.name : s;
  $("car").value = d.car;
  render();
}
function splitBills(n) {
  if (!Number.isSafeInteger(n) || n < 0) return [0, 0, 0, 0];
  const b = Math.floor(n / 2);
  return [b, n - b, b, n - b];
}
function co() {
  if (d.standaloneBook && d.bookNoCompany)
    return {
      id: "none",
      name: "",
      fullName: "",
      manager: "",
      address: "",
      phone: "",
      imageValues: {},
    };
  return cfg.companies.find((x) => x.id === d.companyId) || cfg.companies[0];
}
