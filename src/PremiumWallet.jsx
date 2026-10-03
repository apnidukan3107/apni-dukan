import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "apniDukanWalletToken";
const post = (body) =>
  fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
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
      if (d.ok) setWallet({ name: d.name, balance: d.balance });
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
    setWallet({ name: d.name, balance: d.balance });
    setToken(d.token);
  };
  const logout = clear;
  return { user: token ? { token } : null, token, wallet, refresh, login, logout };
}

// ---------- Header: Premium Login button / naam + wallet ----------
export function PremiumLoginButton({ w }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
        : e.code === "WRONG"
          ? "મોબાઇલ નંબર અથવા પાસવર્ડ ખોટો છે"
          : "Login na thayu. Internet check karo ane fari prayatna karo");
    }
    setBusy(false);
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

  return (
    <>
      <button onClick={() => setOpen(true)} style={{ ...btn, background: C.bg, color: C.blue, borderColor: C.blue, fontWeight: 600 }}>
        Premium Login
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 340 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Premium Login</div>
            <input style={input} inputMode="numeric" maxLength={10} placeholder="મોબાઇલ નંબર" value={mobile} onChange={(e) => { setMobile(e.target.value); setErr(""); }} />
            <input style={input} type="password" placeholder="પાસવર્ડ" value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />
            {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8 }}>{err}</div>}
            <button onClick={submit} style={{ ...btn, width: "100%", background: C.blue, color: "#fff", fontWeight: 600 }}>{busy ? "Login thay chhe..." : "Login"}</button>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 10 }}>Login id ane password dukan mathi malse.</div>
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
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const call = async (action, extra) => {
    return post({ action, secret, ...extra });
  };
  const errText = (e) => ({
    ADMIN_ONLY: "Admin key khotti chhe",
    MOBILE_EXISTS: "Aa mobile number thi customer pehla thi chhe",
    MOBILE_INVALID: "10 anka no mobile number lakho",
    PASSWORD_SHORT: "Password ochha ma ochha 6 akshar no rakho",
    NAME_REQUIRED: "Customer nu naam lakho",
    AMOUNT_INVALID: "Rakam sachi lakho",
  }[e] || "Kai gadbad thai. Fari prayatna karo.");

  const load = async () => {
    const d = await call("list");
    if (d.ok) setList(d.customers); else setMsg({ bad: true, t: errText(d.error) });
  };
  const create = async () => {
    setBusy(true); setMsg(null);
    const d = await call("create", f);
    if (d.ok) { setMsg({ bad: false, t: "Customer bani gayo. Password customer ne aapi do, pachhi joi nahi shakay." }); setF({ name: "", mobile: "", password: "", amount: "0" }); load(); }
    else setMsg({ bad: true, t: errText(d.error) });
    setBusy(false);
  };
  const addMoney = async (c) => {
    const a = window.prompt(`${c.name} ne wallet ma ketla ₹ umerva chho?`);
    if (!a) return;
    const d = await call("topup", { uid: c.uid, amount: Number(a) });
    if (d.ok) load(); else setMsg({ bad: true, t: errText(d.error) });
  };
  const resetPw = async (c) => {
    const p = window.prompt(`${c.name} no navo password (ochha ma ochha 6 akshar):`);
    if (!p) return;
    const d = await call("reset", { uid: c.uid, password: p });
    setMsg(d.ok ? { bad: false, t: "Password badlai gayo." } : { bad: true, t: errText(d.error) });
  };
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };

  return (
    <div style={{ maxWidth: 420 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Premium customers</div>
      <input style={input} type="password" placeholder="Admin key" value={secret} onChange={(e) => setSecret(e.target.value)} />
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
