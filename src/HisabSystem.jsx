import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { makeSeed } from "./HisabSeed";

// 📒 હિસાબ સિસ્ટમ: ખાતું (નામ + ગામ) → તારીખ મુજબ એન્ટ્રી (રકમ, ભાડું, વિગત) → કુલ સરવાળો
// ડેટા Firestore (store/hisabData) માં સર્વર પર સચવાય છે — loadData / saveData App.jsx માંથી મળે છે.
// કોઈ પણ ફોન પર એ જ સેલર લૉગિન કરો તો એ જ ડેટા દેખાશે. બેકઅપ (💾) વધારાની સલામતી માટે છે.

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const uid = () => Math.random().toString(36).slice(2, 9);
const total = (k) => k.entries.reduce((s, e) => s + Number(e.amount || 0), 0);

function NewCard({ byNo, vacant, suggest, onAdd }) {
  const [no, setNo] = useState(String(suggest));
  const [naam, setNaam] = useState("");
  const [gaon, setGaon] = useState("");
  const taken = no ? byNo[Number(no)] : null;
  const go = () => {
    const n = Number(no);
    if (!Number.isInteger(n) || n < 1) return window.alert("કાર્ડ નંબર લખો");
    if (byNo[n]) return window.alert(`કાર્ડ નંબર ${n} ચાલુ છે (${byNo[n].naam || "નામ નથી"}). ખાલી નંબર પસંદ કરો.`);
    if (!naam.trim()) return window.alert("નામ લખો");
    onAdd(n, naam.trim(), gaon.trim());
  };
  return (
    <div className="box noprint">
      <b>➕ નવું કાર્ડ</b>
      <input inputMode="numeric" placeholder="કાર્ડ નંબર" value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} />
      <div className="mut" style={{ minHeight: 20, fontSize: 14 }}>
        {no ? (taken ? "⚠ આ નંબર ચાલુ છે: " + (taken.naam || "(નામ નથી)") : "✓ આ નંબર ખાલી છે") : ""}
      </div>
      {vacant.length > 0 && (
        <>
          <div className="mut" style={{ fontSize: 13 }}>ખાલી નંબર (દબાવીને પસંદ કરો):</div>
          <div className="chips">
            {vacant.slice(0, 30).map((n) => (
              <button key={n} type="button" className="chip" onClick={() => setNo(String(n))}>{n}</button>
            ))}
            {vacant.length > 30 && <span className="mut">…</span>}
          </div>
        </>
      )}
      <div className="row">
        <input placeholder="નામ" value={naam} onChange={(e) => setNaam(e.target.value)} />
        <input placeholder="ગામ" value={gaon} onChange={(e) => setGaon(e.target.value)} />
      </div>
      <button onClick={go}>ઉમેરો</button>
    </div>
  );
}

const MONTHS = ["જાન્યુઆરી","ફેબ્રુઆરી","માર્ચ","એપ્રિલ","મે","જૂન","જુલાઈ","ઓગસ્ટ","સપ્ટેમ્બર","ઓક્ટોબર","નવેમ્બર","ડિસેમ્બર"];
const DAYS = ["રવિ","સોમ","મંગળ","બુધ","ગુરુ","શુક્ર","શનિ"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "—");

function Detail({ k, onBack, onChange, onDelete, onToggleClose }) {
  const now = new Date();
  // કેલેન્ડર છેલ્લી એન્ટ્રીવાળા મહિનામાં ખૂલે; એન્ટ્રી ન હોય તો આજના મહિનામાં
  const latest = k.entries.map((e) => e.date).filter(Boolean).sort().pop();
  const start = latest ? new Date(latest + "T00:00:00") : now;
  const [ym, setYm] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [sel, setSel] = useState(iso(start.getFullYear(), start.getMonth(), start.getDate()));
  const [amt, setAmt] = useState("");
  const [vigat, setVigat] = useState("");
  const [kiraya, setKiraya] = useState(false);
  const [edit, setEdit] = useState(false);

  const byDate = useMemo(() => {
    const o = {};
    k.entries.forEach((e) => {
      if (e.date) o[e.date] = (o[e.date] || 0) + Number(e.amount || 0);
    });
    return o;
  }, [k.entries]);

  const first = new Date(ym.y, ym.m, 1).getDay();
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const prefix = `${ym.y}-${pad(ym.m + 1)}`;
  const monthTotal = k.entries.filter((e) => (e.date || "").startsWith(prefix)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());

  const go = (delta) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  const add = () => {
    const a = Number(amt);
    if (!a) return;
    onChange({ entries: [...k.entries, { id: uid(), amount: a, date: sel, kiraya, vigat: vigat.trim() }] });
    setAmt("");
    setVigat("");
    setKiraya(false);
  };
  const del = (id) => onChange({ entries: k.entries.filter((e) => e.id !== id) });
  const setDate = (id, date) => onChange({ entries: k.entries.map((e) => (e.id === id ? { ...e, date } : e)) });

  const dayList = k.entries.filter((e) => e.date === sel);
  const undated = k.entries.filter((e) => !e.date);

  const Row = ({ e, undatedRow }) => (
    <div className="line slim">
      <div>
        <b className="amt">{inr(e.amount)}</b> {e.kiraya && <span className="tag">ભાડું</span>}
        {e.vigat && <div><small>{e.vigat}</small></div>}
      </div>
      <div className="row" style={{ width: "auto" }}>
        {undatedRow && (
          <button className="ghost noprint" style={{ margin: 0, padding: "5px 8px", fontSize: 12 }} onClick={() => setDate(e.id, sel)}>
            {fmtDate(sel)} મૂકો
          </button>
        )}
        <button className="x noprint" onClick={() => del(e.id)}>✕</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="row noprint" style={{ justifyContent: "space-between" }}>
        <button className="ghost" onClick={onBack}>← પાછા</button>
        <button className="ghost" onClick={() => setEdit(!edit)}>✎ નામ સુધારો</button>
      </div>

      <div className="khname">
        <h2>{k.naam || "(નામ નથી)"}</h2>
        <small>કાર્ડ નં. {k.no} · {k.gaon || "ગામ નથી"}</small>
        {k.note && <div className="warn">⚠ {k.note}</div>}
      </div>

      {k.closed && <div className="closedbar">🔒 હિસાબ પૂરો{k.closedOn ? " · " + fmtDate(k.closedOn) : ""}<br /><small>કાર્ડ નંબર {k.no} ખાલી ગણાય છે — બીજાને આપી શકાય.</small></div>}

      {edit && (
        <div className="box noprint">
          <div className="row">
            <input placeholder="નામ" value={k.naam} onChange={(e) => onChange({ naam: e.target.value })} />
            <input placeholder="ગામ" value={k.gaon} onChange={(e) => onChange({ gaon: e.target.value })} />
          </div>
          <input placeholder="નોંધ" value={k.note} onChange={(e) => onChange({ note: e.target.value })} />
          <button className="danger" onClick={onDelete}>આ ખાતું કાઢી નાખો</button>
        </div>
      )}

      <div className="grand">
        <div>આ ખાતાનો કુલ સરવાળો</div>
        <b>{inr(total(k))}</b>
        <small>{MONTHS[ym.m]}: {inr(monthTotal)}</small>
      </div>

      <button className={"noprint " + (k.closed ? "" : "ghost")} onClick={onToggleClose}>
        {k.closed ? "↩ એ જ ખાતું ફરી ચાલુ કરો" : "🔒 હિસાબ પૂરો — કાર્ડ બંધ કરો"}
      </button>

      <div className="cal">
        <div className="calhd">
          <button className="ghost noprint" onClick={() => go(-1)}>‹</button>
          <b>{MONTHS[ym.m]} {ym.y}</b>
          <button className="ghost noprint" onClick={() => go(1)}>›</button>
        </div>
        <div className="grid">
          {DAYS.map((d) => <div key={d} className="dn">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={"e" + i} />;
            const key = iso(ym.y, ym.m, d);
            return (
              <div key={key} className={"day" + (key === sel ? " sel" : "") + (key === todayIso ? " today" : "") + (byDate[key] ? " has" : "")} onClick={() => setSel(key)}>
                <span>{d}</span>
                {byDate[key] && <em>{Number(byDate[key]).toLocaleString("en-IN")}</em>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="box">
        <b>📅 {fmtDate(sel)}</b>
        {dayList.length === 0 && <div className="mut" style={{ margin: "6px 0" }}>આ તારીખે કોઈ એન્ટ્રી નથી.</div>}
        {dayList.map((e) => <Row key={e.id} e={e} />)}
        {k.closed ? (
          <div className="mut noprint" style={{ margin: "8px 0 2px" }}>બંધ કાર્ડમાં નવી એન્ટ્રી થતી નથી. આ નંબર બીજા કોઈને આપવો હોય તો પાછા જઈને “➕ નવું કાર્ડ” માં આ નંબર લખો.</div>
        ) : (
        <div className="noprint">
          <div className="row">
            <input type="number" inputMode="numeric" placeholder="રકમ" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <input placeholder="વિગત (વૈકલ્પિક)" value={vigat} onChange={(e) => setVigat(e.target.value)} />
          </div>
          <label className="chk">
            <input type="checkbox" checked={kiraya} onChange={(e) => setKiraya(e.target.checked)} /> ભાડું
          </label>
          <button onClick={add}>{fmtDate(sel)} ની એન્ટ્રી ઉમેરો</button>
        </div>
        )}
      </div>

      {undated.length > 0 && (
        <div className="box">
          <b>તારીખ વગરની એન્ટ્રી ({undated.length})</b>
          <div className="mut" style={{ fontSize: 13 }}>ઉપર તારીખ પસંદ કરી "મૂકો" દબાવો</div>
          {undated.map((e) => <Row key={e.id} e={e} undatedRow />)}
        </div>
      )}
    </>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+Gujarati:wght@400;600;700&display=swap');
.hso *{box-sizing:border-box}
.hso{margin:0;background:#e9e1c8;font-family:"Noto Serif Gujarati",Georgia,serif;color:#2b2a26;position:fixed;inset:0;z-index:9999;overflow-y:auto;-webkit-overflow-scrolling:touch}
.hso .wrap{max-width:520px;margin:0 auto;min-height:100vh;padding:14px 14px 40px;background:#fbf6e9;border-left:3px double #d9a79c;box-shadow:0 0 18px #0002}
.hso h1{text-align:center;color:#7a2e1d;margin:0 0 14px}
.hso input{width:100%;padding:11px;border:1px dashed #b9ac82;border-radius:6px;font-size:16px;margin:4px 0;background:#fffdf5;color:#2b2a26;font-family:inherit}
.hso input:focus{outline:2px solid #7a2e1d55;border-style:solid}
.hso button{padding:11px 14px;border:0;border-radius:6px;background:#7a2e1d;color:#fff;font-size:15px;width:100%;margin-top:6px;font-family:inherit}
.hso button.ghost{background:transparent;color:#7a2e1d;border:1px solid #7a2e1d;width:auto}
.hso button.danger{background:#a3261b;margin-top:16px}
.hso button.x{width:auto;background:transparent;color:#a3261b;border:1px solid #dcb1ab;padding:5px 10px;margin:0}
.hso .top{display:flex;gap:8px;align-items:center}
.hso .title{margin:0;font-size:24px}
.hso .month{font-size:21px;font-weight:700;border:0;background:transparent;color:#7a2e1d;margin:0}
.hso .grand{border:2px solid #7a2e1d;border-radius:6px;background:#fff8e1;color:#7a2e1d;padding:12px;margin:12px 0;text-align:center}
.hso .grand b{display:block;font-size:32px}
.hso .grand small{color:#7b7562}
.hso .search{background:#fffdf5}
.hso .ruled{margin:6px 0 10px;border-top:2px solid #7a2e1d}
.hso .line{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 4px;border-bottom:1px solid #d9cfae;cursor:pointer}
.hso .line:active{background:#f3ead0}
.hso .line.slim{padding:8px 4px;cursor:default}
.hso .nm{font-weight:700}
.hso .amt{color:#7a2e1d;font-size:17px}
.hso small,.hso .mut{color:#7b7562}
.hso .warn{font-size:12px;color:#8a5a00;margin-top:3px}
.hso .box{background:#fff8e1;border:1px solid #d9cfae;border-radius:6px;padding:12px;margin:12px 0}
.hso .row{display:flex;gap:8px}
.hso .chk{display:flex;align-items:center;gap:8px;margin:4px 0}
.hso .chk input{width:auto}
.hso .tag{background:#f6dfae;color:#7a4a00;border-radius:4px;padding:1px 7px;font-size:12px}
.hso .err{color:#a3261b;margin:4px 0}
.hso .login{margin-top:16vh}
.hso .khname{text-align:center;margin:10px 0 0}
.hso .khname h2{margin:0;font-size:26px;color:#7a2e1d}
.hso .cal{background:#fffdf5;border:1px solid #d9cfae;border-radius:6px;padding:10px;margin:12px 0}
.hso .calhd{display:flex;justify-content:space-between;align-items:center;color:#7a2e1d;margin-bottom:6px}
.hso .calhd button{margin:0;padding:4px 14px;font-size:20px}
.hso .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.hso .dn{text-align:center;font-size:12px;color:#7b7562;padding:2px 0}
.hso .day{min-height:46px;border:1px solid #e6dcbb;border-radius:5px;padding:3px;display:flex;flex-direction:column;align-items:center;cursor:pointer;background:#fff}
.hso .day span{font-size:14px}
.hso .day em{font-style:normal;font-size:9.5px;color:#7a2e1d;font-weight:700;margin-top:auto}
.hso .day.has{background:#c8ebc9;border-color:#2e8b3d}
.hso .day.today{border-color:#7a2e1d}
.hso .day.has em{color:#14532d}
.hso .day.sel{outline:3px solid #7a2e1d;outline-offset:1px}
.hso .tabs{display:flex;gap:8px;margin:10px 0 4px}
.hso .tabs button{margin:0;flex:1;width:auto;background:transparent;color:#7a2e1d;border:1px solid #7a2e1d}
.hso .tabs button.on{background:#7a2e1d;color:#fff}
.hso .closedbar{background:#ece7d6;border:1px dashed #7b7562;color:#5b5646;text-align:center;padding:8px;border-radius:6px;margin:8px 0}
.hso .chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.hso .chip{width:auto;margin:0;padding:5px 14px;background:#f6dfae;color:#7a4a00;border:1px solid #d9b46a;border-radius:14px;font-size:15px}
.hso .flash{background:#c8ebc9;border:1px solid #2e8b3d;color:#14532d;border-radius:6px;padding:8px 10px;margin:8px 0;text-align:center}
.hso .acts button{flex:1;width:auto;margin-top:0}
.hso .syncbar{font-size:12px;text-align:center;padding:3px 8px;margin:-14px -14px 10px;background:#7a2e1d;color:#fbf6e9}
.hso .syncbar.error{background:#a3261b}
.hso .center{padding:60px 10px;text-align:center}
@media print{body > *:not(.hso){display:none !important}.hso{position:static;overflow:visible;background:#fff}.hso .wrap{box-shadow:none;border:0}.hso .noprint{display:none!important}}
`;

const defaultData = () => ({ month: "Sai Communication", khatas: [] });

// બેકઅપ કે સર્વરના ડેટાને સલામત આકારમાં ફેરવે છે
function normalizeHisab(d) {
  const base = defaultData();
  const khatas = (Array.isArray(d && d.khatas) ? d.khatas : []).map((k) => ({
    id: k.id || uid(),
    no: Number(k.no) || 0,
    naam: String(k.naam || ""),
    gaon: String(k.gaon || ""),
    note: String(k.note || ""),
    closed: !!k.closed,
    closedOn: String(k.closedOn || ""),
    entries: (Array.isArray(k.entries) ? k.entries : []).map((e) => ({
      id: e.id || uid(),
      amount: Number(e.amount || 0),
      date: e.date || "",
      kiraya: !!e.kiraya,
      vigat: String(e.vigat || ""),
    })),
  }));
  // કાર્ડ નંબર: ચાલુ કાર્ડમાં દરેક નંબર અલગ. જૂના ડેટામાં નંબર ન હોય તો યાદીના ક્રમ મુજબ (1, 2, 3…) મળે.
  const used = new Set();
  khatas.forEach((k) => {
    if (k.no > 0 && !k.closed && !used.has(k.no)) used.add(k.no);
    else if (k.no > 0 && k.closed) { /* બંધ કાર્ડનો જૂનો નંબર જેમ છે તેમ */ }
    else k.no = 0;
  });
  khatas.forEach((k, i) => {
    if (k.no) return;
    let n = i + 1;
    while (!k.closed && used.has(n)) n++;
    k.no = n;
    if (!k.closed) used.add(n);
  });
  return { month: String((d && d.month) || base.month), khatas };
}

export default function HisabSystem({ onClose, loadData, saveData }) {
  const [data, setData] = useState({ month: "", khatas: [] });
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [sync, setSync] = useState("saved"); // saved | saving | error
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("open"); // open | closed
  const [panel, setPanel] = useState(null); // null | entry | card
  const [flash, setFlash] = useState("");
  const [qNo, setQNo] = useState("");
  const [qAmt, setQAmt] = useState("");
  const [qVigat, setQVigat] = useState("");
  const [qKiraya, setQKiraya] = useState(false);

  const dataRef = useRef(data);
  const dirty = useRef(false);
  const loaded = useRef(false);
  const justLoaded = useRef(false);
  const timer = useRef(null);

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
      console.error("hisab save failed", e);
      setSync("error");
      timer.current = setTimeout(flush, 5000);
    }
  };

  const load = async () => {
    setPhase("loading");
    try {
      const raw = await loadData();
      // સર્વર પર ડેટા ન હોય (પહેલી વાર) તો નોટબુકનો શરૂઆતનો ડેટા (હિસાબ 1-380) લોડ થાય અને સર્વર પર સેવ થાય
      const seeded = !raw;
      const d = raw ? normalizeHisab(JSON.parse(raw)) : normalizeHisab(makeSeed());
      dataRef.current = d;
      justLoaded.current = true;
      loaded.current = true;
      setData(d);
      setPhase("ready");
      if (seeded) {
        dirty.current = true;
        flush();
      }
    } catch (e) {
      // સર્વર પરથી ડેટા ન આવે તો ખાલી ડેટા સેવ ન થઈ જાય એટલે અહીં અટકી જઈએ છીએ
      console.error("hisab load failed", e);
      setPhase("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  const grand = useMemo(() => data.khatas.filter((k) => !k.closed).reduce((s, k) => s + total(k), 0), [data]);
  const closedTotal = useMemo(() => data.khatas.filter((k) => k.closed).reduce((s, k) => s + total(k), 0), [data]);
  // ચાલુ કાર્ડના નંબર, ખાલી નંબર અને સૂચવેલો નંબર
  const { byNo, vacant, nextNo } = useMemo(() => {
    const act = {};
    let mx = 0;
    data.khatas.forEach((k) => {
      mx = Math.max(mx, k.no || 0);
      if (!k.closed) act[k.no] = k;
    });
    const v = [];
    for (let n = 1; n <= mx; n++) if (!act[n]) v.push(n);
    return { byNo: act, vacant: v, nextNo: mx + 1 };
  }, [data]);
  const suggest = vacant.length ? vacant[0] : nextNo;
  const openCount = data.khatas.filter((k) => !k.closed).length;
  const closedCount = data.khatas.length - openCount;
  const say = (m) => {
    setFlash(m);
    setTimeout(() => setFlash(""), 3500);
  };
  const updateKhata = (id, patch) =>
    setData((d) => ({ ...d, khatas: d.khatas.map((k) => (k.id === id ? { ...k, ...patch } : k)) }));
  const addKhata = (no, naam, gaon) =>
    setData((d) => ({ ...d, khatas: [...d.khatas, { id: uid(), no, naam, gaon, note: "", closed: false, closedOn: "", entries: [] }] }));

  const toggleClose = (id) => {
    const k = data.khatas.find((x) => x.id === id);
    if (!k) return;
    const n = new Date();
    if (!k.closed) {
      if (!window.confirm(`આ કાર્ડનો હિસાબ પૂરો થયો? કાર્ડ નંબર ${k.no} ખાલી થશે અને બીજાને આપી શકાશે. જૂનો હિસાબ 'બંધ કાર્ડ' માં સચવાયેલો રહેશે.`)) return;
      updateKhata(id, { closed: true, closedOn: iso(n.getFullYear(), n.getMonth(), n.getDate()) });
      setOpenId(null);
      say(`🔒 હિસાબ પૂરો — કાર્ડ નંબર ${k.no} ખાલી થયો`);
      return;
    }
    // એ જ ખાતું ફરી ચાલુ: નંબર હજી ખાલી હોય તો એ જ, નહીંતર નવો નંબર
    let no = k.no;
    if (byNo[no]) {
      const r = window.prompt(`કાર્ડ નંબર ${no} હવે બીજાને (${byNo[no].naam || "નામ નથી"}) આપેલો છે. આ ખાતા માટે નવો નંબર લખો:`, String(suggest));
      if (r === null) return;
      no = Number(r);
      if (!Number.isInteger(no) || no < 1 || byNo[no]) return window.alert("આ નંબર ચાલુ છે કે ખોટો છે.");
    }
    updateKhata(id, { closed: false, closedOn: "", no });
    setOpenId(null);
    setTab("open");
    say(`✓ કાર્ડ નંબર ${no} ફરી ચાલુ થયું`);
  };

  // જલ્દી એન્ટ્રી: કાર્ડ નંબર + રકમ → આજની તારીખે એન્ટ્રી
  const qCard = qNo && byNo[Number(qNo)] ? { k: byNo[Number(qNo)], no: Number(qNo) } : null;
  const quickAdd = () => {
    const a = Number(qAmt);
    if (!qCard) return window.alert("ચાલુ કાર્ડનો સાચો નંબર લખો");
    if (!a) return window.alert("રકમ લખો");
    const n = new Date();
    updateKhata(qCard.k.id, {
      entries: [...qCard.k.entries, { id: uid(), amount: a, date: iso(n.getFullYear(), n.getMonth(), n.getDate()), kiraya: qKiraya, vigat: qVigat.trim() }],
    });
    say(`✓ ${qCard.k.naam} (કાર્ડ ${qCard.no}) માં ${inr(a)} ઉમેર્યા`);
    setQNo(""); setQAmt(""); setQVigat(""); setQKiraya(false);
  };

  const backup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "hisab-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result));
        if (!d || !Array.isArray(d.khatas)) throw new Error("bad");
        const n = normalizeHisab(d);
        if (window.confirm(`${n.khatas.length} ખાતા મળ્યા. હાલનો ડેટા બદલીને આ બેકઅપ લાવવો?`)) {
          setData(n);
          setOpenId(null);
        }
      } catch (e) {
        window.alert("આ બેકઅપ ફાઇલ વાંચી શકાઈ નથી. 'hisab-backup.json' ફાઇલ પસંદ કરો.");
      }
    };
    r.readAsText(file);
  };

  const open = data.khatas.find((k) => k.id === openId);
  const searching = !!q.trim();
  const list = data.khatas
    .map((k) => ({ k, no: k.no }))
    // કાર્ડ નંબરથી શોધ (ચાલુ + બંધ બંનેમાં, ચાલુ પહેલાં); નહીંતર પસંદ કરેલા ટેબ મુજબ
    .filter(({ k, no }) => (searching ? no === Number(q.trim()) : (tab === "closed") === !!k.closed))
    .sort((x, y) =>
      searching
        ? Number(!!x.k.closed) - Number(!!y.k.closed)
        : tab === "closed"
        ? String(y.k.closedOn).localeCompare(String(x.k.closedOn)) || x.no - y.no
        : x.no - y.no
    );

  let body;
  if (phase === "loading") body = <div className="center">⏳ ડેટા લોડ થઈ રહ્યો છે…</div>;
  else if (phase === "error")
    body = (
      <div className="center">
        <p>ડેટા સર્વર પરથી લાવી શકાયો નથી. ઇન્ટરનેટ તપાસો.</p>
        <button onClick={load}>ફરી પ્રયત્ન કરો</button>
        <button className="ghost" style={{ marginTop: 10 }} onClick={onClose}>← બહાર</button>
      </div>
    );
  else if (open)
    body = (
      <Detail
        k={open}
        onBack={() => setOpenId(null)}
        onChange={(patch) => updateKhata(open.id, patch)}
        onToggleClose={() => toggleClose(open.id)}
        onDelete={() => {
          if (window.confirm("આ ખાતું કાયમ માટે કાઢી નાખવું?")) {
            setData((d) => ({ ...d, khatas: d.khatas.filter((k) => k.id !== open.id) }));
            setOpenId(null);
          }
        }}
      />
    );
  else
    body = (
      <>
        <div className="top">
          <h2 className="title">📒</h2>
          <input className="month" value={data.month} onChange={(e) => setData({ ...data, month: e.target.value })} />
          <button className="ghost noprint" onClick={close}>બહાર નીકળો</button>
        </div>

        <div className="grand">
          <div>ચાલુ કાર્ડનો કુલ સરવાળો</div>
          <b>{inr(grand)}</b>
          <small>{openCount} ચાલુ · {closedCount} બંધ</small>
        </div>

        <div className="row acts noprint">
          <button className={panel === "entry" ? "" : "ghost"} onClick={() => setPanel(panel === "entry" ? null : "entry")}>✍ એન્ટ્રી</button>
          <button className={panel === "card" ? "" : "ghost"} onClick={() => setPanel(panel === "card" ? null : "card")}>➕ નવું કાર્ડ</button>
        </div>
        {flash && <div className="flash noprint">{flash}</div>}
        {panel === "card" && (
          <NewCard byNo={byNo} vacant={vacant} suggest={suggest} onAdd={(no, n, g) => { addKhata(no, n, g); setPanel(null); say(`✓ કાર્ડ નંબર ${no} બન્યું: ${n}`); }} />
        )}
        {panel === "entry" && (
          <div className="box noprint">
            <b>✍ જલ્દી એન્ટ્રી (આજની તારીખે)</b>
            <input inputMode="numeric" placeholder="કાર્ડ નંબર" value={qNo} onChange={(e) => setQNo(e.target.value.replace(/\D/g, ""))} />
            <div className="mut" style={{ minHeight: 20, fontSize: 14 }}>
              {qCard ? "→ " + (qCard.k.naam || "(નામ નથી)") + " (" + (qCard.k.gaon || "ગામ નથી") + ")" : qNo ? "ચાલુ કાર્ડ મળ્યું નથી" : ""}
            </div>
            <div className="row">
              <input type="number" inputMode="numeric" placeholder="રકમ" value={qAmt} onChange={(e) => setQAmt(e.target.value)} />
              <input placeholder="વિગત (વૈકલ્પિક)" value={qVigat} onChange={(e) => setQVigat(e.target.value)} />
            </div>
            <label className="chk"><input type="checkbox" checked={qKiraya} onChange={(e) => setQKiraya(e.target.checked)} /> ભાડું</label>
            <button onClick={quickAdd}>એન્ટ્રી ઉમેરો</button>
          </div>
        )}

        <div className="tabs noprint">
          <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>ચાલુ કાર્ડ ({openCount})</button>
          <button className={tab === "closed" ? "on" : ""} onClick={() => setTab("closed")}>બંધ · હિસાબ પૂરો ({closedCount})</button>
        </div>
        {tab === "open" && !searching && vacant.length > 0 && (
          <div className="mut noprint" style={{ fontSize: 13, textAlign: "center" }}>
            ખાલી કાર્ડ નંબર ({vacant.length}): {vacant.slice(0, 12).join(", ")}{vacant.length > 12 ? "…" : ""}
          </div>
        )}
        {tab === "closed" && !searching && closedCount > 0 && <div className="mut" style={{ textAlign: "center" }}>બંધ કાર્ડનો કુલ: {inr(closedTotal)}</div>}

        <input className="noprint search" inputMode="numeric" placeholder="🔍 કાર્ડ નંબર લખો" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} />

        <div className="ruled">
          {list.map(({ k, no }) => (
            <div key={k.id} className="line" onClick={() => setOpenId(k.id)}>
              <div>
                <div className="nm">{no}. {k.naam || "(નામ નથી)"} {k.closed && <span className="tag">🔒 હિસાબ પૂરો{k.closedOn ? " · " + fmtDate(k.closedOn) : ""}</span>}</div>
                <small>{k.gaon || "ગામ નથી"} · {k.entries.length} એન્ટ્રી</small>
                {k.note && <div className="warn">⚠ {k.note}</div>}
              </div>
              <b className="amt">{inr(total(k))}</b>
            </div>
          ))}
          {data.khatas.length === 0 && <p className="mut">હજી કોઈ ખાતું નથી. ઉપરથી “➕ નવું કાર્ડ” દબાવો.</p>}
          {data.khatas.length > 0 && list.length === 0 && <p className="mut">{searching ? "કંઈ મળ્યું નથી." : tab === "closed" ? "કોઈ બંધ કાર્ડ નથી." : "કોઈ ચાલુ કાર્ડ નથી."}</p>}
        </div>

        <div className="row noprint">
          <button className="ghost" onClick={() => window.print()}>🖨 PDF / પ્રિન્ટ</button>
          <button className="ghost" onClick={backup}>💾 બેકઅપ</button>
        </div>
        <label className="noprint" style={{ display: "block", marginTop: 10 }}>
          <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { restore(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          <div className="ghost" style={{ border: "1px solid #7a2e1d", borderRadius: 6, padding: 11, textAlign: "center", color: "#7a2e1d", cursor: "pointer" }}>📥 બેકઅપ ફાઇલ ચડાવો (restore)</div>
        </label>
      </>
    );

  return createPortal(
    <div className="hso">
      <style>{css}</style>
      <div className="wrap">
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
