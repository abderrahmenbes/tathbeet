// تقرير تثبيت القرآن: يومي (PDF) + أسبوعي (PDF) + تذكير مسائي (رسالة) — يُرسَل إلى تيليجرام
import fs from "node:fs";

const URL_ = process.env.SB_URL || "https://syuawkhtnikqoqsjdese.supabase.co";
const TG_API = process.env.TG_API || "https://api.telegram.org";
const KEY = "sb_publishable_XENRfQEvxfWgNcGzd6unPA_JaXNOACt";
const { ADMIN_EMAIL, ADMIN_PASSWORD, TG_TOKEN, TG_CHAT, REPORT_DATE, DRY_RUN, HTML_ONLY, SCHEDULE } = process.env;
// نوع التقرير يُستنتج من موعد الجدولة (عدة مواعيد متقاربة لكل نوع، والتكرار تمنعه علامة الإرسال)
function modeFor(c) {
  if (!c) return "daily";
  const f = c.trim().split(/\s+/);
  if (f[4] === "5" || f[4] === "6") return "weekly";
  if (f[1] === "20") return "reminder";
  return "daily";
}
const MODE = (process.env.MODE || "").trim() || modeFor(SCHEDULE);

// التقرير اليومي/الأسبوعي يُنشأ عند 23:57 بتوقيت الجزائر (= 22:57 UTC) ليُسمح للمتأخرين بالتسجيل في نفس اليوم.
// المواعيد المبكرة تنتظر حتى هذا الوقت (فتتحمل تأخر GitHub)، والمواعيد التي بعد منتصف الليل احتياطية وترسل فورًا.
const WAKE = { "37 21 * * *": 0, "7 22 * * *": 20, "37 22 * * *": 40, "42 21 * * 5": 60, "12 22 * * 5": 80, "42 22 * * 5": 100 };
export function waitMs(nowMs, schedule) {
  const off = WAKE[(schedule || "").trim()];
  if (off === undefined) return 0;
  const n = new Date(nowMs);
  const target = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 22, 57, 0) + off * 1000;
  const ms = target - nowMs;
  return ms > 0 && ms < 2 * 3600e3 ? ms : 0;
}

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
const dIdx = (ds) => (new Date(ds + "T00:00:00Z").getUTCDay() + 1) % 7;
const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtG = (ds) => new Intl.DateTimeFormat("ar", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(ds + "T00:00:00Z"));
const fmtH = (ds) => { try { return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(ds + "T00:00:00Z")); } catch { return ""; } };
const usedItems = (SCHED, i) => KEYS.filter((k) => SCHED[i][k] && String(SCHED[i][k]).trim());

// تاريخ اليوم بتوقيت الجزائر؛ قبل الظهر = اليوم الذي انتهى (تشغيل منتصف الليل)
function reportDate() {
  if (REPORT_DATE) return REPORT_DATE;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return addDays(`${p.year}-${p.month}-${p.day}`, +p.hour < 12 ? -1 : 0);
}

async function api(path, token) {
  const r = await fetch(URL_ + path, { headers: { apikey: KEY, Authorization: "Bearer " + (token || KEY) } });
  if (!r.ok) throw new Error(path + " → " + r.status + " " + (await r.text()));
  return r.json();
}

let TOKEN = null;
async function getToken() {
  if (TOKEN) return TOKEN;
  const login = await fetch(URL_ + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error("فشل تسجيل الدخول إلى Supabase: " + login.status);
  TOKEN = (await login.json()).access_token;
  return TOKEN;
}
// علامة الإرسال: أول تشغيل يرسل، وبقية المواعيد المتقاربة تتخطى (التشغيل اليدوي يرسل دائمًا)
const FORCE = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || !!REPORT_DATE;
async function setMarker(key, value, token) {
  const r = await fetch(URL_ + "/rest/v1/settings?on_conflict=key", { method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key, value }]) });
  if (!r.ok) console.log("تنبيه: تعذّر حفظ علامة الإرسال", r.status);
}
async function once(key, value, fn) {
  if (DRY_RUN || HTML_ONLY || FORCE) return fn();
  const token = await getToken();
  const cur = await api(`/rest/v1/settings?key=eq.${key}&select=value`, token);
  if (cur[0] && cur[0].value === value) { console.log("أُرسل مسبقًا، تخطّي:", key, value); return; }
  await setMarker(key, value, token);
  try { await fn(); } catch (e) { await setMarker(key, cur[0] ? cur[0].value : "", token); throw e; }
}
async function loadData(start, end) {
  if (DRY_RUN) {
    const SCHED = DEF.map((x, i) => ({ ...x, l: i === 6 ? "" : "من سورة الفاتحة", k: "سورة يس" }));
    const students = ["محمد أحمد", "عبد الرحمن بن سالم", "يوسف علي", "إبراهيم خليل", "أنس بن عمر", "بلال سعيد"];
    const reports = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const i = dIdx(d);
      students.forEach((n, s) => {
        if ((s * 3 + i) % 5 === 0 && s > 1) return;
        const v = {}; usedItems(SCHED, i).forEach((k) => { const m = maxOf(k, i); v[k] = (s + i) % 4 === 0 && k === "l" ? 0 : m ? (s === 3 && k === "t" ? 4 : m) : 1; });
        reports.push({ name: n, report_date: d, day_idx: i, v, late: (s + i) % 6 === 0 });
      });
    }
    return { START: "2026-10-31", SCHED, students, reports };
  }
  const token = await getToken();
  const [students, reports, settings] = await Promise.all([
    api("/rest/v1/students?select=name&limit=5000", token),
    api(`/rest/v1/reports?select=*&report_date=gte.${start}&report_date=lte.${end}&limit=10000`, token),
    api("/rest/v1/settings?select=*", token)]);
  let START = "2026-10-31", SCHED = DEF.map((x) => ({ ...x }));
  settings.forEach((r) => {
    if (r.key === "schedule" && Array.isArray(r.value) && r.value.length === 7) SCHED = r.value.map((x, i) => ({ ...DEF[i], ...x }));
    if (r.key === "start" && typeof r.value === "string") START = r.value; });
  return { START, SCHED, students: students.map((s) => s.name), reports };
}

const STYLE = `<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=Reem+Kufi:wght@500;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:12mm}
:root{--pr:#0E5C4E;--gold:#B8923A;--gold2:#F6EEDA;--bd:#D5E1DC;--stripe:#F3F8F6;--mu:#5A6F68;--ok:#0E5C4E;--okbg:#DAEEE6;--bad:#A8432F;--badbg:#F8E5E0;--warn:#85570A;--warnbg:#F8EAC6}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",Tahoma,sans-serif;color:#10231F;font-size:15px}
.hd{background:linear-gradient(165deg,#08332D,#0E5C4E);color:#F6EFD8;text-align:center;padding:16px 12px 18px;border-radius:18px;margin-bottom:12px;border-bottom:4px solid var(--gold)}
.bsm{font-family:Amiri,serif;color:#E6CC85;font-size:16px}.hd h1{font-family:"Reem Kufi",sans-serif;font-size:28px;margin:2px 0;color:#fff}
.hd .sub{color:#E6CC85;font-size:14px}
.sum{display:flex;gap:8px;margin-bottom:12px}.sum div{flex:1;border-radius:12px;padding:10px 8px;text-align:center;font-weight:700;font-size:21px}
.sum small{display:block;font-weight:500;font-size:13px}
table{border-collapse:separate;border-spacing:0;width:100%;border:1px solid var(--bd);border-radius:12px;overflow:hidden}
thead{display:table-header-group}tr{break-inside:avoid}
th{background:linear-gradient(180deg,#0E5C4E,#08332D);color:#F6EFD8;font-family:"Reem Kufi",sans-serif;font-weight:500;font-size:15px;padding:11px 8px;text-align:right;border-bottom:3px solid var(--gold)}
td{padding:9px 8px;font-size:15px;border-bottom:1px solid var(--bd);text-align:right}tr:nth-child(even) td{background:var(--stripe)}
.num{color:var(--mu);width:34px}.nm{font-weight:500}
.pill,.chip{display:inline-block;border-radius:99px;font-weight:700;font-size:14px;padding:2px 11px}.pill{min-width:34px;text-align:center}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.ok .pill,.ok .chip{background:var(--okbg)}.bad .pill,.bad .chip{background:var(--badbg)}.warn .chip{background:var(--warnbg)}
.ft{text-align:center;font-family:Amiri,serif;color:var(--gold);font-size:16px;margin-top:12px}
.hon{display:flex;gap:10px;margin-bottom:14px}.hon .c{flex:1;border:1.5px solid var(--gold);background:var(--gold2);border-radius:16px;padding:10px 6px;text-align:center}
.hon .m{width:34px;height:34px;border-radius:50%;margin:0 auto 4px;color:#fff;font-weight:700;font-size:17px;line-height:34px;font-family:"Reem Kufi",sans-serif}
.hon .n{font-weight:700;font-size:15px}.hon .p{color:var(--pr);font-weight:700;font-size:21px}
.bar{height:7px;background:#E2EEE9;border-radius:6px;overflow:hidden;min-width:70px}.bar i{display:block;height:100%;background:#0E5C4E}
</style>`;
const HEAD = (title, sub) => `<div class="hd"><div class="bsm">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div><h1>${title}</h1><div class="sub">${sub}</div></div>`;
const PAGE = (inner) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${STYLE}</head><body>${inner}<div class="ft">وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا</div></body></html>`;

function buildDaily(ds, { SCHED, students, reports }) {
  const i = dIdx(ds);
  const names = [...new Set([...students, ...reports.map((r) => r.name)])].sort((a, b) => a.localeCompare(b, "ar"));
  const used = KEYS.filter((k) => (SCHED[i][k] && String(SCHED[i][k]).trim()) || reports.some((r) => k in r.v));
  const rows = names.map((n) => {
    const r = reports.find((x) => x.name === n);
    const bad = r ? Object.keys(r.v).filter((k) => !okv(k, i, r.v[k])) : [];
    return { n, r, kind: !r ? 2 : bad.length ? 1 : 0 };
  }).sort((a, b) => a.kind - b.kind || a.n.localeCompare(b.n, "ar"));
  const c = [0, 0, 0]; rows.forEach((x) => c[x.kind]++);
  const cell = (k, r) => {
    if (!r) return `<td class="bad"><span class="pill">—</span></td>`;
    if (!(k in r.v)) return `<td>—</td>`;
    const m = maxOf(k, i), x = r.v[k], ok = okv(k, i, x);
    return `<td class="${ok ? "ok" : "bad"}"><span class="pill">${m ? x + "/" + m : x === 1 ? "✓" : "✕"}</span></td>`; };
  const status = (x) => x.kind === 2 ? `<td class="bad"><span class="chip">لم يقرأ ورده</span></td>`
    : x.r.late ? `<td class="warn"><span class="chip">متأخر</span></td>`
    : x.kind === 1 ? `<td class="warn"><span class="chip">ورد ناقص</span></td>` : `<td class="ok"><span class="chip">أتمّ ورده</span></td>`;
  const body = rows.map((x, j) => `<tr><td class="num">${j + 1}</td><td class="nm">${esc(x.n)}</td>${used.map((k) => cell(k, x.r)).join("")}${status(x)}</tr>`).join("");
  const h = fmtH(ds);
  return PAGE(HEAD("تقرير تثبيت القرآن", `${DAYS[i]} — ${fmtG(ds)}${h ? " • " + h : ""}`) +
    `<div class="sum"><div style="background:var(--okbg);color:var(--ok)">${c[0]}<small>أتمّوا وردهم</small></div><div style="background:var(--warnbg);color:var(--warn)">${c[1]}<small>ورد ناقص</small></div><div style="background:var(--badbg);color:var(--bad)">${c[2]}<small>لم يقرءوا وردهم</small></div></div>
<table><thead><tr><th>#</th><th>الطالب</th>${used.map((k) => `<th>${LBL[k]}</th>`).join("")}<th>الحالة</th></tr></thead><tbody>${body}</tbody></table>`);
}

function weeklyStats(start, end, { START, SCHED, students, reports }) {
  const days = []; for (let d = start; d <= end; d = addDays(d, 1)) if (d >= START) days.push({ ds: d, i: dIdx(d) });
  const expected = days.reduce((s, d) => s + usedItems(SCHED, d.i).length, 0);
  const names = [...new Set([...students, ...reports.map((r) => r.name)])];
  const rows = names.map((n) => {
    const rs = reports.filter((r) => r.name === n && r.report_date >= START);
    let done = 0; rs.forEach((r) => Object.keys(r.v).forEach((k) => { if (okv(k, r.day_idx, r.v[k])) done++; }));
    const sent = new Set(rs.map((r) => r.report_date));
    return { n, sent: sent.size, pct: expected ? Math.min(100, Math.round((done / expected) * 100)) : 0,
      late: rs.filter((r) => r.late).length, miss: days.filter((d) => !sent.has(d.ds)) };
  }).sort((a, b) => b.pct - a.pct || a.n.localeCompare(b.n, "ar"));
  return { days, rows };
}

function buildWeekly(start, end, data) {
  const { days, rows } = weeklyStats(start, end, data);
  const medal = ["#C8A24A", "#9AA6A3", "#B4763F"];
  const top = rows.filter((r) => r.pct > 0).slice(0, 3);
  const hon = top.length ? `<div class="hon">${top.map((r, j) => `<div class="c"><div class="m" style="background:${medal[j]}">${j + 1}</div><div class="n">${esc(r.n)}</div><div class="p">${r.pct}%</div></div>`).join("")}</div>` : "";
  const body = rows.map((r, j) => `<tr><td class="num">${j + 1}</td><td class="nm">${esc(r.n)}</td><td>${r.sent}/${days.length}</td><td><b>${r.pct}%</b><div class="bar"><i style="width:${r.pct}%"></i></div></td><td>${r.late}</td><td class="${r.miss.length ? "bad" : "ok"}">${r.miss.length ? r.miss.map((d) => DAYS[d.i]).join("، ") : "—"}</td></tr>`).join("");
  return PAGE(HEAD("التقرير الأسبوعي", `من ${fmtG(start)} إلى ${fmtG(end)}`) + hon +
    `<table><thead><tr><th>#</th><th>الطالب</th><th>أيام الإرسال</th><th>الإنجاز</th><th>التأخر</th><th>أيام لم يقرأ فيها ورده</th></tr></thead><tbody>${body}</tbody></table>`);
}

const IDS = (TG_CHAT || "").split(",").map((x) => x.trim()).filter(Boolean);
// المستلمون = أرقام TG_CHAT (المشرف) + من انضم من البوت عبر رابط الدعوة (يحفظها join.mjs في settings)
async function allIds() {
  const set = new Set(IDS);
  if (!DRY_RUN && !HTML_ONLY) {
    try {
      const rec = await api("/rest/v1/settings?key=eq.recipients&select=value", await getToken());
      if (rec[0] && Array.isArray(rec[0].value)) rec[0].value.forEach((x) => set.add(String(x.id)));
    } catch (e) { console.log("تنبيه: تعذّرت قراءة قائمة المستلمين:", e.message); }
  }
  return [...set];
}
async function toAll(send) {
  let ok = 0; const errs = [];
  for (const id of await allIds()) { try { await send(id); ok++; } catch (e) { errs.push(id + ": " + e.message); } }
  if (errs.length) console.log("تنبيه: تعذّر الإرسال إلى:", errs.join(" | "));
  if (!ok) throw new Error("لم يصل التقرير إلى أي مستلم");
}
async function tg(method, body) {
  const res = await fetch(`${TG_API}/bot${TG_TOKEN}/${method}`, body instanceof FormData ? { method: "POST", body }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!out.ok) throw new Error("فشل إرسال تيليجرام: " + JSON.stringify(out));
}

async function sendPdf(html, filename, caption) {
  if (HTML_ONLY) { fs.writeFileSync("report.html", html); console.log("report.html"); return; }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  if (DRY_RUN) { fs.writeFileSync("report.pdf", pdf); console.log("report.pdf"); return; }
  await toAll(async (id) => {
    const form = new FormData();
    form.append("chat_id", id); form.append("caption", caption);
    form.append("document", new Blob([pdf], { type: "application/pdf" }), filename);
    await tg("sendDocument", form);
  });
  console.log("تم الإرسال ✅", filename);
}

const wait = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || REPORT_DATE ? 0 : waitMs(Date.now(), SCHEDULE);
if (wait) { console.log("انتظار حتى 23:57 بتوقيت الجزائر:", Math.round(wait / 60000), "دقيقة"); await new Promise((res) => setTimeout(res, wait)); }
const ds = reportDate();
if (MODE === "weekly") {
  await once("sent_weekly", ds, async () => {
    const start = addDays(ds, -6), data = await loadData(start, ds);
    if (ds < data.START) { console.log("قبل بداية البرنامج"); return; }
    const { rows } = weeklyStats(start, ds, data);
    const top = rows.filter((r) => r.pct > 0).slice(0, 3).map((r, j) => ["🥇", "🥈", "🥉"][j] + " " + r.n + " " + r.pct + "%").join("\n");
    await sendPdf(buildWeekly(start, ds, data), `tathbeet-week-${ds}.pdf`, `📊 التقرير الأسبوعي لتثبيت القرآن\n${start} → ${ds}${top ? "\n\n" + top : ""}`);
  });
} else if (MODE === "reminder") {
  await once("sent_reminder", ds, async () => {
    const data = await loadData(ds, ds);
    if (ds < data.START) { console.log("قبل بداية البرنامج"); return; }
    const names = [...new Set([...data.students, ...data.reports.map((r) => r.name)])].sort((a, b) => a.localeCompare(b, "ar"));
    const sent = new Set(data.reports.map((r) => r.name));
    const miss = names.filter((n) => !sent.has(n));
    const text = miss.length
      ? `⏰ تذكير تثبيت القرآن\nلم يرسل أوراد اليوم بعد (${miss.length} من ${names.length}):\n\n${miss.map((n, j) => `${j + 1}. ${n}`).join("\n")}\n\nالموعد الأخير: قبل الساعة 11:30 مساءً.`
      : `✅ جميع الطلاب (${names.length}) أرسلوا أوراد اليوم، بارك الله فيهم.`;
    if (DRY_RUN || HTML_ONLY) console.log(text); else { await toAll((id) => tg("sendMessage", { chat_id: id, text })); console.log("تم إرسال التذكير ✅"); }
  });
} else {
  await once("sent_daily", ds, async () => {
    const data = await loadData(ds, ds);
    if (ds < data.START) { console.log("قبل بداية البرنامج، لا إرسال:", ds, "<", data.START); return; }
    const names = new Set([...data.students, ...data.reports.map((r) => r.name)]);
    await sendPdf(buildDaily(ds, data), `tathbeet-${ds}.pdf`, `📖 تقرير تثبيت القرآن\n${DAYS[dIdx(ds)]} ${ds}\n✅ ${data.reports.length} أرسلوا من ${names.size}`);
  });
}
