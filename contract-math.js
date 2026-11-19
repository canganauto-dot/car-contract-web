"use strict";
function normalizeDigits(s) {
  return String(s ?? "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
}
function amount(s) {
  let raw = normalizeDigits(s).replace(/[,،٬\s]/g, "");
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  if (raw === "") return 0;
  return /^\d+$/.test(raw) &&
    Number.isSafeInteger(Number(raw)) &&
    Number(raw) <= 999999999999
    ? Number(raw)
    : NaN;
}
function money(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}
function monthLength(year, month) {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function calendarDateParts(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= monthLength(year, month)
    ? [year, month, day]
    : null;
}
function dateLabel(s) {
  return calendarDateParts(s) ? s.split("-").reverse().join("/") : "";
}
function addMonths(date, n) {
  const parts = calendarDateParts(date);
  if (!parts || !Number.isSafeInteger(n)) return "";
  const [year, month, day] = parts;
  const offset = year * 12 + month - 1 + n;
  const targetYear = Math.floor(offset / 12);
  if (targetYear < 1 || targetYear > 9999) return "";
  const targetMonth = offset % 12 + 1;
  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth).padStart(2, "0"),
    String(Math.min(day, monthLength(targetYear, targetMonth))).padStart(2, "0"),
  ].join("-");
}
const ones = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];
const tens = [
  "",
  "",
  "عشرون",
  "ثلاثون",
  "أربعون",
  "خمسون",
  "ستون",
  "سبعون",
  "ثمانون",
  "تسعون",
];
const hundreds = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];
function under1000(n) {
  const out = [];
  if (n >= 100) out.push(hundreds[Math.floor(n / 100)]);
  n %= 100;
  if (n)
    out.push(
      n < 20
        ? ones[n]
        : [ones[n % 10], tens[Math.floor(n / 10)]].filter(Boolean).join(" و"),
    );
  return out.join(" و");
}
function words(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 999999999999) return "—";
  if (n === 0) return "صفر دينار عراقي فقط";
  const out = [];
  for (const [scale, one, two, plural] of [
    [1e9, "مليار", "ملياران", "مليارات"],
    [1e6, "مليون", "مليونان", "ملايين"],
    [1e3, "ألف", "ألفان", "آلاف"],
  ]) {
    const q = Math.floor(n / scale);
    n %= scale;
    if (q)
      out.push(
        q === 1
          ? one
          : q === 2
            ? two
            : (q === 200 ? "مائتا" : under1000(q)) +
              " " +
              (q >= 3 && q <= 10 ? plural : one),
      );
  }
  if (n) out.push(under1000(n));
  return out.join(" و") + " دينار عراقي فقط";
}
function duration(n) {
  if (!Number.isInteger(n) || n <= 0) return "—";
  const y = Math.floor(n / 12),
    m = n % 12;
  const years =
    y === 1 ? "سنة" : y === 2 ? "سنتين" : y <= 10 ? y + " سنوات" : y + " سنة";
  const months =
    m === 1
      ? "شهر واحد"
      : m === 2
        ? "شهرين"
        : m <= 10
          ? m + " أشهر"
          : m + " شهراً";
  if (!y) return months;
  if (!m) return y === 1 ? "سنة واحدة" : years;
  if (m === 6) return years + " ونصف";
  return years + " و" + months;
}
function cashTerms(data) {
  let received = data.cashReceived;
  if (received == null && data.contractType === "cash") {
    const legacyExtras = Array.isArray(data.extras) ? data.extras : [];
    received = amount(data.deposit) + legacyExtras.reduce((sum, row) => sum + amount(row?.amount), 0) || "";
  }
  return {
    cashReceived: String(received ?? ""),
    cashSplit: data.cashSplit === true,
    cashDueDate: String(data.cashDueDate || ""),
    cashTransferNote: String(data.cashTransferNote || ""),
    cashPayments: Array.from({ length: 4 }, (_, i) => ({
      amount: String(data.cashPayments?.[i]?.amount ?? ""),
      date: String(data.cashPayments?.[i]?.date || ""),
    })),
  };
}
function calculateCash(data) {
  const terms = cashTerms(data);
  const total = amount(data.total), deposit = amount(terms.cashReceived);
  const errors = [], rows = [];
  if (!Number.isFinite(total) || !Number.isFinite(deposit))
    errors.push("أدخل الثمن والواصل بأرقام صحيحة.");
  if (total === 0) errors.push("أدخل ثمن بيع المركبة.");
  const hasScheduledPayments = !data.contractType || data.contractType === "cash";
  if (hasScheduledPayments && total > deposit) {
    for (const [slot, row] of terms.cashPayments.entries()) {
      if (!row.amount.trim()) continue;
      const value = amount(row.amount);
      if (!Number.isFinite(value) || value <= 0) errors.push("حدد مبلغاً موجباً لكل دفعة مستخدمة.");
      rows.push({slot, value, date: row.date});
    }
  }
  const extras = rows.reduce((sum, row) => sum + row.value, 0);
  const remaining = total - deposit - extras;
  if (remaining < 0) errors.push("الواصل والدفعات تتجاوز ثمن المركبة.");
  const dates = [...rows, ...(remaining > 0 && terms.cashDueDate ? [{date:terms.cashDueDate}] : [])];
  const validContractDate = calendarDateParts(data.contractDate);
  if (data.contractDate && !validContractDate) errors.push("راجع تاريخ العقد.");
  if (dates.some((row) => row.date && !calendarDateParts(row.date)))
    errors.push("راجع صيغة تاريخ السداد.");
  if (validContractDate && dates.some((row) => calendarDateParts(row.date) && row.date < data.contractDate))
    errors.push("تاريخ السداد يسبق تاريخ العقد.");
  return {
    total,
    deposit,
    remaining,
    cashRows: rows,
    errors,
    extras,
    outstanding: total - deposit,
    payment: 0,
    count: 0,
    last: 0,
    lastDate: "",
    secondDate: "",
    earlyCount: 0,
    earlyPayment: 0,
    secondCount: 0,
    interval: 1,
    phase: false,
    duration: "",
  };
}
function calculate(d) {
  if (d.contractType === "exchange" && d.exchangeManual === "1")
    return calculateCash({
      ...d,
      cashReceived: d.deposit,
      cashSplit: false,
      cashDueDate: "",
    });
  if (["cash", "external"].includes(d.contractType)) return calculateCash(d);
  const errors = [],
    total = amount(d.total),
    deposit = amount(d.deposit),
    payment = amount(d.payment),
    interval = Number(d.intervalMonths || 1),
    phase = !!d.phaseEnabled,
    earlyCount = phase ? amount(d.phaseCount) : 0,
    earlyPayment = phase ? amount(d.phasePayment) : 0,
    secondCount = phase
      ? amount(d.phaseSecondCount)
      : Math.max(0, amount(d.count) - 1),
    count = phase ? earlyCount + secondCount + 1 : amount(d.count);
  const included = (d.extras || []).filter(
      (x) => String(x.amount || "").trim() !== "",
    ),
    extraAmounts = included.map((x) => amount(x.amount));
  if (
    [
      total,
      deposit,
      payment,
      count,
      earlyCount,
      earlyPayment,
      secondCount,
      ...extraAmounts,
    ].some((n) => !Number.isFinite(n))
  )
    errors.push("أدخل مبالغ وأعداداً صحيحة موجبة أو صفراً.");
  if (!Number.isInteger(count) || count > 1200)
    errors.push("عدد الأقساط يجب أن يكون صحيحاً ولا يتجاوز 1200.");
  if (!Number.isInteger(interval) || interval < 1 || interval > 24)
    errors.push("الفاصل بين الأقساط من شهر إلى 24 شهراً.");
  if (phase && (earlyCount < 1 || earlyPayment <= 0))
    errors.push("أدخل قيمة وعدد أقساط المرحلة الأولى.");
  const extras = extraAmounts.reduce((a, b) => a + b, 0),
    remaining = total - deposit - extras,
    last =
      count >= 1
        ? remaining - earlyCount * earlyPayment - secondCount * payment
        : 0;
  if (remaining < 0)
    errors.push("المقدمة والدفعات الإضافية تتجاوز المبلغ الكلي.");
  if (remaining > 0 && count < 1)
    errors.push("أدخل عدد الأقساط شاملاً الأخير.");
  if (remaining > 0 && secondCount > 0 && payment <= 0)
    errors.push("أدخل قيمة الأقساط الاعتيادية.");
  if (remaining > 0 && count > 0 && last <= 0)
    errors.push("الأقساط تتجاوز المتبقي؛ يجب أن يكون القسط الأخير موجباً.");
  if (total > 0 && remaining === 0 && count > 0)
    errors.push("المبلغ مسدد بالكامل؛ لا حاجة لأقساط.");
  const validFirstDate = calendarDateParts(d.firstDate);
  const validContractDate = calendarDateParts(d.contractDate);
  if (d.contractDate && !validContractDate) errors.push("راجع تاريخ العقد.");
  if (count > 0 && !validFirstDate)
    errors.push("حدد تاريخ أول قسط.");
  if (deposit > 0 && !d.depositDate) errors.push("حدد تاريخ المقدمة.");
  if (included.some((x) => amount(x.amount) > 0 && !x.date))
    errors.push("حدد تاريخ كل دفعة إضافية ظاهرة.");
  if ((deposit > 0 && d.depositDate && !calendarDateParts(d.depositDate)) ||
      included.some((x) => x.date && !calendarDateParts(x.date)))
    errors.push("راجع صيغة تاريخ المقدمة أو الدفعات الإضافية.");
  if (count > 0 && validContractDate && validFirstDate && d.firstDate < d.contractDate)
    errors.push("بداية الأقساط تسبق تاريخ العقد.");
  const valid = validFirstDate && Number.isInteger(count) && count > 0 && count <= 1200 &&
      Number.isInteger(interval) && interval >= 1 && interval <= 24,
    lastDate = valid ? addMonths(d.firstDate, (count - 1) * interval) : "",
    secondDate = valid ? addMonths(d.firstDate, earlyCount * interval) : "";
  if (valid && !lastDate) errors.push("تاريخ القسط الأخير خارج النطاق المدعوم.");
  const months =
    lastDate && validContractDate
      ? (Number(lastDate.slice(0, 4)) - Number(d.contractDate.slice(0, 4))) *
          12 +
        Number(lastDate.slice(5, 7)) -
        Number(d.contractDate.slice(5, 7))
      : 0;
  return {
    total,
    deposit,
    payment,
    count,
    extras,
    remaining,
    last,
    errors,
    lastDate,
    secondDate,
    earlyCount,
    earlyPayment,
    secondCount,
    interval,
    phase,
    duration: duration(Math.max(0, months)),
  };
}
