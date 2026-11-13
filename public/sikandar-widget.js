(function () {
  if (window.__sikandarLoaded) return;
  window.__sikandarLoaded = true;

  var lk = document.createElement('link');
  lk.rel = 'stylesheet';
  lk.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;700&family=Poppins:wght@600;800&display=swap';
  document.head.appendChild(lk);

  var host = document.createElement('div');
  host.id = 'sikandar-root';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
.fab,.ov{font-family:'Poppins','Noto Sans Gujarati',system-ui,sans-serif}
.fab{position:fixed;right:14px;bottom:96px;z-index:2147483000;display:flex;align-items:center;gap:8px;border:none;cursor:pointer;background:#d90429;color:#fff;border-radius:30px;padding:8px 14px 8px 8px;box-shadow:0 4px 14px rgba(217,4,41,.5);animation:glow 2s ease-in-out infinite}
.fab .c{animation:spin360 3s ease-in-out infinite;position:relative;width:34px;height:34px;border-radius:50%;background:#fff;color:#d90429;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.fab .c:before{content:"";position:absolute;inset:-5px;border-radius:50%;border:3px solid transparent;border-top-color:#1d4ed8;border-right-color:#ffcc00;animation:rot 1.2s linear infinite}
.fab .t{font-size:12px;font-weight:700;letter-spacing:.2px;text-align:left;line-height:1.2}
@keyframes spin360{0%{transform:rotate(0)}70%,100%{transform:rotate(360deg)}}
@keyframes glow{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.ov{--bg:#fff5f5;--ink:#2b0a0a;--mut:#7a4a4a;--red:#d90429;--red2:#9d0208;--card:#ffffff;--line:#f1c9c9;--bot:#ffffff;position:fixed;inset:0;z-index:2147483001;background:var(--bg);color:var(--ink);display:none;overflow:hidden;padding-top:env(safe-area-inset-top,0px)}
@media (prefers-color-scheme:dark){.ov{--bg:#140607;--ink:#ffecec;--mut:#d9a3a3;--card:#241012;--line:#4a2226;--bot:#241012}}
.ov.open{display:block}
.siren{position:absolute;top:0;left:0;right:0;height:10px;display:flex;z-index:3}
.siren i{flex:1;animation:fl 1s steps(1) infinite}
.siren i:nth-child(odd){background:#d90429}.siren i:nth-child(even){background:#1d4ed8;animation-delay:.5s}
@keyframes fl{0%{opacity:1}50%{opacity:.25}}
.page{position:absolute;inset:0;display:flex;flex-direction:column;transition:transform .5s ease,opacity .5s ease}
.home{align-items:center;justify-content:center;text-align:center;padding:24px}
.chat{transform:translateX(100%);opacity:0;padding-top:env(safe-area-inset-top,0px)}
.go .home{transform:translateX(-100%);opacity:0;pointer-events:none}
.go .chat{transform:none;opacity:1}
.x{position:absolute;top:20px;right:14px;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:20px;cursor:pointer;z-index:4}
.go .x{display:none}
h1{font-size:clamp(22px,7vw,32px);font-weight:800;letter-spacing:.5px}
h1 b{color:var(--red)}
.sub{margin-top:6px;color:var(--mut);font-family:'Noto Sans Gujarati','Poppins',sans-serif;font-size:15px}
.wrap{position:relative;width:240px;height:240px;margin:36px 0 28px;display:flex;align-items:center;justify-content:center}
.ring{position:absolute;inset:0;border-radius:50%;border:3px solid var(--red);opacity:0;animation:pulse 2.4s ease-out infinite}
.ring:nth-child(2){animation-delay:.8s}.ring:nth-child(3){animation-delay:1.6s}
@keyframes pulse{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.25);opacity:0}}
.spin{position:absolute;inset:-2px;border-radius:50%;background:conic-gradient(from 0deg,#d90429,#1d4ed8,#ffcc00,#d90429);animation:rot 3s linear infinite;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 9px),#000 calc(100% - 9px));mask:radial-gradient(farthest-side,transparent calc(100% - 9px),#000 calc(100% - 9px))}
.run .spin{animation-duration:.6s}
@keyframes rot{to{transform:rotate(360deg)}}
.sos{position:relative;width:190px;height:190px;border-radius:50%;border:8px solid #fff;background:radial-gradient(circle at 35% 30%,#ff4d6d,var(--red) 55%,var(--red2));color:#fff;font-family:'Poppins',sans-serif;font-weight:800;cursor:pointer;box-shadow:0 8px 0 #7a0110,0 14px 30px rgba(217,4,41,.45);transition:transform .1s}
.sos:active{transform:translateY(6px);box-shadow:0 2px 0 #7a0110}
.sos .n{display:block;font-size:56px;line-height:1}
.sos .t{display:block;font-size:12px;letter-spacing:2px;margin-top:4px}
.run .sos{animation:shake .12s linear infinite}
@keyframes shake{0%{transform:translateX(-3px)}50%{transform:translateX(3px)}100%{transform:translateX(-3px)}}
.hint{font-size:15px;font-weight:700;font-family:'Noto Sans Gujarati','Poppins',sans-serif}
.hint small{display:block;font-weight:400;color:var(--mut);margin-top:4px;font-size:13px;font-family:'Poppins',sans-serif}
.st{height:22px;margin-top:14px;font-weight:700;color:var(--red);font-size:14px;font-family:'Noto Sans Gujarati','Poppins',sans-serif}
.tag{position:absolute;bottom:14px;left:0;right:0;text-align:center;font-size:12px;color:var(--mut)}
.hd{display:flex;align-items:center;gap:10px;padding:18px 14px 12px;border-bottom:1px solid var(--line);background:var(--card)}
.hd .av{width:38px;height:38px;border-radius:50%;background:var(--red);color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.hd .nm{font-weight:800;font-size:15px}.hd .sb{font-size:12px;color:var(--mut)}
.hd .bt{margin-left:auto;display:flex;gap:6px}
.hd button{background:none;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:6px 10px;font-size:13px;cursor:pointer}
.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;font-family:'Noto Sans Gujarati','Poppins',sans-serif}
.m{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word}
.m.b{align-self:flex-start;background:var(--bot);border:1px solid var(--line)}
.m.u{align-self:flex-end;background:var(--red);color:#fff}
.chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 8px}
.chips span{border:1px solid var(--red);color:var(--red);border-radius:18px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:'Noto Sans Gujarati','Poppins',sans-serif}
.in{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:var(--card)}
.in input{flex:1;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:22px;padding:11px 15px;font-size:15px;font-family:'Noto Sans Gujarati','Poppins',sans-serif;outline:none}
.in button{width:44px;height:44px;border-radius:50%;border:none;background:var(--red);color:#fff;font-size:18px;cursor:pointer}
</style>
<button class="fab" id="fab" aria-label="Open SIKANDAR'S1710108.ai"><span class="c">1710</span><span class="t">SIKANDAR'S<br>1710108.ai</span></button>
<div class="ov" id="ov">
 <div class="siren"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
 <button class="x" id="x" aria-label="Close">&times;</button>
 <section class="page home">
  <h1>SIKANDAR'S<b>1710108</b>.ai</h1>
  <div class="sub">\u0aa4\u0aae\u0abe\u0ab0\u0ac0 \u0aa6\u0ac1\u0a95\u0abe\u0aa8\u0aa8\u0acb 24x7 AI \u0aae\u0aa6\u0aa6\u0a97\u0abe\u0ab0</div>
  <div class="wrap"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="spin"></div>
   <button class="sos" id="sos" aria-label="Press 1710"><span class="n">1710</span><span class="t">PRESS</span></button></div>
  <div class="hint">\u0aae\u0aa6\u0aa6 \u0aae\u0abe\u0a9f\u0ac7 1710 \u0aa6\u0aac\u0abe\u0ab5\u0acb<small>Press 1710 for instant help</small></div>
  <div class="st" id="st"></div>
  <div class="tag">Powered by apnidukanSE.in</div>
 </section>
 <section class="page chat">
  <div class="hd"><div class="av">1710</div><div><div class="nm">SIKANDAR'S1710108.ai</div><div class="sb">Apni Dukan seller assistant</div></div><div class="bt"><button id="back">Home</button><button id="x2" aria-label="Close">&times;</button></div></div>
  <div class="msgs" id="msgs"></div>
  <div class="chips" id="chips"><span>Product description</span><span>Price list</span><span>Offer message</span></div>
  <div class="in"><input id="inp" type="text" placeholder="Sandesh lakho..." autocomplete="off"><button id="send" aria-label="Send">&#10148;</button></div>
 </section>
</div>`;

  var $ = function (id) { return root.getElementById(id); };
  var ov = $('ov'), msgs = $('msgs'), inp = $('inp'), st = $('st'), started = false;

  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.type = 'square'; g.gain.value = 0.05;
      var t = c.currentTime;
      for (var i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.25);
      o.start(t); o.stop(t + 1.5);
    } catch (e) {}
  }
  function add(t, w) {
    var d = document.createElement('div'); d.className = 'm ' + w; d.textContent = t;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  function demo(q) {
    var s = q.toLowerCase();
    if (/descr|\u0ab5\u0ab0\u0acd\u0aa3\u0aa8|vivaran/.test(s)) return '\u0a9a\u0acb\u0a95\u0acd\u0a95\u0ab8! \u0a89\u0aa6\u0abe\u0ab9\u0ab0\u0aa3:\n"\u0aab\u0acd\u0ab0\u0ac7\u0ab6 \u0a9a\u0a82\u0aa6\u0aa8 \u0ab8\u0abe\u0aac\u0ac1: \u0aa4\u0acd\u0ab5\u0a9a\u0abe\u0aa8\u0ac7 \u0aa8\u0ab0\u0aae \u0a85\u0aa8\u0ac7 \u0ab8\u0ac1\u0a97\u0a82\u0aa7\u0abf\u0aa4 \u0ab0\u0abe\u0a96\u0ac7 \u0a9b\u0ac7. \u0ab0\u0acb\u0a9c\u0abf\u0a82\u0aa6\u0abe \u0a89\u0aaa\u0aaf\u0acb\u0a97 \u0aae\u0abe\u0a9f\u0ac7 \u0ab8\u0ab0\u0ab8."\n\nProduct \u0aa8\u0ac1\u0a82 \u0aa8\u0abe\u0aae \u0a95\u0ab9\u0acb, \u0ab9\u0ac1\u0a82 Gujarati, Hindi ane English ma \u0aac\u0aa8\u0abe\u0ab5\u0ac0 \u0a86\u0aaa\u0ac0\u0ab6.';
    if (/price|\u0aad\u0abe\u0ab5|bhav|kimat/.test(s)) return 'Price list \u0aae\u0abe\u0a9f\u0ac7 product \u0aa8\u0ac1\u0a82 \u0aa8\u0abe\u0aae ane \u0aad\u0abe\u0ab5 \u0aae\u0acb\u0a95\u0ab2\u0acb. \u0ab9\u0ac1\u0a82 \u0ab8\u0ab0\u0ab8 \u0ab2\u0abf\u0ab8\u0acd\u0a9f \u0aac\u0aa8\u0abe\u0ab5\u0ac0 \u0a86\u0aaa\u0ac0\u0ab6.';
    if (/offer|\u0a93\u0aab\u0ab0/.test(s)) return '\u0a93\u0aab\u0ab0 \u0aae\u0ac7\u0ab8\u0ac7\u0a9c:\n"\u0a86\u0a9c\u0ac7 \u0a9c \u0a93\u0ab0\u0acd\u0aa1\u0ab0 \u0a95\u0ab0\u0acb \u0a85\u0aa8\u0ac7 \u20b950 \u0ab8\u0ac1\u0aa7\u0ac0\u0aa8\u0ac0 \u0a9b\u0ac2\u0a9f \u0aae\u0ac7\u0ab3\u0ab5\u0acb! apnidukanSE.in"\n\n\u0a95\u0aaf\u0acb product ane \u0a95\u0ac7\u0a9f\u0ab2\u0ac0 \u0a9b\u0ac2\u0a9f?';
    return '\u0ab8\u0aae\u0a9c\u0abe\u0aaf\u0ac1\u0a82. \u0aa5\u0acb\u0aa1\u0ac1\u0a82 \u0ab5\u0abf\u0a97\u0aa4\u0ab5\u0abe\u0ab0 \u0a95\u0ab9\u0acb: \u0a95\u0aaf\u0abe product \u0ab5\u0abf\u0ab6\u0ac7 \u0a85\u0aa8\u0ac7 \u0ab6\u0ac1\u0a82 \u0a9c\u0acb\u0a88\u0a8f? (description, price list, offer)';
  }
  function ask(t) {
    t = t.trim(); if (!t) return;
    add(t, 'u'); inp.value = '';
    var wait = add('...', 'b');
    fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: t }) })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { wait.textContent = d.reply || demo(t); })
      .catch(function () { wait.textContent = demo(t); });
  }
  function closeAll() { ov.classList.remove('open', 'go', 'run'); st.textContent = ''; started = false; }

  $('fab').onclick = function () { ov.classList.add('open'); };
  $('x').onclick = closeAll;
  $('x2').onclick = closeAll;
  $('back').onclick = function () { ov.classList.remove('go', 'run'); st.textContent = ''; started = false; };
  $('sos').onclick = function () {
    if (started) return; started = true;
    ov.classList.add('run'); beep(); st.textContent = '1710 \u0aa6\u0acb\u0aa1\u0ac0 \u0ab0\u0ab9\u0ac0 \u0a9b\u0ac7...';
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
    setTimeout(function () {
      ov.classList.remove('run'); ov.classList.add('go');
      if (!msgs.children.length) add('\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7! \u0ab9\u0ac1\u0a82 SIKANDAR\'S1710108.ai. \u0aa4\u0aae\u0abe\u0ab0\u0ac0 \u0aa6\u0ac1\u0a95\u0abe\u0aa8 \u0aae\u0abe\u0a9f\u0ac7 \u0ab6\u0ac1\u0a82 \u0aae\u0aa6\u0aa6 \u0a95\u0ab0\u0ac1\u0a82?', 'b');
    }, 1800);
  };
  $('send').onclick = function () { ask(inp.value); };
  inp.onkeydown = function (e) { if (e.key === 'Enter') ask(inp.value); };
  $('chips').onclick = function (e) { if (e.target.tagName === 'SPAN') ask(e.target.textContent); };
})();
