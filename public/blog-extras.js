/* Apni Dukan - blog extras: WhatsApp share + reviews (works on every blog page) */
(function () {
  var P = "apni-dukan-b8e19", K = "AIzaSyC9oJrhtVRE91_fF8FHEWXbcBJnY-916Zc";
  var B = "https://firestore.googleapis.com/v1/projects/" + P + "/databases/(default)/documents";
  var H = { "Content-Type": "application/json" };
  var WA = "919898154548";

  var css = document.createElement("style");
  css.textContent =
    ".bx-share{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}" +
    ".bx-share a{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:9px 18px;font:inherit;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#1fa855}" +
    ".bx-rv{border:1px solid rgba(127,127,127,.35);border-left:6px solid #d8541f;border-radius:14px;padding:12px 14px;margin:28px 0;background:rgba(127,127,127,.07)}" +
    ".bx-st{display:flex;flex-wrap:wrap;gap:2px;margin:8px 0 2px}" +
    ".bx-st button{border:0;background:none;font-size:26px;line-height:1;padding:4px 2px;color:rgba(127,127,127,.55);cursor:pointer}" +
    ".bx-st button.on{color:#e8a410}" +
    ".bx-rt{font-size:14px;opacity:.75;min-height:22px}" +
    ".bx-rv input,.bx-rv textarea{width:100%;box-sizing:border-box;margin-top:8px;padding:8px;border:1px solid rgba(127,127,127,.45);border-radius:8px;font:inherit;background:transparent;color:inherit}" +
    ".bx-sb{margin-top:8px;background:#d8541f;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}" +
    ".bx-ms{font-size:14px;margin:8px 0 0}" +
    ".bx-rl:empty{display:none}.bx-rl{margin:24px 0}.bx-rl h3{font-size:17px;margin:0 0 8px}" +
    ".bx-ri{border:1px solid rgba(127,127,127,.35);border-radius:14px;padding:10px 14px;margin:8px 0;font-size:15px;line-height:1.7;background:rgba(127,127,127,.07)}.bx-ri b{display:block}";
  document.head.appendChild(css);

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function fv(d, n) { return d.fields && d.fields[n] ? d.fields[n] : {}; }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function shareBar(a) {
    var h1 = a.querySelector("h1");
    var title = h1 ? h1.textContent.trim() : document.title;
    var url = location.origin + location.pathname + (a.classList.contains("post") ? "#" + a.id : "");
    var msg = title + "\n\nઆ બ્લોગ વાંચો: " + url;
    var bar = el("div", "bx-share");
    var wa = el("a", "", "WhatsApp પર શેર કરો");
    wa.href = "https://wa.me/?text=" + encodeURIComponent(msg);
    wa.target = "_blank"; wa.rel = "noopener";
    bar.appendChild(wa);
    return bar;
  }

  function loadReviews(a, list) {
    var q = { structuredQuery: { from: [{ collectionId: "reviews" }], where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "postId" }, op: "EQUAL", value: { stringValue: a.id } } },
      { fieldFilter: { field: { fieldPath: "approved" }, op: "EQUAL", value: { booleanValue: true } } }
    ] } }, limit: 50 } };
    fetch(B + ":runQuery?key=" + K, { method: "POST", headers: H, body: JSON.stringify(q) })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        var it = rows.filter(function (x) { return x.document; }).map(function (x) {
          var d = x.document;
          return { r: parseInt(fv(d, "rating").integerValue || 0, 10), c: fv(d, "comment").stringValue || "", n: fv(d, "name").stringValue || "", t: fv(d, "createdAt").timestampValue || "" };
        });
        if (!it.length) return;
        it.sort(function (x, y) { return x.t < y.t ? 1 : -1; });
        var sum = it.reduce(function (s, i) { return s + i.r; }, 0);
        list.appendChild(el("h3", "", "વાચકોના રિવ્યૂ: ★ " + (sum / it.length).toFixed(1) + "/10 (" + it.length + ")"));
        it.forEach(function (i) {
          var d = el("div", "bx-ri");
          d.appendChild(el("b", "", (i.n || "વાચક") + " · " + i.r + "/10"));
          if (i.c) d.appendChild(el("span", "", i.c));
          list.appendChild(d);
        });
      }).catch(function () {});
  }

  function send(a, sel, name, c) {
    return fetch(B + "/reviews?key=" + K, { method: "POST", headers: H, body: JSON.stringify({ fields: {
      postId: { stringValue: a.id }, rating: { integerValue: String(sel) }, name: { stringValue: name },
      comment: { stringValue: c }, approved: { booleanValue: false }, createdAt: { timestampValue: new Date().toISOString() }
    } }) }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function reviewBox(a) {
    var key = "rv_" + a.id, sel = 0, busy = false;
    var list = el("div", "bx-rl"), box = el("div", "bx-rv");
    var st = el("div", "bx-st"), rt = el("div", "bx-rt");
    var nm = el("input"); nm.type = "text"; nm.maxLength = 40; nm.placeholder = "તમારું નામ (વૈકલ્પિક)";
    var ta = el("textarea"); ta.rows = 3; ta.maxLength = 500; ta.placeholder = "તમારો અભિપ્રાય લખો (વૈકલ્પિક)";
    var sb = el("button", "bx-sb", "રિવ્યૂ મોકલો"); sb.type = "button";
    var ms = el("p", "bx-ms");
    var bs = [];
    function paint() {
      bs.forEach(function (b, i) { b.className = i < sel ? "on" : ""; });
      rt.textContent = sel ? ("તમારું રેટિંગ: " + sel + "/10") : "તારા પર ટેપ કરો";
    }
    for (var i = 1; i <= 10; i++) {
      (function (n) {
        var b = el("button", "", "★"); b.type = "button"; b.setAttribute("aria-label", n + " star");
        b.onclick = function () { sel = n; paint(); };
        bs.push(b); st.appendChild(b);
      })(i);
    }
    sb.onclick = function () {
      if (busy) return;
      if (!sel) { ms.style.color = "#c0392b"; ms.textContent = "પહેલા રેટિંગ પસંદ કરો."; return; }
      var name = nm.value.trim().slice(0, 40), c = ta.value.trim().slice(0, 500);
      busy = true; sb.disabled = true; ms.style.color = ""; ms.textContent = "મોકલી રહ્યા છીએ...";
      send(a, sel, name, c).then(function () {
        ms.style.color = "#3b7d3a"; ms.textContent = "આભાર! તમારો રિવ્યૂ મળી ગયો. મંજૂરી પછી અહીં દેખાશે.";
        save(key, { r: sel });
      }).catch(function () {
        var h1 = a.querySelector("h1");
        var m = "Apni Dukan બ્લોગ રિવ્યૂ\nબ્લોગ: " + (h1 ? h1.textContent : a.id) + "\nરેટિંગ: " + sel + "/10" + (name ? "\nનામ: " + name : "") + (c ? "\nઅભિપ્રાય: " + c : "");
        var u = "https://wa.me/" + WA + "?text=" + encodeURIComponent(m);
        ms.style.color = "#3b7d3a"; ms.textContent = "WhatsApp ખૂલશે, ત્યાં Send દબાવો.";
        if (!window.open(u, "_blank")) window.location.href = u;
        busy = false; sb.disabled = false;
      });
    };
    [el("b", "", "આ બ્લોગને રેટિંગ આપો (10 માંથી)"), st, rt, nm, ta, sb, ms].forEach(function (e) { box.appendChild(e); });
    paint();
    return { list: list, box: box };
  }

  function run() {
    document.querySelectorAll("article[id]").forEach(function (a) {
      if (a.dataset.bx) return; a.dataset.bx = "1";
      var anchor = a.querySelector(".meta,.m") || a.querySelector("h1");
      if (anchor) anchor.insertAdjacentElement("afterend", shareBar(a));
      // blog.html already has its own review box inside articles; only add reviews where missing
      if (a.querySelector(".rv")) return;
      var rb = reviewBox(a), au = a.querySelector(".author");
      var bottom = shareBar(a);
      var parts = [rb.list, rb.box, bottom];
      parts.forEach(function (p) { if (au) a.insertBefore(p, au); else a.appendChild(p); });
      loadReviews(a, rb.list);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
