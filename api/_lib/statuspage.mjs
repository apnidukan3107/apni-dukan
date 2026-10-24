// Status page for the shop owner:  https://apnidukanse.in/api/print?action=statuspage&key=YOUR_KEY
// buildStatus() turns what the server knows into a short summary; STATUS_HTML is the page that shows it.

export function buildStatus(st, orders, nowMs) {
  st = st || {};
  const sec = (iso) => (iso ? Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000)) : null);
  const printed = new Set(st.printedIds || []);
  const startMs = st.startAt ? Date.parse(st.startAt) : Infinity;
  let count = 0, oldest = null;
  for (const o of orders || []) {
    const t = Date.parse(o.createdAt);
    if (!o.id || printed.has(o.id) || !(t >= startMs)) continue;
    count++;
    if (oldest === null || t < oldest) oldest = t;
  }
  const espAgo = sec(st.lastSeen);
  const online = espAgo !== null && espAgo <= 150;
  const oldestAge = oldest === null ? null : Math.max(0, Math.round((nowMs - oldest) / 1000));
  const lastPrintAgo = sec(st.lastPrintedAt);
  const lastFailAgo = sec(st.lastFailAt);
  const failIsNewer = lastFailAgo !== null && (lastPrintAgo === null || lastFailAgo < lastPrintAgo);

  let code = 'ok';
  if (espAgo === null) code = 'no_data';
  else if (!online) code = 'esp_offline';
  else if (count > 0 && oldestAge > 90) code = 'waiting';
  else if (failIsNewer && lastFailAgo < 600) code = 'print_failed';
  const level = code === 'ok' ? 'ok' : (code === 'no_data' || code === 'print_failed') ? 'warn' : 'bad';

  return {
    verdict: { code, level },
    esp: { online, agoSec: espAgo },
    printer: {
      checkOk: typeof st.printerCheckOk === 'boolean' ? st.printerCheckOk : null,
      checkAgoSec: sec(st.printerCheckAt),
      checkPending: !!st.checkRequested,
      lastFail: st.lastFailAt ? { agoSec: lastFailAgo, why: st.lastFailWhy || '' } : null,
    },
    waiting: { count, oldestAgeSec: oldestAge },
    lastPrint: st.lastPrintedAt ? { agoSec: lastPrintAgo, ms: typeof st.lastPrintMs === 'number' ? st.lastPrintMs : null } : null,
  };
}

export const STATUS_HTML = `<!DOCTYPE html>
<html lang="gu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apni Dukan – પ્રિન્ટર સ્ટેટસ</title>
<style>
:root{--bg:#f1f4f8;--card:#fff;--text:#1d232a;--muted:#5b6671;--ok:#1b7f3b;--okbg:#e5f5ea;--warn:#8a5a00;--warnbg:#fff1d0;--bad:#b3261e;--badbg:#fde4e2;--btn:#0b5394}
@media (prefers-color-scheme:dark){:root{--bg:#14181d;--card:#1f262e;--text:#e8ecf0;--muted:#9aa5b1;--ok:#6fd48c;--okbg:#17321f;--warn:#f2c45a;--warnbg:#3a2e10;--bad:#ff8a80;--badbg:#3b1815;--btn:#4a90d9}}
*{box-sizing:border-box}
body{margin:0;padding:14px 12px 30px;background:var(--bg);color:var(--text);font-family:system-ui,'Noto Sans Gujarati','Shruti',sans-serif;line-height:1.55;max-width:520px;margin-inline:auto}
h1{font-size:19px;margin:4px 0 10px;text-align:center}
.banner{padding:12px 14px;border-radius:12px;font-weight:700;font-size:16px;margin-bottom:12px}
.banner.ok{background:var(--okbg);color:var(--ok)}.banner.warn{background:var(--warnbg);color:var(--warn)}.banner.bad{background:var(--badbg);color:var(--bad)}
.card{background:var(--card);border-radius:12px;padding:10px 14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.card h2{font-size:14px;margin:0 0 4px;color:var(--muted);font-weight:600}
.v{font-size:16px}.small{font-size:12.5px;color:var(--muted)}
.g{color:var(--ok);font-weight:700}.r{color:var(--bad);font-weight:700}.y{color:var(--warn);font-weight:700}
button{margin-top:8px;font:inherit;font-size:15px;font-weight:600;color:#fff;background:var(--btn);border:0;border-radius:10px;padding:9px 14px;width:100%}
button:disabled{opacity:.55}
</style></head><body>
<h1>🖨️ પ્રિન્ટર સ્ટેટસ</h1>
<div id="banner" class="banner warn">લોડ થાય છે…</div>
<div class="card"><h2>ESP32 (દુકાનનું બોર્ડ)</h2><div id="esp" class="v">—</div></div>
<div class="card"><h2>પ્રિન્ટર (Bluetooth)</h2><div id="prn" class="v">—</div>
<button id="chk">પ્રિન્ટર ચેક કરો</button><div id="chkmsg" class="small"></div></div>
<div class="card"><h2>બાકી ઓર્ડર</h2><div id="wait" class="v">—</div></div>
<div class="card"><h2>છેલ્લું બિલ</h2><div id="last" class="v">—</div></div>
<p class="small">દર ૧૦ સેકન્ડે આપોઆપ અપડેટ થાય છે. Bluetooth ફક્ત છાપતી વખતે ચાલુ થાય છે, એટલે પ્રિન્ટર જોડાયેલું છે કે નહીં તે જાણવા “પ્રિન્ટર ચેક કરો” દબાવો (૧૦–૩૦ સેકન્ડમાં જવાબ આવે).</p>
<script>
var q = new URLSearchParams(location.search), KEY = q.get('key') || '', API = location.pathname;
function $(id){return document.getElementById(id)}
function ago(s){ if (s==null) return '—'; if (s<60) return s+' સેકન્ડ પહેલાં'; if (s<3600) return Math.floor(s/60)+' મિનિટ પહેલાં'; if (s<86400) return Math.floor(s/3600)+' કલાક પહેલાં'; return Math.floor(s/86400)+' દિવસ પહેલાં'; }
var WHY = {'printer-connect':'પ્રિન્ટર સાથે જોડાણ થયું નહીં (પ્રિન્ટર બંધ?)','bluetooth-send':'Bluetooth થી બિલ પહોંચ્યું નહીં','download':'બિલ ડાઉનલોડ થયું નહીં'};
var TXT = {
  ok:['ok','✅ બધું બરાબર ચાલે છે'],
  no_data:['warn','ESP32 તરફથી હજી કોઈ સંદેશ આવ્યો નથી'],
  esp_offline:['bad','❌ ESP32 બંધ છે (પાવર/હોટસ્પોટ ચકાસો)'],
  waiting:['bad','⚠️ ઓર્ડર રાહ જુએ છે – પ્રિન્ટર ચાલુ અને પાસે છે?'],
  print_failed:['warn','⚠️ છેલ્લી વાર પ્રિન્ટર સાથે જોડાણ થયું નહીં']
};
function render(d){
  var t = TXT[d.verdict.code] || TXT.ok;
  $('banner').className = 'banner ' + t[0]; $('banner').textContent = t[1];
  $('esp').innerHTML = d.esp.agoSec==null ? 'હજી કોઈ માહિતી નથી' : (d.esp.online ? '<span class="g">ચાલુ</span>' : '<span class="r">બંધ</span>') + ' · છેલ્લે '+ago(d.esp.agoSec)+' જોયું';
  var p = d.printer, h = '';
  if (p.checkPending) h += '<span class="y">ચેક ચાલુ છે… (૧૦–૩૦ સેકન્ડ રાહ જુઓ)</span><br>';
  if (p.checkOk===true) h += '<span class="g">જોડાયેલું</span> ('+ago(p.checkAgoSec)+' ચેક કર્યું)';
  else if (p.checkOk===false) h += '<span class="r">જોડાણ થયું નહીં</span> ('+ago(p.checkAgoSec)+' ચેક કર્યું)';
  else if (!p.checkPending) h += 'હજી ચેક કર્યું નથી';
  if (p.lastFail) h += '<br><span class="small">છેલ્લી ભૂલ: '+(WHY[p.lastFail.why]||p.lastFail.why)+' · '+ago(p.lastFail.agoSec)+'</span>';
  $('prn').innerHTML = h;
  $('wait').innerHTML = d.waiting.count===0 ? 'કોઈ નહીં' : '<span class="'+(d.verdict.code==='waiting'?'r':'y')+'">'+d.waiting.count+' ઓર્ડર</span> · સૌથી જૂનો '+ago(d.waiting.oldestAgeSec).replace(' પહેલાં','')+'થી';
  $('last').innerHTML = d.lastPrint ? ago(d.lastPrint.agoSec)+(d.lastPrint.ms!=null ? ' · '+Math.round(d.lastPrint.ms/1000)+' સેકન્ડ લાગ્યા':'') : 'હજી કોઈ નહીં';
}
function load(){
  fetch(API+'?action=status&key='+encodeURIComponent(KEY),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){ if (d.error) {$('banner').className='banner bad'; $('banner').textContent='❌ '+d.error; return;} render(d); }).catch(function(){ $('banner').className='banner bad'; $('banner').textContent='❌ સર્વર સાથે જોડાણ થતું નથી'; });
}
$('chk').onclick = function(){
  if (window.__MOCK_STATUS__) { $('chkmsg').textContent = '(આ ફક્ત નમૂનો છે)'; return; }
  $('chk').disabled = true; $('chkmsg').textContent = 'વિનંતી મોકલી… ESP32 આગલી વખતે પૂછે ત્યારે ચેક કરશે.';
  fetch(API+'?action=check&key='+encodeURIComponent(KEY),{cache:'no-store'}).then(load);
  setTimeout(function(){ $('chk').disabled = false; $('chkmsg').textContent=''; }, 30000);
};
if (window.__MOCK_STATUS__) render(window.__MOCK_STATUS__); else { load(); setInterval(load, 10000); }
</script></body></html>`;
