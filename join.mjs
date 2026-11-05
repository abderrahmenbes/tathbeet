// انضمام المستلمين من البوت: الشخص يضغط رابط الدعوة ثم Start، فيُضاف تلقائيًا لاستلام التقارير
const URL_ = process.env.SB_URL || "https://syuawkhtnikqoqsjdese.supabase.co";
const KEY = "sb_publishable_XENRfQEvxfWgNcGzd6unPA_JaXNOACt";
const TG_API = process.env.TG_API || "https://api.telegram.org";
const { ADMIN_EMAIL, ADMIN_PASSWORD, TG_TOKEN, TG_CHAT, JOIN_CODE } = process.env;
const adminIds = (TG_CHAT || "").split(",").map((x) => x.trim()).filter(Boolean);

async function tg(method, body) {
  const r = await fetch(`${TG_API}/bot${TG_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
const say = (id, text) => tg("sendMessage", { chat_id: id, text }).catch(() => {});

const login = await fetch(URL_ + "/auth/v1/token?grant_type=password", {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
if (!login.ok) throw new Error("فشل تسجيل الدخول إلى Supabase: " + login.status);
const token = (await login.json()).access_token;
const H = { apikey: KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" };
async function getSetting(key) {
  const r = await fetch(`${URL_}/rest/v1/settings?key=eq.${key}&select=value`, { headers: H });
  const a = await r.json(); return a[0] ? a[0].value : undefined;
}
async function setSetting(key, value) {
  const r = await fetch(URL_ + "/rest/v1/settings?on_conflict=key", { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify([{ key, value }]) });
  if (!r.ok) throw new Error("تعذّر حفظ " + key + ": " + r.status);
}

const offset = Number(await getSetting("tg_offset")) || 0;
const up = await tg("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
if (!up.ok) throw new Error("getUpdates: " + JSON.stringify(up));
let recips = await getSetting("recipients"); if (!Array.isArray(recips)) recips = [];
let changed = false, last = offset - 1;

for (const u of up.result) {
  last = Math.max(last, u.update_id);
  const m = u.message;
  if (!m || !m.text || !m.chat || m.chat.type !== "private") continue;
  const id = String(m.chat.id), text = m.text.trim();
  const name = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(" ") || (m.from && m.from.username) || id;
  const [cmd, arg] = text.split(/\s+/);
  const c = cmd.split("@")[0].toLowerCase();
  const isAdmin = adminIds.includes(id), isRec = recips.some((r) => r.id === id);
  if (c === "/start") {
    if (isAdmin) { await say(id, "أنت مسجَّل كمشرف، وتصلك كل التقارير."); continue; }
    if (isRec) { await say(id, "أنت مسجَّل بالفعل، وستصلك التقارير بإذن الله. لإيقاف الاستلام أرسل /stop"); continue; }
    if (!JOIN_CODE || arg !== JOIN_CODE) { await say(id, "هذا البوت خاص ببرنامج تثبيت القرآن. اطلب رابط الانضمام من المشرف."); continue; }
    recips.push({ id, name, at: new Date().toISOString().slice(0, 10) }); changed = true;
    await say(id, "✅ تم تسجيلك لاستلام تقارير تثبيت القرآن.\nستصلك التقارير اليومية والأسبوعية بإذن الله.\nلإيقاف الاستلام أرسل /stop");
    for (const a of adminIds) await say(a, "👤 انضم مستلم جديد للتقارير: " + name);
  } else if (c === "/stop") {
    if (isRec) { recips = recips.filter((r) => r.id !== id); changed = true; await say(id, "تم إيقاف استلام التقارير. للعودة أرسل /start"); }
    else await say(id, "أنت غير مسجَّل في قائمة المستلمين.");
  } else if (isRec || isAdmin) {
    await say(id, "أرسل /stop لإيقاف استلام التقارير.");
  }
}
if (changed) await setSetting("recipients", recips);
if (up.result.length) await setSetting("tg_offset", last + 1);
console.log("تمت المعالجة:", up.result.length, "رسالة، المستلمون:", recips.length);
