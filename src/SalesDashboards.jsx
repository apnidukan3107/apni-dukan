import React, { useState, useEffect, useMemo } from "react";
import {
  Store, ClipboardList, Package, TrendingUp, Plus, LogOut, Lock,
  User, Users, Loader2, ShieldCheck, ArrowLeft, Send, X, UserCheck, Clock, Check, Store as StoreIcon, Pencil,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Settings. Password badalvo hoy to ahi badlo.
// ---------------------------------------------------------------------------
export const SO_ROLE = "Sales Officer";
export const SE_ROLE = "Sales Executive";
export const BLOG_ROLE = "Blog Writer";
const SO_PASSWORD = "112137";
const SE_PASSWORD = "112137";
const BLOG_PASSWORD = "112137";         // Blog Writer nu password          // Executive nu password ahi badli shako
const SELECTED_STATUS = "પસંદ થયા";     // admin panel ma aa status vala j login kari shake
const SHOW_DEMO = true;                 // false karo to gate ma "Demo જુઓ" chhupai jase
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

export function fmtRemaining(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

// Reverse timer chip: yellow normally, red in the last 10 minutes.
function TimerChip({ remaining }) {
  const low = remaining < 600;
  return (
    <span style={{ background: low ? "#B23B3B" : YELLOW, color: low ? "#fff" : NAVY, fontWeight: 800, fontSize: 13, padding: "4px 10px", borderRadius: 14, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Clock size={13} /> {fmtRemaining(remaining)}
    </span>
  );
}

// Strip shown on the storefront (front page, cart, checkout...) while a sales person is logged in.
export function SalesSessionBar({ user, remaining, onOpen }) {
  return (
    <div style={{ flexShrink: 0, background: NAVY, color: "#fff", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <UserCheck size={18} color={YELLOW} style={{ flex: "none" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
          <div style={{ fontSize: 11, color: "#b9c3e6" }}>{user.role} login</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <TimerChip remaining={remaining} />
        <button onClick={onOpen} style={{ background: "rgba(255,255,255,0.14)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Dashboard</button>
      </div>
    </div>
  );
}

// Strip shown on the storefront while a Trader / Retailer is logged in.
export function TraderBar({ trader, pct, onLogout }) {
  return (
    <div style={{ flexShrink: 0, background: "#1F5C40", color: "#fff", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <StoreIcon size={18} color={YELLOW} style={{ flex: "none" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trader.firm}</div>
          <div style={{ fontSize: 11, color: "#cfe6d8" }}>{trader.kind} · બધા ભાવ પર {pct}% ઓછા</div>
        </div>
      </div>
      <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", flex: "none" }}>Logout</button>
    </div>
  );
}

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function Field({ label, children }) {
  return (
    <label style={{ display: "block", textAlign: "left", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 12, color: "#6b6555", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

// Trader / Retailer: Signup (firm, mobile, business tabs, GSTIN, address, password) or Login (mobile + password)
export function TraderForm({ kind, tabs, discountPct, onSignup, onLogin, onBack }) {
  const [mode, setMode] = useState("signup");
  const [firm, setFirm] = useState("");
  const [mobile, setMobile] = useState("");
  const [picked, setPicked] = useState([]);
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleTab = (t) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const switchMode = (m) => { setMode(m); setErr(""); };

  const submit = async (e) => {
    e.preventDefault();
    const m = mobile.trim();
    if (!/^[6-9]\d{9}$/.test(m)) return setErr("સાચો 10 અંકનો મોબાઇલ નંબર લખો.");
    if (mode === "signup") {
      if (firm.trim().length < 2) return setErr("ફર્મનું નામ લખો.");
      if (picked.length === 0) return setErr("ઓછામાં ઓછો એક Business tab પસંદ કરો.");
      if (!GST_RE.test(gstin.trim().toUpperCase())) return setErr("સાચો 15 અક્ષરનો GSTIN લખો (દા.ત. 24ABCDE1234F1Z5).");
      if (address.trim().length < 8) return setErr("પૂરું સરનામું લખો.");
      if (pw.length < 6) return setErr("પાસવર્ડ ઓછામાં ઓછો 6 અક્ષરનો રાખો.");
    } else if (pw.length < 1) {
      return setErr("પાસવર્ડ લખો.");
    }
    setErr(""); setBusy(true);
    try {
      const r = mode === "signup"
        ? await onSignup({ kind, firm: firm.trim(), mobile: m, tabs: picked, gstin: gstin.trim().toUpperCase(), address: address.trim(), password: pw })
        : await onLogin(m, pw);
      if (r && !r.ok) setErr(r.error || "કંઈક ખોટું થયું, ફરી પ્રયત્ન કરો.");
    } catch (e2) {
      console.error(e2);
      setErr("કંઈક ખોટું થયું, ફરી પ્રયત્ન કરો.");
    }
    setBusy(false);
  };

  const seg = (m, label) => (
    <button type="button" onClick={() => switchMode(m)} style={{
      flex: 1, border: "none", padding: "9px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      background: mode === m ? NAVY : "transparent", color: mode === m ? "#fff" : NAVY, borderRadius: 9,
    }}>{label}</button>
  );

  return (
    <form onSubmit={submit} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <StoreIcon size={30} color={NAVY} />
        <p style={{ fontWeight: 800, fontSize: 17, color: "#1a1d26", margin: "6px 0 2px" }}>{kind}</p>
        <p style={{ fontSize: 12, color: "#1F5C40", margin: 0, fontWeight: 700 }}>Login પછી બધા product પર {discountPct}% ઓછો ભાવ</p>
      </div>
      <div style={{ display: "flex", gap: 4, background: "#e8ebf3", padding: 3, borderRadius: 12, marginBottom: 14 }}>
        {seg("signup", "Signup")}{seg("login", "Login")}
      </div>

      {mode === "signup" && (
        <Field label="ફર્મનું નામ">
          <input style={inputStyle} value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Firm / દુકાનનું નામ" />
        </Field>
      )}
      <Field label="મોબાઇલ નંબર">
        <input style={inputStyle} type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} placeholder="10 અંકનો નંબર" />
      </Field>

      {mode === "signup" && (
        <>
          <div style={{ textAlign: "left", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 12, color: "#6b6555", marginBottom: 4 }}>Business (સ્ક્રોલ કરીને એક કે વધુ પસંદ કરો)</span>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0 8px", WebkitOverflowScrolling: "touch" }}>
              {tabs.map((t) => {
                const on = picked.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleTab(t)} style={{
                    flex: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5,
                    border: `1px solid ${on ? NAVY : "#d9dce3"}`, background: on ? NAVY : "#fff", color: on ? "#fff" : "#1a1d26",
                    borderRadius: 20, padding: "8px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                  }}>{on && <Check size={13} color={YELLOW} />}{t}</button>
                );
              })}
            </div>
          </div>
          <Field label="GSTIN">
            <input style={{ ...inputStyle, textTransform: "uppercase" }} maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="24ABCDE1234F1Z5" />
          </Field>
          <Field label="સરનામું">
            <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="દુકાન / ફર્મનું પૂરું સરનામું" />
          </Field>
        </>
      )}

      <Field label="પાસવર્ડ">
        <input style={inputStyle} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === "signup" ? "ઓછામાં ઓછા 6 અક્ષર" : "પાસવર્ડ"} />
      </Field>

      {err && <div style={{ color: "#b23b3b", fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <button type="submit" disabled={busy} style={{
        width: "100%", background: NAVY, color: "#fff", border: "none", borderRadius: 12, padding: "13px 0",
        fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1,
      }}>{busy ? "..." : mode === "signup" ? "Signup કરો" : "Login"}</button>
      <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: "#6b6555", margin: "14px auto 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
        <ArrowLeft size={14} /> પાછા
      </button>
    </form>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", border: "1px solid #d9dce3", background: "#fff",
  borderRadius: 10, padding: "12px 12px", fontSize: 14, color: "#1a1d26", outline: "none", fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// GATE: Loading -> Who are you? -> Admin / Sales Officer / Sales Executive
// ---------------------------------------------------------------------------
export function SalesGate({ applications, onAdminLogin, onSuccess }) {
  const [step, setStep] = useState("loading"); // loading | who | admin | name | pass | demo | demoDash
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
    const need = role === SO_ROLE ? SO_PASSWORD : role === BLOG_ROLE ? BLOG_PASSWORD : SE_PASSWORD;
    // Blog writer applications are the ones saved without a "job" (Careers > Blog Writers)
    const match = applications.find(
      (a) => (role === BLOG_ROLE ? !a.job : a.job === role) && a.status === SELECTED_STATUS && norm(a.name) === norm(name)
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
        <button style={bigBtn("#7B4FD8", "#fff")} onClick={() => { setRole(BLOG_ROLE); setErr(""); setPw(""); setStep("name"); }}>
          <Pencil size={20} color={YELLOW} /> Blog Writer
        </button>
        {SHOW_DEMO && (
          <button type="button" onClick={() => setStep("demo")} style={{ border: "none", background: "transparent", color: "#6b6555", marginTop: 16, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline" }}>
            👁 Demo જુઓ (સેમ્પલ ડેટા)
          </button>
        )}
      </div>
    );
  }

  if (step === "demo") {
    return (
      <div style={wrap}>
        <p style={{ fontSize: 18, fontWeight: 800, color: "#1a1d26", margin: "0 0 2px" }}>Demo જુઓ</p>
        <p style={{ fontSize: 12, color: "#6b6555", margin: "0 0 10px" }}>લોગિન વગર, સેમ્પલ ડેટા સાથે</p>
        <button style={bigBtn(DARK, "#fff")} onClick={() => { setRole(SO_ROLE); setStep("demoDash"); }}><Users size={20} color={YELLOW} /> Sales Officer</button>
        <button style={bigBtn(NAVY, "#fff")} onClick={() => { setRole(SE_ROLE); setStep("demoDash"); }}><User size={20} color={YELLOW} /> Sales Executive</button>
        <button style={bigBtn("#7B4FD8", "#fff")} onClick={() => { setRole(BLOG_ROLE); setStep("demoDash"); }}><Pencil size={20} color={YELLOW} /> Blog Writer</button>
        {backBtn}
      </div>
    );
  }

  if (step === "demoDash") {
    return <DemoDashboard role={role} onExit={() => setStep("demo")} />;
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
function ExecDashboard({ user, visits, onAddVisit, onLogout, remaining }) {
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TimerChip remaining={remaining} />
          <button onClick={onLogout} aria-label="લોગઆઉટ" style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogOut size={17} color="#fff" />
          </button>
        </div>
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
function OfficerDashboard({ user, visits, applications, onLogout, remaining }) {
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TimerChip remaining={remaining} />
          <button onClick={onLogout} aria-label="લોગઆઉટ" style={{ background: DARK2, border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogOut size={17} color="#E8ECF8" />
          </button>
        </div>
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
// BLOG WRITER dashboard: write blog -> "Review માટે મોકલો" -> admin approves (Published) or asks to fix
// ---------------------------------------------------------------------------
export const BLOG_STATUS = {
  draft: ["Draft", "#E6E8EE", "#555"],
  review: ["Review માં", "#FDE7D2", "#B5541C"],
  published: ["Published", "#D9EFE1", "#1F5C40"],
  fix: ["સુધારો", "#F8DADA", "#B23B3B"],
};
const BLOG_CATS = ["V Belt", "Pneumatics", "Handtools", "Safety", "Groceries", "Other"];
const PURPLE = "#4B2A99";

export function StatusPill({ status }) {
  const m = BLOG_STATUS[status] || BLOG_STATUS.draft;
  return <span style={{ background: m[1], color: m[2], fontSize: 11, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{m[0]}</span>;
}

function BlogEditor({ initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial.title || "");
  const [category, setCategory] = useState(initial.category || BLOG_CATS[0]);
  const [body, setBody] = useState(initial.body || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async (status) => {
    if (title.trim().length < 5) return setErr("હેડિંગ લખો (ઓછામાં ઓછા 5 અક્ષર).");
    if (status === "review" && body.trim().length < 50) return setErr("Review માટે બ્લોગ ઓછામાં ઓછો 50 અક્ષરનો હોવો જોઈએ.");
    setErr(""); setBusy(true);
    try {
      await onSave({ id: initial.id, title: title.trim(), category, body: body.trim(), status });
      onCancel();
    } catch (e) {
      console.error(e);
      setErr("સેવ થયું નહીં, ફરી પ્રયત્ન કરો.");
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <button onClick={onCancel} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#5b6483", padding: 0, marginBottom: 10 }}>
        <ArrowLeft size={15} /> પાછા
      </button>
      <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="બ્લોગનું હેડિંગ" />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px 0", paddingBottom: 4 }}>
        {BLOG_CATS.map((c) => (
          <button key={c} onClick={() => setCategory(c)} style={{
            flex: "none", whiteSpace: "nowrap", border: `1px solid ${category === c ? PURPLE : "#d9dce3"}`,
            background: category === c ? PURPLE : "#fff", color: category === c ? "#fff" : "#1a1d26",
            borderRadius: 16, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}>{c}</button>
        ))}
      </div>
      <textarea style={{ ...inputStyle, minHeight: 190, resize: "vertical", lineHeight: 1.55 }} value={body}
        onChange={(e) => setBody(e.target.value)} placeholder="બ્લોગ અહીં લખો..." />
      {initial.note && initial.status === "fix" && (
        <div style={{ background: "#F8DADA", color: "#B23B3B", borderRadius: 10, padding: 10, fontSize: 12.5, marginTop: 10 }}>એડમિનની નોંધ: {initial.note}</div>
      )}
      {err && <div style={{ color: "#b23b3b", fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button disabled={busy} onClick={() => go("draft")} style={{ flex: 1, background: "#E6E8EE", color: NAVY, border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>Draft સેવ</button>
        <button disabled={busy} onClick={() => go("review")} style={{ flex: 1, background: PURPLE, color: "#fff", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>Review માટે મોકલો</button>
      </div>
      <div style={{ fontSize: 11.5, color: "#5b6483", marginTop: 8, textAlign: "center" }}>એડમિન મંજૂર કરે પછી બ્લોગ Published થશે</div>
    </div>
  );
}

function BlogDashboard({ user, posts, onSave, onLogout, remaining }) {
  const [editing, setEditing] = useState(null); // null = list, {} = new, post = edit
  const mine = useMemo(() => posts.filter((p) => p.by === user.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [posts, user.id]);
  const stats = [
    ["લખેલા", mine.length],
    ["Review માં", mine.filter((p) => p.status === "review").length],
    ["Published", mine.filter((p) => p.status === "published").length],
  ];

  return (
    <div style={{ background: "#F3F5FA", color: NAVY, minHeight: "100%", paddingBottom: 20 }}>
      <div style={{ background: PURPLE, color: "#fff", padding: "14px 14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: YELLOW }}>apnidukanSE.in · Blog Writer</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{editing ? "બ્લોગ" : `નમસ્તે, ${user.name}`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TimerChip remaining={remaining} />
          <button onClick={onLogout} aria-label="લોગઆઉટ" style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogOut size={17} color="#fff" />
          </button>
        </div>
      </div>

      {editing ? (
        <BlogEditor initial={editing} onSave={onSave} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {stats.map(([l, v]) => (
              <div key={l} style={{ background: "#fff", borderRadius: 12, padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#5b6483" }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setEditing({})} style={{ width: "calc(100% - 24px)", margin: "0 12px 12px", background: YELLOW, color: NAVY, border: "none", borderRadius: 12, padding: "13px 0", fontWeight: 800, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit" }}>
            <Plus size={18} /> નવો બ્લોગ લખો
          </button>
          <div style={{ padding: "0 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>મારા બ્લોગ</div>
            {mine.length === 0 && <div style={{ background: "#fff", borderRadius: 10, padding: 12, fontSize: 13, color: "#5b6483" }}>હજુ કોઈ બ્લોગ નથી. પહેલો બ્લોગ લખો.</div>}
            {mine.map((p) => (
              <button key={p.id} onClick={() => setEditing(p)} style={{ width: "100%", background: "#fff", border: "none", borderRadius: 10, padding: 10, marginBottom: 6, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: NAVY }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14 }}>{p.title}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#5b6483" }}>{p.category}</span>
                </span>
                <StatusPill status={p.status} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DEMO mode: sample data only, nothing is read from or written to Firebase.
// (Gate ma "Demo જુઓ" link. Live site par chhupavvu hoy to SHOW_DEMO = false karo.)
// ---------------------------------------------------------------------------
function seedVisits() {
  const t = Date.now();
  const v = (id, by, byName, shop, kind, amount, minsAgo) => ({ id, by, byName, role: SE_ROLE, shop, kind, amount, note: "", createdAt: t - minsAgo * 60000 });
  return [
    v("d1", "demo-se1", "Kiran", "Ramesh Kirana Store", "order", 12500, 20),
    v("d2", "demo-se1", "Kiran", "Patel Medical", "followup", 0, 55),
    v("d3", "demo-se1", "Kiran", "Shree General Store", "payment", 8000, 90),
    v("d4", "demo-se1", "Kiran", "Jay Hardware", "shop", 0, 130),
    v("d5", "demo-se1", "Kiran", "Om Traders", "order", 21000, 170),
    v("d6", "demo-se2", "Mehul", "Krishna Stores", "order", 9500, 40),
    v("d7", "demo-se2", "Mehul", "Hari Om Hardware", "followup", 0, 100),
    v("d8", "demo-se2", "Mehul", "Sai Agency", "shop", 0, 150),
  ];
}
function seedPosts() {
  const t = Date.now();
  const p = (id, title, category, status, note) => ({ id, by: "demo-bw", byName: "Mira", title, category, body: "Sample blog text. ".repeat(8), status, note: note || "", createdAt: t, updatedAt: t });
  return [
    p("b1", "V Belt કેવી રીતે પસંદ કરવો", "V Belt", "review"),
    p("b2", "Pneumatic fitting ના પ્રકાર", "Pneumatics", "published"),
    p("b3", "Safety material ની યાદી", "Safety", "fix", "ફોટા ઉમેરો અને હેડિંગ ટૂંકું કરો."),
    p("b4", "Handtools ની કાળજી", "Handtools", "draft"),
  ];
}

function DemoDashboard({ role, onExit }) {
  const [visits, setVisits] = useState(seedVisits);
  const [posts, setPosts] = useState(seedPosts);
  const [rem, setRem] = useState(6 * 3600);
  useEffect(() => {
    const t = setInterval(() => setRem((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const apps = [
    { id: "demo-se1", name: "Kiran", job: SE_ROLE, status: SELECTED_STATUS },
    { id: "demo-se2", name: "Mehul", job: SE_ROLE, status: SELECTED_STATUS },
  ];
  const user = role === SO_ROLE ? { role, name: "Demo Officer", id: "demo-so" }
    : role === BLOG_ROLE ? { role, name: "Mira", id: "demo-bw" }
    : { role, name: "Kiran", id: "demo-se1" };
  const addVisit = async (d) => setVisits((v) => [{ id: "n" + Date.now(), by: user.id, byName: user.name, role, ...d, createdAt: Date.now() }, ...v]);
  const saveBlog = async (d) => setPosts((list) => {
    const now = Date.now();
    const rest = d.id ? list.filter((x) => x.id !== d.id) : list;
    return [{ id: d.id || "n" + now, by: user.id, byName: user.name, note: "", createdAt: now, updatedAt: now, ...d }, ...rest];
  });
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ background: "#B5541C", color: "#fff", fontSize: 12, textAlign: "center", padding: "6px 10px" }}>
        DEMO · સેમ્પલ ડેટા · કંઈ સેવ થતું નથી
      </div>
      <SalesDashboard user={user} visits={visits} applications={apps} onAddVisit={addVisit}
        posts={posts} onSaveBlog={saveBlog} onLogout={onExit} remaining={rem} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SalesDashboard({ user, visits, applications, onAddVisit, onLogout, remaining, posts = [], onSaveBlog }) {
  if (!user) return null;
  if (user.role === BLOG_ROLE) return <BlogDashboard user={user} posts={posts} onSave={onSaveBlog} onLogout={onLogout} remaining={remaining} />;
  return user.role === SO_ROLE ? (
    <OfficerDashboard user={user} visits={visits} applications={applications} onLogout={onLogout} remaining={remaining} />
  ) : (
    <ExecDashboard user={user} visits={visits} onAddVisit={onAddVisit} onLogout={onLogout} remaining={remaining} />
  );
}
