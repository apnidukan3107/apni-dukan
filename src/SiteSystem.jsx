import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

// 🏗 સાઇટ સિસ્ટમ: સાઇટ → કર્મચારી (પહેલો હંમેશા Supervisor) → હાજરી કેલેન્ડર + ઉપાડ (Upad)
// (જૂની હિસાબ એપમાં "નિતેશ" લૉગિન પાછળની સિસ્ટમ.) સેલર પેનલમાંથી આખી સ્ક્રીન પર ખૂલે છે.
// ડેટા Firestore (store/siteData) માં સર્વર પર સચવાય છે — loadData / saveData App.jsx માંથી મળે છે.
// કોઈ પણ ફોન/કોમ્પ્યુટર પર સેલર લૉગિન કરો તો એ જ ડેટા દેખાશે. બેકઅપ (💾) વધારાની સલામતી માટે છે.
// આ ફોનમાં જૂનો localStorage ડેટા હોય તો પહેલી વાર આપમેળે સર્વર પર ખસેડાઈ જશે.

const uid = () => Math.random().toString(36).slice(2, 9);
const MONTHS = ["જાન્યુઆરી", "ફેબ્રુઆરી", "માર્ચ", "એપ્રિલ", "મે", "જૂન", "જુલાઈ", "ઓગસ્ટ", "સપ્ટેમ્બર", "ઓક્ટોબર", "નવેમ્બર", "ડિસેમ્બર"];
const DAYS = ["રવિ", "સોમ", "મંગળ", "બુધ", "ગુરુ", "શુક્ર", "શનિ"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "—");

const SITE_KEY = "site-data-v1";
const newEmp = (name, role = "emp") => ({ id: uid(), name, role, salary: 0, att: {}, upad: [] });
const num = (n) => Number(n || 0).toLocaleString("en-IN");
const upadSum = (arr, pre = "") =>
  arr.filter((u) => (u.date || "").startsWith(pre)).reduce((s, u) => s + Number(u.amount || 0), 0);

const rs = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN");
// મહિનાનો પગાર હિસાબ: માસિક પગાર ÷ તે મહિનાના દિવસ (28/29/30/31) = દર દિવસ; હાજર દિવસ × દર દિવસ = કમાણી
const monthCalc = (e, y, m) => {
  const prefix = `${y}-${pad(m + 1)}`;
  const days = new Date(y, m + 1, 0).getDate();
  const salary = Number(e.salary || 0);
  const perDay = salary / days;
  const present = Object.keys(e.att).filter((k) => k.startsWith(prefix) && e.att[k] === "P").length;
  const earned = Math.round(perDay * present);
  const upad = upadSum(e.upad, prefix);
  return { days, salary, perDay, present, earned, upad, net: earned - upad };
};

// બેકઅપ ફાઇલ કે જૂના ડેટાને સલામત આકારમાં ફેરવે છે
function normalizeSites(d) {
  const sites = (Array.isArray(d && d.sites) ? d.sites : []).map((s) => ({
    id: s.id || uid(),
    name: String(s.name || ""),
    location: String(s.location || ""),
    emps: (Array.isArray(s.emps) ? s.emps : []).map((e) => ({
      id: e.id || uid(),
      name: String(e.name || ""),
      role: e.role === "sup" ? "sup" : "emp",
      salary: Number(e.salary || 0),
      att: e.att && typeof e.att === "object" ? e.att : {},
      upad: (Array.isArray(e.upad) ? e.upad : []).map((u) => ({
        id: u.id || uid(),
        date: u.date || "",
        amount: Number(u.amount || 0),
        note: String(u.note || ""),
      })),
    })),
  }));
  return { sites };
}

// જૂનો ડેટા (જો આ ફોનમાં પહેલાં સચવાયો હોય) — એક વાર સર્વર પર ખસેડવા માટે
function loadLocalSites() {
  try {
    const raw = localStorage.getItem(SITE_KEY);
    if (raw) return normalizeSites(JSON.parse(raw));
  } catch (e) {}
  return null;
}

export default function SiteSystem({ onClose, loadData, saveData }) {
  const [data, setData] = useState({ sites: [] });
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [sync, setSync] = useState("saved"); // saved | saving | error
  const [sid, setSid] = useState(null);
  const [eid, setEid] = useState(null);

  const dataRef = useRef(data);
  const dirty = useRef(false);
  const loaded = useRef(false);
  const justLoaded = useRef(false);
  const timer = useRef(null);

  // સર્વર પર સેવ કરે છે (ફેરફાર થયો હોય તો જ)
  const flush = async () => {
    clearTimeout(timer.current);
    if (!dirty.current || !loaded.current) return;
    const snap = dataRef.current;
    setSync("saving");
    try {
      await saveData(JSON.stringify(snap));
      if (dataRef.current === snap) {
        dirty.current = false;
        setSync("saved");
      } else {
        timer.current = setTimeout(flush, 800);
      }
    } catch (e) {
      console.error("site save failed", e);
      setSync("error");
      timer.current = setTimeout(flush, 5000);
    }
  };

  const load = async () => {
    setPhase("loading");
    try {
      const raw = await loadData();
      let d;
      let migrate = false;
      if (raw) {
        d = normalizeSites(JSON.parse(raw));
      } else {
        const old = loadLocalSites();
        d = old || { sites: [] };
        migrate = !!(old && old.sites.length);
      }
      dataRef.current = d;
      justLoaded.current = true;
      loaded.current = true;
      setData(d);
      setPhase("ready");
      if (migrate) {
        dirty.current = true;
        flush();
      }
    } catch (e) {
      // સર્વર પરથી ડેટા ન આવે તો ખાલી ડેટા સેવ ન થઈ જાય એટલે અહીં અટકી જઈએ છીએ
      console.error("site load failed", e);
      setPhase("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  // દરેક ફેરફાર પછી ~1 સેકન્ડમાં આપમેળે સર્વર પર સેવ
  useEffect(() => {
    dataRef.current = data;
    if (!loaded.current) return;
    if (justLoaded.current) {
      justLoaded.current = false;
      return;
    }
    dirty.current = true;
    setSync("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }, [data]);

  // એપ બદલતાં / સ્ક્રીન બંધ થતાં / બહાર નીકળતાં તરત સેવ
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", h);
    return () => {
      document.removeEventListener("visibilitychange", h);
      flush();
    };
  }, []);

  // પાછળનું પેજ સ્ક્રોલ ન થાય
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const close = async () => {
    await flush();
    if (dirty.current && !window.confirm("છેલ્લા ફેરફારો સર્વર પર સેવ થયા નથી. છતાં બહાર નીકળવું?")) return;
    if (onClose) onClose();
  };

  const upSite = (id, fn) =>
    setData((d) => ({ ...d, sites: d.sites.map((s) => (s.id === id ? fn(s) : s)) }));
  const upEmp = (siteId, empId, fn) =>
    upSite(siteId, (s) => ({ ...s, emps: s.emps.map((e) => (e.id === empId ? fn(e) : e)) }));

  const site = data.sites.find((s) => s.id === sid);
  const emp = site && site.emps.find((e) => e.id === eid);

  const addSite = (name, location) =>
    setData((d) => ({
      ...d,
      sites: [...d.sites, { id: uid(), name, location, emps: [newEmp("Supervisor", "sup")] }],
    }));

  const backup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "site-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result));
        if (!d || !Array.isArray(d.sites)) throw new Error("bad");
        const n = normalizeSites(d);
        if (window.confirm(`${n.sites.length} સાઇટ મળી. હાલનો ડેટા બદલીને આ બેકઅપ લાવવો?`)) {
          setData(n);
          setSid(null);
          setEid(null);
        }
      } catch (e) {
        window.alert("આ બેકઅપ ફાઇલ વાંચી શકાઈ નથી. 'site-backup.json' ફાઇલ પસંદ કરો.");
      }
    };
    r.readAsText(file);
  };

  let body;
  if (phase === "loading")
    body = <div className="center">⏳ ડેટા લોડ થઈ રહ્યો છે…</div>;
  else if (phase === "error")
    body = (
      <div className="center">
        <p>ડેટા સર્વર પરથી લાવી શકાયો નથી. ઇન્ટરનેટ તપાસો.</p>
        <button onClick={load}>ફરી પ્રયત્ન કરો</button>
        <button className="line-btn dark" style={{ marginTop: 10 }} onClick={onClose}>← બહાર</button>
      </div>
    );
  else if (site && emp)
    body = (
      <EmpPage
        site={site}
        emp={emp}
        onBack={() => setEid(null)}
        onChange={(fn) => upEmp(site.id, emp.id, fn)}
        onDelete={() => {
          if (window.confirm("આ કર્મચારીને કાઢી નાખવો?")) {
            upSite(site.id, (s) => ({ ...s, emps: s.emps.filter((e) => e.id !== emp.id) }));
            setEid(null);
          }
        }}
      />
    );
  else if (site)
    body = (
      <SitePage
        site={site}
        onBack={() => setSid(null)}
        onOpen={setEid}
        onChange={(fn) => upSite(site.id, fn)}
        onDelete={() => {
          if (window.confirm("આ સાઇટ અને તેના બધા કર્મચારી કાયમ માટે કાઢી નાખવા?")) {
            setData((d) => ({ ...d, sites: d.sites.filter((s) => s.id !== site.id) }));
            setSid(null);
          }
        }}
      />
    );
  else
    body = <SitesPage data={data} onOpen={setSid} onAdd={addSite} onLogout={close} onBackup={backup} onRestore={restore} />;

  return createPortal(
    <div className="nvo">
      <style>{nvCss}</style>
      <div className="nv">
        {phase === "ready" && (
          <div className={"syncbar noprint " + sync}>
            {sync === "saved" ? "☁ સર્વર પર સેવ થયું" : sync === "saving" ? "⏳ સેવ થઈ રહ્યું છે…" : "⚠ સેવ થયું નથી — ફરી પ્રયત્ન ચાલુ છે"}
          </div>
        )}
        {body}
      </div>
    </div>,
    document.body
  );
}

function SitesPage({ data, onOpen, onAdd, onLogout, onBackup, onRestore }) {
  const [name, setName] = useState("");
  const [loc, setLoc] = useState("");
  const totalMp = data.sites.reduce((s, x) => s + x.emps.length, 0);
  return (
    <>
      <div className="hd">
        <div className="hdrow">
          <div>
            <div className="sub">ડેશબોર્ડ</div>
            <div className="h1">Site Overview</div>
          </div>
          <button className="line-btn noprint" onClick={onLogout}>← બહાર</button>
        </div>
      </div>

      <div className="cards">
        <div className="card"><small>કુલ સાઇટ</small><b>{data.sites.length}</b></div>
        <div className="card"><small>કુલ MP</small><b>{totalMp}</b></div>
      </div>

      <div className="sec">Site List</div>
      <div className="tbl">
        <div className="tr th"><span>Site Name</span><span>Location</span><span className="r">MP</span></div>
        {data.sites.map((s, i) => (
          <div key={s.id} className={"tr " + (i % 2 ? "odd" : "even") + " click"} onClick={() => onOpen(s.id)}>
            <b>{s.name}</b>
            <span className="loc">{s.location || "—"}</span>
            <span className="r"><span className="mp">{s.emps.length}</span></span>
          </div>
        ))}
        {data.sites.length > 0 && (
          <div className="tr th tot"><span>કુલ</span><span></span><span className="r">{totalMp}</span></div>
        )}
      </div>
      {data.sites.length === 0 && <p className="mut pad">હજી કોઈ સાઇટ નથી. નીચેથી પહેલી સાઇટ ઉમેરો.</p>}
      <p className="mut pad">MP = કર્મચારીઓની સંખ્યા (Manpower). સાઇટ પર ટેપ કરો તો કર્મચારી ખુલશે.</p>

      <div className="form">
        <b>+ નવી સાઇટ</b>
        <input placeholder="Site Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Location" value={loc} onChange={(e) => setLoc(e.target.value)} />
        <button
          onClick={() => {
            if (!name.trim()) return;
            onAdd(name.trim(), loc.trim());
            setName("");
            setLoc("");
          }}
        >
          ઉમેરો
        </button>
      </div>

      <div className="rowb noprint">
        <button className="line-btn dark" onClick={() => window.print()}>🖨 PDF / પ્રિન્ટ</button>
        <button className="line-btn dark" onClick={onBackup}>💾 બેકઅપ</button>
      </div>
      <label className="noprint" style={{ display: "block", margin: "10px 16px 0" }}>
        <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { onRestore(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        <div className="restorebtn">📥 બેકઅપ ફાઇલ ચડાવો (restore)</div>
      </label>
    </>
  );
}

function SitePage({ site, onBack, onOpen, onChange, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const today = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const presentToday = site.emps.filter((e) => e.att[today] === "P").length;
  const nowD = new Date();
  const anySalary = site.emps.some((e) => Number(e.salary) > 0);
  const totalNet = site.emps.reduce((sum, e) => sum + monthCalc(e, nowD.getFullYear(), nowD.getMonth()).net, 0);

  const addEmp = () => {
    if (!name.trim()) return;
    onChange((s) => ({ ...s, emps: [...s.emps, newEmp(name.trim())] }));
    setName("");
  };
  const removeEmp = (e) => {
    if (e.role === "sup") return;
    if (window.confirm(e.name + " ને કાઢી નાખવો?"))
      onChange((s) => ({ ...s, emps: s.emps.filter((x) => x.id !== e.id) }));
  };

  return (
    <>
      <div className="hd">
        <div className="hdrow">
          <button className="back" onClick={onBack}>← Site List</button>
          <button className="line-btn noprint" onClick={() => setEdit(!edit)}>✎ સુધારો</button>
        </div>
        <div className="h1">{site.name}</div>
        <div className="sub">{site.location || "Location નથી"}</div>
      </div>

      {edit && (
        <div className="form">
          <input placeholder="Site Name" value={site.name} onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))} />
          <input placeholder="Location" value={site.location} onChange={(e) => onChange((s) => ({ ...s, location: e.target.value }))} />
          <button className="danger" onClick={onDelete}>આ સાઇટ કાઢી નાખો</button>
        </div>
      )}

      <div className="cards three">
        <div className="card"><small>કુલ MP</small><b>{site.emps.length}</b></div>
        <div className="card"><small>આજે હાજર</small><b className="g">{presentToday}</b></div>
        <div className="card"><small>આ મહિનાનો બાકી પગાર</small><b className={totalNet < 0 ? "rd" : ""}>{anySalary ? "₹" + num(totalNet) : "—"}</b></div>
      </div>

      <div className="sec">Employees</div>
      <div className="pad">
        {site.emps.map((e, i) => {
          const st = e.att[today];
          return (
            <div key={e.id} className={"emp " + (e.role === "sup" ? "sup" : i % 2 ? "odd" : "even")}>
              <div className="empmain" onClick={() => onOpen(e.id)}>
                <span className="no">{i + 1}</span>
                <b>{e.name || "(નામ નથી)"}</b>
                {e.role === "sup" && <span className="badge">Supervisor</span>}
                <span className={"st " + (st || "n")}>{st === "P" ? "હાજર" : st === "A" ? "ગેરહાજર" : "—"}</span>
              </div>
              {e.role !== "sup" && (
                <button className="x noprint" aria-label="કાઢી નાખો" onClick={() => removeEmp(e)}>✕</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="form noprint">
        <b>+ નવો કર્મચારી</b>
        <div className="rowb">
          <input placeholder="કર્મચારીનું નામ" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEmp()} />
          <button style={{ width: "auto" }} onClick={addEmp}>ઉમેરો</button>
        </div>
      </div>
      <p className="mut pad">Supervisor હંમેશા પહેલો રહેશે અને કાઢી શકાશે નહીં. કર્મચારી પર ટેપ કરો તો હાજરી કેલેન્ડર ખુલશે.</p>
    </>
  );
}

function EmpPage({ site, emp, onBack, onChange, onDelete }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [sel, setSel] = useState(iso(now.getFullYear(), now.getMonth(), now.getDate()));
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState(false);

  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const prefix = `${ym.y}-${pad(ym.m + 1)}`;
  const first = new Date(ym.y, ym.m, 1).getDay();
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const upByDate = useMemo(() => {
    const o = {};
    emp.upad.forEach((u) => {
      if (u.date) o[u.date] = (o[u.date] || 0) + Number(u.amount || 0);
    });
    return o;
  }, [emp.upad]);

  const monthKeys = Object.keys(emp.att).filter((k) => k.startsWith(prefix));
  const present = monthKeys.filter((k) => emp.att[k] === "P").length;
  const absent = monthKeys.filter((k) => emp.att[k] === "A").length;
  const monthUpad = upadSum(emp.upad, prefix);
  const mc = monthCalc(emp, ym.y, ym.m);
  const monthList = emp.upad.filter((u) => (u.date || "").startsWith(prefix)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const dayUpad = emp.upad.filter((u) => u.date === sel);
  const status = emp.att[sel];

  const go = (delta) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
    setSel(iso(d.getFullYear(), d.getMonth(), 1));
  };
  const setAtt = (val) =>
    onChange((e) => {
      const att = { ...e.att };
      if (val) att[sel] = val;
      else delete att[sel];
      return { ...e, att };
    });
  const addUpad = () => {
    const a = Number(amt);
    if (!a) return;
    onChange((e) => ({ ...e, upad: [...e.upad, { id: uid(), date: sel, amount: a, note: note.trim() }] }));
    setAmt("");
    setNote("");
  };
  const editUpad = (id, patch) =>
    onChange((e) => ({ ...e, upad: e.upad.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const delUpad = (id) => onChange((e) => ({ ...e, upad: e.upad.filter((u) => u.id !== id) }));

  return (
    <>
      <div className="hd">
        <div className="hdrow">
          <button className="back" onClick={onBack}>← {site.name}</button>
          <button className="line-btn noprint" onClick={() => setEdit(!edit)}>✎ સુધારો</button>
        </div>
        <div className="h1">{emp.name || "(નામ નથી)"}</div>
        <div className="sub">{site.name}{site.location ? " · " + site.location : ""}{emp.role === "sup" ? " · Supervisor" : ""}</div>
      </div>

      {edit && (
        <div className="form">
          <input placeholder="નામ" value={emp.name} onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))} />
          <input type="number" inputMode="numeric" placeholder="માસિક પગાર (₹) — જેમ કે 12000" value={emp.salary || ""} onChange={(e) => onChange((x) => ({ ...x, salary: Number(e.target.value || 0) }))} />
          {emp.role !== "sup" && <button className="danger" onClick={onDelete}>આ કર્મચારી કાઢી નાખો</button>}
        </div>
      )}

      <div className="cards three">
        <div className="card"><small>હાજર</small><b className="g">{present}</b></div>
        <div className="card"><small>ગેરહાજર</small><b className="rd">{absent}</b></div>
        <div className="card"><small>આ મહિનાનો ઉપાડ</small><b>{num(monthUpad)}</b></div>
      </div>

      <div className="form paybox">
        <b>💰 પગાર — {MONTHS[ym.m]}</b>
        {mc.salary > 0 ? (
          <>
            <div className="uprow"><span>માસિક પગાર</span><b>₹{rs(mc.salary)}</b></div>
            <div className="uprow"><span>દર દિવસ ({rs(mc.salary)} ÷ {mc.days})</span><b>₹{rs(mc.perDay)}</b></div>
            <div className="uprow"><span>કમાણી ({mc.present} હાજર × ₹{rs(mc.perDay)})</span><b>₹{num(mc.earned)}</b></div>
            <div className="uprow"><span>− ઉપાડ</span><b>₹{num(mc.upad)}</b></div>
            <div className="uprow tot"><b>બાકી ચૂકવવાના</b><b className={mc.net < 0 ? "rd" : ""}>₹{num(mc.net)}</b></div>
          </>
        ) : (
          <p className="mut">માસિક પગાર નાખ્યો નથી. ✎ સુધારો દબાવીને પગાર નાખો.</p>
        )}
      </div>

      <div className="calnav">
        <button className="sq" aria-label="પાછલો મહિનો" onClick={() => go(-1)}>‹</button>
        <b>{MONTHS[ym.m]} {ym.y}</b>
        <button className="sq" aria-label="આવતો મહિનો" onClick={() => go(1)}>›</button>
      </div>

      <div className="calgrid">
        {DAYS.map((d) => <div key={d} className="dn">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={"e" + i} />;
          const key = iso(ym.y, ym.m, d);
          const st = emp.att[key];
          return (
            <div
              key={key}
              className={"cd " + (st === "P" ? "p" : st === "A" ? "a" : "n") + (key === sel ? " sel" : "") + (key === todayIso ? " today" : "")}
              onClick={() => setSel(key)}
            >
              <b>{d}</b>
              {upByDate[key] ? <em>{num(upByDate[key])}</em> : null}
              {st && <i>{st}</i>}
            </div>
          );
        })}
      </div>
      <div className="legend pad">
        <span><b className="g">■</b> P = હાજર</span>
        <span><b className="rd">■</b> A = ગેરહાજર</span>
        <span><b className="y">પીળી રકમ</b> = ઉપાડ</span>
      </div>

      <div className="form">
        <b>📅 {fmtDate(sel)}</b>
        <div className="rowb noprint">
          <button className={"pa p" + (status === "P" ? " on" : "")} onClick={() => setAtt("P")}>હાજર</button>
          <button className={"pa a" + (status === "A" ? " on" : "")} onClick={() => setAtt("A")}>ગેરહાજર</button>
          <button className="pa c" onClick={() => setAtt(null)}>ભૂંસો</button>
        </div>
        <div className="sub2">આ તારીખનો ઉપાડ: {num(upadSum(dayUpad))}</div>
        {dayUpad.map((u) => (
          <div key={u.id} className="rowb up">
            <input type="number" inputMode="numeric" value={u.amount} onChange={(e) => editUpad(u.id, { amount: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="વિગત" value={u.note || ""} onChange={(e) => editUpad(u.id, { note: e.target.value })} style={{ flex: 1.4 }} />
            <button className="x noprint" aria-label="કાઢી નાખો" onClick={() => delUpad(u.id)}>✕</button>
          </div>
        ))}
        <div className="rowb noprint">
          <input type="number" inputMode="numeric" placeholder="ઉપાડ રકમ" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="વિગત (વૈકલ્પિક)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1.4 }} />
        </div>
        <button className="noprint" onClick={addUpad}>{fmtDate(sel)} નો ઉપાડ ઉમેરો</button>
      </div>

      <div className="sec">ઉપાડ (Upad) — {MONTHS[ym.m]}</div>
      <div className="pad">
        {monthList.length === 0 && <p className="mut">આ મહિનામાં કોઈ ઉપાડ નથી.</p>}
        {monthList.map((u) => (
          <div key={u.id} className="uprow" onClick={() => setSel(u.date)}>
            <div><b>{fmtDate(u.date)}</b>{u.note && <small> · {u.note}</small>}</div>
            <b>{num(u.amount)}</b>
          </div>
        ))}
        <div className="uprow tot"><b>કુલ (આ મહિનો)</b><b>{num(monthUpad)}</b></div>
        <div className="uprow tot"><b>કુલ ઉપાડ (બધા મહિના)</b><b>{num(upadSum(emp.upad))}</b></div>
      </div>
    </>
  );
}

const nvCss = `
@import url('https://fonts.googleapis.com/css2?family=Hind+Vadodara:wght@400;500;600;700&display=swap');
.nvo{position:fixed;inset:0;z-index:9999;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#E4EAF4;font-family:"Hind Vadodara",sans-serif;color:#0B2545}
.nvo *{box-sizing:border-box}
.nv{max-width:520px;margin:0 auto;min-height:100vh;background:#F3F6FB;padding-bottom:40px;box-shadow:0 0 18px #0002}
.nv .center{padding:60px 16px;text-align:center;color:#0B2545;font-size:16px}
.nv .syncbar{font-size:12px;text-align:center;padding:4px 8px;background:#06172E;color:#9DB8E6}
.nv .syncbar.error{background:#B3261E;color:#fff}
.nv .hd{background:#0B2545;color:#fff;padding:20px 16px 16px}
.nv .hdrow{display:flex;justify-content:space-between;align-items:center;gap:8px}
.nv .h1{font-size:26px;font-weight:700;color:#fff;margin-top:4px}
.nv .sub{font-size:14px;color:#9DB8E6}
.nv .sub2{font-size:14px;color:#5A6B86;margin:10px 0 4px}
.nv .back{width:auto;background:transparent;color:#9DB8E6;padding:6px 0;margin:0;font-size:15px;font-weight:600}
.nv button{padding:11px 14px;border:0;border-radius:10px;background:#0B2545;color:#fff;font-size:16px;font-weight:600;width:100%;margin-top:8px;font-family:inherit;min-height:44px}
.nv button.line-btn{width:auto;margin:0;background:transparent;color:#fff;border:1px solid #5B7DB8;font-size:14px;padding:8px 14px;min-height:40px}
.nv button.line-btn.dark{color:#0B2545;border-color:#0B2545}
.nv button.danger{background:#B3261E}
.nv button.x{width:44px;margin:0;background:transparent;color:#FF9C94;font-size:22px;padding:0}
.nv .form button.x{color:#B3261E}
.nv button.sq{width:44px;margin:0;background:#fff;color:#0B2545;border:1px solid #BCC9DE;font-size:22px;padding:0}
.nv input{width:100%;height:46px;border:1px solid #BCC9DE;border-radius:10px;padding:0 12px;font-size:16px;margin:4px 0;background:#fff;color:#0B2545;font-family:inherit}
.nv input:focus{outline:2px solid #5B8DEF;border-color:#5B8DEF}
.nv .cards{display:flex;gap:10px;padding:16px 16px 4px}
.nv .card{flex:1;background:#fff;border:1px solid #D5DEEC;border-radius:14px;padding:10px 14px}
.nv .card small{display:block;font-size:12px;color:#5A6B86}
.nv .card b{font-size:28px;color:#0B2545}
.nv .cards.three .card{padding:8px 10px}
.nv .cards.three .card b{font-size:24px}
.nv .g{color:#1E7A45}.nv .rd{color:#B3261E}.nv .y{color:#B48A00}
.nv .sec{font-size:18px;font-weight:700;padding:14px 16px 8px}
.nv .pad{padding:0 16px}
.nv .mut{color:#5A6B86;font-size:13px}
.nv small{color:#5A6B86}
.nv .tbl{margin:0 16px;border-radius:14px;overflow:hidden;border:1px solid #0B2545}
.nv .tr{display:grid;grid-template-columns:1.1fr 1.3fr 60px;align-items:center;gap:8px;padding:13px 16px;color:#fff;font-size:16px}
.nv .tr.th{background:#06172E;font-size:14px;font-weight:700;color:#9DB8E6;letter-spacing:.5px}
.nv .tr.tot{border-top:2px solid #5B8DEF;color:#fff;font-size:17px}
.nv .tr.even{background:#0F2F5C}.nv .tr.odd{background:#143A70}
.nv .tr.click{cursor:pointer}.nv .tr.click:active{background:#1B4F9C}
.nv .loc{color:#C9D8F2}
.nv .r{justify-self:end;text-align:right}
.nv .mp{display:inline-block;min-width:44px;text-align:center;border-radius:20px;padding:2px 10px;font-weight:700;background:#DCE8FF;color:#0B2545}
.nv .form{margin:14px 16px;background:#fff;border:1px solid #D5DEEC;border-radius:14px;padding:12px}
.nv .rowb{display:flex;gap:8px;align-items:center}
.nv .rowb button{margin-top:4px}
.nv .rowb.noprint:last-child{margin:0 16px}
.nv .emp{display:flex;align-items:center;border-radius:12px;color:#fff;margin-bottom:8px}
.nv .emp.even{background:#0F2F5C}.nv .emp.odd{background:#143A70}.nv .emp.sup{background:#1B4F9C}
.nv .empmain{flex:1;display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;min-height:48px;min-width:0}
.nv .empmain b{font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nv .no{width:30px;height:30px;flex:none;border-radius:50%;background:#DCE8FF;color:#0B2545;font-weight:700;display:flex;align-items:center;justify-content:center}
.nv .badge{background:#F2C14E;color:#3A2C06;font-size:12px;font-weight:700;border-radius:10px;padding:2px 10px;flex:none}
.nv .st{margin-left:auto;font-size:12px;font-weight:700;border-radius:10px;padding:2px 8px;flex:none}
.nv .st.P{background:#1E7A45;color:#fff}.nv .st.A{background:#B3261E;color:#fff}.nv .st.n{color:#9DB8E6}
.nv .calnav{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 8px;font-size:20px}
.nv .calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;padding:0 14px}
.nv .dn{text-align:center;font-size:12px;color:#5A6B86;font-weight:600}
.nv .cd{min-height:54px;border-radius:8px;border:1px solid #D5DEEC;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;cursor:pointer;color:#0B2545;padding:2px}
.nv .cd b{font-size:16px}
.nv .cd em{font-style:normal;font-size:10px;font-weight:700;color:#8A5A00}
.nv .cd i{font-style:normal;font-size:9px;opacity:.9}
.nv .cd.p{background:#1E7A45;border-color:#1E7A45;color:#fff}
.nv .cd.a{background:#B3261E;border-color:#B3261E;color:#fff}
.nv .cd.p em,.nv .cd.a em{color:#FFE08A}
.nv .cd.today{box-shadow:inset 0 0 0 2px #F2C14E}
.nv .cd.sel{outline:3px solid #0B2545;outline-offset:2px}
.nv .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:#2B3A55}
.nv .pa{margin-top:10px!important}
.nv .pa.p{background:#DCEFE4;color:#1E7A45;border:2px solid #1E7A45}.nv .pa.p.on{background:#1E7A45;color:#fff}
.nv .pa.a{background:#F8DEDC;color:#B3261E;border:2px solid #B3261E}.nv .pa.a.on{background:#B3261E;color:#fff}
.nv .pa.c{background:#DCE8FF;color:#0B2545}
.nv .up input{margin:4px 0}
.nv .uprow{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #D5DEEC;border-radius:12px;padding:10px 14px;margin-bottom:8px;cursor:pointer}
.nv .uprow.tot{background:#0B2545;color:#fff;cursor:default}
.nv .restorebtn{margin-top:8px;padding:11px 14px;border:1px solid #0B2545;border-radius:10px;color:#0B2545;text-align:center;font-size:15px;font-weight:600;cursor:pointer}
.nv .paybox .uprow{cursor:default;gap:10px;font-size:14px}
.nv .uprow.tot .rd{color:#FF9C94}
@media print{body > *:not(.nvo){display:none !important}.nvo{position:static;overflow:visible;background:#fff}.nv{box-shadow:none}.noprint{display:none!important}}
`;
