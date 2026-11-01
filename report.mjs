// تقرير تثبيت القرآن اليومي: يقرأ من Supabase ثم ينشئ PDF ويرسله إلى تيليجرام
import fs from "node:fs";

const URL_ = "https://syuawkhtnikqoqsjdese.supabase.co";
const KEY = "sb_publishable_XENRfQEvxfWgNcGzd6unPA_JaXNOACt";
const { ADMIN_EMAIL, ADMIN_PASSWORD, TG_TOKEN, TG_CHAT, REPORT_DATE, DRY_RUN, HTML_ONLY } = process.env;

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const KEYS = ["t", "q", "l", "k"];
const LBL = { t: "ورد التثبيت", q: "مراجعة القريب", l: "ورد التلاوة", k: "ورد التخصيص" };
const DEF = [
  { t: "الحزب 1", q: "", l: "x", k: "x" }, { t: "الحزب 2", q: "الحزب 1", l: "x", k: "x" },
  { t: "الحزب 3", q: "الحزب 2", l: "x", k: "x" }, { t: "الحزب 4", q: "الحزب 3", l: "x", k: "x" },
  { t: "الحزب 5", q: "الحزب 4", l: "x", k: "x" }, { t: "الحزب 6", q: "الحزب 5", l: "x", k: "x" },
  { t: "تسميع مقرر الأسبوع", q: "الحزب 6", l: "", k: "x" }];
const maxOf = (k, day) => (k === "t" ? (day === 6 ? 0 : 7) : k === "k" ? 3 : 0);
const okv = (k, day, x) => { if (x == null) return false; const m = maxOf(k, day); return m ? x >= m : x === 1; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- تحديد تاريخ التقرير (بتوقيت الجزائر): بعد منتصف الليل = اليوم الذي انتهى
function reportDate() {
  if (REPORT_DATE) return REPORT_DATE;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - (+p.hour < 12 ? 1 : 0)));
  return d.toISOString().slice(0, 10);
}

async function api(path, token) {
  const r = await fetch(URL_ + path, { headers: { apikey: KEY, Authorization: "Bearer " + (token || KEY) } });
  if (!r.ok) throw new Error(path + " → " + r.status + " " + (await r.text()));
  return r.json();
}

async function loadData(ds) {
  if (DRY_RUN) {
    const day = (new Date(ds + "T00:00:00Z").getUTCDay() + 1) % 7;
    return {
      START: "2026-10-31", SCHED: DEF.map((x, i) => ({ ...x, l: i === 6 ? "" : "من سورة الفاتحة", k: "سورة يس" })),
      students: ["محمد أحمد", "عبد الرحمن بن سالم", "يوسف علي", "إبراهيم خليل", "أنس بن عمر", "بلال سعيد"],
      reports: [
        { name: "محمد أحمد", day_idx: day, v: { t: 7, q: 1, l: 1, k: 3 }, late: false },
        { name: "عبد الرحمن بن سالم", day_idx: day, v: { t: 4, q: 0, l: 1, k: 3 }, late: true },
        { name: "إبراهيم خليل", day_idx: day, v: { t: 7, q: 1, l: 1, k: 3 }, late: false },
        { name: "أنس بن عمر", day_idx: day, v: { t: 7, q: 1, l: 0, k: 2 }, late: false }],
    };
  }
  const login = await fetch(URL_ + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error("فشل تسجيل الدخول إلى Supabase: " + login.status);
  const token = (await login.json()).access_token;
  const [students, reports, settings] = await Promise.all([
    api("/rest/v1/students?select=name&limit=5000", token),
    api(`/rest/v1/reports?select=*&report_date=eq.${ds}&limit=5000`, token),
    api("/rest/v1/settings?select=*", token)]);
  let START = "2026-10-31", SCHED = DEF.map((x) => ({ ...x }));
  settings.forEach((r) => {
    if (r.key === "schedule" && Array.isArray(r.value) && r.value.length === 7) SCHED = r.value.map((x, i) => ({ ...DEF[i], ...x }));
    if (r.key === "start" && typeof r.value === "string") START = r.value; });
  return { START, SCHED, students: students.map((s) => s.name), reports };
}

function buildHtml(ds, { SCHED, students, reports }) {
  const i = (new Date(ds + "T00:00:00Z").getUTCDay() + 1) % 7;
  const names = [...new Set([...students, ...reports.map((r) => r.name)])].sort((a, b) => a.localeCompare(b, "ar"));
  const used = KEYS.filter((k) => (SCHED[i][k] && String(SCHED[i][k]).trim()) || reports.some((r) => k in r.v));
  const rows = names.map((n) => {
    const r = reports.find((x) => x.name === n);
    const bad = r ? Object.keys(r.v).filter((k) => !okv(k, i, r.v[k])) : [];
    return { n, r, kind: !r ? 2 : bad.length ? 1 : 0 };
  }).sort((a, b) => a.kind - b.kind || a.n.localeCompare(b.n, "ar"));
  const c = [0, 0, 0]; rows.forEach((x) => c[x.kind]++);
  const d = new Date(ds + "T00:00:00Z");
  const greg = new Intl.DateTimeFormat("ar", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
  let hij = ""; try { hij = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d); } catch {}
  const cell = (k, r) => {
    if (!r) return `<td class="bad"><span class="pill">—</span></td>`;
    if (!(k in r.v)) return `<td>—</td>`;
    const m = maxOf(k, i), x = r.v[k], ok = okv(k, i, x);
    return `<td class="${ok ? "ok" : "bad"}"><span class="pill">${m ? x + "/" + m : x === 1 ? "✓" : "✕"}</span></td>`; };
  const status = (x) => x.kind === 2 ? `<td class="bad"><span class="chip">لم يقرأ ورده</span></td>`
    : x.r.late ? `<td class="warn"><span class="chip">متأخر</span></td>`
    : x.kind === 1 ? `<td class="warn"><span class="chip">ورد ناقص</span></td>` : `<td class="ok"><span class="chip">أتمّ ورده</span></td>`;
  const body = rows.map((x, j) => `<tr><td class="num">${j + 1}</td><td class="nm">${esc(x.n)}</td>${used.map((k) => cell(k, x.r)).join("")}${status(x)}</tr>`).join("");
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=Reem+Kufi:wght@500;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:12mm}
:root{--pr:#0E5C4E;--gold:#B8923A;--gold2:#F6EEDA;--bd:#D5E1DC;--stripe:#F3F8F6;--mu:#5A6F68;--ok:#0E5C4E;--okbg:#DAEEE6;--bad:#A8432F;--badbg:#F8E5E0;--warn:#85570A;--warnbg:#F8EAC6}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",Tahoma,sans-serif;color:#10231F;font-size:12px}
.hd{background:linear-gradient(165deg,#08332D,#0E5C4E);color:#F6EFD8;text-align:center;padding:16px 12px 18px;border-radius:18px;margin-bottom:12px;border-bottom:4px solid var(--gold)}
.bsm{font-family:Amiri,serif;color:#E6CC85;font-size:16px}.hd h1{font-family:"Reem Kufi",sans-serif;font-size:28px;margin:2px 0;color:#fff}
.hd .sub{color:#E6CC85;font-size:12px}
.sum{display:flex;gap:8px;margin-bottom:12px}.sum div{flex:1;border-radius:12px;padding:8px;text-align:center;font-weight:700}
.sum small{display:block;font-weight:500;font-size:11px}
table{border-collapse:separate;border-spacing:0;width:100%;border:1px solid var(--bd);border-radius:12px;overflow:hidden}
thead{display:table-header-group}tr{break-inside:avoid}
th{background:linear-gradient(180deg,#0E5C4E,#08332D);color:#F6EFD8;font-family:"Reem Kufi",sans-serif;font-weight:500;padding:9px 8px;text-align:right;border-bottom:3px solid var(--gold)}
td{padding:7px 8px;border-bottom:1px solid var(--bd);text-align:right}tr:nth-child(even) td{background:var(--stripe)}
.num{color:var(--mu);width:28px}.nm{font-weight:500}
.pill,.chip{display:inline-block;border-radius:99px;font-weight:700;padding:1px 10px}.pill{min-width:34px;text-align:center}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.ok .pill,.ok .chip{background:var(--okbg)}.bad .pill,.bad .chip{background:var(--badbg)}.warn .chip{background:var(--warnbg)}
.ft{text-align:center;font-family:Amiri,serif;color:var(--gold);font-size:16px;margin-top:12px}
</style></head><body>
<div class="hd"><div class="bsm">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div><h1>تقرير تثبيت القرآن</h1><div class="sub">${DAYS[i]} — ${greg}${hij ? " • " + hij : ""}</div></div>
<div class="sum"><div style="background:var(--okbg);color:var(--ok)">${c[0]}<small>أتمّوا أوردتهم</small></div><div style="background:var(--warnbg);color:var(--warn)">${c[1]}<small>ورد ناقص</small></div><div style="background:var(--badbg);color:var(--bad)">${c[2]}<small>لم يقرؤوا أوردتهم</small></div></div>
<table><thead><tr><th>#</th><th>الطالب</th>${used.map((k) => `<th>${LBL[k]}</th>`).join("")}<th>الحالة</th></tr></thead><tbody>${body}</tbody></table>
<div class="ft">وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا</div></body></html>`;
}

const ds = reportDate();
const data = await loadData(ds);
if (ds < data.START) { console.log("قبل بداية البرنامج، لا إرسال:", ds, "<", data.START); process.exit(0); }
const html = buildHtml(ds, data);
if (HTML_ONLY) { fs.writeFileSync("report.html", html); console.log("report.html"); process.exit(0); }

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
if (DRY_RUN) { fs.writeFileSync("report.pdf", pdf); console.log("report.pdf"); process.exit(0); }

const i = (new Date(ds + "T00:00:00Z").getUTCDay() + 1) % 7;
const names = new Set([...data.students, ...data.reports.map((r) => r.name)]);
const caption = `📖 تقرير تثبيت القرآن\n${DAYS[i]} ${ds}\n✅ ${data.reports.length} أرسلوا من ${names.size}`;
const form = new FormData();
form.append("chat_id", TG_CHAT); form.append("caption", caption);
form.append("document", new Blob([pdf], { type: "application/pdf" }), `tathbeet-${ds}.pdf`);
const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, { method: "POST", body: form });
const out = await res.json();
if (!out.ok) throw new Error("فشل إرسال تيليجرام: " + JSON.stringify(out));
console.log("تم الإرسال ✅", ds);
