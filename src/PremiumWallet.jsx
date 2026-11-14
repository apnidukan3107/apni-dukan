import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "apniDukanWalletToken";
const post = async (body) => {
  try {
    const r = await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try { return await r.json(); } catch (e) { return { error: "NO_API" }; }
  } catch (e) { return { error: "NETWORK" }; }
};
const apiErr = (e) => ({
  NO_API: "Server (api/wallet) chalu nathi. Vercel ma wallet.js ane deployment check karo.",
  NETWORK: "Internet check karo ane fari prayatna karo.",
  NO_SERVICE_ACCOUNT: "Vercel ma FIREBASE_SERVICE_ACCOUNT nathi ke khotu chhe.",
  NO_ADMIN_SECRET: "Vercel ma ADMIN_SECRET nathi, ke Redeploy baki chhe.",
  SERVER: "Server ma gadbad chhe. Vercel Logs check karo.",
  NAME_REQUIRED: "નામ લખો",
  MOBILE_INVALID: "૧૦ આંકડાનો મોબાઇલ નંબર લખો",
  SHOP_REQUIRED: "દુકાનનું નામ લખો",
  ADDRESS_REQUIRED: "સરનામું લખો",
  PINCODE_INVALID: "૬ આંકડાનો પિન કોડ લખો",
  PASSWORD_SHORT: "પાસવર્ડ ઓછામાં ઓછો ૬ અક્ષરનો રાખો",
  MOBILE_EXISTS: "આ નંબર થી Premium account પહેલાથી છે. Login કરો.",
  ALREADY_PENDING: "તમારી request પહેલાથી બાકી છે. મંજૂરીની રાહ જુઓ.",
}[e] || null);
const prof = (d) => ({ name: d.name, balance: d.balance, mobile: d.mobile || "", shop: d.shop || "", address: d.address || "", pincode: d.pincode || "" });
const rs = (n) => "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN");

const C = {
  blue: "#0b3d91", bg: "#e8f0fe", green: "#1b6e3c", gbg: "#e6f6ec",
  red: "#b42318", rbg: "#fdecea", line: "#d0d7de",
};
const btn = { border: "1px solid " + C.line, background: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 14, cursor: "pointer" };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", fontSize: 15, border: "1px solid " + C.line, borderRadius: 8, marginBottom: 10 };

// App ma ek j vaar call karo: const w = useWallet(firebaseApp);
// Login mobile + password thi, server (/api/wallet) par. Firebase Auth ni jarur nathi.
export function useWallet() {
  const [token, setToken] = useState(() => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } });
  const [wallet, setWallet] = useState(null);

  const clear = useCallback(() => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } setToken(""); setWallet(null); }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const d = await post({ action: "me", token });
      if (d.ok) setWallet(prof(d));
      else if (d.error === "LOGIN_REQUIRED") clear();
    } catch (e) { /* internet nathi, juno balance rehva do */ }
  }, [token, clear]);

  useEffect(() => { if (token) refresh(); else setWallet(null); }, [token, refresh]);
  useEffect(() => {
    if (!token) return undefined;
    const f = () => refresh();
    window.addEventListener("focus", f);
    return () => window.removeEventListener("focus", f);
  }, [token, refresh]);

  const login = async (mobile, password) => {
    const d = await post({ action: "login", mobile, password });
    if (!d.ok) { const e = new Error(d.error || "SERVER"); e.code = d.error; throw e; }
    try { localStorage.setItem(TOKEN_KEY, d.token); } catch (e) { /* ignore */ }
    setWallet(prof(d));
    setToken(d.token);
  };
  const logout = clear;
  return { user: token ? { token } : null, token, wallet, refresh, login, logout };
}

// ---------- Header: Premium Login button / naam + wallet ----------
export function PremiumLoginButton({ w }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("login"); // login | signup | done
  const [mobile, setMobile] = useState("");
  const [pass, setPass] = useState("");
  const [f, setF] = useState({ name: "", shop: "", address: "", pincode: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const setField = (k, fn) => (e) => { setF({ ...f, [k]: fn ? fn(e.target.value) : e.target.value }); setErr(""); };

  const close = () => { setOpen(false); setMode("login"); setErr(""); setPass(""); };

  const submit = async () => {
    if (!/^\d{10}$/.test(mobile.trim())) return setErr("૧૦ આંકડાનો મોબાઇલ નંબર લખો");
    if (!pass) return setErr("પાસવર્ડ લખો");
    setBusy(true); setErr("");
    try {
      await w.login(mobile.trim(), pass);
      setOpen(false); setMobile(""); setPass("");
    } catch (e) {
      setErr(e.code === "LOCKED"
        ? "ઘણા ખોટા પ્રયત્નો થયા, 15 મિનિટ પછી ફરી કરો"
        : e.code === "PENDING"
          ? "તમારી request હજી બાકી છે. મંજૂરી મળે પછી Login થશે."
          : e.code === "REJECTED"
            ? "તમારી request નામંજૂર થઈ છે." + (e.reason ? " કારણ: " + e.reason : "")
            : e.code === "WRONG"
              ? "મોબાઇલ નંબર અથવા પાસવર્ડ ખોટો છે"
              : apiErr(e.code) || "Login na thayu. Fari prayatna karo");
    }
    setBusy(false);
  };

  const sendSignup = async () => {
    if (!f.name.trim()) return setErr("નામ લખો");
    if (!/^\d{10}$/.test(mobile.trim())) return setErr("૧૦ આંકડાનો મોબાઇલ નંબર લખો");
    if (!f.shop.trim()) return setErr("દુકાનનું નામ લખો");
    if (!f.address.trim()) return setErr("સરનામું લખો");
    if (!/^\d{6}$/.test(f.pincode.trim())) return setErr("૬ આંકડાનો પિન કોડ લખો");
    if (pass.length < 6) return setErr("પાસવર્ડ ઓછામાં ઓછો ૬ અક્ષરનો રાખો");
    setBusy(true); setErr("");
    const d = await post({ action: "signup", name: f.name, mobile: mobile.trim(), shop: f.shop, address: f.address, pincode: f.pincode.trim(), password: pass });
    setBusy(false);
    if (d.ok) { setMode("done"); setPass(""); setF({ name: "", shop: "", address: "", pincode: "" }); }
    else setErr(apiErr(d.error) || "Request na gayi. Fari prayatna karo");
  };

  if (w.user) {
    const nm = (w.wallet && w.wallet.name) || "Customer";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.gbg, borderRadius: 10, padding: "6px 10px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.green }}>નમસ્તે</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.green, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{nm}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.green }}>Wallet</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{w.wallet ? rs(w.wallet.balance) : "..."}</div>
        </div>
        <button style={{ ...btn, padding: "6px 8px" }} onClick={w.logout} aria-label="Logout">Logout</button>
      </div>
    );
  }

  const link = { fontSize: 13, color: C.blue, marginTop: 10, textAlign: "center", cursor: "pointer", textDecoration: "underline" };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ ...btn, background: C.bg, color: C.blue, borderColor: C.blue, fontWeight: 600 }}>
        Premium Login
      </button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 340, maxHeight: "90vh", overflowY: "auto" }}>
            {mode === "login" && (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Premium Login</div>
                <input style={input} inputMode="numeric" maxLength={10} placeholder="મોબાઇલ નંબર" value={mobile} onChange={(e) => { setMobile(e.target.value); setErr(""); }} />
                <input style={input} type="password" placeholder="પાસવર્ડ" value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />
                {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8 }}>{err}</div>}
                <button onClick={submit} style={{ ...btn, width: "100%", background: C.blue, color: "#fff", fontWeight: 600 }}>{busy ? "Login thay chhe..." : "Login"}</button>
                <div style={link} onClick={() => { setMode("signup"); setErr(""); setPass(""); }}>નવા છો? Sign up કરો (મંજૂરી પછી Login)</div>
              </>
            )}
            {mode === "signup" && (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Premium Sign up</div>
                <div style={{ fontSize: 12, color: "#667085", marginBottom: 12 }}>એક જ વાર ભરવાનું. મંજૂરી મળે પછી Login થશે.</div>
                <input style={input} placeholder="નામ" value={f.name} onChange={setField("name")} />
                <input style={input} inputMode="numeric" maxLength={10} placeholder="મોબાઇલ નંબર" value={mobile} onChange={(e) => { setMobile(e.target.value.replace(/[^0-9]/g, "")); setErr(""); }} />
                <input style={input} placeholder="દુકાનનું નામ" value={f.shop} onChange={setField("shop")} />
                <input style={input} placeholder="સરનામું" value={f.address} onChange={setField("address")} />
                <input style={input} inputMode="numeric" maxLength={6} placeholder="પિન કોડ" value={f.pincode} onChange={setField("pincode", (v) => v.replace(/[^0-9]/g, "").slice(0, 6))} />
                <input style={input} type="password" placeholder="પાસવર્ડ નક્કી કરો (ઓછામાં ઓછા ૬ અક્ષર)" value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} />
                {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8 }}>{err}</div>}
                <button onClick={sendSignup} style={{ ...btn, width: "100%", background: C.blue, color: "#fff", fontWeight: 600 }}>{busy ? "Request jay chhe..." : "Request મોકલો"}</button>
                <div style={link} onClick={() => { setMode("login"); setErr(""); }}>પાછા Login પર</div>
              </>
            )}
            {mode === "done" && (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: C.green }}>Request મોકલાઈ ગઈ</div>
                <div style={{ fontSize: 14, marginBottom: 12 }}>સ્થિતિ: બાકી. મંજૂરી મળે પછી તમારા મોબાઇલ નંબર અને પાસવર્ડથી Login કરી શકશો.</div>
                <button onClick={close} style={{ ...btn, width: "100%" }}>ઠીક છે</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Checkout: wallet thi pay ----------
// cartItems = App no cartItems (baseId, size, qty, price), form = checkoutForm,
// grandTotal = App no grandTotal, onSuccess(d) = order thaya pachhi App ma cart khali vagere
export function WalletPayBox({ w, cartItems, form, billOption, gstNumber, grandTotal, promoApplied, onSuccess }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = { marginTop: 14, border: "1px solid " + C.blue, borderRadius: 12, padding: 12, background: C.bg };

  if (!w.user) {
    return <div style={{ ...box, fontSize: 13, color: C.blue }}>Premium customer chho? Upar Premium Login karo ane wallet thi shopping karo.</div>;
  }
  const balance = w.wallet ? Number(w.wallet.balance) || 0 : 0;
  const total = Number(grandTotal) || 0;
  const short = Math.round((total - balance) * 100) / 100;

  const pay = async () => {
    setMsg(null);
    if (promoApplied) return setMsg({ bad: true, t: "Promo code wallet order ma lagu nathi. Promo code kadhi nakho." });
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || form.pincode.trim().length !== 6)
      return setMsg({ bad: true, t: "Upar nu naam, mobile, sarnamu ane pincode bharo." });
    if (billOption === "with-bill" && !gstNumber.trim()) return setMsg({ bad: true, t: "GST number bharo." });
    if (short > 0) return setMsg({ bad: true, t: `Wallet ma paisa ochha chhe. ${rs(short)} ochha pade chhe, etle order nahi thay.` });
    setBusy(true);
    try {
      const d = await post({
        action: "pay", token: w.token, customer: form, billOption, gstNumber,
        items: cartItems.map((i) => ({ id: i.baseId, size: i.size, qty: i.qty })),
      });
      if (d.ok) { w.refresh(); if (onSuccess) onSuccess(d); }
      else if (d.error === "INSUFFICIENT") { w.refresh(); setMsg({ bad: true, t: `Wallet ma paisa ochha chhe. ${rs(d.short)} ochha pade chhe, etle order nahi thay.` }); }
      else if (d.error === "TRY_AGAIN") setMsg({ bad: true, t: "Thodi vaar pachhi fari prayatna karo." });
      else if (d.error === "PRODUCT_NOT_FOUND") setMsg({ bad: true, t: "Cart ni koi vastu have upalabdh nathi." });
      else if (d.error === "LOGIN_REQUIRED") { w.logout(); setMsg({ bad: true, t: "Fari Premium Login karo." }); }
      else setMsg({ bad: true, t: "Order nathi thayo. Fari prayatna karo." });
    } catch (e) { setMsg({ bad: true, t: "Internet check karo ane fari prayatna karo." }); }
    setBusy(false);
  };

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, color: C.blue, marginBottom: 6 }}>Wallet thi order karo</div>
      <div style={{ fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Kul rakam</span><b>{rs(total)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Wallet balance</span><span>{rs(balance)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid " + C.line, marginTop: 4, paddingTop: 4 }}>
          <span>Order pachhi wallet</span><b>{short > 0 ? "-" : rs(balance - total)}</b>
        </div>
      </div>
      {short > 0 && total > 0 && (
        <div style={{ background: C.rbg, color: C.red, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 8 }}>
          Wallet ma paisa ochha chhe. {rs(short)} ochha pade chhe, etle order nahi thay.
        </div>
      )}
      <button onClick={pay} style={{ ...btn, width: "100%", marginTop: 10, background: C.blue, color: "#fff", fontWeight: 600 }}>
        {busy ? "Order thay chhe..." : "Wallet thi order karo"}
      </button>
      {msg && <div style={{ fontSize: 13, marginTop: 8, color: msg.bad ? C.red : C.green }}>{msg.t}</div>}
    </div>
  );
}

// ---------- Admin panel: customer banavo, paisa umero ----------
export function AdminCustomers() {
  const [secret, setSecret] = useState("");
  const [f, setF] = useState({ name: "", mobile: "", password: "", amount: "0" });
  const [list, setList] = useState(null);
  const [reqs, setReqs] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const call = async (action, extra) => {
    return post({ action, secret, ...extra });
  };
  const errText = (e, d) => ({
    ADMIN_ONLY: "Admin key khotti chhe",
    NO_API: apiErr("NO_API"), NETWORK: apiErr("NETWORK"), SERVER: apiErr("SERVER"),
    NO_SERVICE_ACCOUNT: apiErr("NO_SERVICE_ACCOUNT"), NO_ADMIN_SECRET: apiErr("NO_ADMIN_SECRET"),
    MOBILE_EXISTS: "Aa mobile number thi customer pehla thi chhe",
    MOBILE_INVALID: "10 anka no mobile number lakho",
    PASSWORD_SHORT: "Password ochha ma ochha 6 akshar no rakho",
    NAME_REQUIRED: "Customer nu naam lakho",
    AMOUNT_INVALID: "Rakam sachi lakho",
  }[e] || "Kai gadbad thai. Fari prayatna karo.") + (d && d.detail ? " [" + d.detail + "]" : "");

  const load = async () => {
    const d = await call("list");
    if (d.ok) setList(d.customers); else setMsg({ bad: true, t: errText(d.error, d) });
  };
  const create = async () => {
    setBusy(true); setMsg(null);
    const d = await call("create", f);
    if (d.ok) { setMsg({ bad: false, t: "Customer bani gayo. Password customer ne aapi do, pachhi joi nahi shakay." }); setF({ name: "", mobile: "", password: "", amount: "0" }); load(); }
    else setMsg({ bad: true, t: errText(d.error, d) });
    setBusy(false);
  };
  const addMoney = async (c) => {
    const a = window.prompt(`${c.name} ne wallet ma ketla ₹ umerva chho?`);
    if (!a) return;
    const d = await call("topup", { uid: c.uid, amount: Number(a) });
    if (d.ok) load(); else setMsg({ bad: true, t: errText(d.error, d) });
  };
  const resetPw = async (c) => {
    const p = window.prompt(`${c.name} no navo password (ochha ma ochha 6 akshar):`);
    if (!p) return;
    const d = await call("reset", { uid: c.uid, password: p });
    setMsg(d.ok ? { bad: false, t: "Password badlai gayo." } : { bad: true, t: errText(d.error, d) });
  };
  const loadReqs = async () => {
    const d = await call("requests");
    if (d.ok) setReqs(d.requests); else setMsg({ bad: true, t: errText(d.error, d) });
  };
  const approveReq = async (r) => {
    if (!window.confirm(`${r.name} (${r.mobile}) ne manjur karo?`)) return;
    const d = await call("approve", { mobile: r.mobile });
    if (d.ok) { setMsg({ bad: false, t: `${r.name} manjur thayo. Have e Login kari shake.` }); loadReqs(); load(); }
    else setMsg({ bad: true, t: errText(d.error, d) });
  };
  const rejectReq = async (r) => {
    const reason = window.prompt(`${r.name} ni request namanjur karvanu karan (khali rakhi shako):`, "");
    if (reason === null) return;
    const d = await call("reject", { mobile: r.mobile, reason });
    if (d.ok) { setMsg({ bad: false, t: "Request namanjur thai." }); loadReqs(); }
    else setMsg({ bad: true, t: errText(d.error, d) });
  };
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };

  return (
    <div style={{ maxWidth: 420 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Premium customers</div>
      <input style={input} type="password" placeholder="Admin key" value={secret} onChange={(e) => setSecret(e.target.value)} />
      <div style={{ border: "1px solid " + C.blue, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Sign up requests</div>
        <button onClick={loadReqs} style={{ ...btn, marginBottom: 8 }}>Requests juo</button>
        {reqs && reqs.length === 0 && <div style={{ fontSize: 13, color: "#667085" }}>Koi request nathi.</div>}
        {reqs && reqs.map((r) => (
          <div key={r.mobile} style={{ borderTop: "1px solid " + C.line, padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: r.status === "approved" ? C.green : r.status === "rejected" ? C.red : "#b54708" }}>
                {r.status === "approved" ? "Manjur" : r.status === "rejected" ? "Namanjur" : "Baki"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#667085" }}>{r.mobile} • {r.shop}</div>
            <div style={{ fontSize: 12, color: "#667085" }}>{r.address} - {r.pincode}</div>
            {r.status === "rejected" && r.reason && <div style={{ fontSize: 12, color: C.red }}>Karan: {r.reason}</div>}
            {r.status !== "approved" && (
              <div style={{ marginTop: 6 }}>
                <button style={{ ...btn, padding: "4px 10px", fontSize: 13, marginRight: 6, background: C.gbg, color: C.green }} onClick={() => approveReq(r)}>Manjur</button>
                {r.status === "pending" && <button style={{ ...btn, padding: "4px 10px", fontSize: 13, background: C.rbg, color: C.red }} onClick={() => rejectReq(r)}>Namanjur</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ border: "1px solid " + C.line, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Navo customer banavo</div>
        <input style={input} placeholder="Customer nu naam" value={f.name} onChange={set("name")} />
        <input style={input} inputMode="numeric" maxLength={10} placeholder="Mobile number (login id)" value={f.mobile} onChange={set("mobile")} />
        <input style={input} placeholder="Password (ochha ma ochha 6 akshar)" value={f.password} onChange={set("password")} />
        <input style={input} inputMode="decimal" placeholder="Shuruaat nu wallet ₹" value={f.amount} onChange={set("amount")} />
        <button onClick={create} style={{ ...btn, width: "100%", background: C.blue, color: "#fff", fontWeight: 600 }}>{busy ? "Thay chhe..." : "Customer banavo"}</button>
      </div>
      {msg && <div style={{ fontSize: 13, marginBottom: 10, color: msg.bad ? C.red : C.green }}>{msg.t}</div>}
      <button onClick={load} style={{ ...btn, marginBottom: 8 }}>Customer list juo</button>
      {list && list.map((c) => (
        <div key={c.uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid " + C.line }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: "#667085" }}>{c.mobile}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>{rs(c.balance)}</div>
            <button style={{ ...btn, padding: "3px 8px", fontSize: 12, marginRight: 4 }} onClick={() => addMoney(c)}>Paisa umero</button>
            <button style={{ ...btn, padding: "3px 8px", fontSize: 12 }} onClick={() => resetPw(c)}>Password</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Order form: login pachhi naam, mobile, sarnamu aapoaap bharvu ----------
// App ma checkoutForm pachhi ek line: usePremiumAutofill(w, checkoutForm, setCheckoutForm);
export function usePremiumAutofill(w, form, setForm) {
  const p = w && w.wallet;
  const empty = !form.name && !form.phone && !form.address && !form.pincode;
  useEffect(() => {
    if (!p) return;
    setForm((f) => ({
      name: f.name || p.name || "",
      phone: f.phone || p.mobile || "",
      address: f.address || p.address || "",
      pincode: f.pincode || p.pincode || "",
    }));
  }, [p && p.name, p && p.mobile, p && p.address, p && p.pincode, empty]); // eslint-disable-line react-hooks/exhaustive-deps
}
