import React, { useState, useEffect, useMemo } from "react";
import {
  Store, ClipboardList, Package, TrendingUp, Plus, LogOut, Lock,
  User, Users, Loader2, ShieldCheck, ArrowLeft, Send, X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Settings. Password badalvo hoy to ahi badlo.
// ---------------------------------------------------------------------------
export const SO_ROLE = "Sales Officer";
export const SE_ROLE = "Sales Executive";
const SO_PASSWORD = "112137";
const SE_PASSWORD = "112137";          // Executive nu password ahi badli shako
const SELECTED_STATUS = "પસંદ થયા";     // admin panel ma aa status vala j login kari shake
const DAILY_VISIT_TARGET = 12;          // ek executive nu roj nu visit target
const OWNER_WHATSAPP = "919898154548";  // daily report aa number par jashe

const NAVY = "#0B1F5C";
const YELLOW = "#FFD21F";
const DARK = "#0E1424";
const DARK2 = "#172038";

const KINDS = [
  { key: "shop", label: "નવી દુકાન", needsAmount: false },
  { key: "order", label: "ઓર્ડર", needsAmount: true },
  { key: "followup", label: "ફોલો-અપ", needsAmount: false },
  { key: "payment", label: "પેમેન્ટ", needsAmount: true },
];
const kindLabel = (k) => (KINDS.find((x) => x.key === k) || { label: k }).label;

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();
const isThisMonth = (t) => {
  const d = new Date(t), n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
};
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const timeOf = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const sum = (list) => list.reduce((s, v) => s + (Number(v.amount) || 0), 0);

const inputStyle = {
  width: "100%", boxSizing: "border-box", border: "1px solid #d9dce3", background: "#fff",
  borderRadius: 10, padding: "12px 12px", fontSize: 14, color: "#1a1d26", outline: "none", fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// GATE: Loading -> Who are you? -> Admin / Sales Officer / Sales Executive
// ---------------------------------------------------------------------------
export function SalesGate({ applications, onAdminLogin, onSuccess }) {
  const [step, setStep] = useState("loading"); // loading | who | admin | name | pass
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setStep("who"), 1300);
    return () => clearTimeout(t);
  }, []);

  const goBack = () => { setErr(""); setPw(""); setStep(step === "pass" ? "name" : "who"); };

  const submitAdmin = (e) => {
    e.preventDefault();
    if (!onAdminLogin(pw)) setErr("ખોટો PIN. ફરી પ્રયત્ન કરો.");
  };
  const submitName = (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return setErr("નામ લખો.");
    setErr(""); setStep("pass");
  };
  const submitPass = (e) => {
    e.preventDefault();
    const need = role === SO_ROLE ? SO_PASSWORD : SE_PASSWORD;
    const match = applications.find(
      (a) => a.job === role && a.status === SELECTED_STATUS && norm(a.name) === norm(name)
    );
    if (pw === need && match) onSuccess({ role, name: match.name, id: match.id });
    else setErr("નામ અથવા પાસવર્ડ ખોટો છે. નામ અરજીમાં લખ્યા મુજબ જ લખો.");
  };

  const wrap = { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" };
  const bigBtn = (bg, fg) => ({
    width: "100%", maxWidth: 280, display: "flex", alignItems: "center", gap: 12, background: bg, color: fg,
    border: "none", borderRadius: 14, padding: "15px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", marginTop: 10, textAlign: "left",
  });
  const backBtn = (
    <button type="button" onClick={goBack} style={{ border: "none", background: "transparent", color: "#6b6555", marginTop: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit", fontSize: 13 }}>
      <ArrowLeft size={14} /> પાછા
    </button>
  );
  const mainBtn = { ...bigBtn(NAVY, "#fff"), justifyContent: "center", marginTop: 14 };

  if (step === "loading") {
    return (
      <div style={wrap}>
        <style>{`@keyframes sdspin{to{transform:rotate(360deg)}}`}</style>
        <Loader2 size={34} color={NAVY} style={{ animation: "sdspin 1s linear infinite" }} />
        <p style={{ color: "#6b6555", marginTop: 12, fontSize: 14, letterSpacing: 1 }}>Loading.......</p>
      </div>
    );
  }

  if (step === "who") {
    return (
      <div style={wrap}>
        <ShieldCheck size={34} color={NAVY} />
        <p style={{ fontSize: 20, fontWeight: 800, color: "#1a1d26", margin: "10px 0 2px" }}>Who are you?</p>
        <p style={{ fontSize: 12, color: "#6b6555", margin: "0 0 10px" }}>તમે કોણ છો? પસંદ કરો</p>
        <button style={bigBtn("#2c2a26", "#fff")} onClick={() => { setErr(""); setPw(""); setStep("admin"); }}>
          <Lock size={20} color={YELLOW} /> Admin
        </button>
        <button style={bigBtn(DARK, "#fff")} onClick={() => { setRole(SO_ROLE); setErr(""); setPw(""); setStep("name"); }}>
          <Users size={20} color={YELLOW} /> Sales Officer
        </button>
        <button style={bigBtn(NAVY, "#fff")} onClick={() => { setRole(SE_ROLE); setErr(""); setPw(""); setStep("name"); }}>
          <User size={20} color={YELLOW} /> Sales Executive
        </button>
      </div>
    );
  }

  if (step === "admin") {
    return (
      <form style={wrap} onSubmit={submitAdmin}>
        <Lock size={32} color="#8a8378" />
        <p style={{ color: "#6b6555", margin: "12px 0" }}>એડમિન PIN નાખો</p>
        <input style={{ ...inputStyle, textAlign: "center", letterSpacing: 4, width: 160 }} type="password" inputMode="numeric"
          value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} placeholder="••••" autoFocus />
        {err && <div style={{ color: "#b23b3b", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button type="submit" style={{ ...mainBtn, maxWidth: 160 }}>લોગિન</button>
        {backBtn}
      </form>
    );
  }

  if (step === "name") {
    return (
      <form style={wrap} onSubmit={submitName}>
        <User size={32} color="#8a8378" />
        <p style={{ fontWeight: 800, color: "#1a1d26", margin: "10px 0 2px" }}>{role}</p>
        <p style={{ color: "#6b6555", fontSize: 13, margin: "0 0 12px" }}>તમારું નામ લખો</p>
        <input style={{ ...inputStyle, textAlign: "center", maxWidth: 260 }} value={name}
          onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="પૂરું નામ" autoFocus />
        {err && <div style={{ color: "#b23b3b", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button type="submit" style={{ ...mainBtn, maxWidth: 260 }}>આગળ</button>
        {backBtn}
      </form>
    );
  }

  return (
    <form style={wrap} onSubmit={submitPass}>
      <Lock size={32} color="#8a8378" />
      <p style={{ fontWeight: 800, color: "#1a1d26", margin: "10px 0 2px" }}>{name.trim()}</p>
      <p style={{ color: "#6b6555", fontSize: 13, margin: "0 0 12px" }}>પાસવર્ડ નાખો</p>
      <input style={{ ...inputStyle, textAlign: "center", letterSpacing: 4, maxWidth: 260 }} type="password" inputMode="numeric"
        value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} placeholder="••••••" autoFocus />
      {err && <div style={{ color: "#b23b3b", fontSize: 12, marginTop: 8, maxWidth: 260 }}>{err}</div>}
      <button type="submit" style={{ ...mainBtn, maxWidth: 260 }}>લોગિન</button>
      {backBtn}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Visit entry form (Sales Executive)
// ---------------------------------------------------------------------------
function VisitForm({ onSave, onCancel }) {
  const [shop, setShop] = useState("");
  const [kind, setKind] = useState("order");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const needsAmount = (KINDS.find((k) => k.key === kind) || {}).needsAmount;

  const save = async () => {
    if (shop.trim().length < 2) return setErr("દુકાનનું નામ લખો.");
    if (needsAmount && !(Number(amount) > 0)) return setErr("રકમ લખો.");
    setErr(""); setSaving(true);
    try {
      await onSave({ shop: shop.trim(), kind, amount: needsAmount ? Number(amount) : 0, note: note.trim() });
      onCancel();
    } catch (e) {
      console.error(e);
      setErr("સેવ થયું નહીં, ફરી પ્રયત્ન કરો.");
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 14, margin: "0 12px 12px", border: "1px solid #e3e6ee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 800, color: NAVY }}>Visit entry</span>
        <button onClick={onCancel} aria-label="બંધ કરો" style={{ border: "none", background: "transparent", cursor: "pointer" }}><X size={18} color="#5b6483" /></button>
      </div>
      <input style={inputStyle} value={shop} onChange={(e) => setShop(e.target.value)} placeholder="દુકાનનું નામ" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
        {KINDS.map((k) => (
          <button key={k.key} onClick={() => setKind(k.key)} style={{
            border: `1px solid ${kind === k.key ? NAVY : "#d9dce3"}`, background: kind === k.key ? NAVY : "#fff",
            color: kind === k.key ? "#fff" : "#1a1d26", borderRadius: 20, padding: "7px 12px", fontSize: 13,
            cursor: "pointer", fontFamily: "inherit",
          }}>{k.label}</button>
        ))}
      </div>
      {needsAmount && (
        <input style={{ ...inputStyle, marginBottom: 10 }} type="number" inputMode="numeric" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="રકમ ₹" />
      )}
      <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="નોંધ (વૈકલ્પિક)" />
      {err && <div style={{ color: "#b23b3b", fontSize: 12, marginTop: 8 }}>{err}</div>}
      <button onClick={save} disabled={saving} style={{
        width: "100%", background: YELLOW, color: NAVY, border: "none", borderRadius: 12, padding: "13px 0",
        fontWeight: 800, fontSize: 14, marginTop: 12, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1,
      }}>{saving ? "સેવ થાય છે..." : "સેવ કરો"}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SALES EXECUTIVE dashboard  (Design 2: navy + yellow brand tiles)
// ---------------------------------------------------------------------------
function ExecDashboard({ user, visits, onAddVisit, onLogout }) {
  const [open, setOpen] = useState(false);
  const today = useMemo(
    () => visits.filter((v) => v.by === user.id && isToday(v.createdAt)).sort((a, b) => b.createdAt - a.createdAt),
    [visits, user.id]
  );
  const shops = today.filter((v) => v.kind === "shop").length;
  const orders = today.filter((v) => v.kind === "order");
  const pct = Math.min(100, Math.round((today.length / DAILY_VISIT_TARGET) * 100));

  const tiles = [
    { Icon: Store, label: "Shop Onboard", value: shops, bg: YELLOW, fg: NAVY },
    { Icon: ClipboardList, label: "Orders", value: orders.length, bg: "#22A06B", fg: "#fff" },
    { Icon: Package, label: "Product Sell", value: rupee(sum(orders)), bg: "#F5822B", fg: "#fff" },
    { Icon: TrendingUp, label: "Reporting", value: today.length > 0 ? "થઈ ગયું" : "બાકી", bg: "#7B4FD8", fg: "#fff" },
  ];

  return (
    <div style={{ background: "#F3F5FA", color: NAVY, minHeight: "100%", paddingBottom: 20 }}>
      <div style={{ background: NAVY, color: "#fff", padding: "14px 14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: YELLOW }}>apnidukanSE.in · Sales Executive</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>નમસ્તે, {user.name}</div>
        </div>
        <button onClick={onLogout} aria-label="લોગઆઉટ" style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LogOut size={17} color="#fff" />
        </button>
      </div>

      <div style={{ background: YELLOW, margin: "12px 12px 0", borderRadius: 14, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12 }}>આજની visits</span>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{today.length} / {DAILY_VISIT_TARGET}</span>
        </div>
        <div style={{ height: 8, background: "rgba(11,31,92,0.2)", borderRadius: 4, marginTop: 8 }}>
          <div style={{ height: 8, width: pct + "%", background: NAVY, borderRadius: 4 }} />
        </div>
      </div>

      <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "#fff", borderRadius: 14, padding: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <t.Icon size={18} />
            </div>
            <div style={{ fontSize: 11, color: "#5b6483", marginTop: 8 }}>{t.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{t.value}</div>
          </div>
        ))}
      </div>

      {open ? (
        <VisitForm onSave={onAddVisit} onCancel={() => setOpen(false)} />
      ) : (
        <button onClick={() => setOpen(true)} style={{
          width: "calc(100% - 24px)", margin: "0 12px 12px", background: NAVY, color: "#fff", border: "none",
          borderRadius: 12, padding: "13px 0", fontWeight: 800, fontSize: 14, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit",
        }}>
          <Plus size={18} color={YELLOW} /> Visit entry add કરો
        </button>
      )}

      <div style={{ padding: "0 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>આજની visits</div>
        {today.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 10, padding: 12, fontSize: 13, color: "#5b6483" }}>
            હજુ કોઈ visit નથી. પહેલી દુકાનની entry ઉમેરો.
          </div>
        )}
        {today.map((v) => (
          <div key={v.id} style={{ background: "#fff", borderRadius: 10, padding: "9px 10px", marginBottom: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 14 }}>{v.shop}</span>
            <span style={{ color: "#5b6483", fontSize: 12, textAlign: "right" }}>
              {kindLabel(v.kind)}{v.amount ? " " + rupee(v.amount) : ""} · {timeOf(v.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SALES OFFICER dashboard  (Design 3: dark with progress ring)
// ---------------------------------------------------------------------------
function OfficerDashboard({ user, visits, applications, onLogout }) {
  const execs = useMemo(
    () => applications.filter((a) => a.job === SE_ROLE && a.status === SELECTED_STATUS),
    [applications]
  );
  const todayAll = useMemo(() => visits.filter((v) => isToday(v.createdAt)).sort((a, b) => b.createdAt - a.createdAt), [visits]);
  const monthAll = useMemo(() => visits.filter((v) => isThisMonth(v.createdAt)), [visits]);

  const target = Math.max(1, execs.length) * DAILY_VISIT_TARGET;
  const pct = Math.min(100, Math.round((todayAll.length / target) * 100));
  const ordersToday = todayAll.filter((v) => v.kind === "order");
  const monthShops = monthAll.filter((v) => v.kind === "shop").length;
  const monthCollect = sum(monthAll.filter((v) => v.kind === "payment"));

  const kpis = [
    ["આ મહિને નવી દુકાન", monthShops],
    ["આજના ઓર્ડર", ordersToday.length],
    ["Executives", execs.length],
    ["આ મહિને Collection", rupee(monthCollect)],
  ];

  const perExec = execs.map((e) => {
    const mine = todayAll.filter((v) => v.by === e.id);
    return { id: e.id, name: e.name, visits: mine.length, orders: mine.filter((v) => v.kind === "order").length };
  });

  const reportText = [
    "Daily report - " + new Date().toLocaleDateString("en-IN"),
    "Sales Officer: " + user.name,
    "Visits: " + todayAll.length,
    "Orders: " + ordersToday.length + " (" + rupee(sum(ordersToday)) + ")",
    "New shops: " + todayAll.filter((v) => v.kind === "shop").length,
    "Payment collected: " + rupee(sum(todayAll.filter((v) => v.kind === "payment"))),
    ...perExec.map((p) => "- " + p.name + ": " + p.visits + " visits, " + p.orders + " orders"),
  ].join("\n");

  return (
    <div style={{ background: DARK, color: "#E8ECF8", minHeight: "100%", paddingBottom: 20 }}>
      <div style={{ padding: "14px 14px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8F9BBA" }}>નમસ્તે, {user.name}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Sales Officer</div>
        </div>
        <button onClick={onLogout} aria-label="લોગઆઉટ" style={{ background: DARK2, border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LogOut size={17} color="#E8ECF8" />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14 }}>
        <div style={{ width: 92, height: 92, borderRadius: "50%", background: `conic-gradient(${YELLOW} ${pct}%, #26304A 0)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: DARK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>{pct}%</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#8F9BBA" }}>આજની ટીમ visits</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: YELLOW }}>{todayAll.length} / {target}</div>
        </div>
      </div>

      <div style={{ padding: "0 14px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {kpis.map(([l, v]) => (
          <div key={l} style={{ background: DARK2, borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#8F9BBA" }}>{l}</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "14px 14px 0" }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>ટીમ આજે</div>
        {perExec.length === 0 && (
          <div style={{ fontSize: 13, color: "#8F9BBA" }}>હજુ કોઈ Sales Executive “પસંદ થયા” નથી.</div>
        )}
        {perExec.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: YELLOW, marginTop: 6, flex: "none" }} />
            <div>
              <div style={{ fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "#8F9BBA" }}>{p.visits} visits · {p.orders} orders</div>
            </div>
          </div>
        ))}

        <div style={{ fontSize: 13, fontWeight: 800, margin: "14px 0 8px" }}>તાજેતરની એન્ટ્રી</div>
        {todayAll.length === 0 && <div style={{ fontSize: 13, color: "#8F9BBA" }}>આજે હજુ કોઈ એન્ટ્રી નથી.</div>}
        {todayAll.slice(0, 6).map((v) => (
          <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #26304A", fontSize: 13 }}>
            <span>{v.shop} <span style={{ color: "#8F9BBA" }}>· {v.byName}</span></span>
            <span style={{ color: "#8F9BBA", textAlign: "right" }}>{kindLabel(v.kind)}{v.amount ? " " + rupee(v.amount) : ""}</span>
          </div>
        ))}

        <a
          href={`https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(reportText)}`}
          target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: YELLOW, color: NAVY, textDecoration: "none", borderRadius: 12, padding: "13px 0", fontWeight: 800, fontSize: 14, marginTop: 16 }}
        >
          <Send size={17} /> Daily report માલિકને મોકલો
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SalesDashboard({ user, visits, applications, onAddVisit, onLogout }) {
  if (!user) return null;
  return user.role === SO_ROLE ? (
    <OfficerDashboard user={user} visits={visits} applications={applications} onLogout={onLogout} />
  ) : (
    <ExecDashboard user={user} visits={visits} onAddVisit={onAddVisit} onLogout={onLogout} />
  );
}
