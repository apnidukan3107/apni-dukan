import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Search, ShoppingCart, Plus, Minus, X, ArrowLeft, Check,
  Settings, Package, ClipboardList, Trash2, Lock, Loader2,
  Pencil, ImagePlus, Tag, MessageSquare, Download, Bell, Store
} from "lucide-react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, getDocs, writeBatch, increment, runTransaction, query, where, documentId, updateDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported as isMessagingSupported } from "firebase/messaging";
import { getAnalytics, logEvent } from "firebase/analytics";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
// ✅ VERCEL ANALYTICS - Real-time traffic monitoring
import { Analytics } from "@vercel/analytics/react";
// ✅ PREMIUM LOGIN + WALLET
import { useWallet, PremiumLoginButton, WalletPayBox, AdminCustomers, usePremiumAutofill, PREMIUM_TABS } from "./PremiumWallet";
import * as I from "./images";
import SiteSystem from "./SiteSystem";
import HisabSystem from "./HisabSystem";
import { SalesGate, SalesDashboard, SalesSessionBar, TraderBar, TraderForm, BLOG_ROLE, StatusPill } from "./SalesDashboards";
import { MarketList, MarketDetail, MARKETS, marketOfSeller, guessMarket } from "./MarketDirectory";

const firebaseConfig = {
  apiKey: "AIzaSyC9oJrhtVRE91_fF8FHEWXbcBJnY-916Zc",
  authDomain: "apni-dukan-b8e19.firebaseapp.com",
  projectId: "apni-dukan-b8e19",
  storageBucket: "apni-dukan-b8e19.firebasestorage.app",
  messagingSenderId: "723874285858",
  appId: "1:723874285858:web:42e670642150b873187d7b",
  measurementId: "G-FV6DETYSTG"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const analytics = getAnalytics(firebaseApp);

// ---- Push notifications (Firebase Cloud Messaging) ----
// Public VAPID key from Firebase Console → Project settings → Cloud
// Messaging → Web Push certificates. This is a public key (safe to embed
// in client code, unlike the service account key used server-side).
const FCM_VAPID_KEY =
  "BPqUFgVpB-Sl-hHVCMe6mcavw_aQHXqpSB72-rcMFrxYqkQZNnpzb5qIGypPSj_RwUwqdAtx90K_MYZxsKMsTQU";

async function registerAdminForPushNotifications() {
  try {
    const supported = await isMessagingSupported();
    if (!supported) return { ok: false, reason: "unsupported" };
    if (typeof Notification === "undefined") return { ok: false, reason: "unsupported" };

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: "no-token" };

    // Save this device's token so the /api/send-order-notification route
    // knows where to deliver the push. Stored under the "store" collection
    // (same pattern as everything else) so no new Firestore rules needed.
    await setDoc(doc(db, "store", "adminFcmToken"), { value: token });
    return { ok: true };
  } catch (e) {
    console.error("registerAdminForPushNotifications error", e);
    return { ok: false, reason: "error", error: e };
  }
}

// Firestore-backed storage — every key (products / orders / customCategories)
// is stored as one document inside the "store" collection, matching the
// Firestore security rules from the README (match /store/{docId}).
async function storageGet(key) {
  const snap = await getDoc(doc(db, "store", key));
  return snap.exists() ? { value: snap.data().value } : null;
}
async function storageSet(key, value) {
  await setDoc(doc(db, "store", key), { value });
  return true;
}

// ---- Products: each product is now its own Firestore document -------------
// Old design stored ALL products as one giant JSON string inside a single
// "store/products" document, which hits Firestore's 1MB-per-document limit
// once enough products (especially with photo data) are added — new
// products would silently fail to save past that point. Each product now
// lives in its own doc, prefixed "product__<id>", INSIDE the existing
// "store" collection (not a new top-level collection) — this is important
// because the Firestore security rules only grant access to documents
// matching /store/{docId}, so a brand-new collection would be silently
// denied. Using the same "store" collection means no rules changes needed.
// Share of the sale price that is paid to the seller (100 = full price of his items). Used for the seller's hisab.
const SELLER_PAYOUT_PCT = 100;
const PRODUCT_KEY_PREFIX = "product__";
function productKey(id) {
  return PRODUCT_KEY_PREFIX + id;
}

// ---- STOCK: only products that have a numeric "stock" are tracked; all others stay unlimited ----
function stockOf(p) {
  return p && typeof p.stock === "number" && !isNaN(p.stock) ? p.stock : null;
}
function isOutOfStock(p) {
  if (!p) return false;
  const s = stockOf(p);
  return !!p.soldOut || (s !== null && s <= 0);
}
// Reduces stock (atomically, never below 0) for every ordered product that has a stock number.
async function stockReduce(items) {
  const byId = {};
  (items || []).forEach((i) => {
    const bid = String(i.id).split("__SIZE__")[0];
    byId[bid] = (byId[bid] || 0) + (Number(i.qty) || 0);
  });
  for (const [bid, qty] of Object.entries(byId)) {
    if (qty <= 0) continue;
    try {
      const ref = doc(db, "store", productKey(bid));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const cur = snap.data().stock;
        if (typeof cur !== "number") return;
        tx.update(ref, { stock: Math.max(0, cur - qty) });
      });
    } catch (e) {
      console.error("stockReduce failed", bid, e);
    }
  }
}
function StockLine({ p }) {
  const s = stockOf(p);
  if (s === null) return null;
  if (s <= 0 || p.soldOut) return <div style={{ fontSize: 11, fontWeight: 800, color: "#b23b3b", marginBottom: 4 }}>Out of stock</div>;
  if (s <= 5) return <div style={{ fontSize: 11, fontWeight: 700, color: "#c47a00", marginBottom: 4 }}>ફક્ત {s} બાકી</div>;
  return <div style={{ fontSize: 11, color: "#2e7d4f", marginBottom: 4 }}>સ્ટોક: {s}</div>;
}

function productsListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(PRODUCT_KEY_PREFIX))
        .map((d) => {
          const { type, ...fields } = d.data();
          return { id: d.id.slice(PRODUCT_KEY_PREFIX.length), ...fields };
        });
      onChange(list);
    },
    (err) => console.error("productsListen error", err)
  );
}
async function productSave(product) {
  const { id, ...rest } = product;
  await setDoc(doc(db, "store", productKey(id)), { ...rest, type: "product" });
}
async function productDelete(id) {
  await deleteDoc(doc(db, "store", productKey(id)));
}
async function productsBulkSave(productList) {
  // Firestore batches have both a 500-write limit AND a 10MB total-size
  // limit. Product images (base64) can be tens of KB each, so a chunk of
  // 400 products can easily exceed 10MB and fail. Keep chunks small
  // (40) to stay safely under that limit regardless of image size.
  for (let i = 0; i < productList.length; i += 40) {
    const chunk = productList.slice(i, i + 40);
    const batch = writeBatch(db);
    chunk.forEach((p) => {
      const { id, ...rest } = p;
      batch.set(doc(db, "store", productKey(id)), { ...rest, type: "product" });
    });
    await batch.commit();
  }
}

// ---- Enquiries: same per-document pattern as products, so each enquiry
// (which can include a photo) never risks hitting Firestore's 1MB single
// -document limit, and stays inside the "store" collection the security
// rules already allow. ----
const ENQUIRY_KEY_PREFIX = "enquiry__";
function enquiryKey(id) {
  return ENQUIRY_KEY_PREFIX + id;
}
function enquiriesListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(ENQUIRY_KEY_PREFIX))
        .map((d) => {
          const { type, ...fields } = d.data();
          return { id: d.id.slice(ENQUIRY_KEY_PREFIX.length), ...fields };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(list);
    },
    (err) => console.error("enquiriesListen error", err)
  );
}
async function enquirySave(enquiry) {
  const { id, ...rest } = enquiry;
  await setDoc(doc(db, "store", enquiryKey(id)), { ...rest, type: "enquiry" });
}
async function enquiryDelete(id) {
  await deleteDoc(doc(db, "store", enquiryKey(id)));
}

// ---- Blog-writer job applications (Careers): same per-document pattern,
// stored inside the existing "store" collection => no rules change needed. ----
const APPLICATION_KEY_PREFIX = "application__";
function applicationKey(id) {
  return APPLICATION_KEY_PREFIX + id;
}
function applicationsListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(APPLICATION_KEY_PREFIX))
        .map((d) => {
          const { type, ...fields } = d.data();
          return { id: d.id.slice(APPLICATION_KEY_PREFIX.length), ...fields };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(list);
    },
    (err) => console.error("applicationsListen error", err)
  );
}
async function applicationSave(app) {
  const { id, ...rest } = app;
  await setDoc(doc(db, "store", applicationKey(id)), { ...rest, type: "application" });
}
async function applicationDelete(id) {
  await deleteDoc(doc(db, "store", applicationKey(id)));
}
// ---- Sales team visit entries (Sales Executive dashboard). Same per-document
// pattern inside the existing "store" collection => no Firestore rules change needed. ----
const VISIT_KEY_PREFIX = "visit__";
function visitsListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(VISIT_KEY_PREFIX))
        .map((d) => {
          const { type, ...fields } = d.data();
          return { id: d.id.slice(VISIT_KEY_PREFIX.length), ...fields };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(list);
    },
    (err) => console.error("visitsListen error", err)
  );
}
// ---- Trader / Retailer accounts: one doc per mobile number ("trader__<mobile>") inside the existing "store" collection. ----
const TRADER_KEY_PREFIX = "trader__";
async function hashPw(mobile, pw) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("apnidukan:" + mobile + ":" + pw));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "plain:" + pw;
  }
}
async function traderGet(mobile) {
  const snap = await getDoc(doc(db, "store", TRADER_KEY_PREFIX + mobile));
  return snap.exists() ? snap.data() : null;
}
async function traderSave(t) {
  const { mobile, ...rest } = t;
  await setDoc(doc(db, "store", TRADER_KEY_PREFIX + mobile), { ...rest, type: "trader" });
}
async function traderDelete(mobile) {
  await deleteDoc(doc(db, "store", TRADER_KEY_PREFIX + mobile));
}
function tradersListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(TRADER_KEY_PREFIX))
        .map((d) => {
          const { type, passHash, ...fields } = d.data();
          return { mobile: d.id.slice(TRADER_KEY_PREFIX.length), ...fields };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(list);
    },
    (err) => console.error("tradersListen error", err)
  );
}
// ---- Blog posts written by Blog Writers: "blogpost__<id>" docs in the "store" collection.
// status: draft | review | published | fix  (admin approves in the admin panel) ----
const BLOG_POST_PREFIX = "blogpost__";
function blogPostsListen(onChange) {
  return onSnapshot(
    collection(db, "store"),
    (snap) => {
      const list = snap.docs
        .filter((d) => d.id.startsWith(BLOG_POST_PREFIX))
        .map((d) => {
          const { type, ...fields } = d.data();
          return { id: d.id.slice(BLOG_POST_PREFIX.length), ...fields };
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      onChange(list);
    },
    (err) => console.error("blogPostsListen error", err)
  );
}
async function blogPostSave(post) {
  const { id, ...rest } = post;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await setDoc(doc(db, "store", BLOG_POST_PREFIX + id), { ...clean, type: "blogpost" });
}
async function blogPostDelete(id) {
  await deleteDoc(doc(db, "store", BLOG_POST_PREFIX + id));
}
async function visitSave(v) {
  const { id, ...rest } = v;
  await setDoc(doc(db, "store", VISIT_KEY_PREFIX + id), { ...rest, type: "visit" });
}
// ---- Photo uploads from selected sellers (only Sandhya Traders for now) -> admin panel.
// Same per-document pattern inside the existing "store" collection => no Firestore rules change needed. ----
const SELLER_UPLOAD_PREFIX = "sellerupload__";
const HISAB_SYSTEM_MOBILE = "7778889429";   // only this seller login sees the "Hisab" ledger button; data lives in Firestore store/hisabData
const SITE_SYSTEM_MOBILE = "8128299664";   // only this seller login sees the "Site System" (hajri + upad) button; data lives in Firestore store/siteData
const PHOTO_UPLOAD_SELLERS = ["sel-sandhya"];   // only these seller logins see the "ફોટો અપલોડ કરો" button
const PO_PRINT_SELLERS = ["sel-sandhya"];       // only these seller logins see the "PO પ્રિન્ટ કરો" button
// The PO is typed in by the seller (no AI, no API key). Bill To, item names, rates and GST are remembered on this phone
// so the next PO is filled in with a few taps.
const PO_MEMORY_KEY = "apniDukanPoMemory";
function poMemoryLoad() {
  try {
    const m = JSON.parse(localStorage.getItem(PO_MEMORY_KEY) || "{}");
    return {
      parties: Array.isArray(m.parties) ? m.parties : [],
      items: m.items && typeof m.items === "object" ? m.items : {},
      lastBillTo: m.lastBillTo || "",
      lastPayment: m.lastPayment || "",
    };
  } catch {
    return { parties: [], items: {}, lastBillTo: "", lastPayment: "" };
  }
}
function poMemorySave(form) {
  const m = poMemoryLoad();
  const bt = String(form.billTo || "").trim();
  if (bt) m.parties = [bt, ...m.parties.filter((x) => x !== bt)].slice(0, 20);
  m.lastBillTo = bt;
  m.lastPayment = String(form.payment || "").trim();
  (form.items || []).forEach((x) => {
    const n = String(x.name || "").trim();
    if (n) { delete m.items[n]; m.items[n] = { rate: x.rate, gst: x.gst, unit: x.unit }; }
  });
  const keys = Object.keys(m.items);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete m.items[k]);
  try { localStorage.setItem(PO_MEMORY_KEY, JSON.stringify(m)); } catch {}
}
function blankPoForm(mem) {
  return {
    poNo: "", poDate: "", billTo: mem.lastBillTo || "", payment: mem.lastPayment || "", docTotal: null, notes: "",
    items: [{ name: "", qty: "1", unit: "PC", rate: "", gst: "" }],
  };
}
// ---- Reading a purchase order from a PDF or a screenshot, free (no AI, no API key) ----
// PDF: the text and its position are read with pdf.js.  Photo/screenshot: OCR with Tesseract.js.
// Both give "words with a position"; one parser turns them into the PO fields. Tuned for the Lubi PO layout.
// The seller always checks the result in the form before printing.
const PO_SCRIPT_CACHE = {};
function poLoadScript(url) {
  if (PO_SCRIPT_CACHE[url]) return PO_SCRIPT_CACHE[url];
  PO_SCRIPT_CACHE[url] = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => { delete PO_SCRIPT_CACHE[url]; reject(new Error("script load failed")); };
    document.head.appendChild(el);
  });
  return PO_SCRIPT_CACHE[url];
}
async function poWordsFromPdf(file) {
  await poLoadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);   // the PO details are on the first page (page 2 is the terms)
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const words = [];
  tc.items.forEach((it) => {
    if (!it.str || !it.str.trim()) return;
    const x = it.transform[4];
    const yb = vp.height - it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;
    const w = it.width || 0;
    const total = it.str.length;
    let idx = 0;
    it.str.split(/(\s+)/).forEach((part) => {
      if (part.trim()) words.push({ s: part, x0: x + (idx / total) * w, x1: x + ((idx + part.length) / total) * w, y0: yb - h, y1: yb });
      idx += part.length;
    });
  });
  return words;
}
async function poWordsFromImage(file, onStatus) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const scale = Math.max(1, Math.min(2.5, 1800 / img.width));   // small screenshots are enlarged: OCR reads them better
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  onStatus("OCR એન્જિન લોડ થાય છે (પહેલી વખત 10-30 સેકન્ડ)...");
  await poLoadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  onStatus("ફોટો વાંચી રહ્યું છે...");
  const res = await window.Tesseract.recognize(canvas, "eng");
  return (res.data.words || [])
    .filter((w) => w.text && w.text.trim())
    .map((w) => ({ s: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }));
}

function poGroupLines(words) {
  const ws = words
    .filter((w) => w.s && String(w.s).trim())
    .map((w) => ({ ...w, s: String(w.s).trim(), cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));
  if (!ws.length) return { lines: [], med: 10 };
  const hs = ws.map((w) => w.h).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  ws.sort((a, b) => a.cy - b.cy);
  const lines = [];
  ws.forEach((w) => {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.cy - last.cy) <= med * 0.6) {
      last.words.push(w);
      last.cy = last.words.reduce((a, x) => a + x.cy, 0) / last.words.length;
    } else {
      lines.push({ cy: w.cy, words: [w] });
    }
  });
  lines.forEach((l) => {
    l.words.sort((a, b) => a.x0 - b.x0);
    // "9.00" followed by "%" (OCR splits them) -> "9.00%"
    const merged = [];
    l.words.forEach((w) => {
      const prev = merged[merged.length - 1];
      if (w.s === "%" && prev && /^[\d.,]+$/.test(prev.s)) { prev.s += "%"; prev.x1 = w.x1; prev.cx = (prev.x0 + prev.x1) / 2; }
      else merged.push({ ...w });
    });
    l.words = merged;
    l.text = merged.map((w) => w.s).join(" ");
  });
  return { lines, med };
}
function poNum(s) {
  const n = Number(String(s || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
// "Four Thousand Seven Hundred Four Rupees Thirty Three Paise" -> 4704.33
function poWordsToNumber(txt) {
  const small = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const parse = (str) => {
    let total = 0;
    let cur = 0;
    const toks = str.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
    for (const w of toks) {
      if (w in small) cur += small[w];
      else if (w in tens) cur += tens[w];
      else if (w === "hundred") cur = (cur || 1) * 100;
      else if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; }
      else if (w === "lakh" || w === "lakhs" || w === "lac") { total += (cur || 1) * 100000; cur = 0; }
      else if (w === "crore") { total += (cur || 1) * 10000000; cur = 0; }
      else if (w === "and" || w === "only") { /* ignore */ }
      else return null;
    }
    return total + cur;
  };
  const parts = String(txt || "").split(/rupees?/i);
  if (parts.length < 2) return null;
  const rupees = parse(parts[0]);
  if (rupees == null) return null;
  const paiseTxt = parts[1].replace(/paise|paisa|only/gi, " ").trim();
  const paise = paiseTxt ? parse(paiseTxt) : 0;
  if (paise == null) return rupees;
  return Math.round((rupees + paise / 100) * 100) / 100;
}

function parsePoFromWords(words) {
  const warnings = [];
  const out = { poNo: "", poDate: "", billTo: "", payment: "", docTotal: null, items: [] };
  const { lines, med } = poGroupLines(words);
  if (!lines.length) return { po: out, warnings: ["લખાણ વંચાયું નથી."] };
  const allWords = lines.flatMap((l) => l.words);
  const flat = lines.map((l) => l.text).join("\n").replace(/\s+/g, " ");

  // PO number and date
  let m = flat.match(/po\s*no\.?\s*[:\-]?\s*(\d{6,})/i);
  if (m) out.poNo = m[1];
  m = flat.match(/po\s*date\s*[:\-]?\s*(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{2,4})/i);
  if (m) out.poDate = `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3].length === 2 ? "20" + m[3] : m[3]}`;

  // Bill To: first line of the block under the "Bill To" heading
  let billHead = null;
  let supHead = null;
  let shipHead = null;
  lines.forEach((l) => {
    l.words.forEach((w, i) => {
      const nx = l.words[i + 1];
      if (/^bill$/i.test(w.s) && nx && /^to$/i.test(nx.s) && !billHead) billHead = { cx: (w.x0 + nx.x1) / 2, cy: l.cy };
      if (/^ship$/i.test(w.s) && nx && /^to$/i.test(nx.s) && !shipHead) shipHead = { cx: (w.x0 + nx.x1) / 2, cy: l.cy };
      if (/^supplier$/i.test(w.s) && !supHead) supHead = { cx: w.cx, cy: l.cy };
    });
  });
  if (billHead) {
    const leftB = supHead ? (supHead.cx + billHead.cx) / 2 : billHead.cx - 170;
    const rightB = shipHead ? (shipHead.cx + billHead.cx) / 2 : billHead.cx + 170;
    const detLine = lines.find((l) => /purchase\s+order\s+details/i.test(l.text) && l.cy > billHead.cy);
    const stopY = detLine ? detLine.cy - med * 0.5 : billHead.cy + med * 14;
    const block = allWords.filter((w) => w.cy > billHead.cy + med * 0.8 && w.cy < stopY && w.cx >= leftB && w.cx <= rightB);
    const bl = poGroupLines(block).lines.map((l) => l.text).filter((t) => t && !/^[\d\s]+$/.test(t));
    if (bl.length) out.billTo = bl[0].trim();
  }
  if (!out.billTo) warnings.push("Bill To નામ વંચાયું નથી.");

  // items table
  const qtyHead = allWords.find((w) => /^qty$/i.test(w.s));
  if (!qtyHead) {
    warnings.push("વસ્તુઓનું ટેબલ વંચાયું નથી, વસ્તુઓ જાતે ભરો.");
  } else {
    const near = (w) => Math.abs(w.cy - qtyHead.cy) <= med * 2.2;
    const hsnHead = allWords.find((w) => /^hsn$/i.test(w.s) && near(w));
    const descRight = Math.min(hsnHead ? hsnHead.x0 - 3 : Infinity, qtyHead.x0 - 20);
    const gstHeads = ["cgst", "sgst", "igst"]
      .map((k) => { const w = allWords.find((x) => new RegExp("^" + k, "i").test(x.s) && near(x)); return w ? { k, cx: w.cx } : null; })
      .filter(Boolean);
    const totalLine = lines.find((l) => /^total\b/i.test(l.text) && l.cy > qtyHead.cy + med * 2);
    const codes = allWords
      .filter((w) => /^\d{9,10}$/.test(w.s) && w.cx < descRight && w.cy > qtyHead.cy)
      .sort((a, b) => a.cy - b.cy);
    codes.forEach((code, ci) => {
      const y0 = code.cy - med * 0.7;
      const nextY = ci + 1 < codes.length ? codes[ci + 1].cy - med * 0.7 : (totalLine ? totalLine.cy - med * 0.5 : code.cy + med * 9);
      const row = allWords.filter((w) => w.cy >= y0 && w.cy < nextY);

      // name = description lines (without the item code and the "96.000 ROL: 15.11.2026" delivery line)
      const descWords = row.filter((w) => w.cx < descRight && w.x0 > code.x0 - 4 && w !== code);
      const descLines = poGroupLines(descWords).lines
        .map((l) => l.text)
        .filter((t) => t && !/^\d+(?:\.\d+)?\s*[A-Za-z]{1,6}\s*:\s*\d/.test(t) && !/^\d{9,10}$/.test(t));
      const first = descLines[0] || "";
      const keep = [first, ...descLines.slice(1).filter((t) => !t.toLowerCase().startsWith(first.toLowerCase().slice(0, Math.max(4, first.length - 2))))];
      const name = keep.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();

      // qty, unit, rate: read from the same line as the item code, in order  [HSN] QTY UOM RATE DISC
      let qty = NaN;
      let unit = "PC";
      let rate = NaN;
      const outLines = poGroupLines(row.filter((w) => w.cx >= descRight)).lines;
      for (const ol of outLines) {
        const toks = ol.words.map((w) => w.s);
        const ui = toks.findIndex((t) => /^[A-Za-z]{1,6}\.?$/.test(t));
        if (ui > 0 && Number.isFinite(poNum(toks[ui - 1])) && /\d/.test(toks[ui - 1])) {
          qty = poNum(toks[ui - 1]);
          unit = toks[ui].replace(".", "").toUpperCase();
          rate = poNum(toks[ui + 1]);
          break;
        }
      }

      // GST % = CGST% + SGST%  (or IGST%)
      const pcts = row.filter((w) => /^[\d.]+%$/.test(w.s) && w.cx >= descRight).map((w) => ({ cx: w.cx, v: poNum(w.s) }));
      let cg = 0;
      let sg = 0;
      let ig = 0;
      if (pcts.length) {
        pcts.forEach((p, i) => {
          let key;
          if (gstHeads.length) key = gstHeads.reduce((best, g) => (Math.abs(g.cx - p.cx) < Math.abs(best.cx - p.cx) ? g : best)).k;
          else key = pcts.length === 1 ? "igst" : i === 0 ? "cgst" : "sgst";
          if (key === "cgst") cg += p.v; else if (key === "sgst") sg += p.v; else ig += p.v;
        });
      }
      const gstPct = ig > 0 ? ig : cg + sg;
      const gstFound = pcts.length > 0;
      if (!name || !(qty > 0) || !(rate >= 0)) warnings.push(`વસ્તુ ${ci + 1} સ્પષ્ટ વંચાઈ નથી, ચકાસો.`);
      out.items.push({
        name,
        qty: Number.isFinite(qty) ? String(qty) : "",
        unit,
        rate: Number.isFinite(rate) ? String(rate) : "",
        gst: String(gstPct),
        gstFound,
      });
    });
    if (!out.items.length) warnings.push("વસ્તુઓ વંચાઈ નથી, વસ્તુઓ જાતે ભરો.");
    if (out.items.some((x) => !x.gstFound)) warnings.push("GST ની કોલમ ખાલી કે કપાયેલી છે, એટલે GST 0% મૂક્યું છે. PO માં ચકાસો.");
  }

  // total printed on the PO ("Total Amount" number, else the "Amount in Words")
  m = flat.match(/total\s*amount\s*[:\-]?\s*(?:rs\.?|₹)?\s*([\d,]+\.\d{2})/i);
  if (m) out.docTotal = poNum(m[1]);
  if (out.docTotal == null) {
    const w = flat.match(/words\s*:\s*(.*?paise)/i);
    const wl = (() => {
      const head = allWords.find((x) => /^words/i.test(x.s));
      if (!head) return "";
      const sub = allWords.find((x) => /^sub-?total/i.test(x.s) && x.cy > head.cy - med * 2);
      const stopX = sub ? sub.x0 - 2 : Infinity;
      const part = allWords.filter((x) => x.cy >= head.cy - med * 0.7 && x.cy <= head.cy + med * 2.6 && x.cx < stopX);
      return poGroupLines(part).lines.map((l) => l.text).join(" ");
    })();
    const mm = (wl || (w ? w[0] : "")).match(/words\s*:\s*(.*)/i);
    const val = mm ? poWordsToNumber(mm[1]) : null;
    if (val != null) out.docTotal = val;
  }

  // payment terms
  const payLine = lines.find((l) => /payment\s*terms?/i.test(l.text));
  if (payLine) {
    const pm = payLine.text.match(/payment\s*terms?\s*[-:]*\s*(.+)/i);
    if (pm) out.payment = pm[1].trim().slice(0, 80);
  }
  if (!out.poNo) warnings.push("PO નંબર વંચાયો નથી.");
  if (!out.poDate) warnings.push("PO તારીખ વંચાઈ નથી.");
  return { po: out, warnings };
}

// Totals of a purchase order exactly as they are printed on the slip (rounded to paise).
function poCalc(form) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const rows = (form.items || [])
    .map((x) => {
      const qty = Number(x.qty) || 0;
      const rate = Number(x.rate) || 0;
      const gstPct = Number(x.gst) || 0;
      const amount = r2(qty * rate);
      const gst = r2((amount * gstPct) / 100);
      return { name: String(x.name || "").trim(), qty, unit: String(x.unit || "PC").trim(), rate, gstPct, amount, gst, total: r2(amount + gst) };
    })
    .filter((x) => x.name && x.qty > 0);
  const subTotal = r2(rows.reduce((a, x) => a + x.amount, 0));
  const gstTotal = r2(rows.reduce((a, x) => a + x.gst, 0));
  return { rows, subTotal, gstTotal, total: r2(subTotal + gstTotal) };
}
// Phone photos are 3-5 MB; a Firestore document must stay under 1 MB, so the photo is resized + compressed first.
function compressImageFile(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        let q = quality;
        let out = canvas.toDataURL("image/jpeg", q);
        while (out.length > 700000 && q > 0.35) {
          q -= 0.1;
          out = canvas.toDataURL("image/jpeg", q);
        }
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function sellerUploadSave(up) {
  const { id, ...rest } = up;
  await setDoc(doc(db, "store", SELLER_UPLOAD_PREFIX + id), { ...rest, type: "sellerupload" });
}
// Loaded only when the admin opens the section (reads just these documents, not the whole collection).
async function sellerUploadsLoad() {
  const snap = await getDocs(
    query(
      collection(db, "store"),
      where(documentId(), ">=", SELLER_UPLOAD_PREFIX),
      where(documentId(), "<", SELLER_UPLOAD_PREFIX + "\uf8ff")
    )
  );
  return snap.docs
    .map((d) => {
      const { type, ...fields } = d.data();
      return { id: d.id.slice(SELLER_UPLOAD_PREFIX.length), ...fields };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
async function sellerUploadMarkSeen(id) {
  await setDoc(doc(db, "store", SELLER_UPLOAD_PREFIX + id), { seen: true }, { merge: true });
}
async function sellerUploadDelete(id) {
  await deleteDoc(doc(db, "store", SELLER_UPLOAD_PREFIX + id));
}
// Permanent serial numbers (job applications "job", seller registrations "sel"): +1 in one
// atomic transaction so two people applying at the same moment never get the same number.
// "floor" = how many already exist, used only the very first time the counter is created.
async function nextSerial(kind, floor) {
  const ref = doc(db, "store", "serialCounters");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists() ? snap.data() : {};
    const cur = d[kind] != null ? Number(d[kind]) || 0 : Number(floor) || 0;
    tx.set(ref, { [kind]: cur + 1 }, { merge: true });
    return cur + 1;
  });
}
// Puts a slip in the printer queue (the ESP32 printer picks it up like an order).
// Only changes the "queue" part of store/printState, nothing else in that doc.
async function queuePrint(key, item) {
  await setDoc(doc(db, "store", "printState"), { queue: { [key]: item } }, { merge: true });
}
// One-time migration: if no per-document products exist yet inside "store",
// pull whatever exists in the legacy single-document blob (store/products)
// and split it out into individual "product__<id>" documents. Safe to call
// every load — it's a no-op once migration has happened. The legacy blob
// itself is left untouched (not deleted), so nothing is ever lost even if
// this fails.

// ---- One-time photo patch ----
// Attaches real product photos to existing products by matching on
// category + name keywords, so no manual admin work is needed. Runs once
// per product (skips any product that already has a real photo) and is
// safe to leave in permanently — already-photographed products are
// untouched on every subsequent run. If "keywords" is empty and
// "matchAll" is true, every product in that category gets the photo
// (used for a generic category photo like Handtools).
// ---- One-time MRP / discount patch: Pneumatic Fittings ----
// Sets an "mrp" (list price) on existing Pneumatic Fittings products by
// matching tube size + thread size + fitting type in the product name,
// and sets the selling "price" to 35% off that MRP. The product card UI
// already shows a strikethrough MRP + "X% OFF" badge whenever
// p.mrp > p.price (see the catalog rendering below) — this patch only
// supplies the data, no photo/image fields are touched, and no UI code
// is changed. Runs once per product (skipped once "mrp" is already set).
const PNEUMATIC_DISCOUNT_PERCENT = 0.35;
const PNEUMATIC_MRP_TABLE = {
  // key: `${type}_${tubeMm}_${threadCode}`  threadCode: 01=1/8" 02=1/4" 03=3/8" 04=1/2"
  "connector_4_01": 19, "connector_4_02": 31, "connector_4_03": 52, "connector_4_04": 80,
  "connector_6_01": 21, "connector_6_02": 27, "connector_6_03": 45, "connector_6_04": 85,
  "connector_8_01": 24, "connector_8_02": 24, "connector_8_03": 42, "connector_8_04": 68,
  "connector_10_01": 38, "connector_10_02": 38, "connector_10_03": 41, "connector_10_04": 64,
  "connector_12_01": 50, "connector_12_02": 51, "connector_12_03": 51, "connector_12_04": 62,
  "connector_14_02": 135, "connector_14_03": 135, "connector_14_04": 135,
  "connector_16_02": 130, "connector_16_03": 130, "connector_16_04": 135,

  "elbow_4_01": 36, "elbow_4_02": 45, "elbow_4_03": 74, "elbow_4_04": 96,
  "elbow_6_01": 38, "elbow_6_02": 42, "elbow_6_03": 62, "elbow_6_04": 94,
  "elbow_8_01": 42, "elbow_8_02": 43, "elbow_8_03": 58, "elbow_8_04": 90,
  "elbow_10_01": 70, "elbow_10_02": 70, "elbow_10_03": 70, "elbow_10_04": 94,
  "elbow_12_01": 80, "elbow_12_02": 80, "elbow_12_03": 82, "elbow_12_04": 90,
  "elbow_14_02": 170, "elbow_14_03": 170, "elbow_14_04": 170,
  "elbow_16_02": 170, "elbow_16_03": 170, "elbow_16_04": 160,

  "teabranch_4_01": 54, "teabranch_4_02": 56, "teabranch_4_03": 72, "teabranch_4_04": 100,
  "teabranch_6_01": 52, "teabranch_6_02": 57, "teabranch_6_03": 72, "teabranch_6_04": 108,
  "teabranch_8_01": 58, "teabranch_8_02": 58, "teabranch_8_03": 75, "teabranch_8_04": 110,
  "teabranch_10_01": 94, "teabranch_10_02": 94, "teabranch_10_03": 92, "teabranch_10_04": 120,
  "teabranch_12_01": 100, "teabranch_12_02": 100, "teabranch_12_03": 104, "teabranch_12_04": 124,
  "teabranch_14_02": 200, "teabranch_14_03": 200, "teabranch_14_04": 200,
  "teabranch_16_02": 200, "teabranch_16_03": 200, "teabranch_16_04": 200,

  "flowcontrol_4_01": 100, "flowcontrol_4_02": 140, "flowcontrol_4_03": 220, "flowcontrol_4_04": 280,
  "flowcontrol_6_01": 95, "flowcontrol_6_02": 130, "flowcontrol_6_03": 205, "flowcontrol_6_04": 275,
  "flowcontrol_8_01": 95, "flowcontrol_8_02": 125, "flowcontrol_8_03": 200, "flowcontrol_8_04": 295,
  "flowcontrol_10_01": 140, "flowcontrol_10_02": 150, "flowcontrol_10_03": 215, "flowcontrol_10_04": 275,
  "flowcontrol_12_01": 165, "flowcontrol_12_02": 175, "flowcontrol_12_03": 200, "flowcontrol_12_04": 275,
  "flowcontrol_14_03": 500, "flowcontrol_14_06": 350,
  "flowcontrol_16_02": 470, "flowcontrol_16_03": 540,

  "femaleconnector_4_01": 40, "femaleconnector_4_02": 55, "femaleconnector_4_03": 80, "femaleconnector_4_04": 130,
  "femaleconnector_6_01": 34, "femaleconnector_6_02": 55, "femaleconnector_6_03": 64, "femaleconnector_6_04": 104,
  "femaleconnector_8_01": 45, "femaleconnector_8_02": 55, "femaleconnector_8_03": 70, "femaleconnector_8_04": 104,
  "femaleconnector_10_01": 70, "femaleconnector_10_02": 70, "femaleconnector_10_03": 72, "femaleconnector_10_04": 105,
  "femaleconnector_12_01": 100, "femaleconnector_12_02": 105, "femaleconnector_12_03": 105, "femaleconnector_12_04": 115,
  "femaleconnector_14_02": 270, "femaleconnector_14_03": 270,
  "femaleconnector_16_02": 270, "femaleconnector_16_03": 270,
};
function findPneumaticMrp(product) {
  if ((product.category || "").trim().toLowerCase() !== "pneumatic fittings") return null;
  const name = (product.name || "").toLowerCase();
  let type = null;
  if (name.includes("female connector")) type = "femaleconnector";
  else if (name.includes("male connector")) type = "connector";
  else if (name.includes("flow control")) type = "flowcontrol";
  else if (name.includes("tea branch") || name.includes("tee")) type = "teabranch";
  else if (name.includes("elbow")) type = "elbow";
  if (!type) return null;

  const tubeMatch = name.match(/(\d+)\s*x/);
  if (!tubeMatch) return null;
  const tube = tubeMatch[1];

  let threadCode = null;
  if (name.includes("1/8")) threadCode = "01";
  else if (name.includes("1/4")) threadCode = "02";
  else if (name.includes("3/8")) threadCode = "03";
  else if (name.includes("1/2")) threadCode = "04";
  if (!threadCode) return null;

  const key = `${type}_${tube}_${threadCode}`;
  return PNEUMATIC_MRP_TABLE[key] || null;
}


// ---- One-time MRP / discount patch: V Belt (Ecodrive & Pix) ----
// Sets an "mrp" (official price-list value) on existing V Belt products by
// matching the belt code (e.g. A16, B104, C57) in the product name against
// the brand's price list, and sets the selling "price" to 48% off that MRP.
// Only "price" and "mrp" fields are touched — never "image" — so existing
// photos are never affected. Runs once per product (skipped once "mrp" is
// already set), safe to leave running permanently.
const VBELT_DISCOUNT_PERCENT = 0.48;
const ECODRIVE_MRP_TABLE = {
  "A16": 152, "A18": 179, "A19": 180, "A20": 182, "A21": 183, "A22": 186, "A23": 187, "A24": 189,
  "A25": 190, "A26": 199, "A27": 201, "A28": 204, "A29": 207, "A30": 208, "A31": 216, "A32": 220,
  "A33": 221, "A34": 228, "A35": 233, "A36": 238, "A37": 241, "A38": 247, "A39": 254, "A40": 256,
  "A41": 264, "A42": 271, "A43": 273, "A44": 278, "A45": 284, "A46": 291, "A47": 295, "A48": 297,
  "A49": 299, "A50": 303, "A51": 311, "A52": 311, "A53": 314, "A54": 315, "A55": 318, "A56": 319,
  "A57": 320, "A58": 325, "A59": 326, "A60": 332, "A61": 334, "A62": 336, "A63": 338, "A64": 340,
  "A65": 356, "A66": 377, "A67": 379, "A68": 381, "A69": 383, "A70": 385, "A71": 392, "A72": 394,
  "A73": 400, "A74": 404, "A75": 407, "A76": 417, "A77": 421, "A78": 425, "A79": 431, "A80": 439,
  "A81": 440, "A82": 443, "A83": 447, "A84": 453, "A85": 457, "A86": 464, "A87": 469, "A88": 476,
  "A89": 484, "A90": 490, "A91": 511, "A92": 520, "A93": 526, "A94": 534, "A95": 541, "A96": 551,
  "A97": 561, "A97.5": 568, "A98": 575, "A99": 578, "A100": 596, "A101": 599, "A102": 602, "A103": 609,
  "A104": 615, "A105": 625, "A106": 631, "A107": 639, "A108": 642, "A109": 644, "A110": 657, "A111": 659,
  "A112": 667, "A113": 678, "A114": 687, "A115": 689, "A116": 696, "A117": 701, "A118": 707, "A119": 712,
  "A120": 718, "A121": 736, "A122": 744, "A123": 748, "A124": 760, "A125": 762, "A126": 766, "A127": 769,
  "A128": 779, "A129": 784, "A130": 791, "A131": 793, "A132": 801, "A133": 807, "A134": 817, "A135": 822,
  "A136": 824, "A137": 836, "A138": 839, "A139": 844, "A140": 846, "A141": 855, "A142": 863, "A143": 874,
  "A144": 876, "A145": 882, "A146": 886, "A147": 898, "A148": 904, "A149": 906, "A150": 914, "A152": 930,
  "A154": 941, "A156": 951, "A158": 966, "A160": 973, "A162": 983, "A164": 992, "A165": 994, "A166": 998,
  "A168": 1006, "A170": 1011, "A172": 1015, "A173": 1017, "A174": 1020, "A175": 1026, "A178": 1028, "A180": 1048,
  "A185": 1073, "A190": 1103, "A195": 1130, "B20": 241, "B21": 243, "B22": 244, "B23": 245, "B24": 248,
  "B25": 251, "B26": 254, "B27": 259, "B28": 261, "B29": 268, "B29.5": 270, "B30": 271, "B31": 278,
  "B32": 285, "B33": 289, "B34": 296, "B35": 301, "B36": 302, "B37": 303, "B38": 304, "B39": 309,
  "B40": 312, "B41": 324, "B42": 326, "B43": 332, "B44": 340, "B45": 342, "B46": 347, "B47": 353,
  "B48": 360, "B48.5": 363, "B49": 366, "B50": 369, "B51": 383, "B52": 385, "B53": 392, "B54": 394,
  "B55": 400, "B56": 408, "B57": 410, "B58": 412, "B59": 419, "B60": 425, "B61": 434, "B62": 443,
  "B63": 447, "B64": 450, "B65": 486, "B66": 500, "B66.5": 502, "B67": 502, "B68": 504, "B69": 509,
  "B70": 511, "B71": 528, "B72": 531, "B73": 534, "B74": 538, "B75": 545, "B76": 549, "B77": 556,
  "B78": 565, "B79": 568, "B80": 575, "B81": 586, "B82": 589, "B83": 596, "B84": 607, "B85": 612,
  "B86": 657, "B87": 671, "B88": 679, "B89": 692, "B90": 702, "B91": 732, "B92": 739, "B93": 754,
  "B94": 764, "B95": 779, "B96": 786, "B97": 795, "B98": 801, "B99": 807, "B100": 808, "B101": 817,
  "B102": 836, "B103": 838, "B104": 844, "B105": 845, "B106": 858, "B107": 862, "B108": 867, "B109": 874,
  "B110": 886, "B111": 890, "B112": 920, "B113": 937, "B114": 941, "B115": 944, "B116": 958, "B117": 964,
  "B118": 973, "B119": 987, "B120": 996, "B121": 1005, "B122": 1017, "B123": 1026, "B124": 1027, "B125": 1035,
  "B126": 1048, "B127": 1049, "B128": 1049, "B129": 1055, "B130": 1063, "B131": 1077, "B132": 1090, "B133": 1103,
  "B134": 1104, "B135": 1109, "B136": 1114, "B137": 1125, "B138": 1135, "B139": 1144, "B140": 1156, "B141": 1165,
  "B142": 1194, "B143": 1201, "B144": 1202, "B145": 1207, "B146": 1214, "B147": 1223, "B148": 1231, "B149": 1242,
  "B150": 1253, "B151": 1266, "B152": 1283, "B153": 1288, "B154": 1291, "B155": 1298, "B156": 1300, "B157": 1313,
  "B158": 1320, "B159": 1338, "B160": 1350, "B161": 1360, "B162": 1371, "B163": 1376, "B164": 1382, "B165": 1390,
  "B166": 1393, "B167": 1404, "B168": 1409, "B169": 1415, "B170": 1426, "B171": 1432, "B172": 1435, "B173": 1443,
  "B174": 1451, "B175": 1457, "B176": 1465, "B177": 1471, "B178": 1479, "B180": 1495, "B182": 1511, "B183": 1516,
  "B184": 1524, "B185": 1533, "B186": 1541, "B188": 1558, "B190": 1562, "B192": 1578, "B193": 1585, "B194": 1599,
  "B195": 1601, "B196": 1607, "B197": 1612, "B198": 1627, "B200": 1642, "B204": 1667, "B205": 1681, "B208": 1697,
  "B210": 1718, "B212": 1737, "B214": 1746, "B215": 1754, "B218": 1782, "B220": 1803, "B224": 1832, "B225": 1841,
  "B228": 1867, "B230": 1886, "B232": 1887, "B235": 1893, "B238": 1900, "B240": 1920, "B242": 1940, "B245": 1956,
  "B248": 1981, "B250": 1998, "B253": 2022, "B255": 2036, "B258": 2066, "B260": 2075, "B265": 2152, "B268": 2180,
  "B270": 2188, "B275": 2242, "B276": 2253, "B280": 2283, "B285": 2322, "B290": 2365, "B295": 2405, "B300": 2444,
  "B310": 2526, "B314": 2564, "B315": 2572, "B316": 2587, "B320": 2653, "B325": 2700, "B330": 2745, "B340": 2838,
  "B345": 2885, "B350": 2913, "B360": 3020, "B400": 3255, "B434": 3725, "B468": 3810, "C36": 463, "C37": 465,
  "C38": 467, "C39": 472, "C40": 473, "C41": 479, "C42": 487, "C43": 488, "C44": 494, "C45": 502,
  "C46": 507, "C47": 514, "C48": 526, "C49": 534, "C50": 542, "C51": 563, "C52": 572, "C53": 581,
  "C54": 586, "C55": 596, "C56": 606, "C57": 610, "C58": 617, "C59": 628, "C60": 635, "C61": 647,
  "C62": 660, "C63": 670, "C64": 677, "C65": 714, "C66": 755, "C67": 762, "C68": 774, "C69": 781,
  "C70": 786, "C71": 801, "C72": 807, "C73": 813, "C74": 822, "C75": 829, "C76": 842, "C77": 845,
  "C78": 858, "C79": 863, "C80": 874, "C81": 890, "C82": 899, "C83": 911, "C84": 921, "C85": 932,
  "C86": 951, "C87": 960, "C88": 973, "C89": 982, "C90": 1011, "C91": 1042, "C92": 1059, "C93": 1073,
  "C94": 1087, "C95": 1095, "C96": 1146, "C97": 1164, "C98": 1178, "C99": 1190, "C100": 1217, "C101": 1243,
  "C102": 1254, "C103": 1269, "C104": 1283, "C105": 1310, "C106": 1325, "C107": 1338, "C108": 1355, "C109": 1367,
  "C110": 1378, "C111": 1391, "C112": 1409, "C113": 1433, "C114": 1443, "C115": 1453, "C116": 1470, "C117": 1479,
  "C118": 1486, "C119": 1495, "C120": 1503, "C121": 1511, "C122": 1517, "C123": 1526, "C124": 1539, "C125": 1545,
  "C126": 1557, "C127": 1563, "C128": 1574, "C129": 1583, "C130": 1599, "C131": 1612, "C132": 1623, "C133": 1631,
  "C134": 1642, "C135": 1650, "C136": 1667, "C137": 1670, "C138": 1681, "C139": 1685, "C140": 1693, "C141": 1696,
  "C142": 1699, "C143": 1711, "C144": 1715, "C145": 1716, "C146": 1721, "C147": 1726, "C148": 1734, "C149": 1742,
  "C150": 1746, "C151": 1758, "C152": 1766, "C153": 1767, "C154": 1779, "C155": 1786, "C156": 1801, "C157": 1807,
  "C158": 1820, "C159": 1829, "C160": 1834, "C161": 1843, "C162": 1854, "C163": 1865, "C164": 1869, "C165": 1874,
  "C166": 1886, "C167": 1893, "C168": 1899, "C169": 1912, "C170": 1920, "C171": 1931, "C172": 1944, "C173": 1961,
  "C174": 1975, "C175": 1981, "C176": 1991, "C177": 2006, "C178": 2013, "C179": 2022, "C180": 2035, "C181": 2046,
  "C182": 2057, "C183": 2066, "C184": 2077, "C185": 2107, "C186": 2118, "C187": 2129, "C188": 2145, "C189": 2157,
  "C190": 2187, "C191": 2196, "C192": 2201, "C193": 2217, "C194": 2230, "C195": 2246, "C196": 2251, "C197": 2263,
  "C198": 2275, "C199": 2279, "C200": 2293, "C201": 2308, "C202": 2320, "C203": 2329, "C204": 2334, "C205": 2340,
  "C206": 2354, "C207": 2365, "C208": 2369, "C209": 2381, "C210": 2386,
};
const PIX_MRP_TABLE = {
  "A18": 230, "A19": 232, "A20": 234, "A21": 238, "A22": 239, "A23": 240, "A24": 244, "A25": 244,
  "A26": 250, "A27": 251, "A28": 257, "A29": 258, "A30": 260, "A31": 279, "A32": 284, "A33": 290,
  "A34": 294, "A35": 306, "A36": 316, "A37": 319, "A38": 322, "A39": 327, "A40": 332, "A41": 333,
  "A42": 341, "A43": 348, "A44": 357, "A45": 360, "A46": 368, "A47": 371, "A48": 378, "A49": 385,
  "A50": 390, "A51": 393, "A52": 398, "A53": 399, "A54": 401, "A55": 402, "A56": 409, "A57": 416,
  "A58": 421, "A59": 425, "A60": 431, "A61": 440, "A62": 444, "A63": 448, "A64": 453, "A65": 486,
  "A66": 508, "A67": 509, "A68": 520, "A69": 524, "A70": 528, "A71": 534, "A72": 537, "A73": 540,
  "A74": 551, "A75": 554, "A76": 562, "A77": 568, "A78": 571, "A79": 575, "A80": 597, "A81": 605,
  "A82": 610, "A83": 617, "A84": 627, "A85": 631, "A86": 681, "A87": 688, "A88": 694, "A89": 706,
  "A90": 724, "A91": 743, "A92": 760, "A93": 765, "A94": 776, "A95": 782, "A96": 796, "A97": 803,
  "A98": 803, "A99": 821, "A100": 837, "A101": 844, "A102": 857, "A103": 865, "A104": 874, "A105": 883,
  "A106": 892, "A107": 902, "A108": 902, "A109": 924, "A110": 933, "A112": 942, "A114": 973, "A115": 983,
  "A116": 983, "A117": 1001, "A118": 1004, "A119": 1012, "A120": 1012, "A121": 1039, "A122": 1044, "A124": 1047,
  "A125": 1062, "A126": 1083, "A127": 1102, "A128": 1117, "A130": 1147, "A131": 1156, "A132": 1165, "A134": 1178,
  "A135": 1184, "A136": 1189, "A137": 1195, "A138": 1196, "A140": 1207, "A142": 1223, "A143": 1224, "A144": 1226,
  "A145": 1240, "A146": 1244, "A148": 1264, "A150": 1278, "A152": 1289, "A154": 1295, "A156": 1315, "A158": 1319,
  "A160": 1341, "A162": 1352, "A168": 1394, "A170": 1410, "A180": 1471, "A185": 1512, "A190": 1557, "A195": 1611,
  "A200": 1613, "A205": 1720, "A210": 1759, "A236": 1838, "B18": 289, "B20": 308, "B21": 316, "B22": 324,
  "B23": 327, "B24": 329, "B25": 338, "B26": 340, "B27": 346, "B28": 353, "B29": 360, "B30": 366,
  "B31": 380, "B32": 386, "B33": 388, "B34": 392, "B35": 393, "B36": 396, "B37": 398, "B38": 400,
  "B39": 406, "B40": 407, "B41": 420, "B42": 425, "B43": 429, "B44": 436, "B45": 439, "B46": 460,
  "B47": 466, "B48": 476, "B49": 480, "B50": 487, "B51": 498, "B52": 503, "B53": 514, "B54": 521,
  "B55": 531, "B56": 538, "B57": 546, "B58": 550, "B59": 559, "B60": 565, "B61": 571, "B62": 578,
  "B63": 581, "B64": 589, "B65": 635, "B66": 673, "B67": 680, "B68": 681, "B69": 692, "B70": 696,
  "B71": 710, "B72": 714, "B73": 729, "B74": 738, "B75": 741, "B76": 744, "B77": 754, "B78": 758,
  "B79": 770, "B80": 780, "B81": 813, "B82": 819, "B83": 832, "B84": 840, "B85": 849, "B86": 921,
  "B87": 935, "B88": 942, "B89": 954, "B90": 970, "B91": 1028, "B92": 1039, "B93": 1058, "B94": 1072,
  "B95": 1087, "B96": 1093, "B97": 1109, "B98": 1118, "B99": 1123, "B100": 1130, "B101": 1148, "B102": 1156,
  "B103": 1164, "B104": 1176, "B105": 1193, "B106": 1199, "B107": 1217, "B108": 1230, "B109": 1245, "B110": 1257,
  "B111": 1275, "B112": 1293, "B113": 1323, "B114": 1331, "B115": 1340, "B116": 1352, "B117": 1364, "B118": 1375,
  "B119": 1382, "B120": 1394, "B121": 1399, "B122": 1412, "B123": 1416, "B124": 1425, "B125": 1434, "B126": 1437,
  "B127": 1439, "B128": 1449, "B129": 1481, "B130": 1486, "B131": 1498, "B132": 1505, "B133": 1522, "B134": 1531,
  "B135": 1547, "B136": 1553, "B137": 1569, "B138": 1579, "B139": 1592, "B140": 1622, "B142": 1652, "B143": 1661,
  "B144": 1677, "B145": 1691, "B146": 1709, "B147": 1723, "B148": 1734, "B150": 1763, "B152": 1811, "B154": 1824,
  "B155": 1834, "B156": 1841, "B157": 1853, "B158": 1861, "B160": 1885, "B162": 1911, "B163": 1915, "B164": 1934,
  "B165": 1944, "B166": 1956, "B167": 1964, "B168": 1973, "B169": 1986, "B170": 1992, "B172": 2004, "B173": 2014,
  "B174": 2025, "B175": 2035, "B176": 2038, "B178": 2051, "B180": 2063, "B182": 2091, "B184": 2122, "B185": 2133,
  "B186": 2145, "B188": 2167, "B190": 2197, "B192": 2250, "B195": 2277, "B198": 2323, "B200": 2323, "B204": 2390,
  "B205": 2399, "B210": 2445, "B215": 2499, "B220": 2548, "B225": 2606, "B228": 2647, "B230": 2671, "B235": 2720,
  "B238": 2758, "B240": 2778, "B245": 2842, "B250": 2892, "B255": 2954, "B260": 3007, "B268": 3093, "B270": 3122,
  "B275": 3181, "B280": 3238, "B285": 3298, "B300": 3477, "B315": 3650, "B330": 3829, "B340": 3947, "B360": 4164,
  "B370": 4294, "B512": 5857, "B927": 11849, "C31": 561, "C33": 584, "C34": 602, "C35": 619, "C36": 629,
  "C37": 630, "C38": 638, "C39": 639, "C40": 643, "C41": 650, "C42": 657, "C43": 662, "C44": 665,
  "C45": 690, "C46": 731, "C47": 739, "C48": 740, "C49": 748, "C50": 751, "C51": 768, "C52": 774,
  "C53": 780, "C54": 790, "C55": 797, "C56": 835, "C57": 843, "C58": 853, "C59": 869, "C60": 874,
  "C61": 898, "C62": 904, "C63": 915, "C64": 918, "C65": 982, "C66": 1024, "C67": 1033, "C68": 1039,
  "C69": 1053, "C70": 1068, "C71": 1076, "C72": 1087, "C73": 1103, "C74": 1113, "C75": 1123, "C76": 1137,
  "C77": 1148, "C78": 1165, "C79": 1187, "C80": 1203, "C81": 1245, "C82": 1254, "C83": 1269, "C84": 1283,
  "C85": 1290, "C86": 1311, "C87": 1329, "C88": 1360, "C89": 1388, "C90": 1419, "C91": 1485, "C92": 1511,
  "C93": 1538, "C94": 1578, "C95": 1603, "C96": 1617, "C97": 1643, "C98": 1670, "C99": 1693, "C100": 1717,
  "C101": 1733, "C102": 1773, "C103": 1794, "C104": 1816, "C105": 1844, "C106": 1861, "C107": 1889, "C108": 1912,
  "C109": 1941, "C110": 1959, "C111": 1973, "C112": 1997, "C113": 2036, "C114": 2042, "C115": 2053, "C116": 2061,
  "C117": 2066, "C118": 2074, "C119": 2078, "C120": 2082, "C121": 2094, "C122": 2096, "C123": 2105, "C124": 2114,
  "C125": 2132, "C126": 2146, "C127": 2165, "C128": 2203, "C129": 2217, "C130": 2240, "C131": 2257, "C132": 2279,
  "C133": 2299, "C134": 2317, "C135": 2337, "C136": 2363, "C137": 2377, "C138": 2398, "C139": 2407, "C140": 2427,
  "C141": 2444, "C142": 2457, "C143": 2466, "C144": 2472, "C145": 2484, "C146": 2487, "C147": 2495, "C148": 2501,
  "C149": 2514, "C150": 2518, "C151": 2521, "C152": 2538, "C153": 2542, "C154": 2550, "C155": 2562, "C156": 2569,
  "C157": 2576, "C158": 2578, "C159": 2593, "C160": 2601, "C161": 2610, "C162": 2617, "C163": 2626, "C164": 2633,
  "C165": 2646, "C166": 2648, "C167": 2658, "C168": 2662, "C169": 2666, "C170": 2669, "C171": 2671, "C172": 2673,
  "C173": 2684, "C174": 2708, "C175": 2728, "C176": 2742, "C177": 2744, "C178": 2762, "C180": 2790, "C181": 2808,
  "C182": 2824, "C183": 2842, "C184": 2862, "C185": 2871, "C186": 2899, "C187": 2915, "C188": 2923, "C190": 2956,
  "C192": 2999, "C193": 3017, "C194": 3031, "C195": 3052, "C196": 3071, "C197": 3087, "C198": 3108, "C200": 3147,
  "C202": 3184, "C204": 3216, "C205": 3229, "C206": 3249, "C208": 3283, "C210": 3309, "C212": 3339, "C215": 3389,
  "C216": 3404, "C218": 3433, "C220": 3464, "C222": 3495, "C224": 3525, "C225": 3535, "C228": 3584, "C230": 3615,
  "C234": 3682, "C235": 3702, "C236": 3712, "C238": 3753, "C240": 3786, "C242": 3821, "C244": 3843, "C245": 3868,
  "C248": 3910, "C250": 3934, "C252": 3961, "C255": 4010, "C258": 4055, "C260": 4085, "C262": 4124, "C264": 4171,
  "C265": 4192, "C268": 4217, "C270": 4250, "C272": 4284, "C275": 4338, "C276": 4361, "C278": 4396, "C280": 4412,
  "C285": 4489, "C286": 4516, "C288": 4560, "C290": 4589, "C295": 4658, "C298": 4708, "C300": 4737, "C305": 4831,
  "C310": 4908, "C315": 5008, "C320": 5082, "C328": 5230, "C330": 5253, "C340": 5386, "C345": 5483, "C350": 5566,
  "C358": 5772, "C360": 5802, "C370": 6162, "C380": 6482, "C927": 20137,
};
function findVBeltMrp(product) {
  if ((product.category || "").trim().toLowerCase() !== "v belt") return null;
  const name = (product.name || "").toLowerCase();
  const codeMatch = name.match(/\b([abc]\d+(?:\.\d+)?)\b/i);
  if (!codeMatch) return null;
  const code = codeMatch[1].toUpperCase();
  if (name.includes("ecodrive") || name.includes("eco drive") || name.includes("eco")) {
    return ECODRIVE_MRP_TABLE[code] || null;
  }
  if (name.includes("pix")) {
    return PIX_MRP_TABLE[code] || null;
  }
  return null;
}


const PHOTO_PATCH_RULES = [
  { keywords: ["flow control"], image: I.i0 },
  { keywords: ["male connector"], image: I.i1 },
  { keywords: ["elbow"], image: I.i2 },
  { keywords: ["female connector"], image: I.i3 },
  { category: "V BELT", keywords: ["eco"], image: I.i4 },
  { category: "V BELT", keywords: ["pix"], image: I.i5 },
  { category: "Handtools", subcategory: "Taparia", keywords: [], matchAll: true, image: I.i6 }
];

async function migrateLegacyProductsIfNeeded() {
  try {
    const existing = await getDocs(collection(db, "store"));
    const alreadyMigrated = existing.docs.some((d) => d.id.startsWith(PRODUCT_KEY_PREFIX));
    if (alreadyMigrated) return false;
    const legacy = await storageGet("products");
    if (!legacy) return false;
    let list = [];
    try {
      list = JSON.parse(legacy.value) || [];
    } catch {
      list = [];
    }
    if (!list.length) return false;
    await productsBulkSave(list.filter((p) => p && p.id));
    return true;
  } catch (e) {
    console.error("migrateLegacyProductsIfNeeded error", e);
    return false;
  }
}
// Real-time listener — used for orders so the admin panel updates instantly
// on every device/session the moment a new order comes in, without needing
// a manual page refresh. This is what fixes "admin panel me order nahi dikhta".
function storageListen(key, onChange) {
  return onSnapshot(
    doc(db, "store", key),
    (snap) => {
      if (snap.exists()) onChange(snap.data().value);
    },
    (err) => {
      console.error("storageListen error for", key, err);
    }
  );
}

// Tribute button press counter — atomic +1 so simultaneous presses never overwrite each other.
async function bumpTributeCount() {
  try {
    await setDoc(doc(db, "store", "tributeCount"), { value: increment(1) }, { merge: true });
  } catch (e) {
    console.error("tribute count error", e);
  }
}

// Gandhi Jayanti (MJ tribute) press counter — separate from the Bhagat Singh one, starts at 0.
async function bumpMjTributeCount() {
  try {
    await setDoc(doc(db, "store", "mjTributeCount"), { value: increment(1) }, { merge: true });
  } catch (e) {
    console.error("mj tribute count error", e);
  }
}
async function resetMjTributeCount() {
  try {
    await setDoc(doc(db, "store", "mjTributeCount"), { value: 0 });
  } catch (e) {
    console.error("mj tribute reset error", e);
  }
}

const CATEGORIES_DEFAULT = ["Handtools", "Belt", "Oil Seal", "Safety Material", "બીજું", "Maintenance Products", "Pneumatic Fittings", "Nut Bolt N Washer", "Shaurya Stationary"];
// Tabs that always show on the home screen, even before any product is added.
const ALWAYS_SHOW_CATEGORIES = ["Shaurya Stationary"];
// Sub-categories (the small chips under a category). Built-in lists + the ones the admin adds from the product form.
const SUBCATS_DEFAULT = {
  "Handtools": ["Taparia", "Stanley", "Dong Chen", "Jet", "Jainson"],
  "Belt": ["V Belt", "Lifting Belt"],
  "Nut Bolt N Washer": ["NUT", "Hex Bolt", "Washer", "Pan Phillip Screws"],
};
const GROCERY_SUBCATS_DEFAULT = ["Atta & Rice", "Dal & Pulses", "Oil & Ghee", "Sugar, Tea & Coffee", "Masala & Spices", "Dairy & Milk", "Biscuits & Snacks", "Soap & Cleaning"];
function isGroceryCategory(c) {
  return /grocer|ગ્રોસરી|કરિયાણ/i.test(String(c || ""));
}
function subcatsFor(cat, custom) {
  const base = SUBCATS_DEFAULT[cat] || (isGroceryCategory(cat) ? GROCERY_SUBCATS_DEFAULT : []);
  const extra = (custom && custom[cat]) || [];
  return Array.from(new Set([...base, ...extra]));
}
// ---- Product photo tools: shrink a phone photo (under ~0.3 MB) or turn it into a ready "offer poster" with the price ----
function imgLoadFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(url), 8000); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    im.src = url;
  });
}
function imgCanvasToJpeg(canvas, maxChars, q0) {
  let q = q0 || 0.86;
  let out = canvas.toDataURL("image/jpeg", q);
  while (out.length > maxChars && q > 0.42) {
    q -= 0.07;
    out = canvas.toDataURL("image/jpeg", q);
  }
  return out;
}
// plain: only smaller + lighter (a Firestore document must stay under 1 MB; the store loads every product, so lighter is faster)
function imgMakePlain(img, maxDim, maxChars) {
  const md = maxDim || 1000;
  const mc = maxChars || 330000;
  let scale = Math.min(1, md / Math.max(img.naturalWidth, img.naturalHeight));
  let out = "";
  for (let pass = 0; pass < 4; pass++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = canvas.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = imgCanvasToJpeg(canvas, mc, 0.86);
    if (out.length <= mc) break;
    scale *= 0.8;
  }
  return out;
}
const IMG_THEMES = {
  purple: { bg: ["#2a0845", "#6a1b9a", "#c2185b"], tag: "#d50000", tagLine: "#ffeb3b", pill: ["#6a1b9a", "#311b92"] },
  green: { bg: ["#06361f", "#1b7a43", "#7cb342"], tag: "#c62828", tagLine: "#ffeb3b", pill: ["#2e7d32", "#1b5e20"] },
  blue: { bg: ["#07204a", "#1565c0", "#00acc1"], tag: "#d84315", tagLine: "#ffeb3b", pill: ["#1565c0", "#0d2f6e"] },
};
// poster 800x1200: festive background, price tag on top, the photo in a frame, "Available on apnidukanse.in" at the bottom
function imgMakePoster(img, opts) {
  const price = opts && opts.price;
  const T = IMG_THEMES[(opts && opts.theme) || "purple"] || IMG_THEMES.purple;
  const W = 800;
  const H = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  const rr = (x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  const fit = (text, weight, maxW, startPx, minPx) => {
    let fs = startPx;
    c.font = `${weight} ${fs}px "Arial Black", Impact, Arial, sans-serif`;
    while (c.measureText(text).width > maxW && fs > minPx) {
      fs -= 4;
      c.font = `${weight} ${fs}px "Arial Black", Impact, Arial, sans-serif`;
    }
    return fs;
  };
  // background + soft lights
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, T.bg[0]);
  g.addColorStop(0.55, T.bg[1]);
  g.addColorStop(1, T.bg[2]);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  [[90, 330, 60], [700, 420, 48], [120, 980, 70], [690, 860, 56], [400, 170, 40], [745, 140, 34], [55, 640, 40], [560, 1010, 46]].forEach(([x, y, r]) => {
    const rg = c.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, "rgba(255,214,102,0.55)");
    rg.addColorStop(1, "rgba(255,214,102,0)");
    c.fillStyle = rg;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  });

  // price tag
  const p = Number(price);
  const hasPrice = Number.isFinite(p) && p > 0;
  let photoTop = 60;
  if (hasPrice) {
    photoTop = 290;
    const text = `₹${p.toLocaleString("en-IN")}/-`;
    c.save();
    c.shadowColor = "rgba(0,0,0,0.45)";
    c.shadowBlur = 24;
    c.shadowOffsetY = 10;
    c.beginPath();
    c.moveTo(60, 72);
    c.lineTo(740, 40);
    c.lineTo(752, 232);
    c.lineTo(86, 264);
    c.closePath();
    c.fillStyle = T.tag;
    c.fill();
    c.restore();
    c.lineWidth = 7;
    c.lineJoin = "round";
    c.strokeStyle = T.tagLine;
    c.beginPath();
    c.moveTo(60, 72);
    c.lineTo(740, 40);
    c.lineTo(752, 232);
    c.lineTo(86, 264);
    c.closePath();
    c.stroke();
    const fs = fit(text, "900", 560, 170, 56);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.save();
    c.translate(406, 154);
    c.rotate(-0.04);
    c.lineJoin = "round";
    c.lineWidth = 16;
    c.strokeStyle = "#7f0000";
    c.strokeText(text, 0, 0);
    const tg = c.createLinearGradient(0, -fs / 2, 0, fs / 2);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(0.5, "#fff176");
    tg.addColorStop(1, "#ffc107");
    c.fillStyle = tg;
    c.fillText(text, 0, 0);
    c.restore();
  }

  // photo frame (the photo is never cropped: a blurred copy fills the sides)
  const fx = 50;
  const fw = 700;
  const fy = photoTop;
  const fh = 965 - photoTop;
  c.save();
  c.shadowColor = "rgba(0,0,0,0.5)";
  c.shadowBlur = 30;
  c.shadowOffsetY = 14;
  rr(fx, fy, fw, fh, 36);
  c.fillStyle = "#fff";
  c.fill();
  c.restore();
  const ix = fx + 8;
  const iy = fy + 8;
  const iw = fw - 16;
  const ih = fh - 16;
  c.save();
  rr(ix, iy, iw, ih, 30);
  c.clip();
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const canFilter = "filter" in c;
  if (canFilter) {
    const cover = Math.max(iw / w0, ih / h0);
    c.filter = "blur(22px) brightness(0.85)";
    c.drawImage(img, ix + (iw - w0 * cover) / 2, iy + (ih - h0 * cover) / 2, w0 * cover, h0 * cover);
    c.filter = "none";
  } else {
    c.fillStyle = "#f3efe6";
    c.fillRect(ix, iy, iw, ih);
  }
  const contain = Math.min(iw / w0, ih / h0);
  if (canFilter) c.filter = "contrast(1.06) saturate(1.12)";
  c.drawImage(img, ix + (iw - w0 * contain) / 2, iy + (ih - h0 * contain) / 2, w0 * contain, h0 * contain);
  if (canFilter) c.filter = "none";
  c.restore();

  // bottom: "Available on" + site name
  c.save();
  c.shadowColor = "rgba(0,0,0,0.4)";
  c.shadowBlur = 14;
  c.shadowOffsetY = 6;
  rr(205, 980, 390, 66, 33);
  const yg = c.createLinearGradient(0, 980, 0, 1046);
  yg.addColorStop(0, "#fff59d");
  yg.addColorStop(1, "#ffb300");
  c.fillStyle = yg;
  c.fill();
  c.restore();
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#1a1033";
  c.font = 'italic 900 40px "Arial Black", Arial, sans-serif';
  c.fillText("Available on", 400, 1015);
  c.save();
  c.shadowColor = "rgba(0,0,0,0.45)";
  c.shadowBlur = 18;
  c.shadowOffsetY = 8;
  rr(40, 1052, 720, 118, 59);
  const pg = c.createLinearGradient(0, 1052, 0, 1170);
  pg.addColorStop(0, T.pill[0]);
  pg.addColorStop(1, T.pill[1]);
  c.fillStyle = pg;
  c.fill();
  c.restore();
  rr(40, 1052, 720, 118, 59);
  c.lineWidth = 7;
  c.strokeStyle = "#ffca28";
  c.stroke();
  const site = "apnidukanse.in";
  fit(site, "900", 620, 76, 40);
  c.fillStyle = "#ffffff";
  c.fillText(site, 400, 1114);
  return imgCanvasToJpeg(canvas, 450000, 0.9);
}

const ADMIN_PIN = "1609";

// ---- Sellers: small vepari (Sandhya Traders, B.M. Traders, Deepankit) ----
// Each seller logs in with a shared/own PIN and sees only orders whose items
// carry their sellerId. Defaults seed into Firestore ("store/sellers") on
// first load so admin can add/delete more from the admin panel afterwards.
const DEFAULT_SELLERS = [
  { id: "sel-sandhya", name: "Sandhya Traders", mobile: "9898154548", pin: "112137" },
  { id: "sel-bm", name: "B.M. Traders", mobile: "9327073634", pin: "112137" },
  { id: "sel-deepankit", name: "DEEPANKIT TRADING CO", mobile: "9824059777", pin: "112137" },
];

// Works out which seller owns a product when its saved sellerId is missing
// (older products in Firestore were saved before sellers existed, and the
// built-in catalog only seeds an EMPTY store). Used for orders, the print
// slip and a one-time backfill so Lifting Belt -> Deepankit, Ecodrive -> B.M.
function inferSellerId(p) {
  if (!p) return "";
  const name = String(p.name || "").trim().toLowerCase();
  const sub = String(p.subcategory || "").trim().toLowerCase();
  const brand = String(p.brand || "").trim().toLowerCase();
  const cat = String(p.category || "").trim().toLowerCase();
  if (cat.includes("weld") || name.includes("welding")) return "sel-deepankit";
  if (cat === "maintenance products") return "sel-bm";
  if (sub === "lifting belt" || name.startsWith("lifting belt")) return "sel-deepankit";
  if (brand === "ecodrive" || name.startsWith("ecodrive") || name.startsWith("eco drive")) return "sel-bm";
  return "";
}

const VBELT_IMG_A = I.i7;
const VBELT_IMG_B = I.i8;
const VBELT_IMG_C = I.i9;
const WD40_IMG = I.i10;
const SCOTCHBRITE_IMG = I.i11;
const ANABOND_IMG = I.i12;
const FITTING_IMG_PC = I.i13;
const FITTING_IMG_PL = I.i14;
const FITTING_IMG_NSE = I.i15;
const FITTING_IMG_PCF = I.i16;
const WASHER_IMG = I.i17;
const ECODRIVE_IMG_B = I.i18;
const ECODRIVE_IMG_C = I.i19;
const ECODRIVE_IMG_A_NEW = I.i20;

// Lookup table so products can store a short key (e.g. "VBELT_IMG_A") instead of
// duplicating the full photo in every product — keeps Firestore documents small.
const IMAGE_MAP = {
  VBELT_IMG_A, VBELT_IMG_B, VBELT_IMG_C,
  WD40_IMG, SCOTCHBRITE_IMG, ANABOND_IMG,
  FITTING_IMG_PC, FITTING_IMG_PL, FITTING_IMG_NSE, FITTING_IMG_PCF,
  WASHER_IMG,
  ECODRIVE_IMG_B, ECODRIVE_IMG_B, ECODRIVE_IMG_C,
};
function resolveProductImage(p) {
  if (!p) return "";
  if (p.image) return p.image;
  if (p.imageKey && IMAGE_MAP[p.imageKey]) return IMAGE_MAP[p.imageKey];
  return "";
}
const NUT_IMG = I.i21;
const BOLT_IMG = I.i22;
const PANPHILLIP_IMG = I.i23;
const LB_1TON_IMG = I.i24;
const LB_2TON_IMG = I.i25;
const LB_3TON_IMG = I.i26;
const LB_4TON_IMG = I.i27;
const JN_IMG_JN001 = I.i28;
const JN_IMG_SAMRAT16 = I.i29;
const JN_IMG_PANTHERA = I.i30;
const JN_IMG_JOP427 = I.i31;
const JN_IMG_CHAKRA6PRIME = I.i32;
const JN_IMG_ZEBRA = I.i33;
const JN_IMG_CHETAK6 = I.i34;
const JN_IMG_INDRA = I.i35;
const JN_IMG_JN012 = I.i36;
const JN_IMG_SPIDER6PRIME = I.i37;
const JN_IMG_CX01 = I.i38;
const JN_IMG_JN008 = I.i39;
const JN_IMG_DSUB = I.i40;
const JN_IMG_PLUTO50 = I.i41;
const JN_IMG_JN014 = I.i42;
const JN_IMG_DELTA50B = I.i43;
const JN_IMG_PANTHERMAX = I.i44;
const JN_IMG_ARJUN50 = I.i45;
const JN_IMG_JN003 = I.i46;
const JN_IMG_JN006 = I.i47;
const JN_IMG_PANTHERPRIME = I.i48;
const JN_IMG_PUMACUTTER = I.i49;
const JN_IMG_JN013 = I.i50;
const JN_IMG_JN009 = I.i51;
const JN_IMG_JN011 = I.i52;
const JN_IMG_CHAKRA16PRIME = I.i53;
const JN_IMG_PLUTO95 = I.i54;
const JN_IMG_SUPER6 = I.i55;
const JN_IMG_JN010 = I.i56;
const JN_IMG_SPIDER16PRIME = I.i57;
const JN_IMG_JN005 = I.i58;
const JN_IMG_JN002 = I.i59;
const JN_IMG_AGNEE95 = I.i60;
const JN_IMG_DELTA120B = I.i61;
const JN_IMG_LION = I.i62;
const JN_IMG_VIRAT6 = I.i63;
const JN_IMG_VIKRANT50 = I.i64;
const JN_IMG_JN007 = I.i65;
const JN_IMG_TRISHUL = I.i66;
const JN_IMG_DELTA150B = I.i67;
const JN_IMG_CX02 = I.i68;
const JN_IMG_SPIDER6 = I.i69;
const JN_IMG_CHETAK16 = I.i70;
const JN_IMG_CHAKRA6 = I.i71;
const JN_IMG_O5N = I.i72;
const JN_IMG_PUMASTRIPPER = I.i73;
const JN_IMG_JN004 = I.i74;
const SEED_PRODUCTS = [
  { id: "jn-001", name: "Jainson D-Sub Terminal Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1680, mrp: 2400, img: "🔧", image: JN_IMG_DSUB },
  { id: "jn-002", name: "Jainson CX-01 Coaxial Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_CX01 },
  { id: "jn-003", name: "Jainson CX-02 Coaxial Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_CX02 },
  { id: "jn-004", name: "Jainson JN 013 End Sealing Ferrules Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN013 },
  { id: "jn-005", name: "Jainson Indra 7-in-1 Crimping Tool Set", category: "Handtools", subcategory: "Jainson", price: 3080, mrp: 4400, img: "🔧", image: JN_IMG_INDRA },
  { id: "jn-006", name: "Jainson Chakra-6 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 525, mrp: 750, img: "🔧", image: JN_IMG_CHAKRA6 },
  { id: "jn-007", name: "Jainson Chakra-6 Prime Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1344, mrp: 1920, img: "🔧", image: JN_IMG_CHAKRA6PRIME },
  { id: "jn-008", name: "Jainson Spider-6 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 693, mrp: 990, img: "🔧", image: JN_IMG_SPIDER6 },
  { id: "jn-009", name: "Jainson Spider-6 Prime Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1834, mrp: 2620, img: "🔧", image: JN_IMG_SPIDER6PRIME },
  { id: "jn-010", name: "Jainson Chakra-16 Prime Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1330, mrp: 1900, img: "🔧", image: JN_IMG_CHAKRA16PRIME },
  { id: "jn-011", name: "Jainson Spider-16 Prime Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1540, mrp: 2200, img: "🔧", image: JN_IMG_SPIDER16PRIME },
  { id: "jn-012", name: "Jainson Virat-6 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 595, mrp: 850, img: "🔧", image: JN_IMG_VIRAT6 },
  { id: "jn-013", name: "Jainson JOP-427 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 721, mrp: 1030, img: "🔧", image: JN_IMG_JOP427 },
  { id: "jn-014", name: "Jainson Super-6 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 609, mrp: 870, img: "🔧", image: JN_IMG_SUPER6 },
  { id: "jn-015", name: "Jainson Samrat-16 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 770, mrp: 1100, img: "🔧", image: JN_IMG_SAMRAT16 },
  { id: "jn-016", name: "Jainson Chetak-6 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_CHETAK6 },
  { id: "jn-017", name: "Jainson Chetak-16 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_CHETAK16 },
  { id: "jn-018", name: "Jainson Trishul (3in1) Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_TRISHUL },
  { id: "jn-019", name: "Jainson JN 001 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_JN001 },
  { id: "jn-020", name: "Jainson JN 002 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_JN002 },
  { id: "jn-021", name: "Jainson JN 003 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1155, mrp: 1650, img: "🔧", image: JN_IMG_JN003 },
  { id: "jn-022", name: "Jainson JN 004 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 980, mrp: 1400, img: "🔧", image: JN_IMG_JN004 },
  { id: "jn-023", name: "Jainson JN 005 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 980, mrp: 1400, img: "🔧", image: JN_IMG_JN005 },
  { id: "jn-024", name: "Jainson JN 006 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 980, mrp: 1400, img: "🔧", image: JN_IMG_JN006 },
  { id: "jn-025", name: "Jainson JN 007 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1015, mrp: 1450, img: "🔧", image: JN_IMG_JN007 },
  { id: "jn-026", name: "Jainson JN 008 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN008 },
  { id: "jn-027", name: "Jainson JN 009 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN009 },
  { id: "jn-028", name: "Jainson JN 010 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN010 },
  { id: "jn-029", name: "Jainson JN 011 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN011 },
  { id: "jn-030", name: "Jainson JN 012 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 910, mrp: 1300, img: "🔧", image: JN_IMG_JN012 },
  { id: "jn-031", name: "Jainson JN 014 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 945, mrp: 1350, img: "🔧", image: JN_IMG_JN014 },
  { id: "jn-032", name: "Jainson Vikrant-50 Dieless Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1208, mrp: 1725, img: "🔧", image: JN_IMG_VIKRANT50 },
  { id: "jn-033", name: "Jainson Arjun-50 Heavy Duty Dieless Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 2065, mrp: 2950, img: "🔧", image: JN_IMG_ARJUN50 },
  { id: "jn-034", name: "Jainson Pluto-50 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 2065, mrp: 2950, img: "🔧", image: JN_IMG_PLUTO50 },
  { id: "jn-035", name: "Jainson Pluto-95 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 3255, mrp: 4650, img: "🔧", image: JN_IMG_PLUTO95 },
  { id: "jn-036", name: "Jainson Agnee-95 Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 4760, mrp: 6800, img: "🔧", image: JN_IMG_AGNEE95 },
  { id: "jn-037", name: "Jainson Delta-50B Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 1330, mrp: 1900, img: "🔧", image: JN_IMG_DELTA50B },
  { id: "jn-038", name: "Jainson Delta-120B Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 4025, mrp: 5750, img: "🔧", image: JN_IMG_DELTA120B },
  { id: "jn-039", name: "Jainson Delta-150B Crimping Tool", category: "Handtools", subcategory: "Jainson", price: 4025, mrp: 5750, img: "🔧", image: JN_IMG_DELTA150B },
  { id: "jn-040", name: "Jainson Lion Automatic Wire Stripper", category: "Handtools", subcategory: "Jainson", price: 276, mrp: 395, img: "🔧", image: JN_IMG_LION },
  { id: "jn-041", name: "Jainson Zebra Multi-functional Wire Stripper", category: "Handtools", subcategory: "Jainson", price: 507, mrp: 725, img: "🔧", image: JN_IMG_ZEBRA },
  { id: "jn-042", name: "Jainson O5N Wire Cutter/Nipper", category: "Handtools", subcategory: "Jainson", price: 154, mrp: 220, img: "🔧", image: JN_IMG_O5N },
  { id: "jn-043", name: "Jainson Puma Cutter", category: "Handtools", subcategory: "Jainson", price: 227, mrp: 325, img: "🔧", image: JN_IMG_PUMACUTTER },
  { id: "jn-044", name: "Jainson Puma Cutter & Stripper", category: "Handtools", subcategory: "Jainson", price: 245, mrp: 350, img: "🔧", image: JN_IMG_PUMASTRIPPER },
  { id: "jn-045", name: "Jainson Panther A Cable Knife", category: "Handtools", subcategory: "Jainson", price: 525, mrp: 750, img: "🔧", image: JN_IMG_PANTHERA },
  { id: "jn-046", name: "Jainson Panther B Cable Knife", category: "Handtools", subcategory: "Jainson", price: 525, mrp: 750, img: "🔧", image: JN_IMG_PANTHERA },
  { id: "jn-047", name: "Jainson Panther Prime Cable Knife", category: "Handtools", subcategory: "Jainson", price: 525, mrp: 750, img: "🔧", image: JN_IMG_PANTHERPRIME },
  { id: "jn-048", name: "Jainson Panther Max (PG-5) Cable Knife", category: "Handtools", subcategory: "Jainson", price: 2065, mrp: 2950, img: "🔧", image: JN_IMG_PANTHERMAX },
  { id: "lb-1t-1m", name: "Lifting Belt 1Ton x 1 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 63, mrp: 90, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-2m", name: "Lifting Belt 1Ton x 2 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 106, mrp: 152, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-3m", name: "Lifting Belt 1Ton x 3 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 157, mrp: 224, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-4m", name: "Lifting Belt 1Ton x 4 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 203, mrp: 290, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-5m", name: "Lifting Belt 1Ton x 5 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 251, mrp: 358, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-6m", name: "Lifting Belt 1Ton x 6 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 297, mrp: 424, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-8m", name: "Lifting Belt 1Ton x 8 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 391, mrp: 558, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-10m", name: "Lifting Belt 1Ton x 10 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 483, mrp: 690, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-1t-12m", name: "Lifting Belt 1Ton x 12 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 574, mrp: 820, img: "🪢", image: LB_1TON_IMG },
  { id: "lb-2t-1m", name: "Lifting Belt 2Ton x 1 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 111, mrp: 158, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-2m", name: "Lifting Belt 2Ton x 2 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 210, mrp: 300, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-3m", name: "Lifting Belt 2Ton x 3 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 301, mrp: 430, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-4m", name: "Lifting Belt 2Ton x 4 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 400, mrp: 572, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-5m", name: "Lifting Belt 2Ton x 5 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 493, mrp: 705, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-6m", name: "Lifting Belt 2Ton x 6 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 584, mrp: 835, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-8m", name: "Lifting Belt 2Ton x 8 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 770, mrp: 1100, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-10m", name: "Lifting Belt 2Ton x 10 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 955, mrp: 1365, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-2t-12m", name: "Lifting Belt 2Ton x 12 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1140, mrp: 1628, img: "🪢", image: LB_2TON_IMG },
  { id: "lb-3t-1m", name: "Lifting Belt 3Ton x 1 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 183, mrp: 262, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-2m", name: "Lifting Belt 3Ton x 2 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 322, mrp: 460, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-3m", name: "Lifting Belt 3Ton x 3 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 444, mrp: 635, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-4m", name: "Lifting Belt 3Ton x 4 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 595, mrp: 850, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-5m", name: "Lifting Belt 3Ton x 5 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 732, mrp: 1045, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-6m", name: "Lifting Belt 3Ton x 6 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 868, mrp: 1240, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-8m", name: "Lifting Belt 3Ton x 8 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1141, mrp: 1630, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-10m", name: "Lifting Belt 3Ton x 10 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1414, mrp: 2020, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-3t-12m", name: "Lifting Belt 3Ton x 12 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1680, mrp: 2400, img: "🪢", image: LB_3TON_IMG },
  { id: "lb-4t-1m", name: "Lifting Belt 4Ton x 1 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 241, mrp: 345, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-2m", name: "Lifting Belt 4Ton x 2 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 420, mrp: 600, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-3m", name: "Lifting Belt 4Ton x 3 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 598, mrp: 855, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-4m", name: "Lifting Belt 4Ton x 4 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 777, mrp: 1110, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-5m", name: "Lifting Belt 4Ton x 5 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 955, mrp: 1365, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-6m", name: "Lifting Belt 4Ton x 6 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1134, mrp: 1620, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-8m", name: "Lifting Belt 4Ton x 8 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1491, mrp: 2130, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-10m", name: "Lifting Belt 4Ton x 10 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 1848, mrp: 2640, img: "🪢", image: LB_4TON_IMG },
  { id: "lb-4t-12m", name: "Lifting Belt 4Ton x 12 Mtr", category: "Belt", subcategory: "Lifting Belt", sellerId: "sel-deepankit", price: 2205, mrp: 3150, img: "🪢", image: LB_4TON_IMG },
  { id: "nut-generic", name: "Nut (Size જણાવો)", category: "Nut Bolt N Washer", subcategory: "NUT", price: 99, mrp: null, img: "🔩", image: NUT_IMG, unit: "kg", requiresSize: true },
  { id: "bolt-generic", name: "Hex Bolt (Size જણાવો)", category: "Nut Bolt N Washer", subcategory: "Hex Bolt", price: 99, mrp: null, img: "🔩", image: BOLT_IMG, unit: "kg", requiresSize: true },
  { id: "pps-m4x6", name: "Pan Phillips Screw M4x6 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 240, mrp: 300.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x8", name: "Pan Phillips Screw M4x8 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 264, mrp: 330.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x10", name: "Pan Phillips Screw M4x10 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 280, mrp: 350.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x12", name: "Pan Phillips Screw M4x12 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 288, mrp: 360.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x15", name: "Pan Phillips Screw M4x15 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 352, mrp: 440.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x20", name: "Pan Phillips Screw M4x20 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 400, mrp: 500.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x25", name: "Pan Phillips Screw M4x25 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 480, mrp: 600.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x30", name: "Pan Phillips Screw M4x30 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 544, mrp: 680.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x35", name: "Pan Phillips Screw M4x35 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 600, mrp: 750.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x40", name: "Pan Phillips Screw M4x40 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 712, mrp: 890.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x45", name: "Pan Phillips Screw M4x45 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 760, mrp: 950.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x50", name: "Pan Phillips Screw M4x50 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 864, mrp: 1080.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x55", name: "Pan Phillips Screw M4x55 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1096, mrp: 1370.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x60", name: "Pan Phillips Screw M4x60 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1184, mrp: 1480.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x65", name: "Pan Phillips Screw M4x65 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1416, mrp: 1770.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x70", name: "Pan Phillips Screw M4x70 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1464, mrp: 1830.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x75", name: "Pan Phillips Screw M4x75 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1560, mrp: 1950.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x80", name: "Pan Phillips Screw M4x80 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1800, mrp: 2250.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x90", name: "Pan Phillips Screw M4x90 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2040, mrp: 2550.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x100", name: "Pan Phillips Screw M4x100 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2160, mrp: 2700.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x120", name: "Pan Phillips Screw M4x120 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2880, mrp: 3600.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m4x125", name: "Pan Phillips Screw M4x125 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3480, mrp: 4350.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x6", name: "Pan Phillips Screw M5x6 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 408, mrp: 510.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x8", name: "Pan Phillips Screw M5x8 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 424, mrp: 530.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x10", name: "Pan Phillips Screw M5x10 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 456, mrp: 570.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x12", name: "Pan Phillips Screw M5x12 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 504, mrp: 630.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x15", name: "Pan Phillips Screw M5x15 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 544, mrp: 680.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x20", name: "Pan Phillips Screw M5x20 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 640, mrp: 800.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x25", name: "Pan Phillips Screw M5x25 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 760, mrp: 950.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x30", name: "Pan Phillips Screw M5x30 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 840, mrp: 1050.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x35", name: "Pan Phillips Screw M5x35 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 960, mrp: 1200.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x40", name: "Pan Phillips Screw M5x40 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1056, mrp: 1320.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x45", name: "Pan Phillips Screw M5x45 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1192, mrp: 1490.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x50", name: "Pan Phillips Screw M5x50 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1264, mrp: 1580.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x55", name: "Pan Phillips Screw M5x55 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1320, mrp: 1650.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x60", name: "Pan Phillips Screw M5x60 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1384, mrp: 1730.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x65", name: "Pan Phillips Screw M5x65 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2040, mrp: 2550.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x70", name: "Pan Phillips Screw M5x70 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2256, mrp: 2820.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x75", name: "Pan Phillips Screw M5x75 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2376, mrp: 2970.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x80", name: "Pan Phillips Screw M5x80 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2640, mrp: 3300.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x90", name: "Pan Phillips Screw M5x90 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3120, mrp: 3900.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x100", name: "Pan Phillips Screw M5x100 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3240, mrp: 4050.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x120", name: "Pan Phillips Screw M5x120 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3600, mrp: 4500.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m5x125", name: "Pan Phillips Screw M5x125 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3840, mrp: 4800.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x6", name: "Pan Phillips Screw M6x6 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 840, mrp: 1050.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x8", name: "Pan Phillips Screw M6x8 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 720, mrp: 900.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x10", name: "Pan Phillips Screw M6x10 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 720, mrp: 900.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x12", name: "Pan Phillips Screw M6x12 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 792, mrp: 990.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x15", name: "Pan Phillips Screw M6x15 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 840, mrp: 1050.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x20", name: "Pan Phillips Screw M6x20 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 976, mrp: 1220.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x25", name: "Pan Phillips Screw M6x25 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1096, mrp: 1370.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x30", name: "Pan Phillips Screw M6x30 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1192, mrp: 1490.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x35", name: "Pan Phillips Screw M6x35 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1432, mrp: 1790.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x40", name: "Pan Phillips Screw M6x40 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1536, mrp: 1920.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x45", name: "Pan Phillips Screw M6x45 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1752, mrp: 2190.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x50", name: "Pan Phillips Screw M6x50 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1896, mrp: 2370.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x70", name: "Pan Phillips Screw M6x70 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2400, mrp: 3000.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m6x75", name: "Pan Phillips Screw M6x75 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2584, mrp: 3230.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x12", name: "Pan Phillips Screw M8x12 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1560, mrp: 1950.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x15", name: "Pan Phillips Screw M8x15 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1624, mrp: 2030.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x20", name: "Pan Phillips Screw M8x20 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 1768, mrp: 2210.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x25", name: "Pan Phillips Screw M8x25 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2064, mrp: 2580.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x30", name: "Pan Phillips Screw M8x30 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2208, mrp: 2760.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x35", name: "Pan Phillips Screw M8x35 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2808, mrp: 3510.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x40", name: "Pan Phillips Screw M8x40 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 2968, mrp: 3710.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x45", name: "Pan Phillips Screw M8x45 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3336, mrp: 4170.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "pps-m8x50", name: "Pan Phillips Screw M8x50 (1000 pcs pkt)", category: "Nut Bolt N Washer", subcategory: "Pan Phillip Screws", price: 3688, mrp: 4610.0, img: "🔩", image: PANPHILLIP_IMG },
  { id: "ed-a16", name: "Ecodrive V-Belt A16", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 79, mrp: 152, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a18", name: "Ecodrive V-Belt A18", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 93, mrp: 179, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a19", name: "Ecodrive V-Belt A19", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 94, mrp: 180, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a20", name: "Ecodrive V-Belt A20", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 95, mrp: 182, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a21", name: "Ecodrive V-Belt A21", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 95, mrp: 183, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a22", name: "Ecodrive V-Belt A22", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 97, mrp: 186, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a23", name: "Ecodrive V-Belt A23", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 97, mrp: 187, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a24", name: "Ecodrive V-Belt A24", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 98, mrp: 189, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a25", name: "Ecodrive V-Belt A25", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 99, mrp: 190, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a26", name: "Ecodrive V-Belt A26", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 103, mrp: 199, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a27", name: "Ecodrive V-Belt A27", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 105, mrp: 201, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a28", name: "Ecodrive V-Belt A28", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 106, mrp: 204, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a29", name: "Ecodrive V-Belt A29", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 108, mrp: 207, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a30", name: "Ecodrive V-Belt A30", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 108, mrp: 208, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a31", name: "Ecodrive V-Belt A31", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 112, mrp: 216, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a32", name: "Ecodrive V-Belt A32", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 114, mrp: 220, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a33", name: "Ecodrive V-Belt A33", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 115, mrp: 221, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a34", name: "Ecodrive V-Belt A34", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 119, mrp: 228, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a35", name: "Ecodrive V-Belt A35", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 121, mrp: 233, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a36", name: "Ecodrive V-Belt A36", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 124, mrp: 238, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a37", name: "Ecodrive V-Belt A37", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 125, mrp: 241, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a38", name: "Ecodrive V-Belt A38", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 128, mrp: 247, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a39", name: "Ecodrive V-Belt A39", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 132, mrp: 254, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a40", name: "Ecodrive V-Belt A40", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 133, mrp: 256, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a41", name: "Ecodrive V-Belt A41", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 137, mrp: 264, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a42", name: "Ecodrive V-Belt A42", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 141, mrp: 271, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a43", name: "Ecodrive V-Belt A43", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 142, mrp: 273, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a44", name: "Ecodrive V-Belt A44", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 145, mrp: 278, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a45", name: "Ecodrive V-Belt A45", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 148, mrp: 284, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a46", name: "Ecodrive V-Belt A46", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 151, mrp: 291, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a47", name: "Ecodrive V-Belt A47", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 153, mrp: 295, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a48", name: "Ecodrive V-Belt A48", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 154, mrp: 297, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a49", name: "Ecodrive V-Belt A49", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 155, mrp: 299, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a50", name: "Ecodrive V-Belt A50", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 158, mrp: 303, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a51", name: "Ecodrive V-Belt A51", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 162, mrp: 311, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a52", name: "Ecodrive V-Belt A52", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 162, mrp: 311, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a53", name: "Ecodrive V-Belt A53", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 163, mrp: 314, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a54", name: "Ecodrive V-Belt A54", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 164, mrp: 315, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a55", name: "Ecodrive V-Belt A55", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 165, mrp: 318, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a56", name: "Ecodrive V-Belt A56", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 166, mrp: 319, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a57", name: "Ecodrive V-Belt A57", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 166, mrp: 320, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a58", name: "Ecodrive V-Belt A58", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 169, mrp: 325, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a59", name: "Ecodrive V-Belt A59", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 170, mrp: 326, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a60", name: "Ecodrive V-Belt A60", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 173, mrp: 332, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a61", name: "Ecodrive V-Belt A61", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 174, mrp: 334, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a62", name: "Ecodrive V-Belt A62", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 175, mrp: 336, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a63", name: "Ecodrive V-Belt A63", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 176, mrp: 338, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a64", name: "Ecodrive V-Belt A64", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 177, mrp: 340, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a65", name: "Ecodrive V-Belt A65", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 185, mrp: 356, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a66", name: "Ecodrive V-Belt A66", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 196, mrp: 377, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a67", name: "Ecodrive V-Belt A67", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 197, mrp: 379, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a68", name: "Ecodrive V-Belt A68", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 198, mrp: 381, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a69", name: "Ecodrive V-Belt A69", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 199, mrp: 383, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a70", name: "Ecodrive V-Belt A70", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 200, mrp: 385, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a71", name: "Ecodrive V-Belt A71", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 204, mrp: 392, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a72", name: "Ecodrive V-Belt A72", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 205, mrp: 394, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a73", name: "Ecodrive V-Belt A73", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 208, mrp: 400, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a74", name: "Ecodrive V-Belt A74", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 210, mrp: 404, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a75", name: "Ecodrive V-Belt A75", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 212, mrp: 407, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a76", name: "Ecodrive V-Belt A76", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 217, mrp: 417, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a77", name: "Ecodrive V-Belt A77", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 219, mrp: 421, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a78", name: "Ecodrive V-Belt A78", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 221, mrp: 425, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a79", name: "Ecodrive V-Belt A79", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 224, mrp: 431, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a80", name: "Ecodrive V-Belt A80", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 228, mrp: 439, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a81", name: "Ecodrive V-Belt A81", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 229, mrp: 440, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a82", name: "Ecodrive V-Belt A82", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 230, mrp: 443, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a83", name: "Ecodrive V-Belt A83", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 232, mrp: 447, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a84", name: "Ecodrive V-Belt A84", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 236, mrp: 453, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a85", name: "Ecodrive V-Belt A85", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 238, mrp: 457, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a86", name: "Ecodrive V-Belt A86", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 241, mrp: 464, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a87", name: "Ecodrive V-Belt A87", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 244, mrp: 469, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a88", name: "Ecodrive V-Belt A88", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 248, mrp: 476, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a89", name: "Ecodrive V-Belt A89", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 252, mrp: 484, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a90", name: "Ecodrive V-Belt A90", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 255, mrp: 490, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a91", name: "Ecodrive V-Belt A91", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 266, mrp: 511, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a92", name: "Ecodrive V-Belt A92", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 270, mrp: 520, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a93", name: "Ecodrive V-Belt A93", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 274, mrp: 526, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a94", name: "Ecodrive V-Belt A94", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 278, mrp: 534, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a95", name: "Ecodrive V-Belt A95", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 281, mrp: 541, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a96", name: "Ecodrive V-Belt A96", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 287, mrp: 551, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a97", name: "Ecodrive V-Belt A97", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 292, mrp: 561, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a97-5", name: "Ecodrive V-Belt A97.5", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 295, mrp: 568, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-a98", name: "Ecodrive V-Belt A98", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 299, mrp: 575, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a99", name: "Ecodrive V-Belt A99", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 301, mrp: 578, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a100", name: "Ecodrive V-Belt A100", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 310, mrp: 596, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a101", name: "Ecodrive V-Belt A101", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 311, mrp: 599, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a102", name: "Ecodrive V-Belt A102", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 313, mrp: 602, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a103", name: "Ecodrive V-Belt A103", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 317, mrp: 609, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a104", name: "Ecodrive V-Belt A104", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 320, mrp: 615, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a105", name: "Ecodrive V-Belt A105", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 325, mrp: 625, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a106", name: "Ecodrive V-Belt A106", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 328, mrp: 631, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a107", name: "Ecodrive V-Belt A107", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 332, mrp: 639, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a108", name: "Ecodrive V-Belt A108", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 334, mrp: 642, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a109", name: "Ecodrive V-Belt A109", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 335, mrp: 644, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a110", name: "Ecodrive V-Belt A110", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 342, mrp: 657, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a111", name: "Ecodrive V-Belt A111", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 343, mrp: 659, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a112", name: "Ecodrive V-Belt A112", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 347, mrp: 667, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a113", name: "Ecodrive V-Belt A113", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 353, mrp: 678, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a114", name: "Ecodrive V-Belt A114", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 357, mrp: 687, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a115", name: "Ecodrive V-Belt A115", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 358, mrp: 689, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a116", name: "Ecodrive V-Belt A116", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 362, mrp: 696, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a117", name: "Ecodrive V-Belt A117", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 365, mrp: 701, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a118", name: "Ecodrive V-Belt A118", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 368, mrp: 707, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a119", name: "Ecodrive V-Belt A119", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 370, mrp: 712, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a120", name: "Ecodrive V-Belt A120", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 373, mrp: 718, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a121", name: "Ecodrive V-Belt A121", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 383, mrp: 736, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a122", name: "Ecodrive V-Belt A122", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 387, mrp: 744, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a123", name: "Ecodrive V-Belt A123", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 389, mrp: 748, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a124", name: "Ecodrive V-Belt A124", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 395, mrp: 760, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a125", name: "Ecodrive V-Belt A125", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 396, mrp: 762, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a126", name: "Ecodrive V-Belt A126", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 398, mrp: 766, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a127", name: "Ecodrive V-Belt A127", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 400, mrp: 769, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a128", name: "Ecodrive V-Belt A128", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 405, mrp: 779, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a129", name: "Ecodrive V-Belt A129", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 408, mrp: 784, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a130", name: "Ecodrive V-Belt A130", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 411, mrp: 791, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a131", name: "Ecodrive V-Belt A131", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 412, mrp: 793, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a132", name: "Ecodrive V-Belt A132", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 417, mrp: 801, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a133", name: "Ecodrive V-Belt A133", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 420, mrp: 807, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a134", name: "Ecodrive V-Belt A134", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 425, mrp: 817, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a135", name: "Ecodrive V-Belt A135", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 427, mrp: 822, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a136", name: "Ecodrive V-Belt A136", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 428, mrp: 824, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a137", name: "Ecodrive V-Belt A137", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 435, mrp: 836, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a138", name: "Ecodrive V-Belt A138", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 436, mrp: 839, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a139", name: "Ecodrive V-Belt A139", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 439, mrp: 844, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a140", name: "Ecodrive V-Belt A140", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 440, mrp: 846, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a141", name: "Ecodrive V-Belt A141", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 445, mrp: 855, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a142", name: "Ecodrive V-Belt A142", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 449, mrp: 863, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a143", name: "Ecodrive V-Belt A143", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 454, mrp: 874, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a144", name: "Ecodrive V-Belt A144", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 456, mrp: 876, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a145", name: "Ecodrive V-Belt A145", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 459, mrp: 882, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a146", name: "Ecodrive V-Belt A146", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 461, mrp: 886, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a147", name: "Ecodrive V-Belt A147", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 467, mrp: 898, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a148", name: "Ecodrive V-Belt A148", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 470, mrp: 904, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a149", name: "Ecodrive V-Belt A149", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 471, mrp: 906, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a150", name: "Ecodrive V-Belt A150", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 475, mrp: 914, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a152", name: "Ecodrive V-Belt A152", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 484, mrp: 930, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a154", name: "Ecodrive V-Belt A154", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 489, mrp: 941, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a156", name: "Ecodrive V-Belt A156", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 495, mrp: 951, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a158", name: "Ecodrive V-Belt A158", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 502, mrp: 966, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a160", name: "Ecodrive V-Belt A160", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 506, mrp: 973, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a162", name: "Ecodrive V-Belt A162", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 511, mrp: 983, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a164", name: "Ecodrive V-Belt A164", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 516, mrp: 992, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a165", name: "Ecodrive V-Belt A165", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 517, mrp: 994, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a166", name: "Ecodrive V-Belt A166", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 519, mrp: 998, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a168", name: "Ecodrive V-Belt A168", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 523, mrp: 1006, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a170", name: "Ecodrive V-Belt A170", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 526, mrp: 1011, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a172", name: "Ecodrive V-Belt A172", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 528, mrp: 1015, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a173", name: "Ecodrive V-Belt A173", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 529, mrp: 1017, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a174", name: "Ecodrive V-Belt A174", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 530, mrp: 1020, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a175", name: "Ecodrive V-Belt A175", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 534, mrp: 1026, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a178", name: "Ecodrive V-Belt A178", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 535, mrp: 1028, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a180", name: "Ecodrive V-Belt A180", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 545, mrp: 1048, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a185", name: "Ecodrive V-Belt A185", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 558, mrp: 1073, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a190", name: "Ecodrive V-Belt A190", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 574, mrp: 1103, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-a195", name: "Ecodrive V-Belt A195", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 588, mrp: 1130, img: "⚙️", image: ECODRIVE_IMG_A_NEW },
  { id: "ed-b20", name: "Ecodrive V-Belt B20", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 125, mrp: 241, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b21", name: "Ecodrive V-Belt B21", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 126, mrp: 243, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b22", name: "Ecodrive V-Belt B22", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 127, mrp: 244, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b23", name: "Ecodrive V-Belt B23", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 127, mrp: 245, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b24", name: "Ecodrive V-Belt B24", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 129, mrp: 248, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b25", name: "Ecodrive V-Belt B25", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 131, mrp: 251, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b26", name: "Ecodrive V-Belt B26", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 132, mrp: 254, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b27", name: "Ecodrive V-Belt B27", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 135, mrp: 259, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b28", name: "Ecodrive V-Belt B28", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 136, mrp: 261, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b29", name: "Ecodrive V-Belt B29", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 139, mrp: 268, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b29-5", name: "Ecodrive V-Belt B29.5", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 140, mrp: 270, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b30", name: "Ecodrive V-Belt B30", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 141, mrp: 271, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b31", name: "Ecodrive V-Belt B31", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 145, mrp: 278, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b32", name: "Ecodrive V-Belt B32", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 148, mrp: 285, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b33", name: "Ecodrive V-Belt B33", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 150, mrp: 289, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b34", name: "Ecodrive V-Belt B34", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 154, mrp: 296, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b35", name: "Ecodrive V-Belt B35", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 157, mrp: 301, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b36", name: "Ecodrive V-Belt B36", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 157, mrp: 302, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b37", name: "Ecodrive V-Belt B37", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 158, mrp: 303, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b38", name: "Ecodrive V-Belt B38", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 158, mrp: 304, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b39", name: "Ecodrive V-Belt B39", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 161, mrp: 309, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b40", name: "Ecodrive V-Belt B40", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 162, mrp: 312, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b41", name: "Ecodrive V-Belt B41", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 168, mrp: 324, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b42", name: "Ecodrive V-Belt B42", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 170, mrp: 326, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b43", name: "Ecodrive V-Belt B43", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 173, mrp: 332, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b44", name: "Ecodrive V-Belt B44", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 177, mrp: 340, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b45", name: "Ecodrive V-Belt B45", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 178, mrp: 342, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b46", name: "Ecodrive V-Belt B46", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 180, mrp: 347, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b47", name: "Ecodrive V-Belt B47", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 184, mrp: 353, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b48", name: "Ecodrive V-Belt B48", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 187, mrp: 360, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b48-5", name: "Ecodrive V-Belt B48.5", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 189, mrp: 363, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b49", name: "Ecodrive V-Belt B49", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 190, mrp: 366, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b50", name: "Ecodrive V-Belt B50", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 192, mrp: 369, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b51", name: "Ecodrive V-Belt B51", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 199, mrp: 383, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b52", name: "Ecodrive V-Belt B52", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 200, mrp: 385, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b53", name: "Ecodrive V-Belt B53", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 204, mrp: 392, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b54", name: "Ecodrive V-Belt B54", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 205, mrp: 394, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b55", name: "Ecodrive V-Belt B55", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 208, mrp: 400, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b56", name: "Ecodrive V-Belt B56", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 212, mrp: 408, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b57", name: "Ecodrive V-Belt B57", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 213, mrp: 410, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b58", name: "Ecodrive V-Belt B58", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 214, mrp: 412, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b59", name: "Ecodrive V-Belt B59", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 218, mrp: 419, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b60", name: "Ecodrive V-Belt B60", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 221, mrp: 425, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b61", name: "Ecodrive V-Belt B61", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 226, mrp: 434, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b62", name: "Ecodrive V-Belt B62", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 230, mrp: 443, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b63", name: "Ecodrive V-Belt B63", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 232, mrp: 447, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b64", name: "Ecodrive V-Belt B64", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 234, mrp: 450, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b65", name: "Ecodrive V-Belt B65", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 253, mrp: 486, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b66", name: "Ecodrive V-Belt B66", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 260, mrp: 500, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b66-5", name: "Ecodrive V-Belt B66.5", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 261, mrp: 502, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b67", name: "Ecodrive V-Belt B67", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 261, mrp: 502, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b68", name: "Ecodrive V-Belt B68", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 262, mrp: 504, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b69", name: "Ecodrive V-Belt B69", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 265, mrp: 509, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b70", name: "Ecodrive V-Belt B70", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 266, mrp: 511, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b71", name: "Ecodrive V-Belt B71", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 275, mrp: 528, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b72", name: "Ecodrive V-Belt B72", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 276, mrp: 531, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b73", name: "Ecodrive V-Belt B73", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 278, mrp: 534, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b74", name: "Ecodrive V-Belt B74", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 280, mrp: 538, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b75", name: "Ecodrive V-Belt B75", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 283, mrp: 545, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b76", name: "Ecodrive V-Belt B76", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 285, mrp: 549, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b77", name: "Ecodrive V-Belt B77", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 289, mrp: 556, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-b78", name: "Ecodrive V-Belt B78", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 294, mrp: 565, img: "⚙️", image: ECODRIVE_IMG_B },
  { id: "ed-c36", name: "Ecodrive V-Belt C36", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 241, mrp: 463, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c37", name: "Ecodrive V-Belt C37", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 242, mrp: 465, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c38", name: "Ecodrive V-Belt C38", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 243, mrp: 467, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c39", name: "Ecodrive V-Belt C39", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 245, mrp: 472, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c40", name: "Ecodrive V-Belt C40", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 246, mrp: 473, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c174", name: "Ecodrive V-Belt C174", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1027, mrp: 1975, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c175", name: "Ecodrive V-Belt C175", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1030, mrp: 1981, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c176", name: "Ecodrive V-Belt C176", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1035, mrp: 1991, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c177", name: "Ecodrive V-Belt C177", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1043, mrp: 2006, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c178", name: "Ecodrive V-Belt C178", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1047, mrp: 2013, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c179", name: "Ecodrive V-Belt C179", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1051, mrp: 2022, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c180", name: "Ecodrive V-Belt C180", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1058, mrp: 2035, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c181", name: "Ecodrive V-Belt C181", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1064, mrp: 2046, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c182", name: "Ecodrive V-Belt C182", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1070, mrp: 2057, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c183", name: "Ecodrive V-Belt C183", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1074, mrp: 2066, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c184", name: "Ecodrive V-Belt C184", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1080, mrp: 2077, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c185", name: "Ecodrive V-Belt C185", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1096, mrp: 2107, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c186", name: "Ecodrive V-Belt C186", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1101, mrp: 2118, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c187", name: "Ecodrive V-Belt C187", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1107, mrp: 2129, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c188", name: "Ecodrive V-Belt C188", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1115, mrp: 2145, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c189", name: "Ecodrive V-Belt C189", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1122, mrp: 2157, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c190", name: "Ecodrive V-Belt C190", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1137, mrp: 2187, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c191", name: "Ecodrive V-Belt C191", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1142, mrp: 2196, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c192", name: "Ecodrive V-Belt C192", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1145, mrp: 2201, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c193", name: "Ecodrive V-Belt C193", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1153, mrp: 2217, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c194", name: "Ecodrive V-Belt C194", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1160, mrp: 2230, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c195", name: "Ecodrive V-Belt C195", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1168, mrp: 2246, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c196", name: "Ecodrive V-Belt C196", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1171, mrp: 2251, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c197", name: "Ecodrive V-Belt C197", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1177, mrp: 2263, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c198", name: "Ecodrive V-Belt C198", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1183, mrp: 2275, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c199", name: "Ecodrive V-Belt C199", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1185, mrp: 2279, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c200", name: "Ecodrive V-Belt C200", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1192, mrp: 2293, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c201", name: "Ecodrive V-Belt C201", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1200, mrp: 2308, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c202", name: "Ecodrive V-Belt C202", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1206, mrp: 2320, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c203", name: "Ecodrive V-Belt C203", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1211, mrp: 2329, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c204", name: "Ecodrive V-Belt C204", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1214, mrp: 2334, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c205", name: "Ecodrive V-Belt C205", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1217, mrp: 2340, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c206", name: "Ecodrive V-Belt C206", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1224, mrp: 2354, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c207", name: "Ecodrive V-Belt C207", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1230, mrp: 2365, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c208", name: "Ecodrive V-Belt C208", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1232, mrp: 2369, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c209", name: "Ecodrive V-Belt C209", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1238, mrp: 2381, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "ed-c210", name: "Ecodrive V-Belt C210", category: "Belt", subcategory: "V Belt", brand: "Ecodrive", sellerId: "sel-bm", price: 1241, mrp: 2386, img: "⚙️", image: ECODRIVE_IMG_C },
  { id: "wsh-01", name: "Plain Washer 1/4 x 1/2 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.234, mrp: 0.26, img: "🪛", image: WASHER_IMG },
  { id: "wsh-02", name: "Plain Washer 1/4 x 5/8 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.405, mrp: 0.45, img: "🪛", image: WASHER_IMG },
  { id: "wsh-03", name: "Plain Washer 1/4 x 3/4 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.558, mrp: 0.62, img: "🪛", image: WASHER_IMG },
  { id: "wsh-04", name: "Plain Washer 5/16 x 5/8 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.378, mrp: 0.42, img: "🪛", image: WASHER_IMG },
  { id: "wsh-05", name: "Plain Washer 5/16 x 3/4 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.558, mrp: 0.62, img: "🪛", image: WASHER_IMG },
  { id: "wsh-06", name: "Plain Washer 3/8 x 3/4 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.54, mrp: 0.6, img: "🪛", image: WASHER_IMG },
  { id: "wsh-07", name: "Plain Washer 3/8 x 5/8 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.423, mrp: 0.47, img: "🪛", image: WASHER_IMG },
  { id: "wsh-08", name: "Plain Washer 1/2 x 1 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 0.936, mrp: 1.04, img: "🪛", image: WASHER_IMG },
  { id: "wsh-09", name: "Plain Washer 1/2 x 1 1/4 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 1.62, mrp: 1.8, img: "🪛", image: WASHER_IMG },
  { id: "wsh-10", name: "Plain Washer 5/8 x 1 1/4 Zinc Plated 16G", category: "Nut Bolt N Washer", subcategory: "Washer", price: 1.35, mrp: 1.5, img: "🪛", image: WASHER_IMG },
  { id: "pf-pc-4x1-8", name: "Male Connector 4x1/8mm", category: "Pneumatic Fittings", price: 14, mrp: 19, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-4x1-8", name: "Male Elbow 4x1/8mm", category: "Pneumatic Fittings", price: 27, mrp: 36, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-4x1-8", name: "Flow Control 4x1/8mm", category: "Pneumatic Fittings", price: 75, mrp: 100, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-4x1-8", name: "Female Connector 4x1/8mm", category: "Pneumatic Fittings", price: 30, mrp: 40, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-4x1-4", name: "Male Connector 4x1/4mm", category: "Pneumatic Fittings", price: 23, mrp: 31, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-4x1-4", name: "Male Elbow 4x1/4mm", category: "Pneumatic Fittings", price: 34, mrp: 45, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-4x1-4", name: "Flow Control 4x1/4mm", category: "Pneumatic Fittings", price: 105, mrp: 140, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-4x1-4", name: "Female Connector 4x1/4mm", category: "Pneumatic Fittings", price: 41, mrp: 55, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-4x3-8", name: "Male Connector 4x3/8mm", category: "Pneumatic Fittings", price: 39, mrp: 52, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-4x3-8", name: "Male Elbow 4x3/8mm", category: "Pneumatic Fittings", price: 56, mrp: 74, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-4x3-8", name: "Flow Control 4x3/8mm", category: "Pneumatic Fittings", price: 165, mrp: 220, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-4x3-8", name: "Female Connector 4x3/8mm", category: "Pneumatic Fittings", price: 60, mrp: 80, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-4x1-2", name: "Male Connector 4x1/2mm", category: "Pneumatic Fittings", price: 60, mrp: 80, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-4x1-2", name: "Male Elbow 4x1/2mm", category: "Pneumatic Fittings", price: 72, mrp: 96, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-4x1-2", name: "Flow Control 4x1/2mm", category: "Pneumatic Fittings", price: 210, mrp: 280, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-4x1-2", name: "Female Connector 4x1/2mm", category: "Pneumatic Fittings", price: 98, mrp: 130, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-6x1-8", name: "Male Connector 6x1/8mm", category: "Pneumatic Fittings", price: 16, mrp: 21, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-6x1-8", name: "Male Elbow 6x1/8mm", category: "Pneumatic Fittings", price: 28, mrp: 38, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-6x1-8", name: "Flow Control 6x1/8mm", category: "Pneumatic Fittings", price: 71, mrp: 95, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-6x1-8", name: "Female Connector 6x1/8mm", category: "Pneumatic Fittings", price: 26, mrp: 34, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-6x1-4", name: "Male Connector 6x1/4mm", category: "Pneumatic Fittings", price: 20, mrp: 27, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-6x1-4", name: "Male Elbow 6x1/4mm", category: "Pneumatic Fittings", price: 32, mrp: 42, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-6x1-4", name: "Flow Control 6x1/4mm", category: "Pneumatic Fittings", price: 98, mrp: 130, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-6x1-4", name: "Female Connector 6x1/4mm", category: "Pneumatic Fittings", price: 41, mrp: 55, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-6x3-8", name: "Male Connector 6x3/8mm", category: "Pneumatic Fittings", price: 34, mrp: 45, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-6x3-8", name: "Male Elbow 6x3/8mm", category: "Pneumatic Fittings", price: 46, mrp: 62, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-6x3-8", name: "Flow Control 6x3/8mm", category: "Pneumatic Fittings", price: 154, mrp: 205, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-6x3-8", name: "Female Connector 6x3/8mm", category: "Pneumatic Fittings", price: 48, mrp: 64, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-6x1-2", name: "Male Connector 6x1/2mm", category: "Pneumatic Fittings", price: 64, mrp: 85, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-6x1-2", name: "Male Elbow 6x1/2mm", category: "Pneumatic Fittings", price: 70, mrp: 94, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-6x1-2", name: "Flow Control 6x1/2mm", category: "Pneumatic Fittings", price: 206, mrp: 275, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-6x1-2", name: "Female Connector 6x1/2mm", category: "Pneumatic Fittings", price: 78, mrp: 104, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-8x1-8", name: "Male Connector 8x1/8mm", category: "Pneumatic Fittings", price: 18, mrp: 24, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-8x1-8", name: "Male Elbow 8x1/8mm", category: "Pneumatic Fittings", price: 32, mrp: 42, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-8x1-8", name: "Flow Control 8x1/8mm", category: "Pneumatic Fittings", price: 71, mrp: 95, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-8x1-8", name: "Female Connector 8x1/8mm", category: "Pneumatic Fittings", price: 34, mrp: 45, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-8x1-4", name: "Male Connector 8x1/4mm", category: "Pneumatic Fittings", price: 18, mrp: 24, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-8x1-4", name: "Male Elbow 8x1/4mm", category: "Pneumatic Fittings", price: 32, mrp: 43, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-8x1-4", name: "Flow Control 8x1/4mm", category: "Pneumatic Fittings", price: 94, mrp: 125, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-8x1-4", name: "Female Connector 8x1/4mm", category: "Pneumatic Fittings", price: 41, mrp: 55, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-8x3-8", name: "Male Connector 8x3/8mm", category: "Pneumatic Fittings", price: 32, mrp: 42, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-8x3-8", name: "Male Elbow 8x3/8mm", category: "Pneumatic Fittings", price: 44, mrp: 58, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-8x3-8", name: "Flow Control 8x3/8mm", category: "Pneumatic Fittings", price: 150, mrp: 200, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-8x3-8", name: "Female Connector 8x3/8mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-8x1-2", name: "Male Connector 8x1/2mm", category: "Pneumatic Fittings", price: 51, mrp: 68, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-8x1-2", name: "Male Elbow 8x1/2mm", category: "Pneumatic Fittings", price: 68, mrp: 90, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-8x1-2", name: "Flow Control 8x1/2mm", category: "Pneumatic Fittings", price: 221, mrp: 295, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-8x1-2", name: "Female Connector 8x1/2mm", category: "Pneumatic Fittings", price: 78, mrp: 104, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-8x3-4", name: "Male Connector 8x3/4mm", category: "Pneumatic Fittings", price: 188, mrp: 250, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pc-10x1-8", name: "Male Connector 10x1/8mm", category: "Pneumatic Fittings", price: 28, mrp: 38, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-10x1-8", name: "Male Elbow 10x1/8mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-10x1-8", name: "Flow Control 10x1/8mm", category: "Pneumatic Fittings", price: 105, mrp: 140, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-10x1-8", name: "Female Connector 10x1/8mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-10x1-4", name: "Male Connector 10x1/4mm", category: "Pneumatic Fittings", price: 28, mrp: 38, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-10x1-4", name: "Male Elbow 10x1/4mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-10x1-4", name: "Flow Control 10x1/4mm", category: "Pneumatic Fittings", price: 112, mrp: 150, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-10x1-4", name: "Female Connector 10x1/4mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-10x3-8", name: "Male Connector 10x3/8mm", category: "Pneumatic Fittings", price: 31, mrp: 41, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-10x3-8", name: "Male Elbow 10x3/8mm", category: "Pneumatic Fittings", price: 52, mrp: 70, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-10x3-8", name: "Flow Control 10x3/8mm", category: "Pneumatic Fittings", price: 161, mrp: 215, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-10x3-8", name: "Female Connector 10x3/8mm", category: "Pneumatic Fittings", price: 54, mrp: 72, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-10x1-2", name: "Male Connector 10x1/2mm", category: "Pneumatic Fittings", price: 48, mrp: 64, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-10x1-2", name: "Male Elbow 10x1/2mm", category: "Pneumatic Fittings", price: 70, mrp: 94, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-10x1-2", name: "Flow Control 10x1/2mm", category: "Pneumatic Fittings", price: 206, mrp: 275, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-10x1-2", name: "Female Connector 10x1/2mm", category: "Pneumatic Fittings", price: 79, mrp: 105, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-10x3-4", name: "Male Connector 10x3/4mm", category: "Pneumatic Fittings", price: 180, mrp: 240, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pc-12x1-8", name: "Male Connector 12x1/8mm", category: "Pneumatic Fittings", price: 38, mrp: 50, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-12x1-8", name: "Male Elbow 12x1/8mm", category: "Pneumatic Fittings", price: 60, mrp: 80, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-12x1-8", name: "Flow Control 12x1/8mm", category: "Pneumatic Fittings", price: 124, mrp: 165, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-12x1-8", name: "Female Connector 12x1/8mm", category: "Pneumatic Fittings", price: 75, mrp: 100, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-12x1-4", name: "Male Connector 12x1/4mm", category: "Pneumatic Fittings", price: 38, mrp: 51, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-12x1-4", name: "Male Elbow 12x1/4mm", category: "Pneumatic Fittings", price: 60, mrp: 80, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-12x1-4", name: "Flow Control 12x1/4mm", category: "Pneumatic Fittings", price: 131, mrp: 175, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-12x1-4", name: "Female Connector 12x1/4mm", category: "Pneumatic Fittings", price: 79, mrp: 105, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-12x3-8", name: "Male Connector 12x3/8mm", category: "Pneumatic Fittings", price: 38, mrp: 51, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-12x3-8", name: "Male Elbow 12x3/8mm", category: "Pneumatic Fittings", price: 62, mrp: 82, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-12x3-8", name: "Flow Control 12x3/8mm", category: "Pneumatic Fittings", price: 150, mrp: 200, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-12x3-8", name: "Female Connector 12x3/8mm", category: "Pneumatic Fittings", price: 79, mrp: 105, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-12x1-2", name: "Male Connector 12x1/2mm", category: "Pneumatic Fittings", price: 46, mrp: 62, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-12x1-2", name: "Male Elbow 12x1/2mm", category: "Pneumatic Fittings", price: 68, mrp: 90, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-12x1-2", name: "Flow Control 12x1/2mm", category: "Pneumatic Fittings", price: 206, mrp: 275, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-12x1-2", name: "Female Connector 12x1/2mm", category: "Pneumatic Fittings", price: 86, mrp: 115, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-12x3-4", name: "Male Connector 12x3/4mm", category: "Pneumatic Fittings", price: 180, mrp: 240, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pc-14x1-4", name: "Male Connector 14x1/4mm", category: "Pneumatic Fittings", price: 101, mrp: 135, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-14x1-4", name: "Male Elbow 14x1/4mm", category: "Pneumatic Fittings", price: 128, mrp: 170, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-pcf-14x1-4", name: "Female Connector 14x1/4mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-14x3-8", name: "Male Connector 14x3/8mm", category: "Pneumatic Fittings", price: 101, mrp: 135, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-14x3-8", name: "Male Elbow 14x3/8mm", category: "Pneumatic Fittings", price: 128, mrp: 170, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-pcf-14x3-8", name: "Female Connector 14x3/8mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-14x1-2", name: "Male Connector 14x1/2mm", category: "Pneumatic Fittings", price: 101, mrp: 135, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-14x1-2", name: "Male Elbow 14x1/2mm", category: "Pneumatic Fittings", price: 128, mrp: 170, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-14x1-2", name: "Flow Control 14x1/2mm", category: "Pneumatic Fittings", price: 375, mrp: 500, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-14x1-2", name: "Female Connector 14x1/2mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-14x3-4", name: "Male Connector 14x3/4mm", category: "Pneumatic Fittings", price: 210, mrp: 280, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pc-16x1-4", name: "Male Connector 16x1/4mm", category: "Pneumatic Fittings", price: 98, mrp: 130, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-16x1-4", name: "Male Elbow 16x1/4mm", category: "Pneumatic Fittings", price: 128, mrp: 170, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-16x1-4", name: "Flow Control 16x1/4mm", category: "Pneumatic Fittings", price: 262, mrp: 350, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-16x1-4", name: "Female Connector 16x1/4mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-16x3-8", name: "Male Connector 16x3/8mm", category: "Pneumatic Fittings", price: 98, mrp: 130, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-16x3-8", name: "Male Elbow 16x3/8mm", category: "Pneumatic Fittings", price: 128, mrp: 170, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-16x3-8", name: "Flow Control 16x3/8mm", category: "Pneumatic Fittings", price: 352, mrp: 470, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-16x3-8", name: "Female Connector 16x3/8mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-16x1-2", name: "Male Connector 16x1/2mm", category: "Pneumatic Fittings", price: 101, mrp: 135, img: "🔩", image: FITTING_IMG_PC },
  { id: "pf-pl-16x1-2", name: "Male Elbow 16x1/2mm", category: "Pneumatic Fittings", price: 120, mrp: 160, img: "🔩", image: FITTING_IMG_PL },
  { id: "pf-nse-16x1-2", name: "Flow Control 16x1/2mm", category: "Pneumatic Fittings", price: 405, mrp: 540, img: "🔩", image: FITTING_IMG_NSE },
  { id: "pf-pcf-16x1-2", name: "Female Connector 16x1/2mm", category: "Pneumatic Fittings", price: 202, mrp: 270, img: "🔩", image: FITTING_IMG_PCF },
  { id: "pf-pc-16x3-4", name: "Male Connector 16x3/4mm", category: "Pneumatic Fittings", price: 210, mrp: 280, img: "🔩", image: FITTING_IMG_PC },
  { id: "mp-anabond666", name: "Anabond 666 100Gms", category: "Maintenance Products", price: 165, img: "🧴", image: ANABOND_IMG },
  { id: "mp-wd40-400ml", name: "WD-40 400ML", category: "Maintenance Products", price: 353, img: "🧴", image: WD40_IMG },
  { id: "mp-scotchbrite-handpad", name: "Scotch-Brite Hand Pad", category: "Maintenance Products", price: 27, img: "🧽", image: SCOTCHBRITE_IMG },
  { id: "ht1", name: "Adjustable Spanner 205mm - Taparia 1171", category: "Handtools", subcategory: "Taparia", price: 236, img: "🔧", image: I.i75 },
  { id: "ht2", name: "Combination Pliers 165mm - Taparia 1621-6", category: "Handtools", subcategory: "Taparia", price: 188, img: "🔧", image: I.i76 },
  { id: "ht3", name: "Long Nose Pliers 165mm - Taparia 1430-6", category: "Handtools", subcategory: "Taparia", price: 193, img: "🔧" },
  { id: "ht4", name: "Water Pump Pliers 250mm - Taparia WPB10", category: "Handtools", subcategory: "Taparia", price: 292, img: "🔧" },
  { id: "ht5", name: "Locking Pliers 175mm - Taparia 1641-7", category: "Handtools", subcategory: "Taparia", price: 334, img: "🔧" },
  { id: "ht6", name: "Screwdriver Set 8pcs - Taparia 1013", category: "Handtools", subcategory: "Taparia", price: 448, img: "🪛", image: I.i77 },
  { id: "ht7", name: "Flat Screwdriver 150mm - Taparia 712", category: "Handtools", subcategory: "Taparia", price: 34, img: "🪛", image: I.i78 },
  { id: "ht8", name: "Phillips Screwdriver 150mm - Taparia P6 862150", category: "Handtools", subcategory: "Taparia", price: 66, img: "🪛", image: I.i79 },
  { id: "ht9", name: "VDE Combination Pliers 200mm", category: "Handtools", subcategory: "Taparia", price: 1394, img: "🔧" },
  { id: "ht10", name: "Socket Set 1/4\" Dr - 17pcs (S 1/4 H)", category: "Handtools", subcategory: "Taparia", price: 1635, img: "🧰" },
  { id: "ht11", name: "Socket Set 3/8\" Dr - 14pcs (S 3/8 H)", category: "Handtools", subcategory: "Taparia", price: 2335, img: "🧰" },
  { id: "ht12", name: "Torque Wrench 1/2\" - Taparia TW100", category: "Handtools", subcategory: "Taparia", price: 3073, img: "🔧" },
  { id: "ht13", name: "Pipe Wrench 250mm - Taparia 1272", category: "Handtools", subcategory: "Taparia", price: 206, img: "🔧" },
  { id: "ht14", name: "Heavy Duty Pipe Wrench 350mm - HPW14", category: "Handtools", subcategory: "Taparia", price: 728, img: "🔧" },
  { id: "ht15", name: "Claw Hammer 340g - Taparia CH340", category: "Handtools", subcategory: "Taparia", price: 254, img: "🔨" },
  { id: "ht16", name: "Ball Pein Hammer 340g - WH340 B/C", category: "Handtools", subcategory: "Taparia", price: 211, img: "🔨" },
  { id: "ht17", name: "Sledge Hammer 1800g with Handle", category: "Handtools", subcategory: "Taparia", price: 1032, img: "🔨" },
  { id: "ht18", name: "C-Clamp 105mm - Taparia 1261-4", category: "Handtools", subcategory: "Taparia", price: 413, img: "🔧" },
  { id: "ht19", name: "F-Clamp 200mm - Taparia FC15-200", category: "Handtools", subcategory: "Taparia", price: 536, img: "🔧" },
  { id: "ht20", name: "L Spanner Set 9pcs - Taparia AKI-10", category: "Handtools", subcategory: "Taparia", price: 210, img: "🔧", image: I.i80 },
  { id: "ht21", name: "Allen Key Set 10pcs (Black) - KI-10V", category: "Handtools", subcategory: "Taparia", price: 168, img: "🔧" },
  { id: "ht22", name: "Double Ended Spanner Set - DEP08", category: "Handtools", subcategory: "Taparia", price: 256, img: "🔧", image: I.i81 },
  { id: "ht23", name: "Ring Spanner Set 8pcs - 1808", category: "Handtools", subcategory: "Taparia", price: 578, img: "🔧", image: I.i82 },
  { id: "ht24", name: "Combination Spanner Set 12pcs - CSS12", category: "Handtools", subcategory: "Taparia", price: 448, img: "🔧", image: I.i83 },
  { id: "ht25", name: "Slogging Open End Spanner - SSO27", category: "Handtools", subcategory: "Taparia", price: 344, img: "🔧", image: I.i84 },
  { id: "ht26", name: "Bolt Cutter 450mm - Taparia BC-18", category: "Handtools", subcategory: "Taparia", price: 851, img: "✂️" },
  { id: "ht27", name: "Cable Cutter 240mm - Taparia CC10", category: "Handtools", subcategory: "Taparia", price: 423, img: "✂️" },
  { id: "ht28", name: "Aviation Tin Cutter - Taparia ATS10", category: "Handtools", subcategory: "Taparia", price: 462, img: "✂️" },
  { id: "ht29", name: "Hacksaw Frame 12\" - Taparia HFSA12", category: "Handtools", subcategory: "Taparia", price: 294, img: "🔧" },
  { id: "ht30", name: "Hacksaw Blades 10pcs - HBHC1218", category: "Handtools", subcategory: "Taparia", price: 8, img: "🔧" },
  { id: "ht31", name: "Flat Chisel 200mm - Taparia 1048", category: "Handtools", subcategory: "Taparia", price: 131, img: "🔧" },
  { id: "ht32", name: "Center Punch 125mm - Taparia 1985", category: "Handtools", subcategory: "Taparia", price: 46, img: "🔧" },
  { id: "ht33", name: "Utility Knife - Taparia UK-3", category: "Handtools", subcategory: "Taparia", price: 175, img: "🔪" },
  { id: "ht34", name: "Bearing Puller 4 Legs - BP304", category: "Handtools", subcategory: "Taparia", price: 384, img: "🔧" },
  { id: "ht35", name: "Flat File Bastard 250mm - FL2501", category: "Handtools", subcategory: "Taparia", price: 129, img: "🔧" },
  { id: "ht36", name: "Spirit Level 500mm - SL1020", category: "Handtools", subcategory: "Taparia", price: 364, img: "📏" },
  { id: "ht37", name: "Bench Vice 100mm - BVSGM04", category: "Handtools", subcategory: "Taparia", price: 2006, img: "🔧" },
  { id: "ht38", name: "Plastic Tool Box - Taparia PTB16", category: "Handtools", subcategory: "Taparia", price: 746, img: "🧰" },
  { id: "ht39", name: "Tools Trolley 5-Drawer - TTB5", category: "Handtools", subcategory: "Taparia", price: 26460, img: "🧰" },
  { id: "ht40", name: "Hydraulic Bottle Jack 2 Ton - HBJ2", category: "Handtools", subcategory: "Taparia", price: 994, img: "🔧" },
  { id: "ht41", name: "Grease Gun 300cc - GGL30C", category: "Handtools", subcategory: "Taparia", price: 352, img: "🔧" },
  { id: "ht42", name: "Hand Riveter - Taparia HR105", category: "Handtools", subcategory: "Taparia", price: 277, img: "🔧" },
  { id: "ht43", name: "Professional Tool Kit - Taparia 1022", category: "Handtools", subcategory: "Taparia", price: 1834, img: "🧰" },
  { id: "ht44", name: "Two Wheeler Tool Kit 24pcs - TWTK-1", category: "Handtools", subcategory: "Taparia", price: 6090, img: "🧰" },
  { id: "ht45", name: "Plumber Tool Kit 8pcs - PTK1", category: "Handtools", subcategory: "Taparia", price: 1715, img: "🧰" },
  { id: "ht46", name: "Wire Stripping Pliers - WS06", category: "Handtools", subcategory: "Taparia", price: 48, img: "🔧" },
  { id: "ht47", name: "Snap Off Cutter - Taparia SK-1", category: "Handtools", subcategory: "Taparia", price: 78, img: "✂️" },
  { id: "ht48", name: "PVC Pipe Cutter - Taparia PC42", category: "Handtools", subcategory: "Taparia", price: 303, img: "✂️" },
  { id: "ht49", name: "Magnetic Bar - MB6201", category: "Handtools", subcategory: "Taparia", price: 508, img: "🔧" },
  { id: "ht50", name: "Universal Tool Kit Set - Taparia 1001", category: "Handtools", subcategory: "Taparia", price: 690, img: "🧰" },
  { id: "ht50", name: "Universal Tool Kit Set - Taparia 1001", category: "Handtools", subcategory: "Taparia", price: 690, img: "🧰" },
  { id: "ht51", name: "Circlip Plier Internal 7\" - 1441-7C", category: "Handtools", subcategory: "Taparia", price: 217, img: "🔧" },
  { id: "ht52", name: "Insulated Screwdriver 150mm - 833 I", category: "Handtools", subcategory: "Taparia", price: 41, img: "🪛" },
  { id: "ht53", name: "Torx Screwdriver T-25 150mm - T-25L", category: "Handtools", subcategory: "Taparia", price: 56, img: "🪛" },
  { id: "ht54", name: "T-Handle Torx Key T25 - TT-25", category: "Handtools", subcategory: "Taparia", price: 57, img: "🔧" },
  { id: "ht55", name: "Screwdriver Bits Set 80pcs - BS 80", category: "Handtools", subcategory: "Taparia", price: 1582, img: "🧰" },
  { id: "ht56", name: "Crimping Tool - Taparia CTR16", category: "Handtools", subcategory: "Taparia", price: 651, img: "🔧" },
  { id: "ht57", name: "PVC Insulation Tape - IT17B", category: "Handtools", subcategory: "Taparia", price: 9, img: "🧻" },
  { id: "ht58", name: "Bit Driver Set - Taparia BDS125", category: "Handtools", subcategory: "Taparia", price: 196, img: "🧰" },
  { id: "ht59", name: "Impact Socket 19mm - IM19", category: "Handtools", subcategory: "Taparia", price: 77, img: "⚙️" },
  { id: "ht60", name: "Deep Socket 12mm (1/2\" Dr) - L12H", category: "Handtools", subcategory: "Taparia", price: 105, img: "⚙️" },
  { id: "ht61", name: "T Socket Wrench 10mm - TSW10", category: "Handtools", subcategory: "Taparia", price: 134, img: "🔧" },
  { id: "ht62", name: "Chain Pipe Wrench 900mm - CPW04", category: "Handtools", subcategory: "Taparia", price: 3066, img: "🔗" },
  { id: "ht63", name: "Aluminum Handle Pipe Wrench 450mm - APW18", category: "Handtools", subcategory: "Taparia", price: 2364, img: "🔧" },
  { id: "ht64", name: "Torque Wrench Ratchet 1/2\" - TPWR100", category: "Handtools", subcategory: "Taparia", price: 3584, img: "🔧" },
  { id: "ht65", name: "L Spanner with Jack Hole 19mm - 1536 H", category: "Handtools", subcategory: "Taparia", price: 148, img: "🔧", image: I.i85 },
  { id: "ht66", name: "Half Moon Spanner 14x15 - HM1415", category: "Handtools", subcategory: "Taparia", price: 150, img: "🔧", image: I.i86 },
  { id: "ht67", name: "Gear Wrench Combination Spanner 12mm - GWCS12", category: "Handtools", subcategory: "Taparia", price: 168, img: "🔧", image: I.i87 },
  { id: "ht68", name: "Combination Spanner Mirror Finish 33mm - CS33", category: "Handtools", subcategory: "Taparia", price: 574, img: "🔧", image: I.i88 },
  { id: "ht69", name: "Slogging Ring Spanner 32mm - SSR32", category: "Handtools", subcategory: "Taparia", price: 433, img: "🔧", image: I.i89 },
  { id: "ht70", name: "SDS Chisel Pointed 250mm - ECB14250", category: "Handtools", subcategory: "Taparia", price: 112, img: "🔧" },
  { id: "ht71", name: "Drift, Center & Leather Punch Set - LPS12", category: "Handtools", subcategory: "Taparia", price: 949, img: "🧰" },
  { id: "ht72", name: "Wire Rope Cutter 450mm - WRC18", category: "Handtools", subcategory: "Taparia", price: 1173, img: "✂️" },
  { id: "ht73", name: "Fiberglass Handle Steel Axe 600g - FHSA600", category: "Handtools", subcategory: "Taparia", price: 333, img: "🪓" },
  { id: "ht74", name: "Pruning Shear 190mm - PS9", category: "Handtools", subcategory: "Taparia", price: 364, img: "✂️" },
  { id: "ht75", name: "Masonry Drill Bit Set 3pcs - MDS3", category: "Handtools", subcategory: "Taparia", price: 146, img: "🔩" },
  { id: "ht76", name: "Plus Hammer Drill Bit 10mm - HDF10160", category: "Handtools", subcategory: "Taparia", price: 58, img: "🔩" },
  { id: "ht77", name: "Bi-Metal Hole Saw 32mm - HSM32", category: "Handtools", subcategory: "Taparia", price: 246, img: "⚙️" },
  { id: "ht78", name: "Tungsten Carbide Tip Hole Saw 25mm - TCTHS25", category: "Handtools", subcategory: "Taparia", price: 182, img: "⚙️" },
  { id: "ht79", name: "Chalk Line Reel Set - CLRS", category: "Handtools", subcategory: "Taparia", price: 235, img: "📏" },
  { id: "ht80", name: "Cut Off Wheel 105mm (Gold) - COWG04", category: "Handtools", subcategory: "Taparia", price: 15, img: "🔘" },
  { id: "ht81", name: "Diamond Cutting Blade Segmented 110mm - DBS4", category: "Handtools", subcategory: "Taparia", price: 92, img: "💎" },
  { id: "ht82", name: "Abrasive Latex Paper 100 Grit - ALP100", category: "Handtools", subcategory: "Taparia", price: 12, img: "🧻" },
  { id: "ht83", name: "Velcro Disc 100 Grit - VDG58100", category: "Handtools", subcategory: "Taparia", price: 6, img: "🟤" },
  { id: "ht84", name: "Spring Divider 200mm - SD8", category: "Handtools", subcategory: "Taparia", price: 175, img: "🔧" },
  { id: "ht85", name: "Outside Caliper 200mm - CO8", category: "Handtools", subcategory: "Taparia", price: 175, img: "📐" },
  { id: "ht86", name: "Jack Plane 355mm - CJP5", category: "Handtools", subcategory: "Taparia", price: 949, img: "🪵" },
  { id: "ht87", name: "Block Plane 140mm - CBP102", category: "Handtools", subcategory: "Taparia", price: 300, img: "🪵" },
  { id: "ht88", name: "Spoke Shave - SPS151", category: "Handtools", subcategory: "Taparia", price: 316, img: "🪵" },
  { id: "ht89", name: "Beveled Edge Chisel 19mm - WCB19", category: "Handtools", subcategory: "Taparia", price: 148, img: "🔧" },
  { id: "ht90", name: "Wood Working Chisel Set 5pcs - WCBS5", category: "Handtools", subcategory: "Taparia", price: 854, img: "🧰" },
  { id: "ht91", name: "Bench Vice 125mm - BVSGM05", category: "Handtools", subcategory: "Taparia", price: 3427, img: "🔩" },
  { id: "ht92", name: "Jack Stand 3 Ton (Pair) - JS3", category: "Handtools", subcategory: "Taparia", price: 1833, img: "🔧" },
  { id: "ht93", name: "Tools Trolley 7-Drawer - TTB7", category: "Handtools", subcategory: "Taparia", price: 30450, img: "🧰" },
  { id: "ht94", name: "Cantilever Tool Box 5 Compartment - CTB1805", category: "Handtools", subcategory: "Taparia", price: 1757, img: "🧰" },
  { id: "ht95", name: "Universal Set - Taparia 1005", category: "Handtools", subcategory: "Taparia", price: 896, img: "🧰" },
  { id: "ht96", name: "Rotary Barrel Pump 90mm - RBP90", category: "Handtools", subcategory: "Taparia", price: 1190, img: "🛢️" },
  { id: "ht97", name: "Hand Oil Pump 1/2 Pint - OC12", category: "Handtools", subcategory: "Taparia", price: 79, img: "🛢️" },
  { id: "ht98", name: "Strap Filter Wrench - SFW12", category: "Handtools", subcategory: "Taparia", price: 578, img: "🔧" },
  { id: "ht99", name: "Non-Sparking Adjustable Spanner 150mm (BE-CU)", category: "Handtools", subcategory: "Taparia", price: 4827, img: "🔧", image: I.i90 },
  { id: "vb-a18", name: "PIX Classical V-Belt A18", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 120, mrp: 230, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a19", name: "PIX Classical V-Belt A19", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 121, mrp: 232, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a20", name: "PIX Classical V-Belt A20", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 122, mrp: 234, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a21", name: "PIX Classical V-Belt A21", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 124, mrp: 238, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a22", name: "PIX Classical V-Belt A22", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 124, mrp: 239, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a23", name: "PIX Classical V-Belt A23", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 125, mrp: 240, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a24", name: "PIX Classical V-Belt A24", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 127, mrp: 244, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a25", name: "PIX Classical V-Belt A25", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 127, mrp: 244, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a26", name: "PIX Classical V-Belt A26", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 130, mrp: 250, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a27", name: "PIX Classical V-Belt A27", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 131, mrp: 251, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a28", name: "PIX Classical V-Belt A28", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 134, mrp: 257, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a29", name: "PIX Classical V-Belt A29", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 134, mrp: 258, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a30", name: "PIX Classical V-Belt A30", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 135, mrp: 260, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a31", name: "PIX Classical V-Belt A31", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 145, mrp: 279, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a32", name: "PIX Classical V-Belt A32", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 148, mrp: 284, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a33", name: "PIX Classical V-Belt A33", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 151, mrp: 290, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a34", name: "PIX Classical V-Belt A34", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 153, mrp: 294, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a35", name: "PIX Classical V-Belt A35", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 159, mrp: 306, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a36", name: "PIX Classical V-Belt A36", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 164, mrp: 316, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a37", name: "PIX Classical V-Belt A37", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 166, mrp: 319, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a38", name: "PIX Classical V-Belt A38", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 167, mrp: 322, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a39", name: "PIX Classical V-Belt A39", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 170, mrp: 327, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a40", name: "PIX Classical V-Belt A40", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 173, mrp: 332, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a41", name: "PIX Classical V-Belt A41", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 173, mrp: 333, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a42", name: "PIX Classical V-Belt A42", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 177, mrp: 341, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a43", name: "PIX Classical V-Belt A43", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 181, mrp: 348, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a44", name: "PIX Classical V-Belt A44", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 186, mrp: 357, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a45", name: "PIX Classical V-Belt A45", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 187, mrp: 360, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a46", name: "PIX Classical V-Belt A46", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 191, mrp: 368, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a47", name: "PIX Classical V-Belt A47", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 193, mrp: 371, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a48", name: "PIX Classical V-Belt A48", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 197, mrp: 378, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a49", name: "PIX Classical V-Belt A49", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 200, mrp: 385, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a50", name: "PIX Classical V-Belt A50", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 203, mrp: 390, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a51", name: "PIX Classical V-Belt A51", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 204, mrp: 393, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a52", name: "PIX Classical V-Belt A52", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 207, mrp: 398, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a53", name: "PIX Classical V-Belt A53", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 207, mrp: 399, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a54", name: "PIX Classical V-Belt A54", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 209, mrp: 401, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a55", name: "PIX Classical V-Belt A55", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 209, mrp: 402, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a56", name: "PIX Classical V-Belt A56", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 213, mrp: 409, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a57", name: "PIX Classical V-Belt A57", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 216, mrp: 416, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a58", name: "PIX Classical V-Belt A58", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 219, mrp: 421, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a59", name: "PIX Classical V-Belt A59", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 221, mrp: 425, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a60", name: "PIX Classical V-Belt A60", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 224, mrp: 431, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a61", name: "PIX Classical V-Belt A61", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 229, mrp: 440, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a62", name: "PIX Classical V-Belt A62", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 231, mrp: 444, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a63", name: "PIX Classical V-Belt A63", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 233, mrp: 448, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a64", name: "PIX Classical V-Belt A64", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 236, mrp: 453, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a65", name: "PIX Classical V-Belt A65", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 253, mrp: 486, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a66", name: "PIX Classical V-Belt A66", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 264, mrp: 508, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a67", name: "PIX Classical V-Belt A67", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 265, mrp: 509, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a68", name: "PIX Classical V-Belt A68", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 270, mrp: 520, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a69", name: "PIX Classical V-Belt A69", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 272, mrp: 524, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a70", name: "PIX Classical V-Belt A70", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 275, mrp: 528, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a71", name: "PIX Classical V-Belt A71", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 278, mrp: 534, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a72", name: "PIX Classical V-Belt A72", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 279, mrp: 537, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a73", name: "PIX Classical V-Belt A73", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 281, mrp: 540, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a74", name: "PIX Classical V-Belt A74", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 287, mrp: 551, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a75", name: "PIX Classical V-Belt A75", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 288, mrp: 554, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a76", name: "PIX Classical V-Belt A76", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 292, mrp: 562, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a77", name: "PIX Classical V-Belt A77", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 295, mrp: 568, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a78", name: "PIX Classical V-Belt A78", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 297, mrp: 571, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a79", name: "PIX Classical V-Belt A79", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 299, mrp: 575, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a80", name: "PIX Classical V-Belt A80", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 310, mrp: 597, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a81", name: "PIX Classical V-Belt A81", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 315, mrp: 605, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a82", name: "PIX Classical V-Belt A82", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 317, mrp: 610, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a83", name: "PIX Classical V-Belt A83", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 321, mrp: 617, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a84", name: "PIX Classical V-Belt A84", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 326, mrp: 627, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a85", name: "PIX Classical V-Belt A85", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 328, mrp: 631, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a86", name: "PIX Classical V-Belt A86", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 354, mrp: 681, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a87", name: "PIX Classical V-Belt A87", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 358, mrp: 688, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a88", name: "PIX Classical V-Belt A88", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 361, mrp: 694, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a89", name: "PIX Classical V-Belt A89", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 367, mrp: 706, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a90", name: "PIX Classical V-Belt A90", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 376, mrp: 724, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a91", name: "PIX Classical V-Belt A91", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 386, mrp: 743, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a92", name: "PIX Classical V-Belt A92", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 395, mrp: 760, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a93", name: "PIX Classical V-Belt A93", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 398, mrp: 765, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a94", name: "PIX Classical V-Belt A94", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 404, mrp: 776, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a95", name: "PIX Classical V-Belt A95", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 407, mrp: 782, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a96", name: "PIX Classical V-Belt A96", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 414, mrp: 796, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a97", name: "PIX Classical V-Belt A97", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 418, mrp: 803, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a98", name: "PIX Classical V-Belt A98", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 418, mrp: 803, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a99", name: "PIX Classical V-Belt A99", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 427, mrp: 821, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a100", name: "PIX Classical V-Belt A100", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 435, mrp: 837, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a101", name: "PIX Classical V-Belt A101", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 439, mrp: 844, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a102", name: "PIX Classical V-Belt A102", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 446, mrp: 857, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a103", name: "PIX Classical V-Belt A103", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 450, mrp: 865, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a104", name: "PIX Classical V-Belt A104", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 454, mrp: 874, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a105", name: "PIX Classical V-Belt A105", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 459, mrp: 883, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a106", name: "PIX Classical V-Belt A106", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 464, mrp: 892, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a107", name: "PIX Classical V-Belt A107", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 469, mrp: 902, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a108", name: "PIX Classical V-Belt A108", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 469, mrp: 902, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a109", name: "PIX Classical V-Belt A109", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 480, mrp: 924, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a110", name: "PIX Classical V-Belt A110", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 485, mrp: 933, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a112", name: "PIX Classical V-Belt A112", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 490, mrp: 942, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a114", name: "PIX Classical V-Belt A114", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 506, mrp: 973, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a115", name: "PIX Classical V-Belt A115", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 511, mrp: 983, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a116", name: "PIX Classical V-Belt A116", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 511, mrp: 983, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a117", name: "PIX Classical V-Belt A117", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 521, mrp: 1001, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a118", name: "PIX Classical V-Belt A118", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 522, mrp: 1004, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a119", name: "PIX Classical V-Belt A119", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 526, mrp: 1012, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a120", name: "PIX Classical V-Belt A120", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 526, mrp: 1012, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a121", name: "PIX Classical V-Belt A121", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 540, mrp: 1039, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a122", name: "PIX Classical V-Belt A122", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 543, mrp: 1044, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a124", name: "PIX Classical V-Belt A124", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 544, mrp: 1047, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a125", name: "PIX Classical V-Belt A125", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 552, mrp: 1062, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a126", name: "PIX Classical V-Belt A126", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 563, mrp: 1083, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a127", name: "PIX Classical V-Belt A127", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 573, mrp: 1102, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a128", name: "PIX Classical V-Belt A128", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 581, mrp: 1117, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a130", name: "PIX Classical V-Belt A130", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 596, mrp: 1147, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a131", name: "PIX Classical V-Belt A131", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 601, mrp: 1156, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a132", name: "PIX Classical V-Belt A132", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 606, mrp: 1165, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a134", name: "PIX Classical V-Belt A134", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 613, mrp: 1178, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a135", name: "PIX Classical V-Belt A135", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 616, mrp: 1184, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a136", name: "PIX Classical V-Belt A136", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 618, mrp: 1189, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a137", name: "PIX Classical V-Belt A137", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 621, mrp: 1195, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a138", name: "PIX Classical V-Belt A138", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 622, mrp: 1196, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a140", name: "PIX Classical V-Belt A140", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 628, mrp: 1207, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a142", name: "PIX Classical V-Belt A142", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 636, mrp: 1223, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a143", name: "PIX Classical V-Belt A143", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 636, mrp: 1224, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a144", name: "PIX Classical V-Belt A144", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 638, mrp: 1226, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a145", name: "PIX Classical V-Belt A145", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 645, mrp: 1240, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a146", name: "PIX Classical V-Belt A146", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 647, mrp: 1244, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a148", name: "PIX Classical V-Belt A148", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 657, mrp: 1264, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a150", name: "PIX Classical V-Belt A150", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 665, mrp: 1278, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a152", name: "PIX Classical V-Belt A152", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 670, mrp: 1289, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a154", name: "PIX Classical V-Belt A154", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 673, mrp: 1295, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a156", name: "PIX Classical V-Belt A156", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 684, mrp: 1315, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a158", name: "PIX Classical V-Belt A158", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 686, mrp: 1319, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a160", name: "PIX Classical V-Belt A160", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 697, mrp: 1341, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a162", name: "PIX Classical V-Belt A162", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 703, mrp: 1352, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a168", name: "PIX Classical V-Belt A168", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 725, mrp: 1394, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a170", name: "PIX Classical V-Belt A170", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 733, mrp: 1410, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a180", name: "PIX Classical V-Belt A180", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 765, mrp: 1471, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a185", name: "PIX Classical V-Belt A185", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 786, mrp: 1512, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a190", name: "PIX Classical V-Belt A190", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 810, mrp: 1557, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a195", name: "PIX Classical V-Belt A195", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 838, mrp: 1611, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a200", name: "PIX Classical V-Belt A200", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 839, mrp: 1613, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a205", name: "PIX Classical V-Belt A205", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 894, mrp: 1720, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a210", name: "PIX Classical V-Belt A210", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 915, mrp: 1759, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-a236", name: "PIX Classical V-Belt A236", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 956, mrp: 1838, img: "⚙️", image: VBELT_IMG_A },
  { id: "vb-b18", name: "PIX Classical V-Belt B18", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 150, mrp: 289, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b20", name: "PIX Classical V-Belt B20", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 160, mrp: 308, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b21", name: "PIX Classical V-Belt B21", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 164, mrp: 316, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b22", name: "PIX Classical V-Belt B22", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 168, mrp: 324, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b23", name: "PIX Classical V-Belt B23", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 170, mrp: 327, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b24", name: "PIX Classical V-Belt B24", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 171, mrp: 329, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b25", name: "PIX Classical V-Belt B25", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 176, mrp: 338, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b26", name: "PIX Classical V-Belt B26", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 177, mrp: 340, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b27", name: "PIX Classical V-Belt B27", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 180, mrp: 346, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b28", name: "PIX Classical V-Belt B28", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 184, mrp: 353, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b29", name: "PIX Classical V-Belt B29", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 187, mrp: 360, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b30", name: "PIX Classical V-Belt B30", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 190, mrp: 366, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b31", name: "PIX Classical V-Belt B31", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 198, mrp: 380, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b32", name: "PIX Classical V-Belt B32", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 201, mrp: 386, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b33", name: "PIX Classical V-Belt B33", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 202, mrp: 388, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b34", name: "PIX Classical V-Belt B34", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 204, mrp: 392, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b35", name: "PIX Classical V-Belt B35", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 204, mrp: 393, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b36", name: "PIX Classical V-Belt B36", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 206, mrp: 396, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b37", name: "PIX Classical V-Belt B37", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 207, mrp: 398, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b38", name: "PIX Classical V-Belt B38", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 208, mrp: 400, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b39", name: "PIX Classical V-Belt B39", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 211, mrp: 406, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b40", name: "PIX Classical V-Belt B40", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 212, mrp: 407, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b41", name: "PIX Classical V-Belt B41", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 218, mrp: 420, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b42", name: "PIX Classical V-Belt B42", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 221, mrp: 425, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b43", name: "PIX Classical V-Belt B43", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 223, mrp: 429, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b44", name: "PIX Classical V-Belt B44", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 227, mrp: 436, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b45", name: "PIX Classical V-Belt B45", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 228, mrp: 439, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b46", name: "PIX Classical V-Belt B46", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 239, mrp: 460, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b47", name: "PIX Classical V-Belt B47", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 242, mrp: 466, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b48", name: "PIX Classical V-Belt B48", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 248, mrp: 476, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b49", name: "PIX Classical V-Belt B49", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 250, mrp: 480, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b50", name: "PIX Classical V-Belt B50", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 253, mrp: 487, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b51", name: "PIX Classical V-Belt B51", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 259, mrp: 498, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b52", name: "PIX Classical V-Belt B52", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 262, mrp: 503, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b53", name: "PIX Classical V-Belt B53", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 267, mrp: 514, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b54", name: "PIX Classical V-Belt B54", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 271, mrp: 521, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b55", name: "PIX Classical V-Belt B55", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 276, mrp: 531, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b56", name: "PIX Classical V-Belt B56", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 280, mrp: 538, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b57", name: "PIX Classical V-Belt B57", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 284, mrp: 546, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b58", name: "PIX Classical V-Belt B58", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 286, mrp: 550, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b59", name: "PIX Classical V-Belt B59", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 291, mrp: 559, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b60", name: "PIX Classical V-Belt B60", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 294, mrp: 565, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b61", name: "PIX Classical V-Belt B61", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 297, mrp: 571, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b62", name: "PIX Classical V-Belt B62", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 301, mrp: 578, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b63", name: "PIX Classical V-Belt B63", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 302, mrp: 581, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b64", name: "PIX Classical V-Belt B64", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 306, mrp: 589, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b65", name: "PIX Classical V-Belt B65", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 330, mrp: 635, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b66", name: "PIX Classical V-Belt B66", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 350, mrp: 673, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b67", name: "PIX Classical V-Belt B67", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 354, mrp: 680, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b68", name: "PIX Classical V-Belt B68", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 354, mrp: 681, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b69", name: "PIX Classical V-Belt B69", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 360, mrp: 692, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b70", name: "PIX Classical V-Belt B70", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 362, mrp: 696, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b71", name: "PIX Classical V-Belt B71", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 369, mrp: 710, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b72", name: "PIX Classical V-Belt B72", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 371, mrp: 714, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b73", name: "PIX Classical V-Belt B73", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 379, mrp: 729, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b74", name: "PIX Classical V-Belt B74", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 384, mrp: 738, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b75", name: "PIX Classical V-Belt B75", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 385, mrp: 741, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b76", name: "PIX Classical V-Belt B76", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 387, mrp: 744, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b77", name: "PIX Classical V-Belt B77", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 392, mrp: 754, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b78", name: "PIX Classical V-Belt B78", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 394, mrp: 758, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b79", name: "PIX Classical V-Belt B79", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 400, mrp: 770, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b80", name: "PIX Classical V-Belt B80", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 406, mrp: 780, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b81", name: "PIX Classical V-Belt B81", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 423, mrp: 813, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b82", name: "PIX Classical V-Belt B82", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 426, mrp: 819, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b83", name: "PIX Classical V-Belt B83", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 433, mrp: 832, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b84", name: "PIX Classical V-Belt B84", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 437, mrp: 840, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b85", name: "PIX Classical V-Belt B85", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 441, mrp: 849, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b86", name: "PIX Classical V-Belt B86", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 479, mrp: 921, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b87", name: "PIX Classical V-Belt B87", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 486, mrp: 935, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b88", name: "PIX Classical V-Belt B88", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 490, mrp: 942, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b89", name: "PIX Classical V-Belt B89", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 496, mrp: 954, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b90", name: "PIX Classical V-Belt B90", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 504, mrp: 970, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b91", name: "PIX Classical V-Belt B91", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 535, mrp: 1028, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b92", name: "PIX Classical V-Belt B92", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 540, mrp: 1039, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b93", name: "PIX Classical V-Belt B93", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 550, mrp: 1058, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b94", name: "PIX Classical V-Belt B94", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 557, mrp: 1072, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b95", name: "PIX Classical V-Belt B95", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 565, mrp: 1087, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b96", name: "PIX Classical V-Belt B96", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 568, mrp: 1093, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b97", name: "PIX Classical V-Belt B97", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 577, mrp: 1109, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b98", name: "PIX Classical V-Belt B98", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 581, mrp: 1118, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b99", name: "PIX Classical V-Belt B99", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 584, mrp: 1123, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b100", name: "PIX Classical V-Belt B100", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 588, mrp: 1130, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b101", name: "PIX Classical V-Belt B101", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 597, mrp: 1148, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b102", name: "PIX Classical V-Belt B102", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 601, mrp: 1156, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b103", name: "PIX Classical V-Belt B103", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 605, mrp: 1164, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b104", name: "PIX Classical V-Belt B104", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 612, mrp: 1176, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b105", name: "PIX Classical V-Belt B105", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 620, mrp: 1193, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b106", name: "PIX Classical V-Belt B106", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 623, mrp: 1199, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b107", name: "PIX Classical V-Belt B107", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 633, mrp: 1217, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b108", name: "PIX Classical V-Belt B108", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 640, mrp: 1230, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b109", name: "PIX Classical V-Belt B109", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 647, mrp: 1245, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b110", name: "PIX Classical V-Belt B110", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 654, mrp: 1257, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b111", name: "PIX Classical V-Belt B111", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 663, mrp: 1275, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b112", name: "PIX Classical V-Belt B112", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 672, mrp: 1293, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b113", name: "PIX Classical V-Belt B113", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 688, mrp: 1323, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b114", name: "PIX Classical V-Belt B114", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 692, mrp: 1331, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b115", name: "PIX Classical V-Belt B115", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 697, mrp: 1340, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b116", name: "PIX Classical V-Belt B116", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 703, mrp: 1352, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b117", name: "PIX Classical V-Belt B117", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 709, mrp: 1364, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b118", name: "PIX Classical V-Belt B118", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 715, mrp: 1375, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b119", name: "PIX Classical V-Belt B119", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 719, mrp: 1382, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b120", name: "PIX Classical V-Belt B120", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 725, mrp: 1394, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b121", name: "PIX Classical V-Belt B121", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 727, mrp: 1399, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b122", name: "PIX Classical V-Belt B122", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 734, mrp: 1412, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b123", name: "PIX Classical V-Belt B123", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 736, mrp: 1416, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b124", name: "PIX Classical V-Belt B124", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 741, mrp: 1425, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b125", name: "PIX Classical V-Belt B125", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 746, mrp: 1434, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b126", name: "PIX Classical V-Belt B126", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 747, mrp: 1437, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b127", name: "PIX Classical V-Belt B127", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 748, mrp: 1439, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b128", name: "PIX Classical V-Belt B128", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 753, mrp: 1449, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b129", name: "PIX Classical V-Belt B129", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 770, mrp: 1481, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b130", name: "PIX Classical V-Belt B130", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 773, mrp: 1486, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b131", name: "PIX Classical V-Belt B131", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 779, mrp: 1498, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b132", name: "PIX Classical V-Belt B132", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 783, mrp: 1505, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b133", name: "PIX Classical V-Belt B133", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 791, mrp: 1522, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b134", name: "PIX Classical V-Belt B134", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 796, mrp: 1531, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b135", name: "PIX Classical V-Belt B135", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 804, mrp: 1547, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b136", name: "PIX Classical V-Belt B136", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 808, mrp: 1553, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b137", name: "PIX Classical V-Belt B137", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 816, mrp: 1569, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b138", name: "PIX Classical V-Belt B138", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 821, mrp: 1579, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b139", name: "PIX Classical V-Belt B139", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 828, mrp: 1592, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b140", name: "PIX Classical V-Belt B140", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 843, mrp: 1622, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b142", name: "PIX Classical V-Belt B142", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 859, mrp: 1652, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b143", name: "PIX Classical V-Belt B143", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 864, mrp: 1661, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b144", name: "PIX Classical V-Belt B144", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 872, mrp: 1677, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b145", name: "PIX Classical V-Belt B145", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 879, mrp: 1691, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b146", name: "PIX Classical V-Belt B146", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 889, mrp: 1709, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b147", name: "PIX Classical V-Belt B147", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 896, mrp: 1723, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b148", name: "PIX Classical V-Belt B148", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 902, mrp: 1734, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b150", name: "PIX Classical V-Belt B150", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 917, mrp: 1763, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b152", name: "PIX Classical V-Belt B152", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 942, mrp: 1811, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b154", name: "PIX Classical V-Belt B154", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 948, mrp: 1824, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b155", name: "PIX Classical V-Belt B155", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 954, mrp: 1834, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b156", name: "PIX Classical V-Belt B156", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 957, mrp: 1841, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b157", name: "PIX Classical V-Belt B157", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 964, mrp: 1853, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b158", name: "PIX Classical V-Belt B158", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 968, mrp: 1861, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b160", name: "PIX Classical V-Belt B160", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 980, mrp: 1885, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b162", name: "PIX Classical V-Belt B162", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 994, mrp: 1911, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b163", name: "PIX Classical V-Belt B163", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 996, mrp: 1915, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b164", name: "PIX Classical V-Belt B164", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1006, mrp: 1934, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b165", name: "PIX Classical V-Belt B165", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1011, mrp: 1944, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b166", name: "PIX Classical V-Belt B166", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1017, mrp: 1956, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b167", name: "PIX Classical V-Belt B167", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1021, mrp: 1964, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b168", name: "PIX Classical V-Belt B168", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1026, mrp: 1973, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b169", name: "PIX Classical V-Belt B169", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1033, mrp: 1986, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b170", name: "PIX Classical V-Belt B170", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1036, mrp: 1992, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b172", name: "PIX Classical V-Belt B172", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1042, mrp: 2004, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b173", name: "PIX Classical V-Belt B173", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1047, mrp: 2014, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b174", name: "PIX Classical V-Belt B174", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1053, mrp: 2025, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b175", name: "PIX Classical V-Belt B175", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1058, mrp: 2035, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b176", name: "PIX Classical V-Belt B176", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1060, mrp: 2038, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b178", name: "PIX Classical V-Belt B178", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1067, mrp: 2051, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b180", name: "PIX Classical V-Belt B180", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1073, mrp: 2063, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b182", name: "PIX Classical V-Belt B182", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1087, mrp: 2091, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b184", name: "PIX Classical V-Belt B184", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1103, mrp: 2122, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b185", name: "PIX Classical V-Belt B185", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1109, mrp: 2133, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b186", name: "PIX Classical V-Belt B186", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1115, mrp: 2145, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b188", name: "PIX Classical V-Belt B188", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1127, mrp: 2167, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b190", name: "PIX Classical V-Belt B190", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1142, mrp: 2197, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b192", name: "PIX Classical V-Belt B192", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1170, mrp: 2250, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b195", name: "PIX Classical V-Belt B195", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1184, mrp: 2277, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b198", name: "PIX Classical V-Belt B198", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1208, mrp: 2323, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b200", name: "PIX Classical V-Belt B200", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1208, mrp: 2323, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b204", name: "PIX Classical V-Belt B204", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1243, mrp: 2390, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b205", name: "PIX Classical V-Belt B205", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1247, mrp: 2399, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b210", name: "PIX Classical V-Belt B210", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1271, mrp: 2445, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b215", name: "PIX Classical V-Belt B215", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1299, mrp: 2499, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b220", name: "PIX Classical V-Belt B220", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1325, mrp: 2548, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b225", name: "PIX Classical V-Belt B225", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1355, mrp: 2606, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b228", name: "PIX Classical V-Belt B228", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1376, mrp: 2647, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b230", name: "PIX Classical V-Belt B230", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1389, mrp: 2671, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b235", name: "PIX Classical V-Belt B235", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1414, mrp: 2720, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b238", name: "PIX Classical V-Belt B238", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1434, mrp: 2758, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b240", name: "PIX Classical V-Belt B240", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1445, mrp: 2778, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b245", name: "PIX Classical V-Belt B245", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1478, mrp: 2842, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b250", name: "PIX Classical V-Belt B250", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1504, mrp: 2892, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b255", name: "PIX Classical V-Belt B255", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1536, mrp: 2954, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b260", name: "PIX Classical V-Belt B260", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1564, mrp: 3007, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b268", name: "PIX Classical V-Belt B268", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1608, mrp: 3093, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b270", name: "PIX Classical V-Belt B270", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1623, mrp: 3122, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b275", name: "PIX Classical V-Belt B275", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1654, mrp: 3181, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b280", name: "PIX Classical V-Belt B280", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1684, mrp: 3238, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b285", name: "PIX Classical V-Belt B285", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1715, mrp: 3298, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b300", name: "PIX Classical V-Belt B300", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1808, mrp: 3477, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b315", name: "PIX Classical V-Belt B315", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1898, mrp: 3650, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b330", name: "PIX Classical V-Belt B330", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1991, mrp: 3829, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b340", name: "PIX Classical V-Belt B340", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2052, mrp: 3947, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b360", name: "PIX Classical V-Belt B360", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2165, mrp: 4164, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b370", name: "PIX Classical V-Belt B370", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2233, mrp: 4294, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b512", name: "PIX Classical V-Belt B512", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 3046, mrp: 5857, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-b927", name: "PIX Classical V-Belt B927", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 6161, mrp: 11849, img: "⚙️", image: VBELT_IMG_B },
  { id: "vb-c31", name: "PIX Classical V-Belt C31", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 292, mrp: 561, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c33", name: "PIX Classical V-Belt C33", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 304, mrp: 584, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c34", name: "PIX Classical V-Belt C34", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 313, mrp: 602, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c35", name: "PIX Classical V-Belt C35", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 322, mrp: 619, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c36", name: "PIX Classical V-Belt C36", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 327, mrp: 629, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c37", name: "PIX Classical V-Belt C37", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 328, mrp: 630, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c38", name: "PIX Classical V-Belt C38", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 332, mrp: 638, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c39", name: "PIX Classical V-Belt C39", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 332, mrp: 639, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c40", name: "PIX Classical V-Belt C40", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 334, mrp: 643, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c41", name: "PIX Classical V-Belt C41", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 338, mrp: 650, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c42", name: "PIX Classical V-Belt C42", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 342, mrp: 657, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c43", name: "PIX Classical V-Belt C43", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 344, mrp: 662, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c44", name: "PIX Classical V-Belt C44", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 346, mrp: 665, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c45", name: "PIX Classical V-Belt C45", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 359, mrp: 690, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c46", name: "PIX Classical V-Belt C46", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 380, mrp: 731, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c47", name: "PIX Classical V-Belt C47", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 384, mrp: 739, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c48", name: "PIX Classical V-Belt C48", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 385, mrp: 740, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c49", name: "PIX Classical V-Belt C49", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 389, mrp: 748, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c50", name: "PIX Classical V-Belt C50", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 391, mrp: 751, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c51", name: "PIX Classical V-Belt C51", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 399, mrp: 768, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c52", name: "PIX Classical V-Belt C52", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 402, mrp: 774, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c53", name: "PIX Classical V-Belt C53", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 406, mrp: 780, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c54", name: "PIX Classical V-Belt C54", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 411, mrp: 790, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c55", name: "PIX Classical V-Belt C55", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 414, mrp: 797, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c56", name: "PIX Classical V-Belt C56", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 434, mrp: 835, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c57", name: "PIX Classical V-Belt C57", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 438, mrp: 843, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c58", name: "PIX Classical V-Belt C58", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 444, mrp: 853, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c59", name: "PIX Classical V-Belt C59", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 452, mrp: 869, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c60", name: "PIX Classical V-Belt C60", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 454, mrp: 874, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c61", name: "PIX Classical V-Belt C61", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 467, mrp: 898, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c62", name: "PIX Classical V-Belt C62", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 470, mrp: 904, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c63", name: "PIX Classical V-Belt C63", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 476, mrp: 915, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c64", name: "PIX Classical V-Belt C64", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 477, mrp: 918, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c65", name: "PIX Classical V-Belt C65", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 511, mrp: 982, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c66", name: "PIX Classical V-Belt C66", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 532, mrp: 1024, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c67", name: "PIX Classical V-Belt C67", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 537, mrp: 1033, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c68", name: "PIX Classical V-Belt C68", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 540, mrp: 1039, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c69", name: "PIX Classical V-Belt C69", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 548, mrp: 1053, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c70", name: "PIX Classical V-Belt C70", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 555, mrp: 1068, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c71", name: "PIX Classical V-Belt C71", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 560, mrp: 1076, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c72", name: "PIX Classical V-Belt C72", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 565, mrp: 1087, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c73", name: "PIX Classical V-Belt C73", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 574, mrp: 1103, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c74", name: "PIX Classical V-Belt C74", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 579, mrp: 1113, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c75", name: "PIX Classical V-Belt C75", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 584, mrp: 1123, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c76", name: "PIX Classical V-Belt C76", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 591, mrp: 1137, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c77", name: "PIX Classical V-Belt C77", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 597, mrp: 1148, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c78", name: "PIX Classical V-Belt C78", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 606, mrp: 1165, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c79", name: "PIX Classical V-Belt C79", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 617, mrp: 1187, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c80", name: "PIX Classical V-Belt C80", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 626, mrp: 1203, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c81", name: "PIX Classical V-Belt C81", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 647, mrp: 1245, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c82", name: "PIX Classical V-Belt C82", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 652, mrp: 1254, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c83", name: "PIX Classical V-Belt C83", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 660, mrp: 1269, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c84", name: "PIX Classical V-Belt C84", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 667, mrp: 1283, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c85", name: "PIX Classical V-Belt C85", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 671, mrp: 1290, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c86", name: "PIX Classical V-Belt C86", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 682, mrp: 1311, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c87", name: "PIX Classical V-Belt C87", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 691, mrp: 1329, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c88", name: "PIX Classical V-Belt C88", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 707, mrp: 1360, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c89", name: "PIX Classical V-Belt C89", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 722, mrp: 1388, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c90", name: "PIX Classical V-Belt C90", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 738, mrp: 1419, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c91", name: "PIX Classical V-Belt C91", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 772, mrp: 1485, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c92", name: "PIX Classical V-Belt C92", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 786, mrp: 1511, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c93", name: "PIX Classical V-Belt C93", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 800, mrp: 1538, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c94", name: "PIX Classical V-Belt C94", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 821, mrp: 1578, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c95", name: "PIX Classical V-Belt C95", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 834, mrp: 1603, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c96", name: "PIX Classical V-Belt C96", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 841, mrp: 1617, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c97", name: "PIX Classical V-Belt C97", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 854, mrp: 1643, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c98", name: "PIX Classical V-Belt C98", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 868, mrp: 1670, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c99", name: "PIX Classical V-Belt C99", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 880, mrp: 1693, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c100", name: "PIX Classical V-Belt C100", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 893, mrp: 1717, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c101", name: "PIX Classical V-Belt C101", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 901, mrp: 1733, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c102", name: "PIX Classical V-Belt C102", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 922, mrp: 1773, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c103", name: "PIX Classical V-Belt C103", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 933, mrp: 1794, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c104", name: "PIX Classical V-Belt C104", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 944, mrp: 1816, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c105", name: "PIX Classical V-Belt C105", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 959, mrp: 1844, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c106", name: "PIX Classical V-Belt C106", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 968, mrp: 1861, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c107", name: "PIX Classical V-Belt C107", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 982, mrp: 1889, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c108", name: "PIX Classical V-Belt C108", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 994, mrp: 1912, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c109", name: "PIX Classical V-Belt C109", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1009, mrp: 1941, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c110", name: "PIX Classical V-Belt C110", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1019, mrp: 1959, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c111", name: "PIX Classical V-Belt C111", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1026, mrp: 1973, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c112", name: "PIX Classical V-Belt C112", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1038, mrp: 1997, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c113", name: "PIX Classical V-Belt C113", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1059, mrp: 2036, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c114", name: "PIX Classical V-Belt C114", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1062, mrp: 2042, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c115", name: "PIX Classical V-Belt C115", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1068, mrp: 2053, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c116", name: "PIX Classical V-Belt C116", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1072, mrp: 2061, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c117", name: "PIX Classical V-Belt C117", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1074, mrp: 2066, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c118", name: "PIX Classical V-Belt C118", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1078, mrp: 2074, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c119", name: "PIX Classical V-Belt C119", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1081, mrp: 2078, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c120", name: "PIX Classical V-Belt C120", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1083, mrp: 2082, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c121", name: "PIX Classical V-Belt C121", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1089, mrp: 2094, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c122", name: "PIX Classical V-Belt C122", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1090, mrp: 2096, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c123", name: "PIX Classical V-Belt C123", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1095, mrp: 2105, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c124", name: "PIX Classical V-Belt C124", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1099, mrp: 2114, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c125", name: "PIX Classical V-Belt C125", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1109, mrp: 2132, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c126", name: "PIX Classical V-Belt C126", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1116, mrp: 2146, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c127", name: "PIX Classical V-Belt C127", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1126, mrp: 2165, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c128", name: "PIX Classical V-Belt C128", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1146, mrp: 2203, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c129", name: "PIX Classical V-Belt C129", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1153, mrp: 2217, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c130", name: "PIX Classical V-Belt C130", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1165, mrp: 2240, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c131", name: "PIX Classical V-Belt C131", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1174, mrp: 2257, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c132", name: "PIX Classical V-Belt C132", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1185, mrp: 2279, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c133", name: "PIX Classical V-Belt C133", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1195, mrp: 2299, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c134", name: "PIX Classical V-Belt C134", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1205, mrp: 2317, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c135", name: "PIX Classical V-Belt C135", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1215, mrp: 2337, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c136", name: "PIX Classical V-Belt C136", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1229, mrp: 2363, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c137", name: "PIX Classical V-Belt C137", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1236, mrp: 2377, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c138", name: "PIX Classical V-Belt C138", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1247, mrp: 2398, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c139", name: "PIX Classical V-Belt C139", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1252, mrp: 2407, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c140", name: "PIX Classical V-Belt C140", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1262, mrp: 2427, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c141", name: "PIX Classical V-Belt C141", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1271, mrp: 2444, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c142", name: "PIX Classical V-Belt C142", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1278, mrp: 2457, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c143", name: "PIX Classical V-Belt C143", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1282, mrp: 2466, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c144", name: "PIX Classical V-Belt C144", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1285, mrp: 2472, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c145", name: "PIX Classical V-Belt C145", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1292, mrp: 2484, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c146", name: "PIX Classical V-Belt C146", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1293, mrp: 2487, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c147", name: "PIX Classical V-Belt C147", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1297, mrp: 2495, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c148", name: "PIX Classical V-Belt C148", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1301, mrp: 2501, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c149", name: "PIX Classical V-Belt C149", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1307, mrp: 2514, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c150", name: "PIX Classical V-Belt C150", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1309, mrp: 2518, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c151", name: "PIX Classical V-Belt C151", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1311, mrp: 2521, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c152", name: "PIX Classical V-Belt C152", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1320, mrp: 2538, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c153", name: "PIX Classical V-Belt C153", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1322, mrp: 2542, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c154", name: "PIX Classical V-Belt C154", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1326, mrp: 2550, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c155", name: "PIX Classical V-Belt C155", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1332, mrp: 2562, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c156", name: "PIX Classical V-Belt C156", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1336, mrp: 2569, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c157", name: "PIX Classical V-Belt C157", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1340, mrp: 2576, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c158", name: "PIX Classical V-Belt C158", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1341, mrp: 2578, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c159", name: "PIX Classical V-Belt C159", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1348, mrp: 2593, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c160", name: "PIX Classical V-Belt C160", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1353, mrp: 2601, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c161", name: "PIX Classical V-Belt C161", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1357, mrp: 2610, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c162", name: "PIX Classical V-Belt C162", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1361, mrp: 2617, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c163", name: "PIX Classical V-Belt C163", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1366, mrp: 2626, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c164", name: "PIX Classical V-Belt C164", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1369, mrp: 2633, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c165", name: "PIX Classical V-Belt C165", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1376, mrp: 2646, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c166", name: "PIX Classical V-Belt C166", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1377, mrp: 2648, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c167", name: "PIX Classical V-Belt C167", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1382, mrp: 2658, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c168", name: "PIX Classical V-Belt C168", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1384, mrp: 2662, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c169", name: "PIX Classical V-Belt C169", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1386, mrp: 2666, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c170", name: "PIX Classical V-Belt C170", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1388, mrp: 2669, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c171", name: "PIX Classical V-Belt C171", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1389, mrp: 2671, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c172", name: "PIX Classical V-Belt C172", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1390, mrp: 2673, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c173", name: "PIX Classical V-Belt C173", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1396, mrp: 2684, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c174", name: "PIX Classical V-Belt C174", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1408, mrp: 2708, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c175", name: "PIX Classical V-Belt C175", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1419, mrp: 2728, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c176", name: "PIX Classical V-Belt C176", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1426, mrp: 2742, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c177", name: "PIX Classical V-Belt C177", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1427, mrp: 2744, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c178", name: "PIX Classical V-Belt C178", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1436, mrp: 2762, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c180", name: "PIX Classical V-Belt C180", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1451, mrp: 2790, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c181", name: "PIX Classical V-Belt C181", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1460, mrp: 2808, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c182", name: "PIX Classical V-Belt C182", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1468, mrp: 2824, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c183", name: "PIX Classical V-Belt C183", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1478, mrp: 2842, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c184", name: "PIX Classical V-Belt C184", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1488, mrp: 2862, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c185", name: "PIX Classical V-Belt C185", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1493, mrp: 2871, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c186", name: "PIX Classical V-Belt C186", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1507, mrp: 2899, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c187", name: "PIX Classical V-Belt C187", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1516, mrp: 2915, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c188", name: "PIX Classical V-Belt C188", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1520, mrp: 2923, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c190", name: "PIX Classical V-Belt C190", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1537, mrp: 2956, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c192", name: "PIX Classical V-Belt C192", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1559, mrp: 2999, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c193", name: "PIX Classical V-Belt C193", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1569, mrp: 3017, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c194", name: "PIX Classical V-Belt C194", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1576, mrp: 3031, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c195", name: "PIX Classical V-Belt C195", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1587, mrp: 3052, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c196", name: "PIX Classical V-Belt C196", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1597, mrp: 3071, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c197", name: "PIX Classical V-Belt C197", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1605, mrp: 3087, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c198", name: "PIX Classical V-Belt C198", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1616, mrp: 3108, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c200", name: "PIX Classical V-Belt C200", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1636, mrp: 3147, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c202", name: "PIX Classical V-Belt C202", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1656, mrp: 3184, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c204", name: "PIX Classical V-Belt C204", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1672, mrp: 3216, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c205", name: "PIX Classical V-Belt C205", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1679, mrp: 3229, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c206", name: "PIX Classical V-Belt C206", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1689, mrp: 3249, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c208", name: "PIX Classical V-Belt C208", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1707, mrp: 3283, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c210", name: "PIX Classical V-Belt C210", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1721, mrp: 3309, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c212", name: "PIX Classical V-Belt C212", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1736, mrp: 3339, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c215", name: "PIX Classical V-Belt C215", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1762, mrp: 3389, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c216", name: "PIX Classical V-Belt C216", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1770, mrp: 3404, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c218", name: "PIX Classical V-Belt C218", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1785, mrp: 3433, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c220", name: "PIX Classical V-Belt C220", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1801, mrp: 3464, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c222", name: "PIX Classical V-Belt C222", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1817, mrp: 3495, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c224", name: "PIX Classical V-Belt C224", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1833, mrp: 3525, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c225", name: "PIX Classical V-Belt C225", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1838, mrp: 3535, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c228", name: "PIX Classical V-Belt C228", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1864, mrp: 3584, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c230", name: "PIX Classical V-Belt C230", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1880, mrp: 3615, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c234", name: "PIX Classical V-Belt C234", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1915, mrp: 3682, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c235", name: "PIX Classical V-Belt C235", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1925, mrp: 3702, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c236", name: "PIX Classical V-Belt C236", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1930, mrp: 3712, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c238", name: "PIX Classical V-Belt C238", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1952, mrp: 3753, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c240", name: "PIX Classical V-Belt C240", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1969, mrp: 3786, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c242", name: "PIX Classical V-Belt C242", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1987, mrp: 3821, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c244", name: "PIX Classical V-Belt C244", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 1998, mrp: 3843, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c245", name: "PIX Classical V-Belt C245", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2011, mrp: 3868, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c248", name: "PIX Classical V-Belt C248", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2033, mrp: 3910, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c250", name: "PIX Classical V-Belt C250", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2046, mrp: 3934, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c252", name: "PIX Classical V-Belt C252", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2060, mrp: 3961, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c255", name: "PIX Classical V-Belt C255", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2085, mrp: 4010, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c258", name: "PIX Classical V-Belt C258", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2109, mrp: 4055, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c260", name: "PIX Classical V-Belt C260", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2124, mrp: 4085, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c262", name: "PIX Classical V-Belt C262", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2144, mrp: 4124, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c264", name: "PIX Classical V-Belt C264", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2169, mrp: 4171, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c265", name: "PIX Classical V-Belt C265", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2180, mrp: 4192, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c268", name: "PIX Classical V-Belt C268", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2193, mrp: 4217, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c270", name: "PIX Classical V-Belt C270", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2210, mrp: 4250, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c272", name: "PIX Classical V-Belt C272", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2228, mrp: 4284, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c275", name: "PIX Classical V-Belt C275", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2256, mrp: 4338, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c276", name: "PIX Classical V-Belt C276", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2268, mrp: 4361, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c278", name: "PIX Classical V-Belt C278", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2286, mrp: 4396, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c280", name: "PIX Classical V-Belt C280", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2294, mrp: 4412, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c285", name: "PIX Classical V-Belt C285", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2334, mrp: 4489, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c286", name: "PIX Classical V-Belt C286", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2348, mrp: 4516, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c288", name: "PIX Classical V-Belt C288", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2371, mrp: 4560, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c290", name: "PIX Classical V-Belt C290", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2386, mrp: 4589, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c295", name: "PIX Classical V-Belt C295", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2422, mrp: 4658, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c298", name: "PIX Classical V-Belt C298", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2448, mrp: 4708, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c300", name: "PIX Classical V-Belt C300", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2463, mrp: 4737, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c305", name: "PIX Classical V-Belt C305", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2512, mrp: 4831, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c310", name: "PIX Classical V-Belt C310", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2552, mrp: 4908, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c315", name: "PIX Classical V-Belt C315", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2604, mrp: 5008, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c320", name: "PIX Classical V-Belt C320", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2643, mrp: 5082, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c328", name: "PIX Classical V-Belt C328", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2720, mrp: 5230, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c330", name: "PIX Classical V-Belt C330", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2732, mrp: 5253, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c340", name: "PIX Classical V-Belt C340", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2801, mrp: 5386, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c345", name: "PIX Classical V-Belt C345", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2851, mrp: 5483, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c350", name: "PIX Classical V-Belt C350", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 2894, mrp: 5566, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c358", name: "PIX Classical V-Belt C358", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 3001, mrp: 5772, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c360", name: "PIX Classical V-Belt C360", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 3017, mrp: 5802, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c370", name: "PIX Classical V-Belt C370", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 3204, mrp: 6162, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c380", name: "PIX Classical V-Belt C380", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 3371, mrp: 6482, img: "⚙️", image: VBELT_IMG_C },
  { id: "vb-c927", name: "PIX Classical V-Belt C927", category: "Belt", subcategory: "V Belt", brand: "PIX", price: 10471, mrp: 20137, img: "⚙️", image: VBELT_IMG_C },
  { id: "os1", name: "Oil Seal 25x40x7", category: "Oil Seal", price: 89, img: "⭕" },
  { id: "os2", name: "Oil Seal 30x52x10", category: "Oil Seal", price: 119, img: "⭕" },
  { id: "sm1", name: "Safety Helmet", category: "Safety Material", price: 299, img: "⛑️" },
  { id: "sm2", name: "Safety Gloves (Pair)", category: "Safety Material", price: 149, img: "🧤" },
];

function formatRs(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}
function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Plays a short beep using Web Audio API — no external sound file needed.
// Automatically hands a new order to the admin's "Bluetooth Print" / Thermer
// app via its my.bluetoothprint.scheme:// link. That app then fetches
// /api/print-order?id=... itself and prints the JSON it gets back — no tap
// needed, as long as the admin's phone has the app installed with Browser
// Print enabled and the 58mm printer connected.
// Order data is embedded in the print link (param "d"), so printing works even
// when Firestore quota is exhausted. /api/print-order falls back to Firestore
// only when "d" is missing.
function buildPrintPayload(order, orderNumber, sellers) {
  const asc = (v) => String(v == null ? "" : v).replace(/[^\x20-\x7E]/g, "").trim();
  const sellerList = Array.isArray(sellers) ? sellers : [];
  const payload = {
    id: order.id,
    no: orderNumber != null ? orderNumber : "",
    c: order.createdAt || "",
    n: asc(order.customer && order.customer.name),
    ph: asc(order.customer && order.customer.phone),
    ad: asc(order.customer && order.customer.address),
    t: order.total || 0,
    it: (order.items || []).map((i) => {
      const sid = i.sellerId || inferSellerId(i);
      const sel = sid
        ? sellerList.find((x) => x.id === sid) || DEFAULT_SELLERS.find((x) => x.id === sid) || null
        : null;
      return { n: asc(i.name), q: i.qty || 1, p: i.price || 0, s: sel ? asc(sel.name) : "" };
    }),
  };
  return btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function triggerBluetoothPrint(orderId, order, orderNumber, sellers) {
  try {
    let responseUrl = `${window.location.origin}/api/print-order?id=${encodeURIComponent(orderId)}`;
    if (order) responseUrl += `&d=${buildPrintPayload(order, orderNumber, sellers)}`;
    const schemeUrl = `my.bluetoothprint.scheme://${responseUrl}`;
    const a = document.createElement("a");
    a.href = schemeUrl;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {}
}

function playOrderBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startTime + duration);
      osc.start(ctx.currentTime + startTime);
      osc.stop(ctx.currentTime + startTime + duration + 0.05);
    };
    playTone(880, 0, 0.15);
    playTone(1108, 0.18, 0.2);
  } catch (e) {}
}
function formatOrderDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
      " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dateGroupLabel(iso) {
  if (!iso) return "તારીખ અજાણી";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "તારીખ અજાણી";
  }
}

// Groups orders by calendar date (newest date first), keeping each
// group's original order-numbering intact so "ઓર્ડર #N" still matches
// what's shown elsewhere.
function groupOrdersByDate(orders) {
  const groups = [];
  const byLabel = new Map();
  orders.forEach((o, idx) => {
    const label = dateGroupLabel(o.createdAt);
    if (!byLabel.has(label)) {
      const group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    byLabel.get(label).items.push({ order: o, orderNumber: orders.length - idx });
  });
  return groups;
}

// ---- Blog reviews moderation (admin only). Visitors' reviews are saved by blog.html
// into the "reviews" collection with approved:false. The admin signs in once with a
// Firebase email/password account (rules allow only that email) and approves/rejects here.
const reviewAuth = getAuth(firebaseApp);
function AdminBlogReviews() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");

  useEffect(() => onAuthStateChanged(reviewAuth, (u) => setUser(u)), []);

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const snap = await getDocs(collection(db, "reviews"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        if (!!a.approved !== !!b.approved) return a.approved ? 1 : -1;
        return String(b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : b.createdAt || "").localeCompare(
          String(a.createdAt?.toDate ? a.createdAt.toDate().toISOString() : a.createdAt || "")
        );
      });
      setItems(list);
    } catch (e) {
      setItems([]);
      setMsg("રિવ્યૂ વાંચી શકાયા નહીં. એડમિન ઈમેલથી લૉગિન કરેલું છે કે નહીં તે ચેક કરો.");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (user) load();
    else setItems([]);
  }, [user]);

  async function login() {
    setMsg("");
    try {
      await signInWithEmailAndPassword(reviewAuth, email.trim(), pass);
      setPass("");
    } catch (e) {
      setMsg("લૉગિન થયું નહીં. ઈમેલ અને પાસવર્ડ ચેક કરો.");
    }
  }

  async function approve(id) {
    setBusyId(id);
    try {
      await updateDoc(doc(db, "reviews", id), { approved: true });
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, approved: true } : r)));
    } catch (e) {
      setMsg("Approve થયું નહીં (permission). Rules ચેક કરો.");
    }
    setBusyId("");
  }

  async function reject(id) {
    if (!window.confirm("આ રિવ્યૂ કાયમ માટે કાઢી નાખવો છે?")) return;
    setBusyId(id);
    try {
      await deleteDoc(doc(db, "reviews", id));
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setMsg("Reject થયું નહીં (permission). Rules ચેક કરો.");
    }
    setBusyId("");
  }

  const inp = { width: "100%", boxSizing: "border-box", padding: 8, marginBottom: 6, border: "1px solid #d9d5c3", borderRadius: 8, fontSize: 13 };
  const when = (r) => {
    const d = r.createdAt?.toDate ? r.createdAt.toDate() : r.createdAt ? new Date(r.createdAt) : null;
    return d && !isNaN(d) ? d.toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  };

  if (!user) {
    return (
      <div>
        <div style={{ fontSize: 12, color: "#8a8378", marginBottom: 8 }}>રિવ્યૂ મંજૂર કરવા માટે એડમિન ઈમેલથી લૉગિન કરો (Firebase).</div>
        <input style={inp} type="email" placeholder="એડમિન ઈમેલ" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={inp} type="password" placeholder="પાસવર્ડ" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button style={styles.primaryBtn} onClick={login}>લૉગિન</button>
        {msg && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>{msg}</div>}
      </div>
    );
  }

  const pending = items.filter((r) => !r.approved);
  const done = items.filter((r) => r.approved);
  const card = (r) => (
    <div key={r.id} style={{ ...styles.orderCard, marginBottom: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 13 }}>
        {r.name || "વાચક"} · ⭐ {r.rating}/10
      </div>
      <div style={{ fontSize: 11, color: "#8a8378" }}>{r.postId} · {when(r)}</div>
      {r.comment && <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.comment}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {!r.approved && (
          <button style={{ ...styles.primaryBtn, flex: 1 }} disabled={busyId === r.id} onClick={() => approve(r.id)}>✔ Approve</button>
        )}
        <button
          style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #c0392b", background: "#fff", color: "#c0392b", fontWeight: 700, cursor: "pointer" }}
          disabled={busyId === r.id}
          onClick={() => reject(r.id)}
        >
          {r.approved ? "કાઢી નાખો" : "✖ Reject"}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 12, color: "#8a8378" }}>
        <span>{user.email}</span>
        <span>
          <button style={{ border: 0, background: "none", color: "#d8541f", fontWeight: 700, cursor: "pointer" }} onClick={load}>રિફ્રેશ</button>
          {" · "}
          <button style={{ border: 0, background: "none", color: "#8a8378", cursor: "pointer" }} onClick={() => signOut(reviewAuth)}>લૉગઆઉટ</button>
        </span>
      </div>
      {loading && <div style={{ fontSize: 12 }}>લોડ થઈ રહ્યું છે...</div>}
      {msg && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 6 }}>{msg}</div>}
      {!loading && pending.length === 0 && <div style={{ fontSize: 12, color: "#8a8378" }}>મંજૂરી માટે કોઈ નવો રિવ્યૂ નથી.</div>}
      {pending.map(card)}
      {done.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>મંજૂર થયેલા ({done.length})</summary>
          <div style={{ marginTop: 8 }}>{done.map(card)}</div>
        </details>
      )}
    </div>
  );
}

export default function ApniDukanApp() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const w = useWallet(firebaseApp);
  const [lastOrderPaid, setLastOrderPaid] = useState(false);

  // ---- admin dashboard stats, computed purely from existing orders data ----
  const dashboardStats = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfDay - (now.getDay() * 86400000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let today = 0, week = 0, month = 0;
    const productSales = {};
    orders.forEach((o) => {
      const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      const amt = o.total || 0;
      if (t >= startOfDay) today += amt;
      if (t >= startOfWeek) week += amt;
      if (t >= startOfMonth) month += amt;
      (o.items || []).forEach((it) => {
        productSales[it.name] = (productSales[it.name] || 0) + (it.qty || 0);
      });
    });
    const bestSelling = Object.entries(productSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    return { today, week, month, totalOrders: orders.length, bestSelling };
  }, [orders]);

  // ---- customer list, grouped by phone number from past orders ----
  const customerList = useMemo(() => {
    const byPhone = {};
    orders.forEach((o) => {
      const phone = o.customer?.phone;
      if (!phone) return;
      if (!byPhone[phone]) {
        byPhone[phone] = { phone, name: o.customer?.name || "ગ્રાહક", orderCount: 0, totalSpent: 0 };
      }
      byPhone[phone].orderCount += 1;
      byPhone[phone].totalSpent += o.total || 0;
    });
    return Object.values(byPhone).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [orders]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [zoomImage, setZoomImage] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("બધું");
  const [subcategory, setSubcategory] = useState("બધું");
  const ENQUIRY_CAT = "નવી પૂછપરછ";
  const [enquiryName, setEnquiryName] = useState("");
  const [sizeInputs, setSizeInputs] = useState({});
  const [enquiryPhone, setEnquiryPhone] = useState("");
  const [enquiryText, setEnquiryText] = useState("");
  const [enquiryPhoto, setEnquiryPhoto] = useState(null);
  const [enquirySubmitting, setEnquirySubmitting] = useState(false);
  const [enquirySubmitted, setEnquirySubmitted] = useState(false);

  const handleEnquiryPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setEnquiryPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const submitEnquiry = async () => {
    if (!enquiryName.trim() || !enquiryPhone.trim()) return;
    if (!enquiryText.trim() && !enquiryPhoto) return;
    setEnquirySubmitting(true);
    try {
      const enquiryId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await enquirySave({
        id: enquiryId,
        name: enquiryName.trim(),
        phone: enquiryPhone.trim(),
        text: enquiryText.trim(),
        photo: enquiryPhoto || null,
        createdAt: Date.now(),
        status: "નવી",
      });
      setEnquirySubmitted(true);
      setEnquiryName("");
      setEnquiryPhone("");
      setEnquiryText("");
      setEnquiryPhoto(null);
      setTimeout(() => setEnquirySubmitted(false), 2500);
    } catch (err) {
      console.error("Enquiry submit failed:", err);
      alert("પૂછપરછ મોકલવામાં તકલીફ થઈ, ફરી પ્રયત્ન કરો.");
    } finally {
      setEnquirySubmitting(false);
    }
  };

  const [cart, setCart] = useState({});
  const [wishlist, setWishlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("apniDukanWishlist") || "[]");
    } catch {
      return [];
    }
  });
  function toggleWishlist(id) {
    setWishlist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("apniDukanWishlist", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const [myPhone, setMyPhone] = useState(() => {
    try {
      return localStorage.getItem("apniDukanMyPhone") || "";
    } catch {
      return "";
    }
  });
  const [myPhoneInput, setMyPhoneInput] = useState("");
  function repeatOrder(order) {
    setCart((prev) => {
      const next = { ...prev };
      (order.items || []).forEach((it) => {
        next[it.id] = (next[it.id] || 0) + (it.qty || 1);
      });
      return next;
    });
    setView("cart");
  }
  const [view, setView] = useState(() => {
    // Direct link support: apnidukanse.in/?page=careers (or #careers)
    try {
      const q = new URLSearchParams(window.location.search).get("page");
      if (q === "careers" || window.location.hash === "#careers") return "careers";
    } catch {}
    return "home";
  });
  const [lastOrderId, setLastOrderId] = useState("");

  // admin
  const [isAdmin, setIsAdmin] = useState(false);
  // Kept in sync below so the orders listener (subscribed once on mount)
  // always sees the current admin state without re-subscribing.
  const isAdminRef = useRef(false);
  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  // Chrome blocks a custom-scheme app launch (my.bluetoothprint.scheme://)
  // that isn't tied to a real tap — so a new order queues up here and shows
  // a one-tap "🖨️ Print" banner instead of trying to auto-open silently.
  const [printQueue, setPrintQueue] = useState([]);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [newProduct, setNewProduct] = useState({ name: "", category: "કપડાં", subcategory: "", price: "", img: "🛍️", image: "", stock: "", sellerId: "" });
  const [subcatCustom, setSubcatCustom] = useState({});
  const [newSubName, setNewSubName] = useState("");
  const [adminSub, setAdminSub] = useState("");
  // product photo: "poster" = offer poster with the price, "plain" = only a smaller photo
  const [imgMode, setImgMode] = useState("poster");
  const [imgTheme, setImgTheme] = useState("purple");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgNew, setImgNew] = useState(false);   // true while the photo in the form was picked just now
  const imgSourceRef = useRef(null);
  const [editingProductId, setEditingProductId] = useState(null);

  // sellers (Sandhya Traders, B.M. Traders, Deepankit, etc.)
  const [sellers, setSellers] = useState(DEFAULT_SELLERS);
  const [newSellerName, setNewSellerName] = useState("");
  const [newSellerMobile, setNewSellerMobile] = useState("");
  const [newSellerPin, setNewSellerPin] = useState("");
  const [sellerAuth, setSellerAuth] = useState(() => {
    try {
      const raw = localStorage.getItem("apniDukanSeller");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [sellerMobileInput, setSellerMobileInput] = useState("");
  const [sellerPinInput, setSellerPinInput] = useState("");
  const [sellerPinError, setSellerPinError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await storageGet("sellers");
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // An earlier deploy may have saved sellers without a mobile
            // field — backfill it from the defaults so mobile+PIN login
            // keeps working, and save the fix back to Firestore.
            let patched = false;
            const merged = parsed.map((s) => {
              if (!s.mobile) {
                const def = DEFAULT_SELLERS.find((d) => d.id === s.id);
                if (def) {
                  patched = true;
                  return { ...s, mobile: def.mobile };
                }
              }
              return s;
            });
            setSellers(merged);
            if (patched) {
              try {
                await storageSet("sellers", JSON.stringify(merged));
              } catch {}
            }
            return;
          }
        }
        // First time: seed the 3 default sellers into Firestore.
        await storageSet("sellers", JSON.stringify(DEFAULT_SELLERS));
        setSellers(DEFAULT_SELLERS);
      } catch {}
    })();
  }, []);

  async function saveSellers(next) {
    setSellers(next);
    try {
      await storageSet("sellers", JSON.stringify(next));
    } catch {}
  }
  function addSeller(name, mobile, pin) {
    if (!name.trim() || !mobile.trim() || !pin.trim()) return;
    saveSellers([...sellers, { id: uid("sel"), name: name.trim(), mobile: mobile.trim(), pin: pin.trim() }]);
  }
  function deleteSeller(id) {
    if (!window.confirm("આ સેલર ડિલિટ કરવો છે?")) return;
    saveSellers(sellers.filter((s) => s.id !== id));
  }
  function trySellerLogin() {
    const mobile = sellerMobileInput.trim();
    const pin = sellerPinInput.trim();
    const match = sellers.find((s) => s.mobile === mobile && s.pin === pin);
    if (match) {
      const auth = { id: match.id, name: match.name };
      setSellerAuth(auth);
      try {
        localStorage.setItem("apniDukanSeller", JSON.stringify(auth));
      } catch {}
      setSellerPinError("");
      setSellerMobileInput("");
      setSellerPinInput("");
      setView("sellerOrders");
    } else {
      setSellerPinError("મોબાઇલ નંબર અથવા PIN ખોટો છે. ફરી પ્રયત્ન કરો.");
    }
  }
  function sellerLogout() {
    setSellerAuth(null);
    try {
      localStorage.removeItem("apniDukanSeller");
    } catch {}
    setView("home");
  }

  // Seller self-registration — a new shopkeeper fills this form, it lands
  // in Firestore as a "pending" request, and admin approves it from the
  // admin panel before the seller can actually log in.
  const [pendingSellers, setPendingSellers] = useState([]);
  const [regForm, setRegForm] = useState({ shop: "", owner: "", mobile: "", category: "", area: "", pin: "" });
  const [regError, setRegError] = useState("");
  const [regSubmitted, setRegSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storageGet("pendingSellers");
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (Array.isArray(parsed)) setPendingSellers(parsed);
        }
      } catch {}
    })();
  }, []);

  // ---- seller panel: payments (hisab), messages to admin, stock search ----
  const [sellerPayments, setSellerPayments] = useState([]);
  const [sellerMessages, setSellerMessages] = useState([]);
  const [sellerTab, setSellerTab] = useState("orders");
  const [sellerMsgText, setSellerMsgText] = useState("");
  const [sellerStockQuery, setSellerStockQuery] = useState("");
  const [payInputs, setPayInputs] = useState({});
  const [replyInputs, setReplyInputs] = useState({});
  const [sellerMsgSeenAt, setSellerMsgSeenAt] = useState(() => {
    try { return localStorage.getItem("apniDukanSellerMsgSeen") || ""; } catch { return ""; }
  });
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [calSel, setCalSel] = useState("");

  useEffect(() => {
    (async () => {
      for (const [key, setter] of [["sellerPayments", setSellerPayments], ["sellerMessages", setSellerMessages]]) {
        try {
          const res = await storageGet(key);
          if (res && res.value) {
            const parsed = JSON.parse(res.value);
            if (Array.isArray(parsed)) setter(parsed);
          }
        } catch {}
      }
    })();
  }, []);

  // Reads the latest list from Firestore first, applies the change, saves. Two people never overwrite each other.
  async function updateStoredList(key, current, setter, change) {
    let base = current;
    try {
      const r = await storageGet(key);
      if (r && r.value) {
        const parsed = JSON.parse(r.value);
        if (Array.isArray(parsed)) base = parsed;
      }
    } catch {}
    const next = change(base);
    setter(next);
    try {
      await storageSet(key, JSON.stringify(next));
    } catch {}
  }

  // What the seller has sold (delivered orders), what was paid to him, and what is still due.
  function sellerHisab(sid) {
    let deliveredTotal = 0;
    let deliveredCount = 0;
    orders.forEach((o) => {
      if (o.status !== "ડિલિવર થયો") return;
      const mine = (o.items || []).filter((it) => it.sellerId === sid);
      if (mine.length === 0) return;
      deliveredCount += 1;
      deliveredTotal += mine.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    });
    const payable = Math.round((deliveredTotal * SELLER_PAYOUT_PCT) / 100);
    const paid = sellerPayments.filter((x) => x.sellerId === sid).reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
    return { deliveredCount, deliveredTotal, payable, paid, balance: payable - paid };
  }

  async function sendSellerMessage() {
    const text = sellerMsgText.trim();
    if (!text || !sellerAuth) return;
    setSellerMsgText("");
    const entry = { id: uid("msg"), sellerId: sellerAuth.id, sellerName: sellerAuth.name, text, at: new Date().toISOString(), done: false };
    await updateStoredList("sellerMessages", sellerMessages, setSellerMessages, (l) => [entry, ...l]);
  }
  async function markSellerMessageDone(id) {
    await updateStoredList("sellerMessages", sellerMessages, setSellerMessages, (l) => l.map((m) => (m.id === id ? { ...m, done: true } : m)));
  }
  async function deleteSellerMessage(id) {
    await updateStoredList("sellerMessages", sellerMessages, setSellerMessages, (l) => l.filter((m) => m.id !== id));
  }
  async function replyToSellerMessage(id) {
    const text = (replyInputs[id] || "").trim();
    if (!text) return;
    setReplyInputs((prev) => ({ ...prev, [id]: "" }));
    await updateStoredList("sellerMessages", sellerMessages, setSellerMessages, (l) =>
      l.map((m) => (m.id === id ? { ...m, reply: text, repliedAt: new Date().toISOString(), done: true } : m))
    );
  }
  // seller opens the message / hisab tab -> fetch the newest replies / payments
  async function reloadSellerLists(which) {
    const pair = which === "msg" ? ["sellerMessages", setSellerMessages] : ["sellerPayments", setSellerPayments];
    try {
      const res = await storageGet(pair[0]);
      if (res && res.value) {
        const parsed = JSON.parse(res.value);
        if (Array.isArray(parsed)) pair[1](parsed);
      }
    } catch {}
  }
  function openSellerTab(key) {
    setSellerTab(key);
    if (key === "msg") {
      reloadSellerLists("msg");
      const nowIso = new Date().toISOString();
      setSellerMsgSeenAt(nowIso);
      try { localStorage.setItem("apniDukanSellerMsgSeen", nowIso); } catch {}
    }
    if (key === "hisab") reloadSellerLists("hisab");
  }
  async function addSellerPayment(sid) {
    const inp = payInputs[sid] || {};
    const amount = Number(inp.amount);
    if (!(amount > 0)) return;
    const entry = { id: uid("pay"), sellerId: sid, amount, note: (inp.note || "").trim(), date: new Date().toISOString() };
    setPayInputs((prev) => ({ ...prev, [sid]: { amount: "", note: "" } }));
    await updateStoredList("sellerPayments", sellerPayments, setSellerPayments, (l) => [entry, ...l]);
  }
  async function deleteSellerPayment(id) {
    if (!window.confirm("આ ચૂકવણી કાઢી નાખવી?")) return;
    await updateStoredList("sellerPayments", sellerPayments, setSellerPayments, (l) => l.filter((x) => x.id !== id));
  }
  // seller marks a product "ખતમ" / available again (customers can't add it to the cart while it is ખતમ)
  async function toggleSoldOut(prod) {
    await productSave({ ...prod, soldOut: !prod.soldOut });
  }
  // seller changes stock with + / - (atomic, never below 0). A product with no stock number starts at 1 on "+".
  async function adjustStock(prod, delta) {
    try {
      const ref = doc(db, "store", productKey(prod.id));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const cur = snap.data().stock;
        if (typeof cur !== "number") {
          if (delta > 0) tx.update(ref, { stock: delta });
          return;
        }
        tx.update(ref, { stock: Math.max(0, cur + delta) });
      });
    } catch (e) {
      console.error("adjustStock failed", e);
    }
  }
  // seller types an exact stock number
  async function setStockExact(prod, raw) {
    const txt = String(raw).trim();
    if (txt === "") return;
    const val = parseInt(txt, 10);
    if (isNaN(val) || val < 0 || val === stockOf(prod)) return;
    try {
      await updateDoc(doc(db, "store", productKey(prod.id)), { stock: val });
    } catch (e) {
      console.error("setStockExact failed", e);
    }
  }

  async function savePendingSellers(next) {
    setPendingSellers(next);
    try {
      await storageSet("pendingSellers", JSON.stringify(next));
    } catch {}
  }

  async function submitSellerRegistration() {
    const { shop, owner, mobile, category, area, pin } = regForm;
    if (!shop.trim() || !owner.trim() || !mobile.trim() || !category || !pin.trim()) {
      setRegError("બધી જરૂરી વિગત ભરો.");
      return;
    }
    if (mobile.trim().length !== 10 || isNaN(mobile.trim())) {
      setRegError("મોબાઇલ નંબર 10 અંકનો હોવો જોઈએ.");
      return;
    }
    if (pin.trim().length < 4) {
      setRegError("PIN ઓછામાં ઓછો 4 અંકનો રાખો.");
      return;
    }
    if (sellers.some((s) => s.mobile === mobile.trim()) || pendingSellers.some((p) => p.mobile === mobile.trim())) {
      setRegError("આ મોબાઇલ નંબર પહેલેથી રજિસ્ટર છે.");
      return;
    }
    setRegError("");
    let no = 0;
    try { no = await nextSerial("sel", pendingSellers.length); } catch (e) { console.error("serial no failed", e); }
    const entry = {
      id: uid("preg"),
      shop: shop.trim(),
      owner: owner.trim(),
      mobile: mobile.trim(),
      category,
      area: area.trim(),
      pin: pin.trim(),
      requestedAt: new Date().toISOString(),
      ...(no ? { no } : {}),
    };
    // read the latest list first, so two registrations at the same time never overwrite each other
    let baseList = pendingSellers;
    try {
      const r = await storageGet("pendingSellers");
      if (r && r.value) { const parsed = JSON.parse(r.value); if (Array.isArray(parsed)) baseList = parsed; }
    } catch {}
    savePendingSellers([...baseList, entry]);
    try {
      await queuePrint("sr_" + entry.id, {
        kind: "sel", no, t: Date.now(), shop: entry.shop, owner: entry.owner,
        mobile: entry.mobile, category: entry.category, area: entry.area,
      });
    } catch (e) { console.error("print queue failed", e); }
    setRegSubmitted(true);
    setRegForm({ shop: "", owner: "", mobile: "", category: "", area: "", pin: "" });
  }

  function approveSellerRegistration(id) {
    const req = pendingSellers.find((p) => p.id === id);
    if (!req) return;
    saveSellers([...sellers, { id: uid("sel"), name: req.shop, mobile: req.mobile, pin: req.pin, market: guessMarket(req.area) }]);
    savePendingSellers(pendingSellers.filter((p) => p.id !== id));
  }

  function rejectSellerRegistration(id) {
    if (!window.confirm("આ રજિસ્ટ્રેશન કાઢી નાખવું છે?")) return;
    savePendingSellers(pendingSellers.filter((p) => p.id !== id));
  }
  // ---- low stock: products where a "stock" number has been set and is running low ----
  const lowStockProducts = useMemo(() => {
    return products.filter((p) => typeof p.stock === "number" && p.stock <= 5);
  }, [products]);

  const [stockEditId, setStockEditId] = useState(null);
  const [stockEditValue, setStockEditValue] = useState("");
  async function saveStock(p) {
    const val = parseInt(stockEditValue, 10);
    if (isNaN(val) || val < 0) return;
    await productSave({ ...p, stock: val });
    setStockEditId(null);
    setStockEditValue("");
  }
  const [bulkSelectedIds, setBulkSelectedIds] = useState(() => new Set());
  const [bulkAdjustValue, setBulkAdjustValue] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);

  function toggleBulkSelect(id) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkPriceAdjust() {
    const raw = bulkAdjustValue.trim();
    if (!raw || bulkSelectedIds.size === 0) return;
    setBulkApplying(true);
    try {
      const isPercent = raw.endsWith("%");
      const num = parseFloat(raw.replace("%", "").replace("+", ""));
      if (isNaN(num)) return;
      const toUpdate = products
        .filter((p) => bulkSelectedIds.has(p.id))
        .map((p) => {
          const newPrice = isPercent ? p.price * (1 + num / 100) : p.price + num;
          return { ...p, price: Math.max(0, Math.round(newPrice)) };
        });
      await productsBulkSave(toUpdate);
      setBulkSelectedIds(new Set());
      setBulkAdjustValue("");
      alert(`${toUpdate.length} પ્રોડક્ટ્સ ના ભાવ અપડેટ થયા!`);
    } catch (err) {
      console.error(err);
      alert("અપડેટ કરવામાં તકલીફ થઈ.");
    } finally {
      setBulkApplying(false);
    }
  }
  const [customCategories, setCustomCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showProductList, setShowProductList] = useState(false);
  // admin dashboard: long lists stay hidden until the section is tapped; products are shown per category
  const [adminOpen, setAdminOpen] = useState({});
  const [adminCat, setAdminCat] = useState("");
  const [bulkCat, setBulkCat] = useState("");
  const [adminMore, setAdminMore] = useState({ low: 50, cust: 50, prod: 60 });
  const toggleAdminSection = (k) => setAdminOpen((prev) => ({ ...prev, [k]: !prev[k] }));
  const showMoreOf = (k) => setAdminMore((prev) => ({ ...prev, [k]: (prev[k] || 50) + 50 }));
  const productCategoryCounts = useMemo(() => {
    const m = {};
    products.forEach((p) => { const c = p.category || "અન્ય"; m[c] = (m[c] || 0) + 1; });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [products]);
  function adminToggleHeader(key, title) {
    return (
      <button
        style={{
          ...styles.adminSectionTitle, width: "100%", background: T.surface2, border: `1px solid ${T.hairline}`,
          borderRadius: 10, padding: "12px 12px", cursor: "pointer", justifyContent: "space-between",
          fontFamily: "inherit", textTransform: "none", letterSpacing: 0, marginBottom: 8,
        }}
        onClick={() => toggleAdminSection(key)}
      >
        <span>{title}</span>
        <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>{adminOpen[key] ? "છુપાવો ▲" : "જુઓ ▼"}</span>
      </button>
    );
  }
  function categoryChips(selected, onPick) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {productCategoryCounts.map((c) => {
          const on = selected === c.name;
          return (
            <button
              key={c.name}
              onClick={() => onPick(on ? "" : c.name)}
              style={{
                border: `1px solid ${on ? T.orange : T.hairline}`, background: on ? T.orange : "#fff",
                color: on ? "#fff" : T.ink, borderRadius: 16, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              {c.name} ({c.count})
            </button>
          );
        })}
      </div>
    );
  }
  function moreButton(key, total) {
    const shown = adminMore[key] || 50;
    if (total <= shown) return null;
    return (
      <button
        style={{ width: "100%", border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", color: T.inkSoft, marginBottom: 8 }}
        onClick={() => showMoreOf(key)}
      >
        વધુ બતાવો ({total - shown} બાકી)
      </button>
    );
  }
  const [adminSearchQuery, setAdminSearchQuery] = useState("");

  // ---- seller photo upload (seller side) + admin list of uploaded photos ----
  const [upOpen, setUpOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [hisabOpen, setHisabOpen] = useState(false);
  const [upPhoto, setUpPhoto] = useState("");
  const [upNote, setUpNote] = useState("");
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState("");
  const [adminUploads, setAdminUploads] = useState([]);
  const [adminUploadsLoading, setAdminUploadsLoading] = useState(false);
  const [upBigId, setUpBigId] = useState("");

  async function pickSellerPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUpMsg("");
    try {
      setUpPhoto(await compressImageFile(file));
    } catch {
      setUpMsg("ફોટો વાંચી શકાયો નથી. બીજો ફોટો પસંદ કરો.");
    }
  }
  async function submitSellerPhoto() {
    if (!upPhoto || !sellerAuth) return;
    setUpBusy(true);
    setUpMsg("");
    try {
      await sellerUploadSave({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sellerId: sellerAuth.id,
        sellerName: sellerAuth.name,
        note: upNote.trim(),
        image: upPhoto,
        createdAt: Date.now(),
        seen: false,
      });
      setUpPhoto("");
      setUpNote("");
      setUpOpen(false);
      setUpMsg("✔ ફોટો એડમિનને મોકલાઈ ગયો.");
    } catch (e) {
      console.error("seller upload failed", e);
      setUpMsg("ફોટો મોકલી શકાયો નથી. ફરી પ્રયત્ન કરો.");
    }
    setUpBusy(false);
  }
  async function loadAdminUploads() {
    setAdminUploadsLoading(true);
    try {
      setAdminUploads(await sellerUploadsLoad());
    } catch (e) {
      console.error("load uploads failed", e);
    }
    setAdminUploadsLoading(false);
  }
  useEffect(() => {
    if (adminOpen.uploads) loadAdminUploads();
  }, [adminOpen.uploads]);
  async function seenAdminUpload(id) {
    setAdminUploads((l) => l.map((x) => (x.id === id ? { ...x, seen: true } : x)));
    try { await sellerUploadMarkSeen(id); } catch {}
  }
  async function removeAdminUpload(id) {
    if (!window.confirm("આ ફોટો કાઢી નાખવો?")) return;
    setAdminUploads((l) => l.filter((x) => x.id !== id));
    try { await sellerUploadDelete(id); } catch {}
  }

  // ---- PO -> thermal slip: AI reads the PDF / photo, the seller checks the details, then it is printed ----
  const [poOpen, setPoOpen] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [poMsg, setPoMsg] = useState("");
  const [poForm, setPoForm] = useState(null);
  const [poMemory, setPoMemory] = useState(() => poMemoryLoad());
  const [poStatus, setPoStatus] = useState("");
  const [poShot, setPoShot] = useState("");        // PO screenshot shown above the form (stays on this phone, never uploaded)
  const [poShotBig, setPoShotBig] = useState(false);
  function pickPoShot(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (poShot) URL.revokeObjectURL(poShot);
    setPoShot(URL.createObjectURL(file));
    setPoShotBig(false);
  }

  // PDF -> text positions (pdf.js), screenshot/photo -> OCR (Tesseract.js); then the form is filled for the seller to check.
  async function readPoFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPoMsg("");
    setPoBusy(true);
    setPoStatus("ફાઇલ વંચાય છે...");
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      let words;
      if (isPdf) words = await poWordsFromPdf(file);
      else if (file.type && file.type.startsWith("image/")) words = await poWordsFromImage(file, setPoStatus);
      else throw new Error("type");
      if (!words.length) throw new Error("empty");
      const { po, warnings } = parsePoFromWords(words);
      setPoForm({
        poNo: po.poNo,
        poDate: po.poDate,
        billTo: po.billTo || poMemory.lastBillTo || "",
        payment: po.payment || poMemory.lastPayment || "",
        docTotal: po.docTotal == null ? null : String(po.docTotal),
        notes: "",
        warn: warnings,
        items: po.items.length
          ? po.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit || "PC", rate: i.rate, gst: i.gst, chkGst: !i.gstFound }))
          : [{ name: "", qty: "1", unit: "PC", rate: "", gst: "18" }],
      });
    } catch (err) {
      console.error("po read failed", err);
      const m = String((err && err.message) || "");
      setPoMsg(
        m === "type" ? "ફક્ત PDF અથવા ફોટો પસંદ કરો."
        : m === "empty" ? "ફાઇલમાં લખાણ મળ્યું નથી (સ્કેન કરેલી PDF હોય તો તેનો સ્ક્રીનશોટ અપલોડ કરો). ફોર્મ જાતે ભરો."
        : "ફાઇલ વાંચી શકાઈ નથી (ઇન્ટરનેટ તપાસો). ફોર્મ જાતે ભરો."
      );
      setPoForm(blankPoForm(poMemory));
    }
    setPoBusy(false);
    setPoStatus("");
  }
  function setPoField(field, value) {
    setPoForm((f) => ({ ...f, [field]: value }));
  }
  function setPoItem(idx, field, value) {
    setPoForm((f) => ({ ...f, items: f.items.map((x, i) => (i === idx ? { ...x, [field]: value } : x)) }));
  }
  function addPoItem() {
    setPoForm((f) => ({ ...f, items: [...f.items, { name: "", qty: "1", unit: "PC", rate: "", gst: "" }] }));
  }
  function removePoItem(idx) {
    setPoForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }
  async function printPo() {
    if (!poForm || !sellerAuth) return;
    const calc = poCalc(poForm);
    if (!poForm.poNo.trim()) { setPoMsg("PO નંબર લખો."); return; }
    if (calc.rows.length === 0) { setPoMsg("ઓછામાં ઓછી એક વસ્તુ (નામ અને જથ્થા સાથે) જોઈએ."); return; }
    if (poForm.items.some((x) => String(x.name || "").trim() && String(x.gst ?? "").trim() === "")) {
      setPoMsg("દરેક વસ્તુમાં GST% લખો (GST ન હોય તો 0).");
      return;
    }
    const typedTotal = poForm.docTotal == null || String(poForm.docTotal).trim() === "" ? null : Number(poForm.docTotal);
    if (typedTotal == null) {
      if (!window.confirm(`PO નો કુલ ભર્યો નથી.\nગણતરી: ₹${calc.total.toFixed(2)}\nPO સાથે મેળવી લીધું? છાપવું છે?`)) return;
    } else if (Math.abs(typedTotal - calc.total) > 1) {
      if (!window.confirm(`PO માં કુલ ₹${typedTotal.toFixed(2)} છે, પણ ગણતરી ₹${calc.total.toFixed(2)} છે.\nછતાં છાપવું છે?`)) return;
    }
    setPoBusy(true);
    setPoMsg("");
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await queuePrint("po_" + id, {
        kind: "po", no: 0, t: Date.now(), sellerName: sellerAuth.name,
        poNo: poForm.poNo.trim(), poDate: poForm.poDate.trim(), billTo: poForm.billTo.trim(),
        payment: (poForm.payment || "").trim(),
        items: calc.rows, subTotal: calc.subTotal, gstTotal: calc.gstTotal, total: calc.total,
      });
      poMemorySave(poForm);
      setPoMemory(poMemoryLoad());
      if (poShot) URL.revokeObjectURL(poShot);
      setPoShot("");
      setPoForm(null);
      setPoOpen(false);
      setPoMsg("✔ PO ની સ્લિપ પ્રિન્ટ કતારમાં મૂકાઈ ગઈ.");
    } catch (e) {
      console.error("po print queue failed", e);
      setPoMsg("પ્રિન્ટ કતારમાં મૂકી શકાયું નથી. ફરી પ્રયત્ન કરો.");
    }
    setPoBusy(false);
  }
  const adminListed = useMemo(() => {
    const q = adminSearchQuery.trim().toLowerCase();
    if (q) return products.filter((p) => (p.name || "").toLowerCase().includes(q));
    if (adminCat) {
      return products.filter(
        (p) =>
          (p.category || "અન્ય") === adminCat &&
          (!adminSub || (adminSub === "અન્ય" ? !p.subcategory : p.subcategory === adminSub))
      );
    }
    return [];
  }, [products, adminSearchQuery, adminCat, adminSub]);
  // Which date-group headers are expanded in the admin Orders list. The
  // most recent date starts open; older dates stay collapsed until tapped,
  // so there's no more endless scrolling to find today's orders.
  const [expandedDateGroups, setExpandedDateGroups] = useState(() => new Set());

  // ---- background music: active only for 12 hours from deploy time,
  // then it stops playing for everyone forever. ----
  useEffect(() => {
    // 12 hours from when this was set up (30 Aug 2026, 8:17 PM IST).
    // After this, the music will never play again for any user.
    const MUSIC_EXPIRES_AT = new Date("2026-09-01T12:43:00+05:30").getTime();
    if (Date.now() > MUSIC_EXPIRES_AT) return;

    const audio = new Audio("/music-temp.mp3");
    audio.loop = true;
    audio.volume = 0.5;

    let started = false;
    const startMusic = () => {
      if (started) return;
      audio.play().then(() => { started = true; }).catch(() => {});
    };

    // Try immediately on page load.
    startMusic();

    // Fallback: start on first user interaction if autoplay was blocked.
    const events = ["click", "touchstart", "scroll", "keydown"];
    const onFirstInteraction = () => {
      startMusic();
      events.forEach((ev) => window.removeEventListener(ev, onFirstInteraction));
    };
    events.forEach((ev) => window.addEventListener(ev, onFirstInteraction, { once: true }));

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onFirstInteraction));
      audio.pause();
    };
  }, []);

  // ---- bulk add ----
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkRows, setBulkRows] = useState([{ name: "", price: "", stock: "", img: "🛍️", image: "" }]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");

  // ---- load data on mount ----
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // Move any legacy single-document product data into the new
        // per-document collection (no-op if already migrated).
        await migrateLegacyProductsIfNeeded();

        // If, after migration, there's still nothing at all (brand new
        // store), seed with the built-in catalog.
        const afterMigration = await getDocs(collection(db, "store"));
        const hasAnyProducts = afterMigration.docs.some((d) => d.id.startsWith(PRODUCT_KEY_PREFIX));
        if (!hasAnyProducts) {
          try {
            await productsBulkSave(SEED_PRODUCTS);
          } catch {}
        }

        let cats = [];
        try {
          const res3 = await storageGet("customCategories");
          cats = res3 ? JSON.parse(res3.value) : [];
        } catch {
          cats = [];
        }
        setCustomCategories(cats || []);
        try {
          const resSub = await storageGet("subcategories");
          const sc = resSub ? JSON.parse(resSub.value) : {};
          setSubcatCustom(sc && typeof sc === "object" ? sc : {});
        } catch {
          setSubcatCustom({});
        }
      } catch (e) {
        setLoadError("ડેટા લોડ કરવામાં તકલીફ થઈ. ફરી પ્રયત્ન કરો.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Live products — real-time Firestore listener so every product add /
  // edit / delete shows up instantly on every device/session, and bulk
  // adds (which write many docs at once) appear the moment they're saved.
  useEffect(() => {
    const unsubscribe = productsListen((list) => {
      setProducts(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Apply the one-time photo patch once products have loaded. Matches by
  // category + name keyword (or matchAll for a whole category), skips
  // anything that already has a real photo, and only touches Firestore
  // for products that actually need updating.
  useEffect(() => {
    if (!products.length) return;
    function findMatch(p) {
      const name = (p.name || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      return PHOTO_PATCH_RULES.find((entry) => {
        if (entry.category && entry.category.toLowerCase() !== cat) return false;
        if (entry.matchAll) return true;
        return entry.keywords.some((kw) => name.includes(kw));
      });
    }
    const needsPatch = products.filter((p) => !p.image && findMatch(p));
    if (!needsPatch.length) return;
    (async () => {
      for (const p of needsPatch) {
        const match = findMatch(p);
        if (match) {
          try {
            await productSave({ ...p, image: match.image });
          } catch (e) {
            console.error("photo patch failed for", p.id, e);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // Apply the one-time Pneumatic Fittings MRP/discount patch. Only touches
  // the "price" and "mrp" fields — never "image" — so existing photos are
  // never affected. Skips any product that already has "mrp" set, so it's
  // safe to leave running permanently.
  useEffect(() => {
    if (!products.length) return;
    const needsPatch = products.filter((p) => p.mrp == null && findPneumaticMrp(p) != null);
    if (!needsPatch.length) return;
    (async () => {
      for (const p of needsPatch) {
        const mrp = findPneumaticMrp(p);
        if (mrp != null) {
          try {
            const discountedPrice = Math.round(mrp * (1 - PNEUMATIC_DISCOUNT_PERCENT));
            await productSave({ ...p, mrp, price: discountedPrice });
          } catch (e) {
            console.error("pneumatic MRP patch failed for", p.id, e);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // Apply the one-time V Belt (Ecodrive & Pix) MRP/discount patch. Only
  // touches "price" and "mrp" fields — never "image" — so existing photos
  // are never affected. Skips any product that already has "mrp" set, so
  // it's safe to leave running permanently.
  useEffect(() => {
    if (!products.length) return;
    const needsPatch = products.filter((p) => p.mrp == null && findVBeltMrp(p) != null);
    if (!needsPatch.length) return;
    (async () => {
      for (const p of needsPatch) {
        const mrp = findVBeltMrp(p);
        if (mrp != null) {
          try {
            const discountedPrice = Math.round(mrp * (1 - VBELT_DISCOUNT_PERCENT));
            await productSave({ ...p, mrp, price: discountedPrice });
          } catch (e) {
            console.error("v-belt MRP patch failed for", p.id, e);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // Apply the one-time Pressure Gauge discount patch. Here there is no
  // separate official price list — the existing "price" already saved on
  // each product IS treated as the MRP, and the new selling price is set
  // to 35% off that. Only "price" and "mrp" fields are touched — never
  // "image" — so existing photos are never affected. Skips any product
  // that already has "mrp" set, so it's safe to leave running permanently.
  const PRESSURE_GAUGE_DISCOUNT_PERCENT = 0.35;
  useEffect(() => {
    if (!products.length) return;
    const needsPatch = products.filter(
      (p) => p.mrp == null && (p.category || "").trim().toLowerCase() === "pressure gauge"
    );
    if (!needsPatch.length) return;
    (async () => {
      for (const p of needsPatch) {
        try {
          const mrp = p.price;
          const discountedPrice = Math.round(mrp * (1 - PRESSURE_GAUGE_DISCOUNT_PERCENT));
          await productSave({ ...p, mrp, price: discountedPrice });
        } catch (e) {
          console.error("pressure gauge MRP patch failed for", p.id, e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // One-time seller backfill: products saved without a sellerId (e.g. all
  // Lifting Belt items) get the right seller so their name prints on the
  // order slip and the seller sees their orders. Never overwrites a
  // sellerId that is already set, so it is safe to leave running.
  useEffect(() => {
    if (!products.length) return;
    const needsPatch = products.filter((p) => !p.sellerId && inferSellerId(p));
    if (!needsPatch.length) return;
    (async () => {
      for (const p of needsPatch) {
        try {
          await productSave({ ...p, sellerId: inferSellerId(p) });
        } catch (e) {
          console.error("seller backfill failed for", p.id, e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // Live orders — real-time Firestore listener so every new order shows up
  // in the admin panel immediately, on any device, without a manual refresh.
  const firstOrdersLoadRef = useRef(true);
  const prevOrderIdsRef = useRef(new Set());
  const [pushStatus, setPushStatus] = useState("default");

  useEffect(() => {
    const unsubscribe = storageListen("orders", (rawValue) => {
      let parsed = [];
      try {
        parsed = JSON.parse(rawValue) || [];
      } catch {
        parsed = [];
      }

      if (firstOrdersLoadRef.current) {
        // Don't notify for orders that already existed when the app first loaded.
        firstOrdersLoadRef.current = false;
      } else {
        const newOnes = parsed.filter((o) => !prevOrderIdsRef.current.has(o.id));
        if (newOnes.length > 0) {
          playOrderBeep();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            newOnes.forEach((o) => {
              try {
                new Notification("🛍️ નવો ઓર્ડર આવ્યો!", {
                  body: `${o.customer?.name || "ગ્રાહક"} — ${formatRs(o.total)}`,
                  tag: o.id,
                });
              } catch {}
            });
          }
          // Queue for a one-tap print (not auto-triggered) — only in the
          // admin's own session, not every visitor's browser, since this
          // listener runs for everyone on the site. Chrome requires a real
          // tap before it will open the Thermer app via its custom scheme.
          if (isAdminRef.current) {
            setPrintQueue((q) => [...q, ...newOnes.map((o) => o.id)]);
          }
        }
      }
      prevOrderIdsRef.current = new Set(parsed.map((o) => o.id));
      setOrders(parsed);
    });
    return () => unsubscribe();
  }, []);

  // ---- Careers (blog writer job) ----
  const EMPTY_APP = { name: "", age: "", city: "", phone: "", level: "", lang: "", sample: "", about: "" };
  const [appForm, setAppForm] = useState(EMPTY_APP);
  const [appSubmitting, setAppSubmitting] = useState(false);
  const [appSubmitted, setAppSubmitted] = useState(false);
  const [appError, setAppError] = useState("");
  const setAppField = (k, v) => setAppForm((f) => ({ ...f, [k]: v }));

  const submitApplication = async () => {
    const f = appForm;
    const age = parseInt(f.age, 10);
    if (!f.name.trim()) return setAppError("નામ લખો.");
    if (!(age >= 14 && age < 25)) return setAppError("આ નોકરી ફક્ત 25 વર્ષથી ઓછી ઉંમર માટે છે.");
    if (!f.city.trim()) return setAppError("શહેર / ગામ લખો.");
    if (!/^[6-9]\d{9}$/.test(f.phone.trim())) return setAppError("સાચો 10 અંકનો WhatsApp નંબર લખો.");
    if (!f.level) return setAppError("Experience પસંદ કરો.");
    if (!f.lang) return setAppError("ભાષા પસંદ કરો.");
    setAppError("");
    setAppSubmitting(true);
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await applicationSave({
        id, name: f.name.trim(), age, city: f.city.trim(), phone: f.phone.trim(),
        level: f.level, lang: f.lang, sample: f.sample.trim(), about: f.about.trim(),
        createdAt: Date.now(), status: "નવી",
      });
      setAppForm(EMPTY_APP);
      setAppSubmitted(true);
    } catch (err) {
      console.error("Application submit failed:", err);
      setAppError("મોકલવામાં તકલીફ થઈ, ફરી પ્રયત્ન કરો.");
    } finally {
      setAppSubmitting(false);
    }
  };

  // ---- Job ads: Apply Now form (Sales Executive / Sales Officer / Delivery Partner) ----
  const EMPTY_JOB = { name: "", phone: "", qualification: "", experience: "" };
  const [jobForm, setJobForm] = useState(EMPTY_JOB);
  const [jobOpen, setJobOpen] = useState(null); // job name when form is open
  const [jobError, setJobError] = useState("");
  const [jobSending, setJobSending] = useState(false);
  const [jobDone, setJobDone] = useState(false);
  const [jobFilter, setJobFilter] = useState("બધી");
  const openJobForm = (job) => { setJobForm(EMPTY_JOB); setJobError(""); setJobDone(false); setJobOpen(job); };
  const submitJobApplication = async () => {
    const f = jobForm;
    if (f.name.trim().length < 2) return setJobError("નામ લખો.");
    if (!/^[6-9]\d{9}$/.test(f.phone.trim())) return setJobError("સાચો 10 અંકનો મોબાઈલ નંબર લખો.");
    if (!f.qualification) return setJobError("Qualification પસંદ કરો.");
    if (!f.experience) return setJobError("Experience પસંદ કરો.");
    setJobError(""); setJobSending(true);
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = Date.now();
      let no = 0;
      try { no = await nextSerial("job", jobApps.length); } catch (e) { console.error("serial no failed", e); }
      await applicationSave({
        id, job: jobOpen, name: f.name.trim(), phone: f.phone.trim(),
        qualification: f.qualification, experience: f.experience,
        createdAt, status: "નવી", ...(no ? { no } : {}),
      });
      try {
        await queuePrint("ja_" + id, {
          kind: "job", no, t: createdAt, job: jobOpen, name: f.name.trim(), phone: f.phone.trim(),
          qualification: f.qualification, experience: f.experience,
        });
      } catch (e) { console.error("print queue failed", e); }
      setJobDone(true);
    } catch (err) {
      console.error("Job application failed:", err);
      setJobError("મોકલવામાં તકલીફ થઈ, ફરી પ્રયત્ન કરો.");
    } finally { setJobSending(false); }
  };

  // ---- Diwali Bonus ad: tap karo to form khule (naam, mobile, address, salary range) ----
  const BONUS_JOB = "Diwali Bonus";
  const BONUS_SALARY = ["₹5,000 – ₹10,000", "₹10,000 – ₹30,000", "₹30,000 – ₹60,000"];
  const EMPTY_BONUS = { name: "", phone: "", address: "", salary: "" };
  const [bonusForm, setBonusForm] = useState(EMPTY_BONUS);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonusError, setBonusError] = useState("");
  const [bonusSending, setBonusSending] = useState(false);
  const [bonusDone, setBonusDone] = useState(false);
  const openBonusForm = () => { setBonusForm(EMPTY_BONUS); setBonusError(""); setBonusDone(false); setBonusOpen(true); };
  const submitBonusForm = async () => {
    const f = bonusForm;
    if (f.name.trim().length < 2) return setBonusError("નામ લખો.");
    if (!/^[6-9]\d{9}$/.test(f.phone.trim())) return setBonusError("સાચો 10 અંકનો મોબાઈલ નંબર લખો.");
    if (f.address.trim().length < 5) return setBonusError("પૂરું સરનામું લખો.");
    if (!f.salary) return setBonusError("Salary range પસંદ કરો.");
    setBonusError(""); setBonusSending(true);
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await applicationSave({
        id, job: BONUS_JOB, name: f.name.trim(), phone: f.phone.trim(),
        address: f.address.trim(), salary: f.salary,
        createdAt: Date.now(), status: "નવી",
      });
      setBonusDone(true);
    } catch (err) {
      console.error("Bonus form failed:", err);
      setBonusError("મોકલવામાં તકલીફ થઈ, ફરી પ્રયત્ન કરો.");
    } finally { setBonusSending(false); }
  };

  const [applications, setApplications] = useState([]);
  const blogApps = applications.filter((a) => !a.job);
  const bonusApps = applications.filter((a) => a.job === "Diwali Bonus");
  const jobApps = applications.filter((a) => a.job && a.job !== "Diwali Bonus");
  // Serial numbers like orders: oldest = 1, newest = highest (list is sorted newest first).
  const jobAppNo = (a) => jobApps.length - jobApps.findIndex((x) => x.id === a.id);
  const blogAppNo = (a) => blogApps.length - blogApps.findIndex((x) => x.id === a.id);
  const firstApplicationsLoadRef = useRef(true);
  const prevApplicationIdsRef = useRef(new Set());
  useEffect(() => {
    const unsubscribe = applicationsListen((list) => {
      if (firstApplicationsLoadRef.current) {
        firstApplicationsLoadRef.current = false;
      } else if (list.some((a) => !prevApplicationIdsRef.current.has(a.id))) {
        playOrderBeep();
      }
      prevApplicationIdsRef.current = new Set(list.map((a) => a.id));
      setApplications(list);
    });
    return () => unsubscribe();
  }, []);

  // ---- Sales Officer / Sales Executive login + dashboard ----
  // Login is valid for 6 hours from the moment of login (loginAt is saved, so refresh / leaving the tab does not reset it).
  const SALES_SESSION_MS = 6 * 60 * 60 * 1000;
  const [salesAuth, setSalesAuth] = useState(() => {
    try {
      const raw = localStorage.getItem("apniDukanSales");
      const u = raw ? JSON.parse(raw) : null;
      return u && u.loginAt && Date.now() < u.loginAt + SALES_SESSION_MS ? u : null;
    } catch {
      return null;
    }
  });
  const [salesNow, setSalesNow] = useState(() => Date.now());
  useEffect(() => {
    if (!salesAuth) return undefined;
    setSalesNow(Date.now());
    const t = setInterval(() => setSalesNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [salesAuth]);
  const salesRemaining = salesAuth
    ? Math.max(0, Math.floor((salesAuth.loginAt + SALES_SESSION_MS - salesNow) / 1000))
    : 0;
  useEffect(() => {
    if (salesAuth && salesRemaining <= 0) salesLogout();
  }, [salesAuth, salesRemaining]);
  const [salesVisits, setSalesVisits] = useState([]);
  useEffect(() => {
    if (!salesAuth) return undefined;
    const unsubscribe = visitsListen(setSalesVisits);
    return () => unsubscribe();
  }, [salesAuth]);
  // ---- Trader / Retailer login: all product rates shown 5% less while logged in ----
  const TRADER_DISCOUNT_PCT = 5;
  const [traderAuth, setTraderAuth] = useState(() => {
    try {
      const raw = localStorage.getItem("apniDukanTrader");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [traders, setTraders] = useState([]);
  useEffect(() => {
    if (!isAdmin) return undefined;
    const unsubscribe = tradersListen(setTraders);
    return () => unsubscribe();
  }, [isAdmin]);
  // ---- Blog posts (Blog Writer dashboard + admin review) ----
  const [blogPosts, setBlogPosts] = useState([]);
  const needBlogPosts = isAdmin || (salesAuth && salesAuth.role === BLOG_ROLE);
  useEffect(() => {
    if (!needBlogPosts) return undefined;
    const unsubscribe = blogPostsListen(setBlogPosts);
    return () => unsubscribe();
  }, [needBlogPosts]);
  async function blogWriterSave(data) {
    if (!salesAuth) return;
    const now = Date.now();
    const old = blogPosts.find((p) => p.id === data.id && p.by === salesAuth.id);
    await blogPostSave({
      id: old ? old.id : `${now}_${Math.random().toString(36).slice(2, 8)}`,
      by: salesAuth.id, byName: salesAuth.name,
      title: data.title, category: data.category, body: data.body,
      status: data.status,
      note: data.status === "review" ? "" : (old && old.note) || "",
      createdAt: old ? old.createdAt : now, updatedAt: now,
      ...(old && old.publishedAt ? { publishedAt: old.publishedAt } : {}),
    });
  }
  async function adminBlogSet(post, status, note) {
    await blogPostSave({
      ...post, status, note: note || "", updatedAt: Date.now(),
      ...(status === "published" ? { publishedAt: Date.now() } : {}),
    });
  }
  // ---- Market directory (front page "Market" button) ----
  const [marketSel, setMarketSel] = useState(null);       // selected market name
  const [sellerFilter, setSellerFilter] = useState(null);  // {id, name} -> home shows only that seller's products
  function openSellerProducts(s) {
    setSellerFilter({ id: s.id, name: s.name });
    setCategory("બધું");
    setSubcategory("બધું");
    setQuery("");
    setView("home");
  }
  // Storefront price list. Admin and all stored data keep using the real "products"; only the shop display/cart use this.
  const shopProducts = useMemo(() => {
    if (!traderAuth || isAdmin) return products;
    return products.map((p) => ({ ...p, price: Math.round(Number(p.price || 0) * (100 - TRADER_DISCOUNT_PCT)) / 100 }));
  }, [products, traderAuth, isAdmin]);
  function traderLogoutQuiet() {
    try { localStorage.removeItem("apniDukanTrader"); } catch {}
    setTraderAuth(null);
  }
  function loginTrader(t) {
    const u = { mobile: t.mobile, kind: t.kind, firm: t.firm, tabs: t.tabs || [] };
    try { localStorage.setItem("apniDukanTrader", JSON.stringify(u)); } catch {}
    setTraderAuth(u);
    setView("home");
  }
  async function gateTraderSignup(d) {
    try {
      if (await traderGet(d.mobile)) return { ok: false, error: "આ મોબાઇલ નંબરથી એકાઉન્ટ પહેલેથી છે. Login કરો." };
      const passHash = await hashPw(d.mobile, d.password);
      await traderSave({ mobile: d.mobile, kind: d.kind, firm: d.firm, tabs: d.tabs, gstin: d.gstin, address: d.address, passHash, createdAt: Date.now() });
      loginTrader(d);
      return { ok: true };
    } catch (e) {
      console.error("trader signup failed", e);
      return { ok: false, error: "Signup થયું નહીં, ફરી પ્રયત્ન કરો." };
    }
  }
  async function gateTraderLogin(mobile, password) {
    try {
      const t = await traderGet(mobile);
      const h = await hashPw(mobile, password);
      if (!t || t.passHash !== h) return { ok: false, error: "મોબાઇલ નંબર અથવા પાસવર્ડ ખોટો છે." };
      loginTrader({ mobile, kind: t.kind, firm: t.firm, tabs: t.tabs });
      return { ok: true };
    } catch (e) {
      console.error("trader login failed", e);
      return { ok: false, error: "Login થયું નહીં, ફરી પ્રયત્ન કરો." };
    }
  }
  function gateAdminLogin(pin) {
    if (pin === ADMIN_PIN) {
      traderLogoutQuiet();
      setIsAdmin(true);
      setView("admin");
      return true;
    }
    return false;
  }
  function gateSalesSuccess(user) {
    const u = { ...user, loginAt: Date.now() };
    try { localStorage.setItem("apniDukanSales", JSON.stringify(u)); } catch {}
    setSalesNow(Date.now());
    setSalesAuth(u);
    setView("salesDash");
  }
  function salesLogout() {
    try { localStorage.removeItem("apniDukanSales"); } catch {}
    setSalesAuth(null);
    setSalesVisits([]);
    setView((v) => (v === "salesDash" ? "home" : v));
  }
  async function salesAddVisit(data) {
    if (!salesAuth) return;
    await visitSave({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      by: salesAuth.id, byName: salesAuth.name, role: salesAuth.role,
      ...data, createdAt: Date.now(),
    });
  }

  // Live enquiries — same real-time + notification pattern as orders, so
  // the admin finds out about a new "New Enquiry" submission immediately.
  const [enquiries, setEnquiries] = useState([]);
  const firstEnquiriesLoadRef = useRef(true);
  const prevEnquiryIdsRef = useRef(new Set());

  useEffect(() => {
    const unsubscribe = enquiriesListen((list) => {
      if (firstEnquiriesLoadRef.current) {
        firstEnquiriesLoadRef.current = false;
      } else {
        const newOnes = list.filter((e) => !prevEnquiryIdsRef.current.has(e.id));
        if (newOnes.length > 0) {
          playOrderBeep();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            newOnes.forEach((e) => {
              try {
                new Notification("📩 નવી પૂછપરછ આવી!", {
                  body: e.text ? e.text.slice(0, 80) : "ફોટો સાથે પૂછપરછ",
                  tag: e.id,
                });
              } catch {}
            });
          }
        }
      }
      prevEnquiryIdsRef.current = new Set(list.map((e) => e.id));
      setEnquiries(list);
    });
    return () => unsubscribe();
  }, []);

  // Premium customer: Login pachhi faqat potana pasand karela tab dekhay
  const premiumTabs = useMemo(() => {
    const tb = w && w.user && w.wallet && w.wallet.tabs;
    return Array.isArray(tb) && tb.length ? tb : null;
  }, [w.user, w.wallet]);
  useEffect(() => {
    if (premiumTabs && category !== "બધું" && category !== ENQUIRY_CAT && !premiumTabs.includes(category)) setCategory("બધું");
  }, [premiumTabs, category]);

  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category));
    const ordered = CATEGORIES_DEFAULT.filter((c) => cats.has(c) || ALWAYS_SHOW_CATEGORIES.includes(c));
    const extra = Array.from(cats).filter((c) => !CATEGORIES_DEFAULT.includes(c));
    const extraCustom = customCategories.filter((c) => !ordered.includes(c) && !extra.includes(c));
    if (premiumTabs) return ["બધું", ...premiumTabs];
    return ["બધું", ...ordered, ...extra, ...extraCustom];
  }, [products, customCategories, premiumTabs]);

  // Direct category link support (for Google Ads etc.):
  //   apnidukanse.in/?cat=last      -> opens the LAST category tab (Navratri)
  //   apnidukanse.in/?cat=navratri  -> opens the category whose name contains "navratri"
  // Applied once, after products have loaded.
  const urlCatApplied = useRef(false);
  useEffect(() => {
    if (urlCatApplied.current || loading || products.length === 0) return;
    urlCatApplied.current = true;
    try {
      const want = (new URLSearchParams(window.location.search).get("cat") || "").trim().toLowerCase();
      if (!want) return;
      const real = categories.filter((c) => c !== "બધું");
      const match =
        want === "last"
          ? real[real.length - 1]
          : real.find((c) => String(c).toLowerCase() === want) ||
            real.find((c) => String(c).toLowerCase().includes(want));
      if (match) {
        setCategory(match);
        setSubcategory("બધું");
      }
    } catch {}
  }, [products, categories, loading]);

  // full list of category options for the admin add/edit-product dropdown
  const allCategoryOptions = useMemo(() => {
    const merged = new Set([...CATEGORIES_DEFAULT, ...PREMIUM_TABS, ...customCategories, ...products.map((p) => p.category)]);
    return Array.from(merged);
  }, [customCategories, products]);

  const filtered = useMemo(() => {
    return shopProducts.filter((p) => {
      const matchCat = category === "બધું" ? (!premiumTabs || premiumTabs.includes(p.category)) : p.category === category;
      const matchSubcat =
        subcatsFor(category, subcatCustom).length === 0 ||
        subcategory === "બધું" ||
        p.subcategory === subcategory ||
        (subcategory === "અન્ય" && !p.subcategory);
      const matchQuery = (p.name || "").toLowerCase().includes(query.toLowerCase());
      const matchSeller = !sellerFilter || (p.sellerId || inferSellerId(p)) === sellerFilter.id;
      return matchCat && matchSubcat && matchQuery && matchSeller;
    });
  }, [shopProducts, query, category, subcategory, subcatCustom, sellerFilter, premiumTabs]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([key, qty]) => {
        const [id, sizePart] = key.split("__SIZE__");
        const p = shopProducts.find((x) => x.id === id);
        if (!p) return null;
        const size = sizePart ? decodeURIComponent(sizePart) : null;
        return { ...p, id: key, baseId: id, qty, size };
      })
      .filter(Boolean);
  }, [cart, shopProducts]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);

  function addToCart(id, size) {
    const pr = products.find((x) => x.id === id);
    if (pr && isOutOfStock(pr)) return;   // seller marked "ખતમ" or stock is 0
    const leftStock = stockOf(pr);
    if (leftStock !== null) {
      const inCart = Object.entries(cart).reduce((s, [k, q]) => (k.split("__SIZE__")[0] === id ? s + q : s), 0);
      if (inCart >= leftStock) return;   // can't add more than the stock available
    }
    const key = size && size.trim() ? `${id}__SIZE__${encodeURIComponent(size.trim())}` : id;
    setCart((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
  }
  function decFromCart(id) {
    setCart((prev) => {
      const next = { ...prev };
      if (!next[id]) return next;
      next[id] -= 1;
      if (next[id] <= 0) delete next[id];
      return next;
    });
  }
  function removeFromCart(id) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const [checkoutForm, setCheckoutForm] = useState({ name: "", phone: "", address: "", pincode: "" });
  usePremiumAutofill(w, checkoutForm, setCheckoutForm);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  // Pincodes eligible for free delivery regardless of order total.
  const FREE_DELIVERY_PINCODES = ["382345", "382330"];
  const PROMO_CODES = { NAVGHAN20: 20, KARAN20: 20, YASHIKA20: 20, SUBHASH20: 20, BHAGAT28: 72 };
  // Optional per-code rules. maxDiscount = cap in Rs, maxUses = total uses allowed (default 2), expires = ISO time.
  const PROMO_RULES = {
    BHAGAT28: { maxDiscount: 100, maxUses: 10, expires: "2026-09-28T23:58:00+05:30" },
  };
  const promoMaxUses = (code) => (PROMO_RULES[code] && PROMO_RULES[code].maxUses !== undefined ? PROMO_RULES[code].maxUses : 2);
  const promoExpired = (code) => !!(PROMO_RULES[code] && PROMO_RULES[code].expires && Date.now() >= new Date(PROMO_RULES[code].expires).getTime());
  // Items eligible for item-specific promo codes (category + name match). Codes without "nameHas" apply to the whole cart.
  const promoItemMatches = (code, item) => {
    const r = PROMO_RULES[code];
    if (!r || !r.nameHas) return true;
    const cat = (item.category || "").trim().toLowerCase();
    const nm = (item.name || "").toLowerCase().replace(/\s+/g, "");
    return cat.startsWith(r.category || "") && r.nameHas.every((w) => nm.includes(w));
  };
  const promoEligibleSubtotal = (code) => {
    const r = PROMO_RULES[code];
    if (!r || !r.nameHas) return cartTotal;
    return cartItems
      .filter((i) => promoItemMatches(code, i))
      .reduce((sum, i) => sum + i.price * (r.maxUnits ? Math.min(i.qty, r.maxUnits) : i.qty), 0);
  };
  const promoNotEligibleMsg = (code) => {
    const r = PROMO_RULES[code];
    if (r && r.nameHas && promoEligibleSubtotal(code) <= 0) return r.onlyMsg || "આ કોડ આ કાર્ટ માટે લાગુ પડતો નથી.";
    return "";
  };
  const isFreeDeliveryPincode = FREE_DELIVERY_PINCODES.includes(checkoutForm.pincode.trim());
  // "no-bill" = direct order, no GST. "with-bill" = proper GST bill, 18% added.
  const [billOption, setBillOption] = useState("no-bill");
  const [gstNumber, setGstNumber] = useState("");
  const deliveryFee = (cartTotal > 999 || isFreeDeliveryPincode) ? 0 : 49;
  const gstAmount = billOption === "with-bill" ? Math.round(cartTotal * 0.18) : 0;
  const promoDiscountPercent = appliedPromoCode ? PROMO_CODES[appliedPromoCode] || 0 : 0;
  const promoBase = appliedPromoCode ? promoEligibleSubtotal(appliedPromoCode) : 0;
  const promoBaseWithGst = billOption === "with-bill" ? promoBase + Math.round(promoBase * 0.18) : promoBase;
  const promoDiscountRaw = Math.round(promoBaseWithGst * (promoDiscountPercent / 100));
  const promoCap = appliedPromoCode && PROMO_RULES[appliedPromoCode] ? PROMO_RULES[appliedPromoCode].maxDiscount : undefined;
  const promoDiscountAmount = promoCap !== undefined ? Math.min(promoDiscountRaw, promoCap) : promoDiscountRaw;
  const grandTotal = cartTotal + deliveryFee + gstAmount - promoDiscountAmount;

  function applyPromoCode() {
    const code = promoCodeInput.trim().toUpperCase();
    if (!code) {
      setPromoError("પ્રોમો કોડ નાખો.");
      return;
    }
    if (!PROMO_CODES[code]) {
      setPromoError("આ પ્રોમો કોડ માન્ય નથી.");
      setAppliedPromoCode(null);
      return;
    }
    const usedCount = orders.filter((o) => o.promoCode === code).length;
    if (usedCount >= promoMaxUses(code) || promoExpired(code)) {
      setPromoError("Sorry, its too late — this code has expired.");
      setAppliedPromoCode(null);
      return;
    }
    const notEligible = promoNotEligibleMsg(code);
    if (notEligible) {
      setPromoError(notEligible);
      setAppliedPromoCode(null);
      return;
    }
    setAppliedPromoCode(code);
    setPromoError("");
  }

  function removePromoCode() {
    setAppliedPromoCode(null);
    setPromoCodeInput("");
    setPromoError("");
  }

  async function placeOrder() {
    if (!checkoutForm.name.trim() || !checkoutForm.phone.trim() || !checkoutForm.address.trim() || !checkoutForm.pincode.trim()) {
      setCheckoutError("કૃપા કરીને બધી વિગત ભરો.");
      return;
    }
    if (checkoutForm.pincode.trim().length !== 6) {
      setCheckoutError("કૃપા કરીને સાચો 6 અંકનો પિનકોડ ભરો.");
      return;
    }
    if (billOption === "with-bill" && !gstNumber.trim()) {
      setCheckoutError("કૃપા કરીને GST નંબર ભરો.");
      return;
    }
    if (appliedPromoCode) {
      const usedCount = orders.filter((o) => o.promoCode === appliedPromoCode).length;
      if (usedCount >= promoMaxUses(appliedPromoCode) || promoExpired(appliedPromoCode)) {
        setCheckoutError("Sorry, its too late — this code has expired.");
        setAppliedPromoCode(null);
        return;
      }
      const notEligible = promoNotEligibleMsg(appliedPromoCode);
      if (notEligible) {
        setCheckoutError(notEligible);
        setAppliedPromoCode(null);
        return;
      }
    }
    const soldOutItem = cartItems.find((i) => isOutOfStock(i));
    if (soldOutItem) {
      setCheckoutError(`${soldOutItem.name} હાલ ઉપલબ્ધ નથી (Out of stock). કૃપા કરીને કાર્ટમાંથી કાઢી નાખો.`);
      return;
    }
    const qtyByBase = {};
    cartItems.forEach((i) => { qtyByBase[i.baseId] = (qtyByBase[i.baseId] || 0) + i.qty; });
    const overItem = cartItems.find((i) => stockOf(i) !== null && qtyByBase[i.baseId] > stockOf(i));
    if (overItem) {
      setCheckoutError(`${overItem.name} ફક્ત ${stockOf(overItem)} બાકી છે. કાર્ટમાં સંખ્યા ઓછી કરો.`);
      return;
    }
    setCheckoutError("");
    setSaving(true);
    const order = {
      id: uid("ord"),
      items: cartItems.map((i) => ({ id: i.id, name: i.size ? `${i.name} (Size: ${i.size})` : i.name, price: i.price, qty: i.qty, sellerId: i.sellerId || inferSellerId(i) || null })),
      subtotal: cartTotal,
      deliveryFee,
      billOption,
      gstNumber: billOption === "with-bill" ? gstNumber.trim() : undefined,
      gstAmount,
      promoCode: appliedPromoCode || undefined,
      promoDiscountAmount: appliedPromoCode ? promoDiscountAmount : 0,
      total: grandTotal,
      customer: { ...checkoutForm },
      payment: "કેશ ઓન ડિલિવરી",
      status: "નવો",
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem("apniDukanMyPhone", checkoutForm.phone.trim());
      setMyPhone(checkoutForm.phone.trim());
    } catch {}
    try {
      let freshOrders = orders;
      try {
        const freshRes = await storageGet("orders");
        if (freshRes) freshOrders = JSON.parse(freshRes.value) || [];
      } catch {}
      const nextOrders = [order, ...freshOrders];
      const res = await storageSet("orders", JSON.stringify(nextOrders));
      setOrders(nextOrders);
      stockReduce(order.items);
      setCart({});
      setLastOrderId(String(nextOrders.length));
      setLastOrderPaid(false);
      setView("success");
      // Log a GA4 "purchase" event so revenue shows up in Analytics —
      // without this, GA never knows an order happened even though it's
      // saved fine in storage. Wrapped in try/catch so it never blocks
      // the order if Analytics fails to load.
      try {
        logEvent(analytics, "purchase", {
          transaction_id: order.id,
          value: order.total,
          currency: "INR",
          items: order.items.map((i) => ({
            item_name: i.name,
            price: i.price,
            quantity: i.qty,
          })),
        });
      } catch {}
      setCheckoutForm({ name: "", phone: "", address: "", pincode: "" });
      setAppliedPromoCode(null);
      setPromoCodeInput("");
      setBillOption("no-bill");
      setGstNumber("");
      // Fire the real push notification via the Vercel API route — this
      // works even if the admin's phone screen is off / app is closed,
      // unlike the browser Notification API which only fires while a tab
      // is open. Never blocks the customer's order if this call fails.
      try {
        fetch("/api/send-order-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.id,
            customerName: order.customer.name,
            total: order.total,
          }),
        }).catch(() => {});
      } catch {}
      // Email notification via EmailJS — sends straight from the browser,
      // no backend needed. Never blocks the customer's order if it fails.
      try {
        fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: "service_yg8sysc",
            template_id: "template_h01cv8i",
            user_id: "40etdMV1rISl5hS5f",
            template_params: {
              customer_name: order.customer.name,
              customer_phone: order.customer.phone,
              customer_address: order.customer.address,
              total: formatRs(order.total),
              order_details: order.items.map((i) => `${i.name} x${i.qty}`).join(", "),
            },
          }),
        }).catch(() => {});
      } catch {}
      if (!res) {
        setLoadError("ઓર્ડર થઈ ગયો, પણ સર્વર પર સેવ કરવામાં તકલીફ પડી — એડમિન પેનલમાં કદાચ ના દેખાય.");
      }
    } catch (e) {
      // Even if storage sync fails, don't block the customer — complete the order locally
      const nextOrders = [order, ...orders];
      setOrders(nextOrders);
      stockReduce(order.items);
      setCart({});
      setLastOrderId(String(nextOrders.length));
      setLastOrderPaid(false);
      setView("success");
      try {
        logEvent(analytics, "purchase", {
          transaction_id: order.id,
          value: order.total,
          currency: "INR",
          items: order.items.map((i) => ({
            item_name: i.name,
            price: i.price,
            quantity: i.qty,
          })),
        });
      } catch {}
      setCheckoutForm({ name: "", phone: "", address: "", pincode: "" });
      setAppliedPromoCode(null);
      setPromoCodeInput("");
      setLoadError("ઓર્ડર થઈ ગયો, પણ સર્વર સાથે સેવ ના થયું: " + (e && e.message ? e.message : "અજાણી ભૂલ"));
    } finally {
      setSaving(false);
    }
  }

  // Opens a small printable invoice window for an order — the customer
  // taps "Save as PDF" in the browser's print dialog. No extra library
  // needed, so it can't break the Vercel build.
  function downloadOrderPdf(o, orderNumber) {
    const itemsRows = (o.items || [])
      .map((i) => `<tr><td>${i.name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">${formatRs(i.price)}</td><td style="text-align:right">${formatRs(i.price * i.qty)}</td></tr>`)
      .join("");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
      <head>
        <title>Order #${orderNumber}</title>
        <style>
          body{ font-family: 'Noto Sans Gujarati','Segoe UI',sans-serif; padding: 24px; color:#24282A; }
          h1{ font-size:18px; margin-bottom:2px; }
          .muted{ color:#666; font-size:12px; margin-bottom:16px; }
          .ref{ color:#D8531F; font-weight:700; font-size:13px; margin-bottom:10px; }
          table{ width:100%; border-collapse:collapse; margin-top:12px; }
          th, td{ padding:6px 8px; border-bottom:1px solid #ddd; font-size:13px; }
          th{ text-align:left; background:#F2EFE4; }
          .total-row td{ font-weight:800; font-size:14px; border-top:2px solid #24282A; }
        </style>
      </head>
      <body>
        <h1>અપની દુકાન — ઓર્ડર #${orderNumber}</h1>
        <div class="muted">${formatOrderDate(o.createdAt)}</div>
        <div><strong>ગ્રાહક:</strong> ${o.customer.name} — ${o.customer.phone}</div>
        <div><strong>સરનામું:</strong> ${o.customer.address}</div>
        <table>
          <tr><th>પ્રોડક્ટ</th><th>જથ્થો</th><th>ભાવ</th><th>કુલ</th></tr>
          ${itemsRows}
          <tr class="total-row"><td colspan="3">કુલ રકમ</td><td style="text-align:right">${formatRs(o.total)}</td></tr>
        </table>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  async function updateOrderStatus(orderId, status) {
    let base = orders;
    try {
      const freshRes = await storageGet("orders");
      if (freshRes) base = JSON.parse(freshRes.value) || [];
    } catch {}
    const next = base.map((o) => (o.id === orderId ? { ...o, status } : o));
    setOrders(next);
    try {
      await storageSet("orders", JSON.stringify(next));
    } catch {}
  }

  async function importSeedCatalog() {
    setSaving(true);
    try {
      const existingIds = new Set(products.map((p) => p.id));
      const toAdd = SEED_PRODUCTS.filter((p) => !existingIds.has(p.id));
      if (toAdd.length) await productsBulkSave(toAdd);
    } catch {} finally {
      setSaving(false);
    }
  }

  // One-time fix: PIX/Ecodrive products were already saved in Firestore
  // under their old categories, and the new Lifting Belt products don't
  // exist there yet — importSeedCatalog only adds missing products, it
  // doesn't overwrite existing ones. This force-re-saves everything under
  // the "Belt" category (V Belt + Lifting Belt) with today's data.
  async function refreshBeltCategory() {
    setSaving(true);
    try {
      const beltProducts = SEED_PRODUCTS.filter((p) => p.category === "Belt");
      await productsBulkSave(beltProducts);
      alert(`Belt કેટેગરી અપડેટ થઈ ગઈ! (${beltProducts.length} પ્રોડક્ટ્સ)`);
    } catch (err) {
      console.error(err);
      alert("અપડેટ કરવામાં તકલીફ થઈ.");
    } finally {
      setSaving(false);
    }
  }

  async function saveProduct() {
    if (!newProduct.name.trim() || !newProduct.price) return;
    const stockVal = newProduct.stock === "" ? undefined : Number(newProduct.stock);

    let p;
    if (editingProductId) {
      const existing = products.find((x) => x.id === editingProductId) || {};
      p = {
        ...existing,
        id: editingProductId,
        name: newProduct.name.trim(),
        category: newProduct.category,
        subcategory: newProduct.subcategory || "",
        price: Number(newProduct.price),
        img: newProduct.img || "🛍️",
        image: newProduct.image || existing.image,
        stock: stockVal,
        sellerId: newProduct.sellerId || null,
      };
    } else {
      p = {
        id: uid("p"),
        name: newProduct.name.trim(),
        category: newProduct.category,
        ...(newProduct.subcategory ? { subcategory: newProduct.subcategory } : {}),
        price: Number(newProduct.price),
        img: newProduct.img || "🛍️",
        image: newProduct.image || undefined,
        stock: stockVal,
        sellerId: newProduct.sellerId || null,
      };
    }
    resetProductPhoto();
    setNewProduct({ name: "", category: newProduct.category, subcategory: newProduct.subcategory, price: "", img: "🛍️", image: "", stock: "", sellerId: newProduct.sellerId });
    setEditingProductId(null);
    try {
      await productSave(p);
    } catch {}
  }

  function startEditProduct(p) {
    resetProductPhoto();
    setEditingProductId(p.id);
    setNewProduct({
      name: p.name || "",
      category: p.category || allCategoryOptions[0] || "",
      subcategory: p.subcategory || "",
      price: p.price != null ? String(p.price) : "",
      img: p.img || "🛍️",
      image: p.image || "",
      stock: p.stock != null ? String(p.stock) : "",
      sellerId: p.sellerId || "",
    });
  }

  function cancelEditProduct() {
    setEditingProductId(null);
    resetProductPhoto();
    setNewProduct({ name: "", category: newProduct.category, subcategory: newProduct.subcategory, price: "", img: "🛍️", image: "", stock: "", sellerId: newProduct.sellerId });
  }

  async function saveSubcatCustom(next) {
    setSubcatCustom(next);
    try { await storageSet("subcategories", JSON.stringify(next)); } catch {}
  }
  async function addSubcategory(cat, name) {
    const n = String(name || "").trim();
    if (!cat || !n) return false;
    if (subcatsFor(cat, subcatCustom).some((x) => x.toLowerCase() === n.toLowerCase())) return false;
    await saveSubcatCustom({ ...subcatCustom, [cat]: [...(subcatCustom[cat] || []), n] });
    return true;
  }
  async function removeSubcategory(cat, name) {
    if (!window.confirm(`"${name}" પેટા કેટેગરી કાઢી નાખવી? (પ્રોડક્ટ્સ કાઢવામાં નહીં આવે)`)) return;
    await saveSubcatCustom({ ...subcatCustom, [cat]: (subcatCustom[cat] || []).filter((x) => x !== name) });
  }

  function buildProductImage(img, mode, theme, price) {
    try {
      return mode === "poster" ? imgMakePoster(img, { price, theme }) : imgMakePlain(img);
    } catch (e) {
      console.error("photo make failed", e);
      return "";
    }
  }
  async function handleProductImageFile(file) {
    if (!file) return;
    setImgBusy(true);
    try {
      const img = await imgLoadFile(file);
      imgSourceRef.current = img;
      setImgNew(true);
      const out = buildProductImage(img, imgMode, imgTheme, newProduct.price);
      if (out) setNewProduct((f) => ({ ...f, image: out }));
    } catch {
      window.alert("ફોટો વાંચી શકાયો નથી. બીજો ફોટો પસંદ કરો.");
    }
    setImgBusy(false);
  }
  function resetProductPhoto() {
    imgSourceRef.current = null;
    setImgNew(false);
  }
  // the poster is made again when the price, style or mode changes (only for a photo picked just now)
  useEffect(() => {
    const img = imgSourceRef.current;
    if (!img) return undefined;
    const t = setTimeout(() => {
      const out = buildProductImage(img, imgMode, imgTheme, newProduct.price);
      if (out) setNewProduct((f) => ({ ...f, image: out }));
    }, 350);
    return () => clearTimeout(t);
  }, [imgMode, imgTheme, newProduct.price]);

  // ---- bulk add helpers ----
  function addBulkRow() {
    setBulkRows((rows) => [...rows, { name: "", price: "", stock: "", img: "🛍️", image: "" }]);
  }
  function removeBulkRow(idx) {
    setBulkRows((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateBulkRow(idx, field, value) {
    setBulkRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  async function handleBulkRowImageFile(idx, file) {
    if (!file) return;
    try {
      const img = await imgLoadFile(file);
      updateBulkRow(idx, "image", imgMakePlain(img));
    } catch {
      window.alert("ફોટો વાંચી શકાયો નથી. બીજો ફોટો પસંદ કરો.");
    }
  }

  async function saveBulkRows() {
    const cat = bulkCategory.trim();
    if (!cat) {
      setBulkMessage("કૃપા કરીને કેટેગરી પસંદ કરો અથવા લખો.");
      return;
    }
    const validRows = bulkRows.filter((r) => r.name.trim() && r.price !== "");
    if (!validRows.length) {
      setBulkMessage("ઓછામાં ઓછું એક પ્રોડક્ટ નામ અને ભાવ સાથે ભરો.");
      return;
    }
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const newProducts = validRows.map((r) => ({
        id: uid("p"),
        name: r.name.trim(),
        category: cat,
        price: Number(r.price),
        img: r.img || "🛍️",
        image: r.image || undefined,
        stock: r.stock === "" ? undefined : Number(r.stock),
      }));
      await productsBulkSave(newProducts);
      if (!customCategories.includes(cat) && !CATEGORIES_DEFAULT.includes(cat)) {
        const nextCats = [...customCategories, cat];
        setCustomCategories(nextCats);
        try {
          await storageSet("customCategories", JSON.stringify(nextCats));
        } catch {}
      }
      setBulkMessage(`✅ ${newProducts.length} પ્રોડક્ટ ઉમેરાયા.`);
      setBulkRows([{ name: "", price: "", stock: "", img: "🛍️", image: "" }]);
    } catch (e) {
      setBulkMessage("સેવ કરવામાં તકલીફ થઈ: " + (e && e.message ? e.message : "અજાણી ભૂલ"));
    } finally {
      setBulkSaving(false);
    }
  }

  async function deleteProduct(id) {
    if (editingProductId === id) cancelEditProduct();
    try {
      await productDelete(id);
    } catch {}
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    if (CATEGORIES_DEFAULT.includes(name) || customCategories.includes(name)) {
      setNewCategoryName("");
      return;
    }
    const next = [...customCategories, name];
    setCustomCategories(next);
    setNewCategoryName("");
    try {
      await storageSet("customCategories", JSON.stringify(next));
    } catch {}
  }

  async function deleteCategory(name) {
    const next = customCategories.filter((c) => c !== name);
    setCustomCategories(next);
    try {
      await storageSet("customCategories", JSON.stringify(next));
    } catch {}
  }

  function tryAdminLogin() {
    if (pinInput === ADMIN_PIN) {
      traderLogoutQuiet();
      setIsAdmin(true);
      setPinError("");
      setView("admin");
    } else {
      setPinError("ખોટો PIN. ફરી પ્રયત્ન કરો.");
    }
  }

  if (loading) {
    return (
      <div style={styles.appShell} className="app-shell">
        <div style={{ ...styles.phoneFrame, alignItems: "center", justifyContent: "center", display: "flex" }} className="phone-frame">
          <Loader2 size={30} color="#2c2a26" className="spin" />
        </div>
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:480px){
  .app-shell{padding:0 !important;}
  .phone-frame{width:100% !important;height:100vh !important;max-height:none !important;border:none !important;border-radius:0 !important;box-shadow:none !important;}
}`}</style>
      </div>
    );
  }

  return (
    <div style={styles.appShell} className="app-shell">
      {/* ✅ VERCEL ANALYTICS - Tracks real-time visitor data & performance */}
      <Analytics />
      <FallingLogoAdsOverlay />
      <DuckAnimation />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Noto+Sans+Gujarati:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
/* 🖥️ DESKTOP / WEB VIEW: moti screen par puri width, phone jevo frame nahi */
@media (min-width:900px){
  .app-shell{padding:0 !important;align-items:stretch !important;}
  .phone-frame{width:100% !important;max-width:1240px !important;height:100vh !important;max-height:none !important;border:none !important;border-radius:0 !important;box-shadow:0 0 40px rgba(0,0,0,0.08) !important;}
  .product-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr)) !important;gap:18px !important;padding:0 28px 28px !important;}
  .card-img{height:170px !important;}
  .view-narrow{display:flex !important;flex-direction:column !important;align-items:center !important;}
  .view-narrow > *{width:100% !important;max-width:760px !important;box-sizing:border-box;}
  .view-narrow-box{width:100% !important;max-width:760px !important;margin-left:auto !important;margin-right:auto !important;box-sizing:border-box;}
  .view-wide-box{width:100% !important;max-width:1100px !important;margin-left:auto !important;margin-right:auto !important;box-sizing:border-box;}
}
@media (max-width:480px){
  .app-shell{padding:0 !important;}
  .phone-frame{width:100% !important;height:100vh !important;max-height:none !important;border:none !important;border-radius:0 !important;box-shadow:none !important;}
}
@keyframes adStripScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes fallDrop {
  0% { top: -70px; }
  100% { top: 105%; }
}
@keyframes fallH0 {
  0% { transform: translateX(28px) rotate(9.3deg); }
  20% { transform: translateX(-51px) rotate(-17.0deg); }
  40% { transform: translateX(59px) rotate(19.7deg); }
  60% { transform: translateX(-33px) rotate(-11.0deg); }
  80% { transform: translateX(44px) rotate(14.7deg); }
  100% { transform: translateX(-22px) rotate(-7.3deg); }
}
@keyframes fallH1 {
  0% { transform: translateX(-40px) rotate(-13.3deg); }
  20% { transform: translateX(35px) rotate(11.7deg); }
  40% { transform: translateX(-58px) rotate(-19.3deg); }
  60% { transform: translateX(27px) rotate(9.0deg); }
  80% { transform: translateX(-45px) rotate(-15.0deg); }
  100% { transform: translateX(38px) rotate(12.7deg); }
}
@keyframes fallH2 {
  0% { transform: translateX(50px) rotate(16.7deg); }
  20% { transform: translateX(-29px) rotate(-9.7deg); }
  40% { transform: translateX(41px) rotate(13.7deg); }
  60% { transform: translateX(-55px) rotate(-18.3deg); }
  80% { transform: translateX(23px) rotate(7.7deg); }
  100% { transform: translateX(-48px) rotate(-16.0deg); }
}
@keyframes fallH3 {
  0% { transform: translateX(-33px) rotate(-11.0deg); }
  20% { transform: translateX(47px) rotate(15.7deg); }
  40% { transform: translateX(-26px) rotate(-8.7deg); }
  60% { transform: translateX(54px) rotate(18.0deg); }
  80% { transform: translateX(-42px) rotate(-14.0deg); }
  100% { transform: translateX(31px) rotate(10.3deg); }
}
@keyframes fallH4 {
  0% { transform: translateX(37px) rotate(12.3deg); }
  20% { transform: translateX(-52px) rotate(-17.3deg); }
  40% { transform: translateX(24px) rotate(8.0deg); }
  60% { transform: translateX(-39px) rotate(-13.0deg); }
  80% { transform: translateX(56px) rotate(18.7deg); }
  100% { transform: translateX(-30px) rotate(-10.0deg); }
}`}</style>
      <div style={styles.phoneFrame} className="phone-frame">
        {/* ONE-TAP PRINT BANNER — Chrome won't auto-open Thermer without a
            real tap, so this shows up over any screen until tapped. */}
        {isAdmin && printQueue.length > 0 && (
          <button
            onClick={() => {
              printQueue.forEach((id) => {
                const ord = orders.find((x) => x.id === id);
                const found = groupOrdersByDate(orders).flatMap((g) => g.items).find((x) => x.order.id === id);
                triggerBluetoothPrint(id, ord, found ? found.orderNumber : undefined, sellers);
              });
              setPrintQueue([]);
            }}
            style={{
              position: "absolute", top: 8, left: 8, right: 8, zIndex: 999,
              background: "#1F5C40", color: "#F2EFE4", border: "none", borderRadius: 12,
              padding: "12px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
            }}
          >
            🖨️ {printQueue.length} નવો ઓર્ડર — Print કરવા ટેપ કરો
          </button>
        )}
        {/* TOP BAR */}
        <div style={styles.hazardStrip} />
        <div style={styles.topBar}>
          <TopBarNature />
          <div style={styles.brandRow}>
            {view !== "home" ? (
              <button
                style={styles.iconBtn}
                onClick={() => setView(view === "checkout" ? "cart" : "home")}
                aria-label="પાછળ"
              >
                <ArrowLeft size={20} color={T.ink} />
              </button>
            ) : (
              <div style={styles.brand}>
                <span style={styles.brandDot} />
                Support Youth Support Nation
              </div>
            )}
            {view === "home" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={styles.iconBtn} onClick={() => setView("myOrders")} aria-label="મારા ઓર્ડર્સ">
                  <ClipboardList size={18} color={T.ink} />
                </button>
                <button style={styles.iconBtn} onClick={() => setView("wishlist")} aria-label="મારી પસંદ">
                  <span style={{ fontSize: 16 }}>{wishlist.length > 0 ? "❤️" : "🤍"}</span>
                </button>
                <button style={styles.iconBtn} onClick={() => setView(sellerAuth ? "sellerOrders" : "sellerLogin")} aria-label="સેલર લોગિન">
                  <Store size={18} color={sellerAuth ? T.greenDeep : T.ink} />
                </button>
                <button style={styles.iconBtn} onClick={() => setView(isAdmin ? "admin" : salesAuth ? "salesDash" : "gate")} aria-label="લોગિન">
                  <Settings size={18} color={T.ink} />
                </button>
                <button style={styles.cartIconBtn} onClick={() => setView("cart")} aria-label="કાર્ટ">
                  <ShoppingCart size={20} color={T.ink} />
                  {cartCount > 0 && <span style={styles.cartBadge}>{cartCount}</span>}
                </button>
              </div>
            )}
            {view === "cart" && <div style={styles.brand}>કાર્ટ</div>}
            {view === "checkout" && <div style={styles.brand}>ચેકઆઉટ</div>}
            {view === "adminLogin" && <div style={styles.brand}>એડમિન લોગિન</div>}
            {view === "admin" && <div style={styles.brand}>એડમિન પેનલ</div>}
            {view === "sellerLogin" && <div style={styles.brand}>સેલર લોગિન</div>}
            {view === "sellerRegister" && <div style={styles.brand}>સેલર રજિસ્ટ્રેશન</div>}
            {view === "sellerOrders" && <div style={styles.brand}>સેલર ઓર્ડર્સ</div>}
            {view === "careers" && <div style={styles.brand}>કરિયર</div>}
            {view === "gate" && <div style={styles.brand}>લોગિન</div>}
            {view === "trader" && <div style={styles.brand}>Trader / Retailer</div>}
            {view === "market" && <div style={styles.brand}>માર્કેટ</div>}
            {view === "salesDash" && <div style={styles.brand}>{salesAuth ? salesAuth.role : "ડેશબોર્ડ"}</div>}
          </div>
          {view === "home" && (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 0 2px" }}>
              <PremiumLoginButton w={w} />
            </div>
          )}
          {view === "home" && (
            <div style={styles.ecoSloganRow}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 22s7-4.5 7-12a7 7 0 0 0-14 0c0 7.5 7 12 7 12z" fill={T.greenDeep} />
                <path d="M12 22V10" stroke="#153D2A" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span style={styles.ecoSloganText}>Save Environment, Save Nation</span>
            </div>
          )}
        </div>

        {loadError && <div style={styles.errorBanner}>{loadError}</div>}

        {/* DIWALI BONUS MODAL */}
        {bonusOpen && (
          <div onClick={() => setBonusOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: 18, maxHeight: "92vh", overflowY: "auto" }}>
              {bonusDone ? (
                <div style={{ textAlign: "center", padding: "10px 0" }}>
                  <div style={{ fontSize: 40 }}>🪔</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.green, marginTop: 6 }}>આભાર! માહિતી મોકલાઈ ગઈ.</div>
                  <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 6 }}>Happy Diwali! અમે ટૂંક સમયમાં સંપર્ક કરીશું.</div>
                  <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={() => setBonusOpen(false)}>બંધ કરો</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>🎁 Claim Diwali Bonus</div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, margin: "2px 0 12px" }}>નીચેની માહિતી ભરો</div>
                  {[["name", "પૂરું નામ", "text", 80], ["phone", "મોબાઈલ નંબર", "tel", 10]].map(([k, label, type, max]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>{label}</label>
                      <input type={type} inputMode={type === "tel" ? "numeric" : undefined} maxLength={max} value={bonusForm[k]}
                        onChange={(e) => setBonusForm((f) => ({ ...f, [k]: k === "phone" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", background: T.surface2, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 12 }} />
                    </div>
                  ))}
                  <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>સરનામું</label>
                  <textarea rows={3} maxLength={250} value={bonusForm.address}
                    onChange={(e) => setBonusForm((f) => ({ ...f, address: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", background: T.surface2, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 12, resize: "none" }} />
                  <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>Salary (માસિક)</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                    {BONUS_SALARY.map((o) => (
                      <button key={o} type="button" onClick={() => setBonusForm((f) => ({ ...f, salary: o }))}
                        style={{ ...styles.statusBtn, ...(bonusForm.salary === o ? styles.statusBtnActive : {}), flex: "none", padding: "12px 14px", fontSize: 14, textAlign: "left" }}>
                        {bonusForm.salary === o ? "● " : "○ "}{o}
                      </button>
                    ))}
                  </div>
                  {bonusError && <div style={{ color: "#b23b3b", fontSize: 13, marginBottom: 8 }}>{bonusError}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...styles.statusBtn, flex: 1, padding: 12 }} onClick={() => setBonusOpen(false)}>રદ કરો</button>
                    <button style={{ ...styles.primaryBtn, flex: 1 }} disabled={bonusSending} onClick={submitBonusForm}>{bonusSending ? "મોકલાય છે…" : "Submit"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* JOB APPLY MODAL */}
        {jobOpen && (
          <div onClick={() => setJobOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: 18, maxHeight: "92vh", overflowY: "auto" }}>
              {jobDone ? (
                <div style={{ textAlign: "center", padding: "10px 0" }}>
                  <div style={{ fontSize: 40 }}>🎉</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.green, marginTop: 6 }}>અરજી મોકલાઈ ગઈ!</div>
                  <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 6 }}>{jobOpen} માટે અમે ટૂંક સમયમાં સંપર્ક કરીશું.</div>
                  <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={() => setJobOpen(null)}>બંધ કરો</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>Apply – {jobOpen}</div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, margin: "2px 0 12px" }}>નીચેની માહિતી ભરો</div>
                  {[["name", "પૂરું નામ", "text", 80], ["phone", "મોબાઈલ નંબર", "tel", 10]].map(([k, label, type, max]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>{label}</label>
                      <input type={type} inputMode={type === "tel" ? "numeric" : undefined} maxLength={max} value={jobForm[k]}
                        onChange={(e) => setJobForm((f) => ({ ...f, [k]: k === "phone" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", background: T.surface2, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 12 }} />
                    </div>
                  ))}
                  {[["qualification", "Qualification", ["10th Pass", "12th Pass", "Graduate", "Post Graduate", "Diploma / ITI"]], ["experience", "Experience", ["Fresher", "1 વર્ષથી ઓછો", "1–3 વર્ષ", "3–5 વર્ષ", "5+ વર્ષ"]]].map(([k, label, opts]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>{label}</label>
                      <select value={jobForm[k]} onChange={(e) => setJobForm((f) => ({ ...f, [k]: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", background: T.surface2, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 12 }}>
                        <option value="">પસંદ કરો</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                  {jobError && <div style={{ color: "#b23b3b", fontSize: 13, marginBottom: 8 }}>{jobError}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...styles.statusBtn, flex: 1, padding: 12 }} onClick={() => setJobOpen(null)}>રદ કરો</button>
                    <button style={{ ...styles.primaryBtn, flex: 1 }} disabled={jobSending} onClick={submitJobApplication}>{jobSending ? "મોકલાય છે…" : "Submit"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* SALES LOGIN STRIP: name + 6 hour reverse timer on the storefront */}
        {salesAuth && !["salesDash", "gate", "admin", "adminLogin"].includes(view) && (
          <SalesSessionBar user={salesAuth} remaining={salesRemaining} onOpen={() => setView("salesDash")} />
        )}

        {/* TRADER / RETAILER STRIP: firm name + 5% less rates */}
        {traderAuth && !isAdmin && !["gate", "admin", "adminLogin"].includes(view) && (
          <TraderBar trader={traderAuth} pct={TRADER_DISCOUNT_PCT} onLogout={traderLogoutQuiet} />
        )}

        {/* HOME */}
        {view === "home" && (
          <div style={styles.scrollArea} className="scroll-area view-home">
            <SanskritMarquee />
            <IndependenceDayBanner />
            <HomeBannerTimer
              onBannerClick={(action) => {
                if (action === "sellerLogin") setView(sellerAuth ? "sellerOrders" : "sellerRegister");
                if (action === "diwaliBonus") openBonusForm();
                if (typeof action === "string" && action.startsWith("job:")) openJobForm(action.slice(4));
              }}
            />
            <ApkDownloadBanner />
            <AdStrip />
            <div style={{ display: "flex", gap: 8, padding: "4px 16px 8px" }}>
              {!traderAuth && (
                <button
                  onClick={() => setView("trader")}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1F5C40", color: "#fff", border: "none", borderRadius: 12, padding: "11px 8px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                >
                  <Store size={16} color="#FFD21F" /> Trader / Retailer
                </button>
              )}
              <button
                onClick={() => { setMarketSel(null); setView("market"); }}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#B5541C", color: "#fff", border: "none", borderRadius: 12, padding: "11px 8px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
              >
                📍 Market
              </button>
            </div>
            {sellerFilter && (
              <div style={{ padding: "0 16px 8px" }}>
                <button
                  onClick={() => setSellerFilter(null)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0B1F5C", color: "#fff", border: "none", borderRadius: 20, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  🏪 {sellerFilter.name} ✕
                </button>
              </div>
            )}
            <div style={styles.searchWrap}>
              <Search size={16} color="#8a8378" style={{ flexShrink: 0 }} />
              <input
                style={styles.searchInput}
                placeholder="પ્રોડક્ટ શોધો..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={styles.catRow}>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => { setCategory(c); setSubcategory("બધું"); }}
                  style={{ ...styles.catChip, ...(category === c ? styles.catChipActive : {}) }}
                >
                  {c}
                </button>
              ))}
              <button
                onClick={() => { setCategory(ENQUIRY_CAT); setSubcategory("બધું"); }}
                style={{
                  ...styles.catChip,
                  ...(category === ENQUIRY_CAT ? { background: T.orange, color: "#fff", borderColor: T.orange } : { background: "#fff7f2", color: T.orange, borderStyle: "dashed", borderColor: T.orange }),
                  fontWeight: 800,
                }}
              >
                + {ENQUIRY_CAT}
              </button>
            </div>
            {subcatsFor(category, subcatCustom).length > 0 && (
              <div style={{ ...styles.catRow, paddingTop: 0 }}>
                {[
                  "બધું",
                  ...subcatsFor(category, subcatCustom),
                  ...(products.some((p) => p.category === category && !p.subcategory) ? ["અન્ય"] : []),
                ].map((sc) => (
                  <button
                    key={sc}
                    onClick={() => setSubcategory(sc)}
                    style={{
                      ...styles.catChip,
                      fontSize: 11,
                      padding: "6px 12px 5px",
                      ...(subcategory === sc
                        ? { background: T.orange, color: "#fff", borderColor: T.orange }
                        : { background: "#fff", color: T.inkSoft }),
                    }}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            )}
            {category === ENQUIRY_CAT ? (
              <div style={{ padding: "4px 16px 24px" }}>
                <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 14 }}>
                  તમારી જરૂરિયાત લખો, અથવા ફોટો અપલોડ કરો — અમે ટૂંક સમયમાં સંપર્ક કરીશું.
                </div>

                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>
                  તમારું નામ
                </label>
                <input
                  type="text"
                  value={enquiryName}
                  onChange={(e) => setEnquiryName(e.target.value)}
                  placeholder="તમારું નામ લખો"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }}
                />

                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>
                  ફોન નંબર
                </label>
                <input
                  type="tel"
                  value={enquiryPhone}
                  onChange={(e) => setEnquiryPhone(e.target.value.replace(/[^0-9+ ]/g, ""))}
                  placeholder="9XXXXXXXXX"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }}
                />

                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>
                  જરૂરિયાત વિગત
                </label>
                <textarea
                  value={enquiryText}
                  onChange={(e) => setEnquiryText(e.target.value)}
                  placeholder="દા.ત. મારે 10mm સાઈઝના 50 V-belt જોઈએ છે..."
                  rows={5}
                  style={{
                    width: "100%", boxSizing: "border-box", resize: "none",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none",
                  }}
                />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, margin: "16px 0 6px", display: "block" }}>
                  ફોટો (વૈકલ્પિક)
                </label>
                {!enquiryPhoto ? (
                  <label style={{
                    width: "100%", boxSizing: "border-box", padding: "22px 14px",
                    background: T.surface2, border: `1.5px dashed ${T.hairline}`,
                    borderRadius: 12, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 6, cursor: "pointer", color: T.inkSoft,
                  }}>
                    <Plus size={22} color={T.orange} />
                    <span style={{ fontSize: 13 }}>ફોટો અપલોડ કરવા ટેપ કરો</span>
                    <input type="file" accept="image/*" onChange={handleEnquiryPhoto} style={{ display: "none" }} />
                  </label>
                ) : (
                  <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${T.hairline}` }}>
                    <img src={enquiryPhoto} alt="upload preview" style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "cover" }} />
                    <button
                      onClick={() => setEnquiryPhoto(null)}
                      style={{
                        position: "absolute", top: 8, right: 8, width: 28, height: 28,
                        borderRadius: 99, background: "rgba(36,40,42,0.75)", color: "#fff",
                        border: "none", cursor: "pointer", fontSize: 16, lineHeight: "28px",
                      }}
                    >×</button>
                  </div>
                )}
                <button
                  onClick={submitEnquiry}
                  disabled={!enquiryName.trim() || !enquiryPhone.trim() || (!enquiryText.trim() && !enquiryPhoto) || enquirySubmitting}
                  style={{
                    width: "100%", marginTop: 22, padding: "13px 0", borderRadius: 12,
                    border: "none", fontSize: 15, fontWeight: 800, cursor: "pointer",
                    background: (!enquiryName.trim() || !enquiryPhone.trim() || (!enquiryText.trim() && !enquiryPhoto)) ? T.hairline : T.orange,
                    color: (!enquiryName.trim() || !enquiryPhone.trim() || (!enquiryText.trim() && !enquiryPhoto)) ? T.inkSoft : "#fff",
                    boxShadow: (!enquiryName.trim() || !enquiryPhone.trim() || (!enquiryText.trim() && !enquiryPhoto)) ? "none" : "0 8px 18px rgba(216,83,31,0.3)",
                  }}
                >
                  {enquirySubmitting ? "મોકલી રહ્યા છીએ..." : "પૂછપરછ મોકલો"}
                </button>
                {enquirySubmitted && (
                  <div style={{
                    marginTop: 14, background: T.greenLight, color: T.green,
                    padding: "10px 14px", borderRadius: 10, fontSize: 13.5,
                    fontWeight: 700, textAlign: "center",
                  }}>
                    ✓ મોકલાયું! અમે ટૂંક સમયમાં સંપર્ક કરીશું.
                  </div>
                )}
              </div>
            ) : (
            <>
            <div style={styles.grid} className="product-grid">
              {filtered.map((p) => (
                <div key={p.id} style={styles.card}>
                  <div
                    className="card-img" style={{ ...styles.cardImgWrap, cursor: resolveProductImage(p) ? "zoom-in" : "default" }}
                    onClick={() => { const img = resolveProductImage(p); if (img) setZoomImage({ src: img, name: p.name }); }}
                  >
                    {resolveProductImage(p) ? (
                      <img src={resolveProductImage(p)} alt={p.name} style={{ ...styles.cardImg, opacity: isOutOfStock(p) ? 0.5 : 1 }} />
                    ) : (
                      <span style={{ fontSize: 40 }}>{p.img}</span>
                    )}
                    {p.mrp && p.mrp > p.price ? (
                      <span style={styles.discountBadge}>
                        {Math.round((1 - p.price / p.mrp) * 100)}% OFF
                      </span>
                    ) : null}
                    {isOutOfStock(p) ? (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#b23b3b", color: "#fff", fontSize: 11, fontWeight: 800, textAlign: "center", padding: "3px 0", letterSpacing: 0.5, zIndex: 2 }}>OUT OF STOCK</div>
) : null}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleWishlist(p.id); }}
                      aria-label="wishlist"
                      style={{
                        position: "absolute", top: 6, right: 6, width: 26, height: 26,
                        borderRadius: 99, background: "rgba(255,255,255,0.9)", border: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, cursor: "pointer",
                      }}
                    >
                      {wishlist.includes(p.id) ? "❤️" : "🤍"}
                    </button>
                  </div>
                  <div style={styles.cardBody}>
                    <div style={styles.cardCat}>{p.category}</div>
                    <div style={styles.cardName}>{p.name}</div>
                    <StockLine p={p} />
                    <div style={styles.cardBottomRow}>
                      <div>
                        <div style={styles.cardPrice}>
                          {formatRs(p.price)}{p.unit ? <span style={{ fontSize: 10, fontWeight: 600 }}> /{p.unit}</span> : null}
                        </div>
                        {p.mrp && p.mrp > p.price ? (
                          <div style={styles.cardMrp}>{formatRs(p.mrp)}</div>
                        ) : null}
                      </div>
                      {isOutOfStock(p) ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#b23b3b" }}>Out of stock</span>
                      ) : p.requiresSize ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            value={sizeInputs[p.id] || ""}
                            onChange={(e) => setSizeInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="Size (દા.ત. 10mm)"
                            style={{
                              width: 88, fontSize: 11.5, padding: "6px 8px",
                              border: `1px solid ${T.hairline}`, borderRadius: 8,
                              background: T.surface2, color: T.ink, outline: "none",
                            }}
                          />
                          <button
                            style={styles.addBtn}
                            onClick={() => {
                              const size = (sizeInputs[p.id] || "").trim();
                              if (!size) return;
                              addToCart(p.id, size);
                              setSizeInputs((prev) => ({ ...prev, [p.id]: "" }));
                            }}
                          >
                            ઉમેરો
                          </button>
                        </div>
                      ) : cart[p.id] ? (
                        <div style={styles.qtyControl}>
                          <button style={styles.qtyBtn} onClick={() => decFromCart(p.id)}>
                            <Minus size={13} color="#fff" />
                          </button>
                          <span style={styles.qtyNum}>{cart[p.id]}</span>
                          <button style={styles.qtyBtn} onClick={() => addToCart(p.id)}>
                            <Plus size={13} color="#fff" />
                          </button>
                        </div>
                      ) : (
                        <button style={styles.addBtn} onClick={() => addToCart(p.id)}>
                          ઉમેરો
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={styles.emptyState}>
                  {category === "Shaurya Stationary" && !query
                    ? "Shaurya Stationary ની વસ્તુઓ જલ્દી આવશે. 📒✏️"
                    : "કંઈ મળ્યું નહીં."}
                </div>
              )}
            </div>
            <div style={styles.missionStrip}>
              <div style={styles.missionStamp}>✦</div>
              <div>
                <div style={styles.missionText1}>દરેક ખરીદી યુવા રોજગારને ટેકો આપે છે</div>
                <div style={styles.missionText2}>Every order backs local youth livelihoods</div>
              </div>
            </div>
            </>
            )}
            <div style={{ padding: "18px 16px 28px", textAlign: "center", fontSize: 12, color: T.inkSoft, borderTop: `1px solid ${T.hairline}`, marginTop: 12 }}>
              {[["/about.html", "અમારા વિશે"], ["/blog.html", "બ્લોગ"], ["#careers", "કરિયર"], ["/privacy.html", "પ્રાઇવસી પોલિસી"], ["/terms.html", "નિયમો અને શરતો"], ["/contact.html", "સંપર્ક"]].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={href === "#careers" ? (ev) => { ev.preventDefault(); setAppSubmitted(false); setView("careers"); } : undefined}
                  style={{ color: T.inkSoft, margin: "0 6px", display: "inline-block", textDecoration: "underline" }}
                >{label}</a>
              ))}
            </div>
          </div>
        )}

        {/* CAREERS */}
        {view === "careers" && (
          <div style={styles.scrollArea} className="scroll-area view-narrow">
            <div style={{ padding: "12px 16px 28px" }}>
              <div style={{ background: T.orange, color: "#fff", borderRadius: 16, padding: "16px 14px", textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>WE ARE HIRING</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>Blog Writers</div>
                <div style={{ fontSize: 12.5, marginTop: 4, opacity: 0.95 }}>Freshers &amp; Experienced | Youth Below 25</div>
                <div style={{ display: "inline-block", marginTop: 10, background: "#fff", color: T.orange, fontWeight: 800, fontSize: 18, padding: "6px 16px", borderRadius: 10 }}>₹100 per blog</div>
              </div>

              {appSubmitted ? (
                <div style={{ background: T.greenLight, color: T.green, padding: "16px 14px", borderRadius: 12, fontSize: 14, fontWeight: 700, textAlign: "center" }}>
                  🎉 અરજી મોકલાઈ ગઈ! અમે ટૂંક સમયમાં WhatsApp પર સંપર્ક કરીશું.
                  <button style={{ ...styles.primaryBtn, marginTop: 14 }} onClick={() => setView("home")}>હોમ પર જાઓ</button>
                </div>
              ) : (
                <>
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>તમારું પૂરું નામ</label>
                <input type="text" value={appForm.name} maxLength={80} onChange={(e) => setAppField("name", e.target.value)} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }} />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>ઉંમર (25 થી ઓછી)</label>
                <input type="tel" inputMode="numeric" value={appForm.age} maxLength={2} onChange={(e) => setAppField("age", e.target.value.replace(/[^0-9]/g, ""))} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }} />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>શહેર / ગામ</label>
                <input type="text" value={appForm.city} maxLength={60} onChange={(e) => setAppField("city", e.target.value)} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }} />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>WhatsApp નંબર</label>
                <input type="tel" inputMode="numeric" value={appForm.phone} maxLength={10} placeholder="9XXXXXXXXX" onChange={(e) => setAppField("phone", e.target.value.replace(/[^0-9]/g, ""))} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }} />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>Experience</label>
                <select value={appForm.level} onChange={(e) => setAppField("level", e.target.value)} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }}>
                  <option value="">પસંદ કરો</option>
                  <option value="Fresher">Fresher</option>
                  <option value="Experienced">Experienced</option>
                </select>
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>કઈ ભાષામાં લખી શકો?</label>
                <select value={appForm.lang} onChange={(e) => setAppField("lang", e.target.value)} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }}>
                  <option value="">પસંદ કરો</option>
                  {["ગુજરાતી", "હિન્દી", "English", "ગુજરાતી + હિન્દી", "ગુજરાતી + English", "બધી"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>Sample blog / work ની લિંક (ઓપ્શનલ)</label>
                <input type="url" value={appForm.sample} maxLength={300} placeholder="https://..." onChange={(e) => setAppField("sample", e.target.value)} style={{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }} />
                <label style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginBottom: 6, display: "block" }}>તમારા વિશે થોડું લખો (ઓપ્શનલ)</label>
                <textarea rows={4} value={appForm.about} maxLength={500} onChange={(e) => setAppField("about", e.target.value)} style={{ ...{
                    width: "100%", boxSizing: "border-box",
                    background: T.surface2, border: `1px solid ${T.hairline}`,
                    borderRadius: 12, padding: "12px 14px", fontSize: 14.5,
                    color: T.ink, fontFamily: "inherit", outline: "none", marginBottom: 14,
                  }, resize: "vertical" }} />
                {appError && (
                  <div style={{ background: "#fdecec", color: "#b23b3b", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{appError}</div>
                )}
                <button style={{ ...styles.primaryBtn, marginTop: 6 }} onClick={submitApplication} disabled={appSubmitting}>
                  {appSubmitting ? "મોકલી રહ્યા છીએ..." : "અરજી કરો"}
                </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* CART */}
        {view === "cart" && (
          <div style={styles.scrollArea} className="scroll-area view-narrow">
            {cartItems.length === 0 ? (
              <div style={styles.emptyCart}>
                <ShoppingCart size={40} color="#c9c2b4" />
                <p style={{ color: "#8a8378", marginTop: 12 }}>તમારી કાર્ટ ખાલી છે</p>
                <button style={styles.primaryBtn} onClick={() => setView("home")}>ખરીદી શરૂ કરો</button>
              </div>
            ) : (
              <>
                <div style={{ padding: "4px 16px" }}>
                  {cartItems.map((item) => (
                    <div key={item.id} style={styles.cartRow}>
                      {resolveProductImage(item) ? (
                        <img
                          src={resolveProductImage(item)}
                          alt={item.name}
                          style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", cursor: "zoom-in" }}
                          onClick={() => setZoomImage({ src: resolveProductImage(item), name: item.name })}
                        />
                      ) : (
                        <span style={{ fontSize: 28 }}>{item.img}</span>
                      )}
                      <div style={{ flex: 1, marginLeft: 10 }}>
                        <div style={styles.cardName}>{item.name}</div>
                        {item.size && (
                          <div style={{ fontSize: 11.5, color: T.orange, fontWeight: 700 }}>Size: {item.size}</div>
                        )}
                        <div style={styles.cardPrice}>
                          {formatRs(item.price)}{item.unit ? <span style={{ fontSize: 10, fontWeight: 600 }}> /{item.unit}</span> : null}
                        </div>
                      </div>
                      <div style={styles.qtyControl}>
                        <button style={styles.qtyBtn} onClick={() => decFromCart(item.id)}>
                          <Minus size={13} color="#fff" />
                        </button>
                        <span style={styles.qtyNum}>{item.qty}</span>
                        <button style={styles.qtyBtn} onClick={() => addToCart(item.id)}>
                          <Plus size={13} color="#fff" />
                        </button>
                      </div>
                      <button style={styles.removeBtn} onClick={() => removeFromCart(item.id)}>
                        <X size={16} color="#b23b3b" />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={styles.summaryBox}>
                  <div
                    style={{
                      background: "linear-gradient(90deg, #1f3a1f, #2f6b3a)",
                      color: "#fff",
                      borderRadius: 10,
                      padding: "10px 14px",
                      textAlign: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      marginBottom: 14,
                    }}
                  >
                    🧾 પાક્કું બિલ, પાક્કો સોદો!
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 800, color: "#2a2a2a", marginBottom: 10 }}>
                    ઓર્ડર કેવી રીતે કરવો છે?
                  </div>

                  <div
                    onClick={() => setBillOption("no-bill")}
                    style={{
                      background: "#fff",
                      border: `2px solid ${billOption === "no-bill" ? T.orange : T.hairline}`,
                      borderRadius: 12,
                      padding: 14,
                      marginBottom: 10,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>બિલ વગર</span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: billOption === "no-bill" ? T.orange : "#eee",
                          color: billOption === "no-bill" ? "#fff" : "#666",
                        }}
                      >
                        સીધો ઓર્ડર
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8a8378" }}>કોઈ GST નહીં, સીધું ચેકઆઉટ પર જાવ</p>
                  </div>

                  <div
                    onClick={() => setBillOption("with-bill")}
                    style={{
                      background: billOption === "with-bill" ? "#fff7f2" : "#fff",
                      border: `2px solid ${billOption === "with-bill" ? T.orange : T.hairline}`,
                      borderRadius: 12,
                      padding: 14,
                      marginBottom: 14,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>બિલ સાથે (GST સહિત)</span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: billOption === "with-bill" ? T.orange : "#eee",
                          color: billOption === "with-bill" ? "#fff" : "#666",
                        }}
                      >
                        18% GST
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8a8378" }}>Proper GST બિલ મળશે — બિઝનેસ ખરીદી માટે</p>
                    {billOption === "with-bill" && (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 12, color: "#565b52", display: "block", marginBottom: 4, fontWeight: 700 }}>
                          GST નંબર
                        </label>
                        <input
                          style={styles.textInput}
                          placeholder="દા.ત. 24ABCDE1234F1Z5"
                          value={gstNumber}
                          onChange={(e) => setGstNumber(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </div>

                  <div style={styles.summaryRow}><span>સબટોટલ</span><span>{formatRs(cartTotal)}</span></div>
                  {billOption === "with-bill" && (
                    <div style={styles.summaryRow}><span>GST (18%)</span><span>{formatRs(gstAmount)}</span></div>
                  )}
                  <div style={styles.summaryRow}><span>ડિલિવરી</span><span>{deliveryFee === 0 ? "મફત" : formatRs(deliveryFee)}</span></div>
                  <div style={{ ...styles.summaryRow, ...styles.summaryTotal }}>
                    <span>કુલ</span><span>{formatRs(grandTotal)}</span>
                  </div>
                  <button style={styles.primaryBtn} onClick={() => setView("checkout")}>ચેકઆઉટ કરો</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* CHECKOUT */}
        {view === "checkout" && (
          <div style={styles.scrollArea} className="scroll-area view-narrow">
            <div style={{ padding: 16 }}>
              <label style={styles.label}>પૂરું નામ</label>
              <input
                style={styles.textInput}
                value={checkoutForm.name}
                onChange={(e) => setCheckoutForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="તમારું નામ"
              />
              <label style={styles.label}>મોબાઇલ નંબર</label>
              <input
                style={styles.textInput}
                value={checkoutForm.phone}
                onChange={(e) => setCheckoutForm((f) => ({ ...f, phone: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))}
                placeholder="9XXXXXXXXX"
              />
              <label style={styles.label}>ડિલિવરી સરનામું</label>
              <textarea
                style={{ ...styles.textInput, height: 70 }}
                value={checkoutForm.address}
                onChange={(e) => setCheckoutForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="ઘર નં, શેરી, શહેર, પિનકોડ"
              />
              <label style={styles.label}>પિનકોડ</label>
              <input
                style={styles.textInput}
                value={checkoutForm.pincode}
                onChange={(e) => setCheckoutForm((f) => ({ ...f, pincode: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) }))}
                placeholder="દા.ત. 382345"
                inputMode="numeric"
              />
              {checkoutForm.pincode.trim().length === 6 && (
                isFreeDeliveryPincode ? (
                  <div style={{ color: "#1e9c3a", fontWeight: 700, fontSize: 12.5, marginTop: -10, marginBottom: 12 }}>
                    ✓ તમારા વિસ્તારમાં ફ્રી ડિલિવરી ઉપલબ્ધ છે!
                  </div>
                ) : (
                  <div style={{ color: "#8a8378", fontWeight: 600, fontSize: 12.5, marginTop: -10, marginBottom: 12 }}>
                    આ પિનકોડ પર ફ્રી ડિલિવરી નથી — ₹999+ ના ઓર્ડર પર ફ્રી ડિલિવરી મળશે.
                  </div>
                )
              )}
              <label style={styles.label}>ચુકવણી પદ્ધતિ</label>
              <div style={styles.payOptions}>
                <div style={{ ...styles.payChip, ...styles.payChipActive }}>કેશ ઓન ડિલિવરી</div>
              </div>

              <label style={styles.label}>🎟️ પ્રોમો કોડ (વૈકલ્પિક)</label>
              {appliedPromoCode ? (
                <div
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: T.greenLight, border: `1px dashed ${T.green}`, borderRadius: 10,
                    padding: "10px 12px", marginBottom: 12,
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 13, color: T.green }}>
                    ✓ {appliedPromoCode} લાગુ થયો — {promoDiscountPercent}% છૂટ
                  </span>
                  <button
                    onClick={removePromoCode}
                    style={{ background: "none", border: "none", color: "#b23b3b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <input
                    style={{ ...styles.textInput, flex: 1, textTransform: "uppercase" }}
                    value={promoCodeInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPromoCodeInput(raw);
                      const code = raw.trim().toUpperCase();
                      if (!code) {
                        setPromoError("");
                        return;
                      }
                      if (!PROMO_CODES[code]) {
                        setPromoError("");
                        return;
                      }
                      const usedCount = orders.filter((o) => o.promoCode === code).length;
                      if (usedCount >= promoMaxUses(code) || promoExpired(code)) {
                        setAppliedPromoCode(null);
                        setPromoError("Sorry, its too late — this code has expired.");
                      } else if (promoNotEligibleMsg(code)) {
                        setAppliedPromoCode(null);
                        setPromoError(promoNotEligibleMsg(code));
                      } else {
                        setAppliedPromoCode(code);
                        setPromoError("");
                      }
                    }}
                    placeholder="દા.ત. NAVGHAN20"
                  />
                  <button
                    onClick={applyPromoCode}
                    style={{
                      background: T.orange, color: "#fff", fontWeight: 800, fontSize: 13,
                      border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer",
                    }}
                  >
                    લાગુ કરો
                  </button>
                </div>
              )}
              {promoError && <div style={styles.errorText}>{promoError}</div>}

              {checkoutError && <div style={styles.errorText}>{checkoutError}</div>}

              <div style={{ ...styles.summaryBox, marginTop: 20 }}>
                <div style={styles.summaryRow}><span>વસ્તુઓ ({cartCount})</span><span>{formatRs(cartTotal)}</span></div>
                {billOption === "with-bill" && (
                  <div style={styles.summaryRow}><span>GST (18%)</span><span>{formatRs(gstAmount)}</span></div>
                )}
                <div style={styles.summaryRow}><span>ડિલિવરી</span><span>{deliveryFee === 0 ? "મફત" : formatRs(deliveryFee)}</span></div>
                {appliedPromoCode && (
                  <div style={{ ...styles.summaryRow, color: T.green, fontWeight: 700 }}>
                    <span>પ્રોમો છૂટ ({appliedPromoCode})</span><span>-{formatRs(promoDiscountAmount)}</span>
                  </div>
                )}
                <div style={{ ...styles.summaryRow, ...styles.summaryTotal }}>
                  <span>કુલ ચૂકવવાનું (ડિલિવરી વખતે)</span>
                  <span>{formatRs(grandTotal)}</span>
                </div>
                <button style={styles.primaryBtn} onClick={placeOrder} disabled={saving}>
                  {saving ? "સેવ થાય છે..." : "ઓર્ડર કન્ફર્મ કરો"}
                </button>
              </div>
              <WalletPayBox
                w={w}
                cartItems={cartItems}
                form={checkoutForm}
                billOption={billOption}
                gstNumber={gstNumber}
                grandTotal={grandTotal}
                promoApplied={!!appliedPromoCode}
                onSuccess={(d) => {
                  const nm = checkoutForm.name.trim();
                  const ph = checkoutForm.phone.trim();
                  try { localStorage.setItem("apniDukanMyPhone", ph); setMyPhone(ph); } catch {}
                  setCart({});
                  setLastOrderId(String(d.orderNumber || ""));
                  setLastOrderPaid(true);
                  setView("success");
                  setCheckoutForm({ name: "", phone: "", address: "", pincode: "" });
                  setAppliedPromoCode(null);
                  setPromoCodeInput("");
                  setBillOption("no-bill");
                  setGstNumber("");
                  try {
                    fetch("/api/send-order-notification", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderId: d.orderId, customerName: nm, total: d.total }),
                    }).catch(() => {});
                  } catch {}
                  try {
                    fetch("https://api.emailjs.com/api/v1.0/email/send", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        service_id: "service_yg8sysc",
                        template_id: "template_h01cv8i",
                        user_id: "40etdMV1rISl5hS5f",
                        template_params: {
                          customer_name: nm,
                          customer_phone: ph,
                          customer_address: checkoutForm.address,
                          total: formatRs(d.total) + " (વૉલેટ થી ચૂકવ્યા)",
                          order_details: cartItems.map((i) => `${i.name} x${i.qty}`).join(", "),
                        },
                      }),
                    }).catch(() => {});
                  } catch {}
                }}
              />
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {view === "success" && (
          <div style={styles.successWrap}>
            <div style={styles.successIcon}><Check size={36} color="#fff" /></div>
            <h2 style={{ color: "#2c2a26", margin: "16px 0 6px" }}>ઓર્ડર થઈ ગયો!</h2>
            <p style={{ color: "#8a8378", textAlign: "center", padding: "0 30px" }}>
              ઓર્ડર નંબર: {lastOrderId}<br />{lastOrderPaid ? "વૉલેટ થી ચૂકવણી થઈ ગઈ." : "ડિલિવરી વખતે કેશ ચૂકવો."}
            </p>
            <button style={styles.primaryBtn} onClick={() => setView("home")}>ખરીદી ચાલુ રાખો</button>
          </div>
        )}

        {/* WISHLIST */}
        {view === "wishlist" && (
          <div style={{ padding: 16 }} className="view-wide-box">
            <button
              onClick={() => setView("home")}
              style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 6, color: T.inkSoft, fontSize: 13, fontWeight: 700, marginBottom: 14, cursor: "pointer" }}
            >
              <ArrowLeft size={16} /> પાછા
            </button>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginBottom: 14 }}>❤️ મારી પસંદ</div>
            {wishlist.length === 0 ? (
              <div style={{ textAlign: "center", color: T.inkSoft, fontSize: 13, marginTop: 40 }}>
                હજુ કંઈ પસંદ કર્યું નથી. પ્રોડક્ટ પર 🤍 ટેપ કરો.
              </div>
            ) : (
              <div style={styles.grid} className="product-grid">
                {shopProducts.filter((p) => wishlist.includes(p.id)).map((p) => (
                  <div key={p.id} style={styles.card}>
                    <div
                      className="card-img" style={{ ...styles.cardImgWrap, cursor: resolveProductImage(p) ? "zoom-in" : "default" }}
                      onClick={() => { const img = resolveProductImage(p); if (img) setZoomImage({ src: img, name: p.name }); }}
                    >
                      {resolveProductImage(p) ? (
                        <img src={resolveProductImage(p)} alt={p.name} style={{ ...styles.cardImg, opacity: isOutOfStock(p) ? 0.5 : 1 }} />
                      ) : (
                        <span style={{ fontSize: 40 }}>{p.img}</span>
                      )}
                      {isOutOfStock(p) ? (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#b23b3b", color: "#fff", fontSize: 11, fontWeight: 800, textAlign: "center", padding: "3px 0", letterSpacing: 0.5, zIndex: 2 }}>OUT OF STOCK</div>
) : null}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWishlist(p.id); }}
                        style={{
                          position: "absolute", top: 6, right: 6, width: 26, height: 26,
                          borderRadius: 99, background: "rgba(255,255,255,0.9)", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 14, cursor: "pointer",
                        }}
                      >
                        ❤️
                      </button>
                    </div>
                    <div style={styles.cardBody}>
                      <div style={styles.cardCat}>{p.category}</div>
                      <div style={styles.cardName}>{p.name}</div>
                      <StockLine p={p} />
                      <div style={styles.cardBottomRow}>
                        <div style={styles.cardPrice}>
                          {formatRs(p.price)}{p.unit ? <span style={{ fontSize: 10, fontWeight: 600 }}> /{p.unit}</span> : null}
                        </div>
                        {!p.requiresSize && (isOutOfStock(p) ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#b23b3b" }}>Out of stock</span>
                        ) : (
                          <button style={styles.addBtn} onClick={() => addToCart(p.id)}>ઉમેરો</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY ORDERS — tracking + repeat order */}
        {view === "myOrders" && (
          <div style={{ padding: 16 }} className="view-narrow-box">
            <button
              onClick={() => setView("home")}
              style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 6, color: T.inkSoft, fontSize: 13, fontWeight: 700, marginBottom: 14, cursor: "pointer" }}
            >
              <ArrowLeft size={16} /> પાછા
            </button>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginBottom: 14 }}>📦 મારા ઓર્ડર્સ</div>

            {!myPhone ? (
              <div>
                <div style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 10 }}>
                  તમારો ઓર્ડર જોવા માટે એ જ ફોન નંબર નાખો જે ઓર્ડર વખતે આપ્યો હતો.
                </div>
                <input
                  type="tel"
                  value={myPhoneInput}
                  onChange={(e) => setMyPhoneInput(e.target.value.replace(/[^0-9+ ]/g, ""))}
                  placeholder="9XXXXXXXXX"
                  style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", border: `1px solid ${T.hairline}`, borderRadius: 12, background: T.surface2, color: T.ink, fontSize: 14.5, marginBottom: 10 }}
                />
                <button
                  style={styles.primaryBtn}
                  onClick={() => {
                    const val = myPhoneInput.trim();
                    if (!val) return;
                    try { localStorage.setItem("apniDukanMyPhone", val); } catch {}
                    setMyPhone(val);
                  }}
                >
                  ઓર્ડર જુઓ
                </button>
              </div>
            ) : (
              <div>
                {(() => {
                  const myOrders = orders.filter((o) => o.customer?.phone === myPhone);
                  if (myOrders.length === 0) {
                    return <div style={{ textAlign: "center", color: T.inkSoft, fontSize: 13, marginTop: 30 }}>આ નંબર પર કોઈ ઓર્ડર મળ્યો નથી.</div>;
                  }
                  const STEPS = ["નવો", "કન્ફર્મ", "ડિલિવર થયો"];
                  return myOrders.map((o) => {
                    const currentStep = STEPS.indexOf(o.status || "નવો");
                    return (
                      <div key={o.id} style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700, marginBottom: 10 }}>
                          {new Date(o.createdAt).toLocaleDateString("gu-IN", { day: "2-digit", month: "short", year: "numeric" })} — {formatRs(o.total)}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", position: "relative", margin: "10px 0" }}>
                          <div style={{ position: "absolute", top: 9, left: 10, right: 10, height: 2, background: T.hairline }} />
                          {STEPS.map((s, i) => (
                            <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative", zIndex: 1, flex: 1 }}>
                              <div
                                style={{
                                  width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 10, color: "#fff",
                                  background: i < currentStep ? T.green : i === currentStep ? T.orange : T.hairline,
                                }}
                              >
                                {i <= currentStep ? "✓" : ""}
                              </div>
                              <div style={{ fontSize: 8.5, color: i <= currentStep ? T.ink : T.inkSoft, fontWeight: i <= currentStep ? 800 : 600, textAlign: "center" }}>{s}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 10 }}>
                          {(o.items || []).map((i) => `${i.name} x${i.qty}`).join(", ")}
                        </div>
                        <button
                          onClick={() => repeatOrder(o)}
                          style={{ width: "100%", background: T.orange, color: "#fff", fontWeight: 800, fontSize: 12.5, padding: "9px 0", borderRadius: 10, border: "none" }}
                        >
                          🔁 ફરી ઓર્ડર કરો
                        </button>
                      </div>
                    );
                  });
                })()}
                <button
                  onClick={() => {
                    try { localStorage.removeItem("apniDukanMyPhone"); } catch {}
                    setMyPhone("");
                    setMyPhoneInput("");
                  }}
                  style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 11.5, textDecoration: "underline", cursor: "pointer", marginTop: 4 }}
                >
                  બીજા નંબરથી જુઓ
                </button>
              </div>
            )}
          </div>
        )}

        {/* ADMIN LOGIN */}
        {view === "adminLogin" && (
          <div style={styles.successWrap}>
            <Lock size={34} color="#8a8378" />
            <p style={{ color: "#6b6555", margin: "12px 0" }}>એડમિન PIN નાખો</p>
            <input
              style={{ ...styles.textInput, textAlign: "center", letterSpacing: 4, width: 140 }}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              type="password"
            />
            {pinError && <div style={styles.errorText}>{pinError}</div>}
            <button style={styles.primaryBtn} onClick={tryAdminLogin}>લોગિન</button>
          </div>
        )}

        {/* SETTINGS GATE: Loading -> Who are you? -> Admin / Sales Officer / Sales Executive */}
        {view === "gate" && (
          <SalesGate applications={applications} onAdminLogin={gateAdminLogin} onSuccess={gateSalesSuccess} />
        )}

        {/* TRADER / RETAILER SIGNUP + LOGIN (front page button) */}
        {view === "trader" && (
          <TraderForm
            kind="Trader / Retailer"
            tabs={Array.from(new Set([...categories.filter((c) => c !== "બધું"), "Groceries"]))}
            discountPct={TRADER_DISCOUNT_PCT}
            onSignup={gateTraderSignup}
            onLogin={gateTraderLogin}
            onBack={() => setView("home")}
          />
        )}

        {/* MARKET DIRECTORY (front page button) */}
        {view === "market" && (marketSel ? (
          <MarketDetail marketName={marketSel} sellers={sellers} onBack={() => setMarketSel(null)} onOpenSeller={openSellerProducts} />
        ) : (
          <MarketList sellers={sellers} onSelect={setMarketSel} />
        ))}

        {/* SALES OFFICER / SALES EXECUTIVE DASHBOARD */}
        {view === "salesDash" && salesAuth && (
          <div style={styles.scrollArea} className="scroll-area">
            <SalesDashboard
              user={salesAuth}
              visits={salesVisits}
              applications={applications}
              onAddVisit={salesAddVisit}
              onLogout={salesLogout}
              remaining={salesRemaining}
              posts={blogPosts}
              onSaveBlog={blogWriterSave}
            />
          </div>
        )}

        {/* SELLER LOGIN */}
        {view === "sellerLogin" && (
          <div style={styles.successWrap}>
            <Store size={34} color="#8a8378" />
            <p style={{ color: "#6b6555", margin: "12px 0" }}>સેલર લોગિન</p>
            <input
              style={{ ...styles.textInput, textAlign: "center", width: 180, marginBottom: 8 }}
              value={sellerMobileInput}
              onChange={(e) => setSellerMobileInput(e.target.value)}
              placeholder="મોબાઇલ નંબર"
              type="tel"
            />
            <input
              style={{ ...styles.textInput, textAlign: "center", letterSpacing: 4, width: 180 }}
              value={sellerPinInput}
              onChange={(e) => setSellerPinInput(e.target.value)}
              placeholder="••••••"
              type="password"
            />
            {sellerPinError && <div style={styles.errorText}>{sellerPinError}</div>}
            <button style={styles.primaryBtn} onClick={trySellerLogin}>લોગિન</button>
            <button
              style={{ border: "none", background: "transparent", color: T.orange, fontWeight: 700, marginTop: 12, cursor: "pointer" }}
              onClick={() => {
                setSellerPinError("");
                setRegSubmitted(false);
                setView("sellerRegister");
              }}
            >
              નવા સેલર? રજિસ્ટર કરો
            </button>
          </div>
        )}

        {/* SELLER SELF-REGISTRATION — new shopkeeper fills this, it lands as
            a "pending" request, admin approves it from the admin panel. */}
        {view === "sellerRegister" && (
          <div style={styles.scrollArea} className="scroll-area view-narrow">
            <div style={{ padding: 16 }}>
              {regSubmitted ? (
                <div style={{ textAlign: "center", marginTop: 30 }}>
                  <Store size={34} color="#8a8378" />
                  <p style={{ fontWeight: 800, fontSize: 15, marginTop: 12 }}>રજિસ્ટ્રેશન મોકલાઈ ગયું!</p>
                  <p style={{ color: "#6b6555", fontSize: 12, marginTop: 6 }}>
                    એડમિન ચકાસીને Approve કરશે પછી તમારો લોગિન ચાલુ થશે.
                  </p>
                  <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={() => setView("home")}>
                    હોમ પર જાવ
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ textAlign: "center", marginBottom: 14 }}>
                    <Store size={30} color="#8a8378" />
                    <p style={{ fontWeight: 800, fontSize: 15, marginTop: 8 }}>સેલર રજિસ્ટ્રેશન</p>
                    <p style={{ color: "#6b6555", fontSize: 11 }}>Apni Dukan પર તમારી દુકાન શરૂ કરો</p>
                  </div>

                  <input
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    placeholder="દુકાનનું નામ"
                    value={regForm.shop}
                    onChange={(e) => setRegForm((f) => ({ ...f, shop: e.target.value }))}
                  />
                  <input
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    placeholder="તમારું નામ"
                    value={regForm.owner}
                    onChange={(e) => setRegForm((f) => ({ ...f, owner: e.target.value }))}
                  />
                  <input
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    placeholder="મોબાઇલ નંબર"
                    type="tel"
                    value={regForm.mobile}
                    onChange={(e) => setRegForm((f) => ({ ...f, mobile: e.target.value }))}
                  />
                  <select
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    value={regForm.category}
                    onChange={(e) => setRegForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    <option value="">તમે શું વેચો છો?</option>
                    <option>Welding Materials</option>
                    <option>Belt (V-Belt / Lifting Belt)</option>
                    <option>Hardware / Handtools</option>
                    <option>Electrical</option>
                    <option>Plumbing</option>
                    <option>બીજું</option>
                  </select>
                  <input
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    placeholder="શહેર / વિસ્તાર (વૈકલ્પિક)"
                    value={regForm.area}
                    onChange={(e) => setRegForm((f) => ({ ...f, area: e.target.value }))}
                  />
                  <input
                    style={{ ...styles.textInput, marginBottom: 8 }}
                    placeholder="PIN સેટ કરો (4-6 અંક)"
                    type="password"
                    value={regForm.pin}
                    onChange={(e) => setRegForm((f) => ({ ...f, pin: e.target.value }))}
                  />
                  {regError && <div style={styles.errorText}>{regError}</div>}
                  <button style={{ ...styles.primaryBtn, marginTop: 4 }} onClick={submitSellerRegistration}>
                    રજિસ્ટ્રેશન મોકલો
                  </button>
                  <button
                    style={{ border: "none", background: "transparent", color: T.orange, fontWeight: 700, marginTop: 12, cursor: "pointer", display: "block", width: "100%", textAlign: "center" }}
                    onClick={() => setView("sellerLogin")}
                  >
                    પહેલેથી સેલર છો? લોગિન કરો
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* SELLER PANEL — orders, stock, hisab and messages for the logged-in seller */}
        {view === "sellerOrders" && sellerAuth && (() => {
          const numById = {};
          orders.forEach((o, idx) => { numById[o.id] = orders.length - idx; });   // same number as the printed bill
          const mine = orders
            .map((o) => ({ ...o, myItems: (o.items || []).filter((it) => it.sellerId === sellerAuth.id) }))
            .filter((o) => o.myItems.length > 0);
          const mineTotal = (o) => o.myItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
          const now = new Date();
          const isToday = (iso) => new Date(iso).toDateString() === now.toDateString();
          const isThisMonth = (iso) => { const d = new Date(iso); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); };
          const todayNew = mine.filter((o) => isToday(o.createdAt)).length;
          const notDelivered = mine.filter((o) => o.status !== "ડિલિવર થયો").length;
          const monthTotal = mine.filter((o) => isThisMonth(o.createdAt)).reduce((sum, o) => sum + mineTotal(o), 0);
          const fmtDt = (iso) => new Date(iso).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          const fmtD = (iso) => new Date(iso).toLocaleDateString("gu-IN", { day: "2-digit", month: "short", year: "numeric" });
          const hisab = sellerHisab(sellerAuth.id);
          const myPays = sellerPayments.filter((x) => x.sellerId === sellerAuth.id);
          const myMsgs = sellerMessages.filter((m) => m.sellerId === sellerAuth.id);
          const unreadReplies = myMsgs.filter((m) => m.reply && (m.repliedAt || "") > sellerMsgSeenAt).length;
          const byMonth = {};
          mine.filter((o) => o.status === "ડિલિવર થયો").forEach((o) => {
            const d = new Date(o.createdAt);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            byMonth[k] = byMonth[k] || { count: 0, amount: 0 };
            byMonth[k].count += 1;
            byMonth[k].amount += mineTotal(o);
          });
          const monthKeys = Object.keys(byMonth).sort().reverse();
          const monthLabel = (k) => { const [y, m] = k.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleString("gu-IN", { month: "long", year: "numeric" }); };
          const pad2 = (n) => String(n).padStart(2, "0");
          const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
          const byDay = {};
          mine.forEach((o) => {
            if (!o.createdAt) return;
            const k = dayKey(o.createdAt);
            byDay[k] = byDay[k] || { count: 0, amount: 0, orders: [] };
            byDay[k].count += 1;
            byDay[k].amount += mineTotal(o);
            byDay[k].orders.push(o);
          });
          const calPrefix = `${calMonth.y}-${pad2(calMonth.m + 1)}-`;
          const firstDow = new Date(calMonth.y, calMonth.m, 1).getDay();
          const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
          const calCells = [];
          for (let i = 0; i < firstDow; i++) calCells.push(null);
          for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
          const calMonthTotal = Object.keys(byDay).filter((k) => k.startsWith(calPrefix)).reduce((sum, k) => sum + byDay[k].amount, 0);
          const compactRs = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${Math.round(n).toLocaleString("en-IN")}`);
          const moveMonth = (delta) => { const d = new Date(calMonth.y, calMonth.m + delta, 1); setCalMonth({ y: d.getFullYear(), m: d.getMonth() }); setCalSel(""); };
          const selDay = calSel && byDay[calSel] ? byDay[calSel] : null;
          const navBtn = { border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "4px 12px", fontSize: 13, cursor: "pointer" };
          const myProducts = products.filter((x) => x.sellerId === sellerAuth.id);
          const q = sellerStockQuery.trim().toLowerCase();
          const shownProducts = myProducts.filter((x) => !q || String(x.name || "").toLowerCase().includes(q));
          const soldOutCount = myProducts.filter((x) => x.soldOut).length;
          const tabBtn = (key, label) => (
            <button
              key={key}
              onClick={() => openSellerTab(key)}
              style={{
                flex: 1, padding: "8px 2px", fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: "pointer",
                border: `1px solid ${T.hairline}`, background: sellerTab === key ? T.orange : "transparent",
                color: sellerTab === key ? "#fff" : T.ink,
              }}
            >
              {label}
            </button>
          );
          const statBox = (label, value, danger) => (
            <div style={{ flex: 1, background: T.surface2, borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: danger ? "#b23b3b" : T.ink }}>{value}</div>
              <div style={{ fontSize: 10.5, color: "#8a8378", marginTop: 2 }}>{label}</div>
            </div>
          );
          return (
            <div style={styles.scrollArea} className="scroll-area view-narrow">
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{sellerAuth.name}</div>
                  <button
                    style={{ border: "none", background: "transparent", color: T.orange, fontWeight: 700, cursor: "pointer" }}
                    onClick={sellerLogout}
                  >
                    લોગઆઉટ
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {statBox("આજના ઓર્ડર", todayNew)}
                  {statBox("બાકી ડિલિવરી", notDelivered, notDelivered > 0)}
                  {statBox("આ મહિનાનું વેચાણ", formatRs(monthTotal))}
                </div>

                {(() => {
                  const me = sellers.find((x) => x.id === sellerAuth.id);
                  if (!me || String(me.mobile).trim() !== SITE_SYSTEM_MOBILE) return null;
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <button
                        onClick={() => setSiteOpen(true)}
                        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: "#0B2545", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                      >
                        🏗 Site System (હાજરી + ઉપાડ)
                      </button>
                      {siteOpen && (
                        <SiteSystem
                          onClose={() => setSiteOpen(false)}
                          loadData={async () => { const r = await storageGet("siteData"); return r ? r.value : null; }}
                          saveData={(v) => storageSet("siteData", v)}
                        />
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  const me = sellers.find((x) => x.id === sellerAuth.id);
                  if (!me || String(me.mobile).trim() !== HISAB_SYSTEM_MOBILE) return null;
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <button
                        onClick={() => setHisabOpen(true)}
                        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: "#7a2e1d", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                      >
                        📒 ખાતાવહી (નોટબુક હિસાબ)
                      </button>
                      {hisabOpen && (
                        <HisabSystem
                          onClose={() => setHisabOpen(false)}
                          loadData={async () => { const r = await storageGet("hisabData"); return r ? r.value : null; }}
                          saveData={(v) => storageSet("hisabData", v)}
                        />
                      )}
                    </div>
                  );
                })()}

                {PHOTO_UPLOAD_SELLERS.includes(sellerAuth.id) && (
                  <div style={{ marginBottom: 12 }}>
                    <button
                      onClick={() => { setUpOpen((v) => !v); setUpMsg(""); }}
                      style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: `1.5px dashed ${T.orange}`, background: "transparent", color: T.orange, fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                    >
                      📷 ફોટો અપલોડ કરો
                    </button>
                    {upMsg && (
                      <div style={{ fontSize: 12.5, marginTop: 6, fontWeight: 700, color: upMsg.startsWith("✔") ? "#2e7d4f" : "#b23b3b" }}>{upMsg}</div>
                    )}
                    {upOpen && (
                      <div style={{ ...styles.orderCard, marginTop: 8 }}>
                        <label style={{ display: "block", cursor: "pointer" }}>
                          <input type="file" accept="image/*" onChange={pickSellerPhoto} style={{ display: "none" }} />
                          <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "10px 0", textAlign: "center", fontSize: 13, fontWeight: 700 }}>
                            {upPhoto ? "બીજો ફોટો પસંદ કરો" : "ફોટો પસંદ કરો / કેમેરા ખોલો"}
                          </div>
                        </label>
                        {upPhoto && <img src={upPhoto} alt="પસંદ કરેલો ફોટો" style={{ width: "100%", borderRadius: 8, marginTop: 8 }} />}
                        <input
                          style={{ ...styles.textInput, marginTop: 8 }}
                          placeholder="નોંધ (વૈકલ્પિક)"
                          value={upNote}
                          onChange={(e) => setUpNote(e.target.value)}
                        />
                        <button
                          style={{ ...styles.primaryBtn, marginTop: 8, opacity: upPhoto && !upBusy ? 1 : 0.5 }}
                          disabled={!upPhoto || upBusy}
                          onClick={submitSellerPhoto}
                        >
                          {upBusy ? "મોકલાય છે..." : "સબમિટ કરો"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {PO_PRINT_SELLERS.includes(sellerAuth.id) && (() => {
                  const calc = poForm ? poCalc(poForm) : null;
                  const mismatch = poForm && poForm.docTotal != null && calc && Math.abs(Number(poForm.docTotal) - calc.total) > 1;
                  const mi = { ...styles.textInput, padding: "6px 8px", fontSize: 12.5 };
                  const rs2 = (n) => `₹${(Number(n) || 0).toFixed(2)}`;
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <button
                        onClick={() => { setPoOpen((v) => !v); setPoMsg(""); }}
                        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: `1.5px dashed ${T.orange}`, background: "transparent", color: T.orange, fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                      >
                        🧾 PO પ્રિન્ટ કરો
                      </button>
                      {poMsg && (
                        <div style={{ fontSize: 12.5, marginTop: 6, fontWeight: 700, color: poMsg.startsWith("✔") ? "#2e7d4f" : "#b23b3b" }}>{poMsg}</div>
                      )}
                      {poOpen && (
                        <div style={{ ...styles.orderCard, marginTop: 8 }}>
                          {!poForm && (
                            <>
                              <div style={{ fontSize: 12, color: "#6b6555", marginBottom: 8 }}>PO કેવી રીતે બનાવવી?</div>
                              <div
                                onClick={() => setPoForm(blankPoForm(poMemory))}
                                style={{ border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "11px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}
                              >
                                ✍ જાતે ભરો
                                <div style={{ fontWeight: 400, fontSize: 11.5, color: "#8a8378" }}>PO જોઈને વિગત ટાઇપ કરો</div>
                              </div>
                              <label style={{ display: "block", marginTop: 8, cursor: poBusy ? "default" : "pointer" }}>
                                <input type="file" accept="application/pdf,image/*" onChange={readPoFile} disabled={poBusy} style={{ display: "none" }} />
                                <div style={{ border: `1px solid ${T.orange}`, borderRadius: 10, padding: "11px 12px", fontWeight: 700, fontSize: 13.5, color: T.orange }}>
                                  📎 PDF / સ્ક્રીનશોટ અપલોડ કરો
                                  <div style={{ fontWeight: 400, fontSize: 11.5 }}>
                                    {poBusy ? poStatus || "વંચાય છે..." : "આપોઆપ વંચાય, તમે ચકાસીને છાપો"}
                                  </div>
                                </div>
                              </label>
                            </>
                          )}
                          {poForm && (
                            <>
                              <div style={{ fontSize: 11.5, color: "#8a8378", marginBottom: 8 }}>
                                PO જોઈને વિગત ભરો. પાર્ટી, વસ્તુ, ભાવ અને GST આ ફોનમાં યાદ રહેશે, આગલી વખતે ઝડપથી ભરાશે.
                              </div>
                              <label style={{ display: "block", cursor: "pointer", marginBottom: 8 }}>
                                <input type="file" accept="image/*" onChange={pickPoShot} style={{ display: "none" }} />
                                <div style={{ border: `1px dashed ${T.hairline}`, borderRadius: 8, padding: "8px 0", textAlign: "center", fontSize: 12.5, fontWeight: 700 }}>
                                  {poShot ? "બીજો સ્ક્રીનશોટ પસંદ કરો" : "🖼 PO નો સ્ક્રીનશોટ સાથે બતાવો (વૈકલ્પિક)"}
                                </div>
                              </label>
                              {poShot && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ maxHeight: poShotBig ? 520 : 220, overflow: "auto", border: `1px solid ${T.hairline}`, borderRadius: 8 }}>
                                    <img
                                      src={poShot}
                                      alt="PO સ્ક્રીનશોટ"
                                      onClick={() => setPoShotBig((v) => !v)}
                                      style={{ width: poShotBig ? "250%" : "100%", maxWidth: "none", display: "block" }}
                                    />
                                  </div>
                                  <div style={{ fontSize: 10.5, color: "#8a8378", marginTop: 3 }}>ફોટો દબાવો તો મોટો/નાનો થાય. આ ફોટો ક્યાંય મોકલાતો નથી.</div>
                                </div>
                              )}
                              {poForm.warn && poForm.warn.length > 0 && (
                                <div style={{ background: "#FFF4D6", borderRadius: 8, padding: "6px 8px", marginBottom: 8, fontSize: 12, color: "#8a5a00" }}>
                                  {poForm.warn.map((w, wi) => (
                                    <div key={wi}>• {w}</div>
                                  ))}
                                </div>
                              )}
                              <datalist id="po-parties">{poMemory.parties.map((v) => <option key={v} value={v} />)}</datalist>
                              <datalist id="po-items">{Object.keys(poMemory.items).map((v) => <option key={v} value={v} />)}</datalist>
                              <div style={{ display: "flex", gap: 6 }}>
                                <input style={{ ...mi, flex: 1 }} placeholder="PO નંબર" value={poForm.poNo} onChange={(e) => setPoField("poNo", e.target.value)} />
                                <input style={{ ...mi, width: 108 }} placeholder="PO તારીખ" value={poForm.poDate} onChange={(e) => setPoField("poDate", e.target.value)} />
                              </div>
                              <input list="po-parties" style={{ ...mi, marginTop: 6 }} placeholder="Bill To (પાર્ટીનું નામ)" value={poForm.billTo} onChange={(e) => setPoField("billTo", e.target.value)} />
                              {poForm.items.map((x, i) => (
                                <div key={i} style={{ borderTop: `1px dashed ${T.hairline}`, marginTop: 8, paddingTop: 8 }}>
                                  <input
                                    list="po-items"
                                    style={mi}
                                    placeholder="વસ્તુનું નામ"
                                    value={x.name}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setPoItem(i, "name", v);
                                      const mem = poMemory.items[v];
                                      if (mem && !x.rate) {
                                        setPoItem(i, "rate", mem.rate);
                                        setPoItem(i, "gst", mem.gst);
                                        setPoItem(i, "unit", mem.unit);
                                      }
                                    }}
                                  />
                                  <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                                    <input type="number" style={{ ...mi, width: 58 }} placeholder="જથ્થો" value={x.qty} onChange={(e) => setPoItem(i, "qty", e.target.value)} />
                                    <input style={{ ...mi, width: 46 }} placeholder="PC" value={x.unit} onChange={(e) => setPoItem(i, "unit", e.target.value)} />
                                    <input type="number" style={{ ...mi, flex: 1 }} placeholder="ભાવ" value={x.rate} onChange={(e) => setPoItem(i, "rate", e.target.value)} />
                                    <input
                                      type="number"
                                      style={{ ...mi, width: 56, ...(x.chkGst ? { background: "#FFF4D6", border: `1px solid ${T.orange}` } : {}) }}
                                      placeholder="GST%"
                                      value={x.gst}
                                      onChange={(e) => { setPoItem(i, "gst", e.target.value); setPoItem(i, "chkGst", false); }}
                                    />
                                    <span style={{ color: "#c0392b", cursor: "pointer", fontWeight: 800, padding: "0 4px" }} onClick={() => removePoItem(i)}>✕</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#6b6555", marginTop: 3 }}>
                                    વસ્તુનો કુલ (GST સાથે): {rs2((Number(x.qty) || 0) * (Number(x.rate) || 0) * (1 + (Number(x.gst) || 0) / 100))}
                                  </div>
                                </div>
                              ))}
                              <button
                                style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginTop: 8 }}
                                onClick={addPoItem}
                              >
                                + વસ્તુ ઉમેરો
                              </button>
                              <input style={{ ...mi, marginTop: 8 }} placeholder="પેમેન્ટની શરત (વૈકલ્પિક)" value={poForm.payment} onChange={(e) => setPoField("payment", e.target.value)} />
                              <input
                                type="number"
                                style={{ ...mi, marginTop: 8 }}
                                placeholder="PO માં લખેલો કુલ (ચકાસવા માટે, વૈકલ્પિક)"
                                value={poForm.docTotal ?? ""}
                                onChange={(e) => setPoField("docTotal", e.target.value === "" ? null : e.target.value)}
                              />
                              <div style={{ background: T.surface2, borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12.5 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Sub Total</span><span>{rs2(calc.subTotal)}</span></div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}><span>GST</span><span>{rs2(calc.gstTotal)}</span></div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, marginTop: 2 }}><span>TOTAL</span><span>{rs2(calc.total)}</span></div>
                              </div>
                              {!mismatch && poForm.docTotal != null && poForm.docTotal !== "" && Math.abs(Number(poForm.docTotal) - calc.total) <= 1 && (
                                <div style={{ fontSize: 12, color: "#2e7d4f", fontWeight: 700, marginTop: 6 }}>✔ ગણતરી PO ના કુલ સાથે મેળ ખાય છે</div>
                              )}
                              {mismatch && (
                                <div style={{ fontSize: 12, color: "#b23b3b", fontWeight: 700, marginTop: 6 }}>
                                  ધ્યાન: PO માં કુલ {rs2(poForm.docTotal)} લખેલું છે, પણ અહીંની ગણતરી {rs2(calc.total)} છે. જથ્થો, ભાવ, GST ફરી ચકાસો.
                                </div>
                              )}
                              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                <button
                                  style={{ ...styles.primaryBtn, marginTop: 0, flex: 1, opacity: poBusy ? 0.5 : 1 }}
                                  disabled={poBusy}
                                  onClick={printPo}
                                >
                                  {poBusy ? "મોકલાય છે..." : "🖨 પ્રિન્ટ કરો"}
                                </button>
                                <button
                                  style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                                  onClick={() => { setPoForm(null); setPoMsg(""); }}
                                >
                                  રદ કરો
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {tabBtn("orders", "ઓર્ડર")}
                  {tabBtn("stock", "સ્ટોક")}
                  {tabBtn("hisab", "હિસાબ")}
                  {tabBtn("msg", unreadReplies > 0 ? `મેસેજ 🔴${unreadReplies}` : "મેસેજ")}
                </div>

                {sellerTab === "orders" && (
                  mine.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#8a8378", marginTop: 40 }}>હજુ કોઈ ઓર્ડર નથી</div>
                  ) : (
                    mine.map((o) => (
                      <div key={o.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 800, fontSize: 13 }}>ઓર્ડર #{numById[o.id]}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: o.status === "ડિલિવર થયો" ? "#2e9e57" : T.orange }}>{o.status || "નવો"}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#8a8378", marginTop: 2 }}>{o.createdAt ? fmtDt(o.createdAt) : ""}</div>
                        <div style={{ fontSize: 12.5, marginTop: 6 }}>
                          {o.myItems.map((it, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span>{it.name} × {it.qty}</span>
                              <span style={{ color: "#6b6555" }}>{formatRs((Number(it.price) || 0) * (Number(it.qty) || 0))}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700 }}>
                          {o.customer?.name || "ગ્રાહક"} — {formatRs(mineTotal(o))}
                        </div>
                      </div>
                    ))
                  )
                )}

                {sellerTab === "stock" && (
                  <div>
                    <div style={{ fontSize: 12, color: "#6b6555", marginBottom: 8 }}>
                      વસ્તુ ખતમ થાય ત્યારે <b>ખતમ</b> કરો. ગ્રાહક તેને કાર્ટમાં ઉમેરી નહીં શકે. ફરી આવે ત્યારે ચાલુ કરો.
                      {myProducts.length > 0 ? ` (કુલ ${myProducts.length}, ખતમ ${soldOutCount})` : ""}
                    </div>
                    {myProducts.length === 0 ? (
                      <div style={{ textAlign: "center", color: "#8a8378", marginTop: 30 }}>તમારા નામે કોઈ પ્રોડક્ટ નથી. એડમિનને મેસેજ કરો.</div>
                    ) : (
                      <>
                        <input
                          style={{ ...styles.textInput, marginBottom: 8 }}
                          placeholder="પ્રોડક્ટ શોધો"
                          value={sellerStockQuery}
                          onChange={(e) => setSellerStockQuery(e.target.value)}
                        />
                        {shownProducts.slice(0, 60).map((x) => (
                          <div key={x.id} style={{ ...styles.orderCard, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{x.name}</div>
                              <div style={{ fontSize: 11, color: "#8a8378" }}>{formatRs(x.price)}{stockOf(x) !== null ? ` · સ્ટોક: ${stockOf(x)}` : ""}</div>
                            </div>
                            <button
                              onClick={() => toggleSoldOut(x)}
                              style={{
                                border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                                background: x.soldOut ? "#fdecec" : "#e8f6ec", color: x.soldOut ? "#b23b3b" : "#2e7d4f",
                              }}
                            >
                              {x.soldOut ? "❌ ખતમ" : "✅ ઉપલબ્ધ"}
                            </button>
                            <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                              <span style={{ fontSize: 11.5, color: "#6b6555", fontWeight: 700 }}>સ્ટોક</span>
                              <button onClick={() => adjustStock(x, -1)} aria-label="minus" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.hairline}`, background: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>−</button>
                              <input
                                key={x.id + "_" + (stockOf(x) === null ? "" : stockOf(x))}
                                type="number" min="0" inputMode="numeric"
                                defaultValue={stockOf(x) === null ? "" : stockOf(x)}
                                placeholder="—"
                                onBlur={(e) => setStockExact(x, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                                style={{ width: 64, height: 34, textAlign: "center", fontSize: 14, fontWeight: 700, border: `1px solid ${T.hairline}`, borderRadius: 8, outline: "none" }}
                              />
                              <button onClick={() => adjustStock(x, 1)} aria-label="plus" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.hairline}`, background: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>+</button>
                            </div>
                          </div>
                        ))}
                        {shownProducts.length > 60 && (
                          <div style={{ fontSize: 11, color: "#8a8378", textAlign: "center" }}>બીજા {shownProducts.length - 60} માટે ઉપર શોધો.</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {sellerTab === "hisab" && (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      {statBox("પૂર્ણ વેચાણ", formatRs(hisab.payable))}
                      {statBox("મળેલ", formatRs(hisab.paid))}
                      {statBox("બાકી", formatRs(hisab.balance), hisab.balance > 0)}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#8a8378", marginBottom: 12 }}>
                      "પૂર્ણ વેચાણ" માં ફક્ત <b>ડિલિવર થયેલા</b> ઓર્ડર ({hisab.deliveredCount}) ગણાય છે.
                      {SELLER_PAYOUT_PCT !== 100 ? ` તમારો હિસ્સો ${SELLER_PAYOUT_PCT}%.` : ""}
                    </div>

                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>📅 તારીખ પ્રમાણે ઓર્ડર</div>
                    <div style={{ ...styles.orderCard, marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <button onClick={() => moveMonth(-1)} style={navBtn}>◀</button>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{monthLabel(`${calMonth.y}-${pad2(calMonth.m + 1)}`)}</div>
                          <div style={{ fontSize: 11, color: "#6b6555" }}>આ મહિનાના ઓર્ડર: <b>{formatRs(calMonthTotal)}</b></div>
                        </div>
                        <button onClick={() => moveMonth(1)} style={navBtn}>▶</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                        {["ર", "સો", "મં", "બુ", "ગુ", "શુ", "શ"].map((w) => (
                          <div key={w} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#8a8378" }}>{w}</div>
                        ))}
                        {calCells.map((d, i) => {
                          if (d == null) return <div key={`e${i}`} />;
                          const k = `${calPrefix}${pad2(d)}`;
                          const info = byDay[k];
                          const picked = calSel === k;
                          return (
                            <div
                              key={k}
                              onClick={() => info && setCalSel(picked ? "" : k)}
                              style={{
                                minHeight: 46, borderRadius: 6, padding: "2px 1px", textAlign: "center",
                                cursor: info ? "pointer" : "default",
                                border: picked ? `2px solid ${T.orange}` : `1px solid ${T.hairline}`,
                                background: info ? "#FFF1DC" : "transparent",
                              }}
                            >
                              <div style={{ fontSize: 11, color: "#6b6555" }}>{d}</div>
                              {info && <div style={{ fontSize: 9.5, fontWeight: 800, color: "#b34a00", lineHeight: 1.2 }}>{compactRs(info.amount)}</div>}
                            </div>
                          );
                        })}
                      </div>
                      {selDay ? (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 4 }}>
                            {fmtD(`${calSel}T00:00:00`)} · {selDay.count} ઓર્ડર · {formatRs(selDay.amount)}
                          </div>
                          {selDay.orders.map((o) => (
                            <div key={o.id} style={{ fontSize: 12, borderTop: `1px dashed ${T.hairline}`, padding: "5px 0" }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <b>#{numById[o.id]} · {new Date(o.createdAt).toLocaleTimeString("gu-IN", { hour: "2-digit", minute: "2-digit" })}</b>
                                <span style={{ color: o.status === "ડિલિવર થયો" ? "#2e9e57" : T.orange, fontWeight: 700 }}>{o.status || "નવો"}</span>
                              </div>
                              <div style={{ color: "#6b6555" }}>{o.myItems.map((it) => `${it.name} × ${it.qty}`).join(", ")}</div>
                              <div style={{ fontWeight: 700 }}>{formatRs(mineTotal(o))}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 10.5, color: "#8a8378", marginTop: 8 }}>
                          દરેક તારીખે તે દિવસના બધા ઓર્ડરની રકમ દેખાય છે. વિગત જોવા તારીખ દબાવો.
                        </div>
                      )}
                    </div>

                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>મહિના પ્રમાણે</div>
                    {monthKeys.length === 0 && <div style={{ fontSize: 12, color: "#8a8378", marginBottom: 12 }}>હજુ કોઈ ડિલિવર થયેલો ઓર્ડર નથી.</div>}
                    {monthKeys.map((k) => (
                      <div key={k} style={{ ...styles.orderCard, display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12.5 }}>
                        <span>{monthLabel(k)} · {byMonth[k].count} ઓર્ડર</span>
                        <b>{formatRs(Math.round((byMonth[k].amount * SELLER_PAYOUT_PCT) / 100))}</b>
                      </div>
                    ))}

                    <div style={{ fontWeight: 800, fontSize: 13, margin: "14px 0 6px" }}>તમને મળેલી ચૂકવણી</div>
                    {myPays.length === 0 && <div style={{ fontSize: 12, color: "#8a8378" }}>હજુ કોઈ ચૂકવણી નોંધાઈ નથી.</div>}
                    {myPays.map((x) => (
                      <div key={x.id} style={{ ...styles.orderCard, display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12.5 }}>
                        <span>{fmtD(x.date)}{x.note ? ` · ${x.note}` : ""}</span>
                        <b>{formatRs(x.amount)}</b>
                      </div>
                    ))}
                  </div>
                )}

                {sellerTab === "msg" && (
                  <div>
                    <div style={{ fontSize: 12, color: "#6b6555", marginBottom: 8 }}>એડમિનને કોઈ સવાલ કે જાણ કરવી હોય તો અહીં લખો.</div>
                    <textarea
                      style={{ ...styles.textInput, minHeight: 80, resize: "vertical" }}
                      placeholder="તમારો મેસેજ લખો..."
                      value={sellerMsgText}
                      onChange={(e) => setSellerMsgText(e.target.value)}
                    />
                    <button style={{ ...styles.primaryBtn, marginTop: 8 }} onClick={sendSellerMessage}>
                      મેસેજ મોકલો
                    </button>
                    <div style={{ fontWeight: 800, fontSize: 13, margin: "16px 0 6px" }}>તમારા મેસેજ</div>
                    {myMsgs.length === 0 && <div style={{ fontSize: 12, color: "#8a8378" }}>હજુ કોઈ મેસેજ મોકલ્યો નથી.</div>}
                    {myMsgs.map((m) => (
                      <div key={m.id} style={{ ...styles.orderCard, marginBottom: 6 }}>
                        <div style={{ fontSize: 11, color: "#8a8378" }}>
                          {fmtDt(m.at)} · {m.done ? "✔ એડમિને જોયું" : "મોકલાયો"}
                        </div>
                        <div style={{ fontSize: 12.5, marginTop: 3, whiteSpace: "pre-wrap" }}>{m.text}</div>
                        {m.reply && (
                          <div style={{ marginTop: 6, padding: "6px 8px", background: "#e8f6ec", borderRadius: 8, fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                            <div style={{ fontSize: 10.5, color: "#2e7d4f", fontWeight: 700 }}>એડમિનનો જવાબ · {fmtDt(m.repliedAt)}</div>
                            {m.reply}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ADMIN PANEL */}
        {view === "admin" && (
          <div style={styles.scrollArea} className="scroll-area view-narrow">
            <div style={{ padding: 16 }}>
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>👑 Premium customers / Wallet</summary>
                <div style={{ marginTop: 10 }}>
                  <AdminCustomers />
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>⭐ Blog Reviews (Approve / Reject)</summary>
                <div style={{ marginTop: 10 }}>
                  <AdminBlogReviews />
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                  ✉️ Seller Messages {sellerMessages.filter((m) => !m.done).length > 0 ? `(${sellerMessages.filter((m) => !m.done).length})` : ""}
                </summary>
                <div style={{ marginTop: 10 }}>
                  {sellerMessages.length === 0 && <div style={{ fontSize: 12, color: "#8a8378" }}>હાલમાં કોઈ મેસેજ નથી.</div>}
                  {sellerMessages.map((m) => (
                    <div key={m.id} style={{ ...styles.orderCard, marginBottom: 8, ...(m.done ? { opacity: 0.6 } : {}) }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{m.sellerName}</div>
                      <div style={{ fontSize: 11, color: "#8a8378" }}>
                        {new Date(m.at).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{m.text}</div>
                      {m.reply && (
                        <div style={{ fontSize: 12.5, marginTop: 6, padding: "6px 8px", background: T.surface2, borderRadius: 8, whiteSpace: "pre-wrap" }}>
                          <b>તમારો જવાબ:</b> {m.reply}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <input
                          style={{ ...styles.textInput, flex: 1, padding: "6px 8px", fontSize: 12 }}
                          placeholder={m.reply ? "નવો જવાબ લખો..." : "જવાબ લખો..."}
                          value={replyInputs[m.id] || ""}
                          onChange={(e) => setReplyInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        />
                        <button
                          style={{ border: "none", background: T.orange, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          onClick={() => replyToSellerMessage(m.id)}
                        >
                          જવાબ મોકલો
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        {!m.done && (
                          <button
                            style={{ ...styles.primaryBtn, marginTop: 0, flex: 1, padding: "8px 0", fontSize: 12 }}
                            onClick={() => markSellerMessageDone(m.id)}
                          >
                            ✓ જોયું
                          </button>
                        )}
                        <button
                          style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}
                          onClick={() => deleteSellerMessage(m.id)}
                        >
                          ✕ કાઢો
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                  🆕 Pending Sellers {pendingSellers.length > 0 ? `(${pendingSellers.length})` : ""}
                </summary>
                <div style={{ marginTop: 10 }}>
                  {pendingSellers.length === 0 && (
                    <div style={{ fontSize: 12, color: "#8a8378" }}>હાલમાં કોઈ નવી રજિસ્ટ્રેશન વિનંતી નથી.</div>
                  )}
                  {pendingSellers.map((p, pi) => (
                    <div key={p.id} style={{ ...styles.orderCard, marginBottom: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>રજિસ્ટ્રેશન #{p.no || pi + 1} · {p.shop}</div>
                      <div style={{ fontSize: 11, color: "#8a8378" }}>
                        {p.owner} · {p.mobile} · {p.category}
                        {p.area ? ` · ${p.area}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#8a8378" }}>PIN: {p.pin}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          style={{ ...styles.primaryBtn, marginTop: 0, flex: 1, padding: "8px 0", fontSize: 12 }}
                          onClick={() => approveSellerRegistration(p.id)}
                        >
                          ✅ Approve
                        </button>
                        <button
                          style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}
                          onClick={() => rejectSellerRegistration(p.id)}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>🏪 Sellers</summary>
                <div style={{ marginTop: 10 }}>
                  {sellers.map((s, si) => (
                    <div
                      key={s.id}
                      style={{ ...styles.orderCard, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>સેલર #{si + 1} · {s.name}</div>
                        <div style={{ fontSize: 11, color: "#8a8378" }}>મોબાઇલ: {s.mobile || "—"} · PIN: {s.pin}</div>
                        <select
                          value={marketOfSeller(s)}
                          onChange={(e) => saveSellers(sellers.map((x) => (x.id === s.id ? { ...x, market: e.target.value } : x)))}
                          style={{ ...styles.textInput, width: "auto", padding: "5px 8px", fontSize: 12, marginTop: 4 }}
                        >
                          <option value="">📍 Market નક્કી નથી</option>
                          {MARKETS.map((m) => <option key={m.name} value={m.name}>📍 {m.name}</option>)}
                        </select>
                        {(() => {
                          const h = sellerHisab(s.id);
                          const pi = payInputs[s.id] || { amount: "", note: "" };
                          return (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize: 11.5 }}>
                                હિસાબ બાકી: <b style={{ color: h.balance > 0 ? "#b23b3b" : "inherit" }}>{formatRs(h.balance)}</b>
                                <span style={{ color: "#8a8378" }}> (ડિલિવર થયેલા {formatRs(h.payable)} − ચૂકવેલ {formatRs(h.paid)})</span>
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                <input
                                  type="number"
                                  style={{ ...styles.textInput, width: 90, padding: "6px 8px", fontSize: 12 }}
                                  placeholder="₹ ચૂકવ્યા"
                                  value={pi.amount}
                                  onChange={(e) => setPayInputs((prev) => ({ ...prev, [s.id]: { ...pi, amount: e.target.value } }))}
                                />
                                <input
                                  style={{ ...styles.textInput, flex: 1, padding: "6px 8px", fontSize: 12 }}
                                  placeholder="નોંધ (વૈકલ્પિક)"
                                  value={pi.note}
                                  onChange={(e) => setPayInputs((prev) => ({ ...prev, [s.id]: { ...pi, note: e.target.value } }))}
                                />
                                <button
                                  style={{ border: "none", background: T.orange, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                                  onClick={() => addSellerPayment(s.id)}
                                >
                                  ઉમેરો
                                </button>
                              </div>
                              {sellerPayments.filter((x) => x.sellerId === s.id).slice(0, 3).map((x) => (
                                <div key={x.id} style={{ fontSize: 11, color: "#6b6555", marginTop: 3 }}>
                                  {new Date(x.date).toLocaleDateString("gu-IN", { day: "2-digit", month: "short" })} · {formatRs(x.amount)}{x.note ? ` · ${x.note}` : ""}{" "}
                                  <span style={{ color: "#c0392b", cursor: "pointer" }} onClick={() => deleteSellerPayment(x.id)}>✕</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      <button
                        style={{ border: "none", background: "transparent", cursor: "pointer" }}
                        onClick={() => deleteSeller(s.id)}
                        aria-label="ડિલિટ"
                      >
                        <Trash2 size={18} color="#c0392b" />
                      </button>
                    </div>
                  ))}
                  <input
                    style={{ ...styles.textInput, marginTop: 8 }}
                    placeholder="સેલરનું નામ"
                    value={newSellerName}
                    onChange={(e) => setNewSellerName(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      style={{ ...styles.textInput, flex: 1 }}
                      placeholder="મોબાઇલ નંબર"
                      value={newSellerMobile}
                      onChange={(e) => setNewSellerMobile(e.target.value)}
                    />
                    <input
                      style={{ ...styles.textInput, width: 90 }}
                      placeholder="PIN"
                      value={newSellerPin}
                      onChange={(e) => setNewSellerPin(e.target.value)}
                    />
                  </div>
                  <button
                    style={{ ...styles.primaryBtn, marginTop: 8 }}
                    onClick={() => {
                      addSeller(newSellerName, newSellerMobile, newSellerPin);
                      setNewSellerName("");
                      setNewSellerMobile("");
                      setNewSellerPin("");
                    }}
                  >
                    + સેલર ઉમેરો
                  </button>
                </div>
              </details>
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>💬 નવી પૂછપરછ ({enquiries.length})</summary>
                <div style={{ marginTop: 10 }}>
              {enquiries.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ પૂછપરછ નથી.</p>}
              {enquiries.map((e) => (
                <div key={e.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                  <div style={styles.orderTopRow}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>
                      {new Date(e.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={styles.orderStatusTag}>{e.status || "નવી"}</span>
                  </div>
                  {(e.name || e.phone) && (
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginTop: 8 }}>
                      {e.name}
                      {e.phone && (
                        <a href={`tel:${e.phone}`} style={{ color: T.orange, marginLeft: 8, fontWeight: 700, textDecoration: "none" }}>
                          📞 {e.phone}
                        </a>
                      )}
                    </div>
                  )}
                  {e.text && (
                    <div style={{ fontSize: 13, color: T.ink, marginTop: 6, whiteSpace: "pre-wrap" }}>{e.text}</div>
                  )}
                  {e.photo && (
                    <div style={{ marginTop: 8 }}>
                      <img
                        src={e.photo}
                        alt="enquiry"
                        style={{ width: "100%", maxWidth: 220, borderRadius: 10, border: `1px solid ${T.hairline}`, display: "block" }}
                      />
                      <a
                        href={e.photo}
                        download={`enquiry-photo-${e.id}.jpg`}
                        style={{
                          marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 12, fontWeight: 700, color: T.green, textDecoration: "none",
                          background: T.greenLight, padding: "6px 10px", borderRadius: 8,
                        }}
                      >
                        <Download size={13} /> ફોટો ડાઉનલોડ કરો
                      </a>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {e.status !== "થઈ ગયું" && (
                      <button
                        onClick={() => enquirySave({ ...e, status: "થઈ ગયું" })}
                        style={{ ...styles.statusBtn, ...styles.statusBtnActive }}
                      >
                        ✓ થઈ ગયું તરીકે માર્ક કરો
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (window.confirm("આ પૂછપરછ ડિલીટ કરવી છે?")) enquiryDelete(e.id);
                      }}
                      style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>🎁 Diwali Bonus ({bonusApps.length})</summary>
                <div style={{ marginTop: 10 }}>
                  {bonusApps.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈએ ફોર્મ ભર્યું નથી.</p>}
                  {bonusApps.map((a, idx) => (
                    <div key={a.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                      <div style={styles.orderTopRow}>
                        <span style={{ fontWeight: 700, fontSize: 12 }}>#{bonusApps.length - idx} · {new Date(a.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span style={styles.orderStatusTag}>{a.status || "નવી"}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 8 }}>{a.name}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>💰 Salary: {a.salary}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>📍 {a.address}</div>
                      <a href={`https://wa.me/91${a.phone}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, color: T.green, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>💬 WhatsApp: {a.phone}</a>
                      <a href={`tel:${a.phone}`} style={{ marginLeft: 12, color: T.orange, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>📞 કૉલ</a>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        {["સંપર્ક થયો", "પૂર્ણ"].filter((st) => st !== a.status).map((st) => (
                          <button key={st} onClick={() => applicationSave({ ...a, status: st })} style={{ ...styles.statusBtn, ...styles.statusBtnActive }}>{st}</button>
                        ))}
                        <button onClick={() => { if (window.confirm("આ એન્ટ્રી ડિલીટ કરવી છે?")) applicationDelete(a.id); }} style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>📝 Blog Posts ({blogPosts.filter((b) => b.status === "review").length} review માં)</summary>
                <div style={{ marginTop: 10 }}>
                  {blogPosts.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ બ્લોગ નથી.</p>}
                  {[...blogPosts].sort((a, b) => (a.status === "review" ? -1 : 0) - (b.status === "review" ? -1 : 0)).map((b) => (
                    <div key={b.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                      <div style={styles.orderTopRow}>
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{b.byName} · {b.category}</span>
                        <StatusPill status={b.status} />
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 8 }}>{b.title}</div>
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 12.5, color: T.orange, cursor: "pointer" }}>બ્લોગ વાંચો</summary>
                        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: T.inkSoft, marginTop: 6, lineHeight: 1.6 }}>{b.body}</div>
                      </details>
                      {b.note ? <div style={{ fontSize: 12, color: "#b23b3b", marginTop: 6 }}>નોંધ: {b.note}</div> : null}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        {b.status !== "published" && (
                          <button onClick={() => adminBlogSet(b, "published", "")} style={{ ...styles.statusBtn, color: "#1F5C40", borderColor: "#b7dcc4" }}>✅ Publish</button>
                        )}
                        <button
                          onClick={() => { const n = window.prompt("લેખકને શું સુધારવું છે? (નોંધ)"); if (n !== null) adminBlogSet(b, "fix", n.trim()); }}
                          style={styles.statusBtn}
                        >✏️ સુધારો</button>
                        <button onClick={() => { if (window.confirm("આ બ્લોગ ડિલીટ કરવો છે?")) blogPostDelete(b.id); }} style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>🏪 Trader / Retailer ({traders.length})</summary>
                <div style={{ marginTop: 10 }}>
                  {traders.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ Signup નથી.</p>}
                  {traders.map((t) => (
                    <div key={t.mobile} style={{ ...styles.orderCard, marginBottom: 10 }}>
                      <div style={styles.orderTopRow}>
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{new Date(t.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span style={styles.orderStatusTag}>{t.kind}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 8 }}>{t.firm}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>GSTIN: {t.gstin}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>📍 {t.address}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>🏷️ {(t.tabs || []).join(", ")}</div>
                      <a href={`https://wa.me/91${t.mobile}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, color: T.green, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>💬 WhatsApp: {t.mobile}</a>
                      <a href={`tel:${t.mobile}`} style={{ marginLeft: 12, color: T.orange, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>📞 કૉલ</a>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => { if (window.confirm("આ એકાઉન્ટ ડિલીટ કરવું છે?")) traderDelete(t.mobile); }} style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>💼 Job Applications ({jobApps.length})</summary>
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {["બધી", "Sales Executive", "Sales Officer", "Delivery Partner"].map((n) => {
                      const c = n === "બધી" ? jobApps.length : jobApps.filter((a) => a.job === n).length;
                      return (
                        <button key={n} onClick={() => setJobFilter(n)} style={{ ...styles.statusBtn, ...(jobFilter === n ? styles.statusBtnActive : {}) }}>{n} ({c})</button>
                      );
                    })}
                  </div>
                  {jobApps.filter((a) => jobFilter === "બધી" || a.job === jobFilter).length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ અરજી નથી.</p>}
                  {jobApps.filter((a) => jobFilter === "બધી" || a.job === jobFilter).map((a) => (
                    <div key={a.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                      <div style={styles.orderTopRow}>
                        <span style={{ fontWeight: 700, fontSize: 12 }}>અરજી #{a.no || jobAppNo(a)} · {new Date(a.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span style={styles.orderStatusTag}>{a.job}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 8 }}>{a.name}</div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>🎓 {a.qualification} • 💼 {a.experience} • {a.status || "નવી"}</div>
                      <a href={`https://wa.me/91${a.phone}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, color: T.green, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>💬 WhatsApp: {a.phone}</a>
                      <a href={`tel:${a.phone}`} style={{ marginLeft: 12, color: T.orange, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>📞 કૉલ</a>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        {["સંપર્ક થયો", "પસંદ થયા", "નામંજૂર"].filter((st) => st !== a.status).map((st) => (
                          <button key={st} onClick={() => applicationSave({ ...a, status: st })} style={{ ...styles.statusBtn, ...styles.statusBtnActive }}>{st}</button>
                        ))}
                        <button onClick={() => { if (window.confirm("આ અરજી ડિલીટ કરવી છે?")) applicationDelete(a.id); }} style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>📝 બ્લોગ રાઇટર અરજીઓ ({blogApps.length})</summary>
                <div style={{ marginTop: 10 }}>
              {blogApps.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ અરજી નથી.</p>}
              {blogApps.map((a) => (
                <div key={a.id} style={{ ...styles.orderCard, marginBottom: 10 }}>
                  <div style={styles.orderTopRow}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>
                      અરજી #{blogAppNo(a)} · {new Date(a.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={styles.orderStatusTag}>{a.status || "નવી"}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 8 }}>
                    {a.name} <span style={{ fontWeight: 600, color: T.inkSoft }}>({a.age} વર્ષ, {a.city})</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>{a.level} • {a.lang}</div>
                  <a
                    href={`https://wa.me/91${a.phone}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-block", marginTop: 6, color: T.green, fontWeight: 700, fontSize: 13, textDecoration: "none" }}
                  >
                    💬 WhatsApp: {a.phone}
                  </a>
                  <a href={`tel:${a.phone}`} style={{ marginLeft: 12, color: T.orange, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>📞 કૉલ</a>
                  {a.sample && (
                    <div style={{ marginTop: 6, fontSize: 12.5 }}>
                      <a href={a.sample} target="_blank" rel="noreferrer" style={{ color: T.orange, wordBreak: "break-all" }}>🔗 Sample: {a.sample}</a>
                    </div>
                  )}
                  {a.about && <div style={{ fontSize: 13, color: T.ink, marginTop: 6, whiteSpace: "pre-wrap" }}>{a.about}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {["સંપર્ક થયો", "પસંદ થયા", "નામંજૂર"].filter((st) => st !== a.status).map((st) => (
                      <button key={st} onClick={() => applicationSave({ ...a, status: st })} style={{ ...styles.statusBtn, ...styles.statusBtnActive }}>
                        {st}
                      </button>
                    ))}
                    <button
                      onClick={() => { if (window.confirm("આ અરજી ડિલીટ કરવી છે?")) applicationDelete(a.id); }}
                      style={{ ...styles.statusBtn, color: "#b23b3b", borderColor: "#e3b8b8" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
                </div>
              </details>

              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontWeight: 800, fontSize: 14, cursor: "pointer" }}>📦 ઓર્ડર્સ ({orders.length})</summary>
                <div style={{ marginTop: 10 }}>
              {orders.length === 0 && <p style={{ color: "#a49c88", fontSize: 13 }}>હજુ કોઈ ઓર્ડર નથી.</p>}
              {groupOrdersByDate(orders).map((group, groupIdx) => {
                const defaultOpen = groupIdx === 0;
                const toggled = expandedDateGroups.has(group.label);
                const isOpen = toggled ? !defaultOpen : defaultOpen;
                return (
                  <div key={group.label} style={{ marginBottom: 10 }}>
                    <button
                      onClick={() =>
                        setExpandedDateGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.label)) next.delete(group.label);
                          else next.add(group.label);
                          return next;
                        })
                      }
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: T.surface2,
                        border: `1px solid ${T.hairline}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>
                        📅 {group.label} ({group.items.length})
                      </span>
                      <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>
                        {isOpen ? "છુપાવો ▲" : "જુઓ ▼"}
                      </span>
                    </button>
                    {isOpen &&
                      group.items.map(({ order: o, orderNumber }) => (
                        <div key={o.id} style={{ ...styles.orderCard, marginTop: 8 }}>
                          <div style={styles.orderTopRow}>
                            <span style={{ fontWeight: 700, fontSize: 12 }}>ઓર્ડર #{orderNumber} · {o.customer.name}</span>
                            <span style={styles.orderStatusTag}>{o.status}</span>
                          </div>
                          <div style={{ fontSize: 10.5, color: "#a49c88", marginTop: 2 }}>{formatOrderDate(o.createdAt)}</div>
                          <div style={{ fontSize: 11, color: "#8a8378", marginTop: 4 }}>{o.customer.phone}</div>
                          <div style={{ fontSize: 11, color: "#8a8378", marginBottom: 4 }}>{o.customer.address}</div>
                          {o.promoCode ? (
                            <div style={{ fontSize: 11, color: T.green, fontWeight: 700, marginBottom: 4 }}>
                              🎟️ પ્રોમો: {o.promoCode} (-{formatRs(o.promoDiscountAmount || 0)})
                            </div>
                          ) : null}
                          <div style={{ fontSize: 12, color: "#2c2a26" }}>
                            {o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 13, margin: "4px 0" }}>{formatRs(o.total)}</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => downloadOrderPdf(o, orderNumber)}
                              style={{
                                display: "flex", alignItems: "center", gap: 6, background: T.green, color: "#fff",
                                fontWeight: 800, fontSize: 11.5, padding: "6px 12px", borderRadius: 8, border: "none",
                              }}
                            >
                              📄 PDF ડાઉનલોડ કરો
                            </button>
                            <button
                              onClick={() => triggerBluetoothPrint(o.id, o, orderNumber, sellers)}
                              style={{
                                display: "flex", alignItems: "center", gap: 6, background: "#185FA5", color: "#fff",
                                fontWeight: 800, fontSize: 11.5, padding: "6px 12px", borderRadius: 8, border: "none",
                              }}
                            >
                              🖨️ Print
                            </button>
                          </div>
                          <div style={styles.statusRow}>
                            {["નવો", "કન્ફર્મ", "ડિલિવર થયો"].map((s) => (
                              <button
                                key={s}
                                onClick={() => updateOrderStatus(o.id, s)}
                                style={{ ...styles.statusBtn, ...(o.status === s ? styles.statusBtnActive : {}) }}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })}
                </div>
              </details>

              <div style={{ ...styles.adminSectionTitle, marginTop: 24 }}><Tag size={16} /> કેટેગરી મેનેજ કરો</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ ...styles.textInput, flex: 1 }}
                  placeholder="નવી કેટેગરીનું નામ"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button
                  style={{ ...styles.primaryBtn, width: 80, marginTop: 0, padding: "0 10px" }}
                  onClick={addCategory}
                >
                  ઉમેરો
                </button>
              </div>
              {customCategories.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {customCategories.map((c) => (
                    <div
                      key={c}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: T.surface2, border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "4px 6px 4px 10px", fontSize: 11.5, color: T.ink }}
                    >
                      {c}
                      <button
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
                        onClick={() => deleteCategory(c)}
                        aria-label="કેટેગરી કાઢી નાખો"
                      >
                        <X size={12} color="#b23b3b" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ ...styles.adminSectionTitle, marginTop: 24 }}>
                <Package size={16} /> {editingProductId ? "પ્રોડક્ટ અપડેટ કરો" : "પ્રોડક્ટ ઉમેરો"}
              </div>
              <input
                style={styles.textInput}
                placeholder="પ્રોડક્ટનું નામ"
                value={newProduct.name}
                onChange={(e) => setNewProduct((f) => ({ ...f, name: e.target.value }))}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <select
                  style={{ ...styles.textInput, flex: 1 }}
                  value={newProduct.category}
                  onChange={(e) => setNewProduct((f) => ({ ...f, category: e.target.value, subcategory: "" }))}
                >
                  {allCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  style={{ ...styles.textInput, width: 90 }}
                  placeholder="ભાવ ₹"
                  type="number"
                  value={newProduct.price}
                  onChange={(e) => setNewProduct((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              {(() => {
                const cat = newProduct.category;
                const subs = subcatsFor(cat, subcatCustom);
                const customOnes = subcatCustom[cat] || [];
                const chip = (on) => ({
                  border: `1px solid ${on ? T.orange : T.hairline}`, borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", background: on ? T.orange : "#fff", color: on ? "#fff" : T.inkSoft,
                });
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                      પેટા કેટેગરી {subs.length === 0 ? <span style={{ fontWeight: 400, color: "#8a8378" }}>(આ કેટેગરીમાં હજી નથી, નીચેથી ઉમેરો)</span> : ""}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {subs.length > 0 && (
                        <button style={chip(!newProduct.subcategory)} onClick={() => setNewProduct((f) => ({ ...f, subcategory: "" }))}>કોઈ નહીં</button>
                      )}
                      {subs.map((sc) => (
                        <button key={sc} style={chip(newProduct.subcategory === sc)} onClick={() => setNewProduct((f) => ({ ...f, subcategory: sc }))}>
                          {sc}
                          {customOnes.includes(sc) && (
                            <span
                              style={{ marginLeft: 6, color: newProduct.subcategory === sc ? "#fff" : "#c0392b" }}
                              onClick={(e) => { e.stopPropagation(); removeSubcategory(cat, sc); }}
                            >
                              ✕
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <input
                        style={{ ...styles.textInput, flex: 1, padding: "6px 8px", fontSize: 12 }}
                        placeholder="+ નવી પેટા કેટેગરી"
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                      />
                      <button
                        style={{ border: "none", background: T.orange, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                        onClick={async () => {
                          const nm = newSubName.trim();
                          if (await addSubcategory(cat, nm)) {
                            setNewProduct((f) => ({ ...f, subcategory: nm }));
                            setNewSubName("");
                          }
                        }}
                      >
                        ઉમેરો
                      </button>
                    </div>
                  </div>
                );
              })()}
              <select
                style={{ ...styles.textInput, marginTop: 8 }}
                value={newProduct.sellerId || ""}
                onChange={(e) => setNewProduct((f) => ({ ...f, sellerId: e.target.value }))}
              >
                <option value="">સેલર નથી (Apni Dukan)</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  style={{ ...styles.textInput, flex: 1 }}
                  placeholder="ઇમોજી (દા.ત. 👕)"
                  value={newProduct.img}
                  onChange={(e) => setNewProduct((f) => ({ ...f, img: e.target.value }))}
                />
                <input
                  style={{ ...styles.textInput, width: 90 }}
                  placeholder="સ્ટોક"
                  type="number"
                  value={newProduct.stock}
                  onChange={(e) => setNewProduct((f) => ({ ...f, stock: e.target.value }))}
                />
              </div>

              <label style={{ ...styles.label, margin: "12px 0 6px" }}>પ્રોડક્ટ ફોટો</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {newProduct.image ? (
                  <img src={newProduct.image} alt="preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: `1px solid ${T.hairline}` }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 8, border: `1px dashed ${T.hairline}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                    {newProduct.img || "🛍️"}
                  </div>
                )}
                <label
                  style={{ ...styles.textInput, flex: 1, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: T.inkSoft }}
                >
                  <ImagePlus size={15} />
                  {newProduct.image ? "ફોટો બદલો" : "ફોટો અપલોડ કરો"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => { handleProductImageFile(e.target.files && e.target.files[0]); e.target.value = ""; }}
                  />
                </label>
                {newProduct.image && (
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => { resetProductPhoto(); setNewProduct((f) => ({ ...f, image: "" })); }}
                    aria-label="ફોટો કાઢી નાખો"
                  >
                    <X size={16} color="#b23b3b" />
                  </button>
                )}
              </div>

              {imgBusy && <div style={{ fontSize: 12, color: "#8a8378", marginTop: 6 }}>ફોટો તૈયાર થાય છે...</div>}
              {imgNew && newProduct.image && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {[["poster", "✨ ઓફર પોસ્ટર"], ["plain", "સાદો ફોટો"]].map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setImgMode(k)}
                        style={{
                          border: `1px solid ${imgMode === k ? T.orange : T.hairline}`, borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                          background: imgMode === k ? T.orange : "#fff", color: imgMode === k ? "#fff" : T.inkSoft,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    {imgMode === "poster" &&
                      [["purple", "જાંબલી"], ["green", "લીલો"], ["blue", "વાદળી"]].map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setImgTheme(k)}
                          style={{
                            border: `1px solid ${imgTheme === k ? T.ink : T.hairline}`, borderRadius: 8, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                            background: imgTheme === k ? T.surface2 : "#fff", color: T.inkSoft,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                  </div>
                  <img
                    src={newProduct.image}
                    alt="તૈયાર ફોટો"
                    style={{ display: "block", marginTop: 8, width: imgMode === "poster" ? 190 : 150, maxWidth: "100%", borderRadius: 10, border: `1px solid ${T.hairline}` }}
                  />
                  <div style={{ fontSize: 11.5, color: "#6b6555", marginTop: 4 }}>
                    સાઇઝ: લગભગ {Math.max(1, Math.round((newProduct.image.length * 0.75) / 1024))} KB (1 MB થી ઓછી)
                    {imgMode === "poster" && !(Number(newProduct.price) > 0) ? " · ભાવ લખશો એટલે ભાવની પટ્ટી ઉમેરાશે" : ""}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.primaryBtn, flex: 1 }} onClick={saveProduct}>
                  {editingProductId ? "અપડેટ કરો" : "પ્રોડક્ટ ઉમેરો"}
                </button>
                {editingProductId && (
                  <button
                    style={{ ...styles.primaryBtn, flex: 1, background: T.surface2, color: T.inkSoft, boxShadow: "none" }}
                    onClick={cancelEditProduct}
                  >
                    રદ કરો
                  </button>
                )}
              </div>

              {/* ---- Bulk Add: multiple products (with photos) at once ---- */}
              <button
                style={{
                  ...styles.adminSectionTitle,
                  marginTop: 16,
                  width: "100%",
                  background: T.surface2,
                  border: `1px solid ${T.hairline}`,
                  borderRadius: 10,
                  padding: "12px 12px",
                  cursor: "pointer",
                  justifyContent: "space-between",
                  fontFamily: "inherit",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
                onClick={() => setShowBulkAdd((v) => !v)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ImagePlus size={16} /> બલ્ક એડ (એકસાથે ઘણા પ્રોડક્ટ)
                </span>
                <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>
                  {showBulkAdd ? "છુપાવો ▲" : "ખોલો ▼"}
                </span>
              </button>

              {showBulkAdd && (
                <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 12, marginTop: 8 }}>
                  <label style={styles.label}>કેટેગરી (બધા પ્રોડક્ટ માટે એક જ)</label>
                  <input
                    style={styles.textInput}
                    placeholder="દા.ત. Welding Materials"
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    list="bulk-cat-options"
                  />
                  <datalist id="bulk-cat-options">
                    {allCategoryOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>

                  {bulkRows.map((row, idx) => (
                    <div key={idx} style={{ border: `1px dashed ${T.hairline}`, borderRadius: 8, padding: 8, marginTop: 10 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          style={{ ...styles.textInput, flex: 1 }}
                          placeholder="પ્રોડક્ટ નામ"
                          value={row.name}
                          onChange={(e) => updateBulkRow(idx, "name", e.target.value)}
                        />
                        {bulkRows.length > 1 && (
                          <button style={styles.removeBtn} onClick={() => removeBulkRow(idx)} aria-label="કાઢી નાખો">
                            <X size={16} color="#b23b3b" />
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input
                          style={{ ...styles.textInput, width: 90 }}
                          placeholder="ભાવ ₹"
                          type="number"
                          value={row.price}
                          onChange={(e) => updateBulkRow(idx, "price", e.target.value)}
                        />
                        <input
                          style={{ ...styles.textInput, width: 90 }}
                          placeholder="સ્ટોક"
                          type="number"
                          value={row.stock}
                          onChange={(e) => updateBulkRow(idx, "stock", e.target.value)}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        {row.image ? (
                          <img src={row.image} alt="preview" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: `1px solid ${T.hairline}` }} />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 8, border: `1px dashed ${T.hairline}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                            {row.img || "🛍️"}
                          </div>
                        )}
                        <label style={{ ...styles.textInput, flex: 1, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: T.inkSoft, fontSize: 11 }}>
                          <ImagePlus size={13} />
                          {row.image ? "ફોટો બદલો" : "ફોટો પસંદ કરો"}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => handleBulkRowImageFile(idx, e.target.files && e.target.files[0])}
                          />
                        </label>
                      </div>
                    </div>
                  ))}

                  <button
                    style={{ ...styles.primaryBtn, background: T.surface2, color: T.ink, boxShadow: "none", marginTop: 10 }}
                    onClick={addBulkRow}
                  >
                    + વધુ પ્રોડક્ટ ઉમેરો
                  </button>
                  <button
                    style={{ ...styles.primaryBtn, marginTop: 8 }}
                    onClick={saveBulkRows}
                    disabled={bulkSaving}
                  >
                    {bulkSaving ? "સેવ થાય છે..." : "બધા સેવ કરો"}
                  </button>
                  {bulkMessage && <div style={{ fontSize: 12, marginTop: 8, color: bulkMessage.startsWith("✅") ? T.green : "#b23b3b" }}>{bulkMessage}</div>}
                </div>
              )}

              <button
                style={{
                  ...styles.adminSectionTitle,
                  marginTop: 24,
                  width: "100%",
                  background: T.surface2,
                  border: `1px solid ${T.hairline}`,
                  borderRadius: 10,
                  padding: "12px 12px",
                  cursor: "pointer",
                  justifyContent: "space-between",
                  fontFamily: "inherit",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
                onClick={() => setShowProductList((v) => !v)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Package size={16} /> બધા પ્રોડક્ટ્સ ({products.length})
                </span>
                <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>
                  {showProductList ? "છુપાવો ▲" : "જુઓ ▼"}
                </span>
              </button>
              {showProductList && (
                <div style={{ ...styles.searchWrap, margin: "8px 0" }}>
                  <Search size={15} color={T.inkSoft} />
                  <input
                    style={styles.searchInput}
                    placeholder="પ્રોડક્ટ શોધો..."
                    value={adminSearchQuery}
                    onChange={(e) => { setAdminSearchQuery(e.target.value); setAdminMore((prev) => ({ ...prev, prod: 60 })); }}
                  />
                  {adminSearchQuery && (
                    <button style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setAdminSearchQuery("")}>
                      <X size={14} color={T.inkSoft} />
                    </button>
                  )}
                </div>
              )}
              {showProductList && categoryChips(adminCat, (c) => { setAdminCat(c); setAdminSub(""); setAdminMore((prev) => ({ ...prev, prod: 60 })); })}
              {showProductList && adminCat && subcatsFor(adminCat, subcatCustom).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 10px" }}>
                  {["", ...subcatsFor(adminCat, subcatCustom), "અન્ય"].map((sc) => (
                    <button
                      key={sc || "all"}
                      onClick={() => { setAdminSub(sc); setAdminMore((prev) => ({ ...prev, prod: 60 })); }}
                      style={{
                        border: `1px solid ${adminSub === sc ? T.orange : T.hairline}`, borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                        background: adminSub === sc ? T.orange : "#fff", color: adminSub === sc ? "#fff" : T.inkSoft,
                      }}
                    >
                      {sc || "બધું"}
                    </button>
                  ))}
                </div>
              )}
              {showProductList && adminListed.length === 0 && (
                <div style={{ fontSize: 12, color: "#a49c88", margin: "4px 0 12px" }}>
                  {adminSearchQuery.trim() ? "કોઈ પ્રોડક્ટ મળ્યું નથી." : "ઉપરથી કેટેગરી પસંદ કરો અથવા નામ શોધો."}
                </div>
              )}
              {showProductList && adminListed.slice(0, adminMore.prod).map((p) => (
                <div key={p.id} style={{ ...styles.productRow, ...(editingProductId === p.id ? { background: T.surface2, borderRadius: 8 } : {}) }}>
                  {resolveProductImage(p) ? (
                    <img src={resolveProductImage(p)} alt={p.name} style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6 }} />
                  ) : (
                    <span style={{ fontSize: 20 }}>{p.img}</span>
                  )}
                  <div style={{ flex: 1, marginLeft: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#8a8378" }}>
                      {p.category}{p.subcategory ? ` / ${p.subcategory}` : ""} · {formatRs(p.price)}
                      {p.stock != null && p.stock !== "" ? ` · સ્ટોક: ${p.stock}` : ""}
                      {p.soldOut ? " · ❌ ખતમ (સેલરે)" : ""}
                    </div>
                  </div>
                  <button style={styles.removeBtn} onClick={() => startEditProduct(p)} aria-label="એડિટ કરો">
                    <Pencil size={15} color={T.inkSoft} />
                  </button>
                  <button style={styles.removeBtn} onClick={() => deleteProduct(p.id)} aria-label="કાઢી નાખો">
                    <Trash2 size={15} color="#b23b3b" />
                  </button>
                </div>
              ))}
              {showProductList && moreButton("prod", adminListed.length)}

              {/* ---- 1. Sales Dashboard ---- */}
              <div style={styles.adminSectionTitle}>📊 વેચાણ ડેશબોર્ડ</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                <div style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>આજનું વેચાણ</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginTop: 2 }}>{formatRs(dashboardStats.today)}</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>આ અઠવાડિયે</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginTop: 2 }}>{formatRs(dashboardStats.week)}</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>આ મહિને</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.green, marginTop: 2 }}>{formatRs(dashboardStats.month)}</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>કુલ ઓર્ડર્સ</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginTop: 2 }}>{dashboardStats.totalOrders}</div>
                </div>
              </div>
              {dashboardStats.bestSelling.length > 0 && adminToggleHeader("best", `🏆 સૌથી વધુ વેચાયેલા (${dashboardStats.bestSelling.length})`)}
              {dashboardStats.bestSelling.length > 0 && adminOpen.best && (
                <div style={{ background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: 10, marginBottom: 20 }}>
                  {dashboardStats.bestSelling.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "5px 0", borderBottom: i < dashboardStats.bestSelling.length - 1 ? `1px solid ${T.hairline}` : "none" }}>
                      <span>{b.name}</span>
                      <span style={{ fontWeight: 700, color: T.orange }}>{b.qty} વેચાયા</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- 2. Low Stock Alert ---- */}
              {adminToggleHeader("low", `⚠️ ઓછો સ્ટોક (${lowStockProducts.length})`)}
              {adminOpen.low && lowStockProducts.length === 0 && (
                <p style={{ color: "#a49c88", fontSize: 12.5, marginBottom: 16 }}>
                  કોઈ પ્રોડક્ટમાં ઓછો સ્ટોક નથી. (સ્ટોક નંબર સેટ કરવા નીચે પ્રોડક્ટ લિસ્ટમાં "સ્ટોક" પર ટેપ કરો.)
                </p>
              )}
              {adminOpen.low && lowStockProducts.slice(0, adminMore.low).map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{p.name}</div>
                    <div style={{ fontSize: 10.5, color: "#b23b3b", fontWeight: 700 }}>{p.stock === 0 ? "0 બાકી" : `ફક્ત ${p.stock} બાકી`}</div>
                  </div>
                  <span style={{ background: "#fde3e3", color: "#b23b3b", fontSize: 9.5, fontWeight: 800, padding: "3px 8px", borderRadius: 6 }}>
                    {p.stock === 0 ? "OUT" : "LOW"}
                  </span>
                </div>
              ))}
              {adminOpen.low && moreButton("low", lowStockProducts.length)}
              <div style={{ height: 10 }} />

              {/* ---- 3. Bulk Price Update ---- */}
              {adminToggleHeader("bulk", `💰 બલ્ક ભાવ અપડેટ (${bulkSelectedIds.size} પસંદ કરેલા)`)}
              {adminOpen.bulk && (
                <div style={{ marginBottom: 20 }}>
                  {categoryChips(bulkCat, setBulkCat)}
                  {bulkCat ? (() => {
                    const inCat = products.filter((p) => (p.category || "અન્ય") === bulkCat);
                    return (
                      <>
                        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                          <button
                            style={{ flex: 1, border: `1px solid ${T.hairline}`, background: "#fff", borderRadius: 8, padding: "7px 6px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: T.ink }}
                            onClick={() => setBulkSelectedIds((prev) => { const n = new Set(prev); inCat.forEach((p) => n.add(p.id)); return n; })}
                          >
                            આ કેટેગરીના બધા પસંદ કરો ({inCat.length})
                          </button>
                          <button
                            style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "7px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: T.inkSoft }}
                            onClick={() => setBulkSelectedIds(new Set())}
                          >
                            હટાવો
                          </button>
                        </div>
                        <div style={{ maxHeight: 260, overflowY: "auto", marginBottom: 8, border: `1px solid ${T.hairline}`, borderRadius: 10, background: "#fff" }}>
                          {inCat.slice(0, 150).map((p) => (
                            <label
                              key={p.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                                borderBottom: `1px solid ${T.hairline}`, fontSize: 11.5, cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={bulkSelectedIds.has(p.id)}
                                onChange={() => toggleBulkSelect(p.id)}
                                style={{ width: 14, height: 14, flexShrink: 0 }}
                              />
                              <span style={{ flex: 1, fontWeight: 700, color: T.ink }}>{p.name}</span>
                              <span style={{ color: T.inkSoft }}>{formatRs(p.price)}</span>
                            </label>
                          ))}
                        </div>
                        {inCat.length > 150 && (
                          <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 8 }}>
                            પહેલા 150 દેખાય છે. "બધા પસંદ કરો" બટન બધા {inCat.length} પસંદ કરે છે.
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "#a49c88", marginBottom: 8 }}>ઉપરથી કેટેગરી પસંદ કરો.</div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={bulkAdjustValue}
                      onChange={(e) => setBulkAdjustValue(e.target.value)}
                      placeholder="દા.ત. +10% અથવા -20 (₹)"
                      style={{ flex: 1, fontSize: 12, padding: "8px 10px", border: `1px solid ${T.hairline}`, borderRadius: 8, background: T.surface2, color: T.ink }}
                    />
                    <button
                      onClick={applyBulkPriceAdjust}
                      disabled={bulkApplying || bulkSelectedIds.size === 0 || !bulkAdjustValue.trim()}
                      style={{ background: T.orange, color: "#fff", fontWeight: 700, fontSize: 12, padding: "8px 16px", borderRadius: 8, border: "none" }}
                    >
                      {bulkApplying ? "..." : "Apply"}
                    </button>
                  </div>
                </div>
              )}

              {/* ---- Seller photo uploads ---- */}
              {adminToggleHeader("uploads", `📷 સેલર અપલોડ${adminOpen.uploads ? ` (${adminUploads.length})` : ""}`)}
              {adminOpen.uploads && (
                <div style={{ marginBottom: 16 }}>
                  <button
                    style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}
                    onClick={loadAdminUploads}
                  >
                    {adminUploadsLoading ? "લોડ થાય છે..." : "🔄 તાજું કરો"}
                  </button>
                  {!adminUploadsLoading && adminUploads.length === 0 && (
                    <p style={{ color: "#a49c88", fontSize: 12.5 }}>હજુ કોઈ ફોટો આવ્યો નથી.</p>
                  )}
                  {adminUploads.map((x) => (
                    <div key={x.id} style={{ ...styles.orderCard, marginBottom: 10, ...(x.seen ? { opacity: 0.65 } : {}) }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>{x.sellerName || "સેલર"}</span>
                        <span style={{ fontSize: 11, color: "#8a8378" }}>
                          {x.createdAt ? new Date(x.createdAt).toLocaleString("gu-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                      </div>
                      {x.note && <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{x.note}</div>}
                      <img
                        src={x.image}
                        alt="સેલરનો ફોટો"
                        onClick={() => setUpBigId(upBigId === x.id ? "" : x.id)}
                        style={{ width: upBigId === x.id ? "100%" : 120, borderRadius: 8, marginTop: 8, cursor: "pointer", display: "block" }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <a
                          href={x.image}
                          download={`seller-photo-${x.id}.jpg`}
                          style={{ border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, textDecoration: "none", color: T.ink }}
                        >
                          ⬇ ડાઉનલોડ
                        </a>
                        {!x.seen && (
                          <button
                            style={{ border: "none", background: T.orange, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            onClick={() => seenAdminUpload(x.id)}
                          >
                            ✓ જોયું
                          </button>
                        )}
                        <button
                          style={{ border: `1px solid ${T.hairline}`, background: "transparent", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
                          onClick={() => removeAdminUpload(x.id)}
                        >
                          ✕ કાઢો
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- 4. Customer List ---- */}
              {adminToggleHeader("cust", `👥 ગ્રાહકો (${customerList.length})`)}
              {adminOpen.cust && customerList.length === 0 && <p style={{ color: "#a49c88", fontSize: 12.5, marginBottom: 16 }}>હજુ કોઈ ઓર્ડર નથી.</p>}
              {adminOpen.cust && customerList.slice(0, adminMore.cust).map((c) => (
                <div key={c.phone} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{c.name}</div>
                    <div style={{ fontSize: 10.5, color: T.inkSoft }}>{c.orderCount} ઓર્ડર્સ • {formatRs(c.totalSpent)} કુલ</div>
                  </div>
                  <a href={`tel:${c.phone}`} style={{ background: T.greenLight, color: T.green, fontSize: 10.5, fontWeight: 800, padding: "5px 10px", borderRadius: 8, textDecoration: "none" }}>
                    📞 Call
                  </a>
                </div>
              ))}
              {adminOpen.cust && moreButton("cust", customerList.length)}
              <div style={{ height: 10 }} />

            </div>
          </div>
        )}
      </div>
      {zoomImage && (
        <div
          onClick={() => setZoomImage(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 10000, padding: 24, cursor: "zoom-out",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
            aria-label="close"
            style={{
              position: "absolute", top: 16, right: 16, width: 36, height: 36,
              borderRadius: 99, background: "rgba(255,255,255,0.15)", border: "none",
              color: "#fff", fontSize: 20, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
          <img
            src={zoomImage.src}
            alt={zoomImage.name || "product"}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "80vh", objectFit: "contain",
              borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.5)", cursor: "default",
            }}
          />
          {zoomImage.name && (
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 700, marginTop: 14, textAlign: "center", maxWidth: 320 }}>
              {zoomImage.name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- design tokens: industrial + environmental + nation + youth ---- */
// ---- Independence Day theme (temporary, auto-reverts) ----
// For a limited window around 15 August, the whole app's color palette
// switches to a tricolor (saffron / white / green) look. After
// THEME_SWITCH_END_TIME passes, T automatically falls back to the
// regular earthy palette — nothing to remove manually.
const THEME_SWITCH_END_TIME = "2026-08-16T12:30:00+05:30";
const REGULAR_THEME = {
  bg: "#DAD6C8",
  surface: "#F2EFE4",
  surface2: "#EAE6D8",
  ink: "#24282A",
  inkSoft: "#565B52",
  orange: "#D8531F",
  orangeDeep: "#B4431A",
  green: "#1F5C40",
  greenDeep: "#17462F",
  greenLight: "#D9EACB",
  greenLight2: "#C3DFAF",
  marigold: "#D99B2B",
  hairline: "#C7C3B4",
};
const INDEPENDENCE_THEME = {
  bg: "#FFF6EC",
  surface: "#FFFFFF",
  surface2: "#FFE9D2",
  ink: "#0B1F4B",
  inkSoft: "#3A4A6B",
  orange: "#FF9933",
  orangeDeep: "#E67E22",
  green: "#138808",
  greenDeep: "#0B5C05",
  greenLight: "#DFF6DA",
  greenLight2: "#C3EFC0",
  marigold: "#000080",
  hairline: "#F0DCC0",
};
const T = Date.now() < new Date(THEME_SWITCH_END_TIME).getTime() ? INDEPENDENCE_THEME : REGULAR_THEME;

const styles = {
  appShell: { minHeight: "100vh", width: "100%", background: `radial-gradient(circle at 15% 0%, #e3e0d3 0%, transparent 45%), ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans Gujarati','Segoe UI',sans-serif", padding: "12px 0" },
  phoneFrame: { width: 390, maxWidth: "100%", height: 780, maxHeight: "95vh", background: T.surface, borderRadius: 28, overflow: "hidden", boxShadow: "0 20px 50px rgba(40,35,20,0.3)", display: "flex", flexDirection: "column", border: `6px solid ${T.ink}`, position: "relative" },
  hazardStrip: { height: 6, flexShrink: 0, background: `repeating-linear-gradient(-45deg, ${T.orange}, ${T.orange} 10px, ${T.ink} 10px, ${T.ink} 20px)` },
  topBar: { background: `linear-gradient(180deg, ${T.greenLight}, ${T.greenLight2})`, padding: "14px 16px 12px", position: "relative", overflow: "hidden", flexShrink: 0 },
  topBarLeaf: { position: "absolute", right: -10, top: -10, width: 130, height: 100, opacity: 0.85, pointerEvents: "none" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" },
  brand: { color: T.ink, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, lineHeight: 1.2, maxWidth: 210 },
  brandDot: { width: 9, height: 9, borderRadius: "50%", background: T.orangeDeep, display: "inline-block" },
  iconBtn: { background: "rgba(255,255,255,0.55)", border: `1px solid rgba(31,92,64,0.25)`, borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.ink },
  cartIconBtn: { position: "relative", background: "rgba(255,255,255,0.55)", border: `1px solid rgba(31,92,64,0.25)`, borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  cartBadge: { position: "absolute", top: -6, right: -6, background: T.orange, color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, minWidth: 17, height: 17, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", border: `2px solid ${T.greenLight}` },
  ecoSloganRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(31,92,64,0.22)" },
  ecoSloganText: { fontFamily: "'Noto Sans Gujarati',sans-serif", fontWeight: 700, fontSize: 11.5, color: T.greenDeep, letterSpacing: "0.01em" },
  scrollArea: { flex: 1, overflowY: "auto" },
  errorBanner: { background: "#f6d9d9", color: "#8a2b2b", fontSize: 12, padding: "8px 16px" },
  errorText: { color: "#b23b3b", fontSize: 12, marginTop: 6 },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: T.surface, border: `1.5px solid ${T.hairline}`, margin: "14px 16px 10px", padding: "10px 14px", borderRadius: 11 },
  searchInput: { border: "none", background: "transparent", outline: "none", fontSize: 14, flex: 1, color: T.ink, fontFamily: "inherit" },
  catRow: { display: "flex", gap: 8, padding: "0 16px 14px", overflowX: "auto" },
  catChip: { flexShrink: 0, fontFamily: "'Oswald',sans-serif", border: `1px solid ${T.hairline}`, background: T.surface2, color: T.inkSoft, padding: "8px 14px 7px", borderRadius: "7px 7px 3px 3px", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", cursor: "pointer" },
  catChipActive: { background: T.ink, color: "#fff", borderColor: T.ink },
  missionStrip: { margin: "2px 16px 16px", background: `linear-gradient(120deg, ${T.green}, ${T.greenDeep})`, borderRadius: 13, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12 },
  missionStamp: { width: 38, height: 38, borderRadius: "50%", border: `2px solid ${T.marigold}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.marigold, fontSize: 16, flexShrink: 0, transform: "rotate(-6deg)" },
  missionText1: { color: "#fff", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans Gujarati',sans-serif" },
  missionText2: { color: "rgba(255,255,255,0.72)", fontSize: 10, marginTop: 2 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 20px" },
  card: { background: T.surface, borderRadius: 12, overflow: "hidden", border: `1px solid ${T.hairline}`, display: "flex", flexDirection: "column", position: "relative" },
  cardImgWrap: { position: "relative", background: "linear-gradient(160deg, #ECE8DA, #DDD8C6)", display: "flex", alignItems: "center", justifyContent: "center", height: 84, overflow: "hidden", borderBottom: `1px dashed ${T.hairline}` },
  cardImg: { width: "100%", height: "100%", objectFit: "cover" },
  cardBody: { padding: "9px 10px 11px" },
  cardCat: { fontFamily: "'Oswald',sans-serif", fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green, fontWeight: 700, marginBottom: 2 },
  cardName: { fontSize: 13, fontWeight: 600, color: T.ink, lineHeight: 1.3, minHeight: 34 },
  cardBottomRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  cardPrice: { fontFamily: "'Oswald',sans-serif", fontSize: 14.5, fontWeight: 700, color: T.ink },
  cardMrp: { fontFamily: "'Oswald',sans-serif", fontSize: 11, color: "#a39c8c", textDecoration: "line-through" },
  discountBadge: { position: "absolute", top: 5, left: 5, background: T.green, color: "#fff", fontFamily: "'Oswald',sans-serif", fontSize: 9.5, fontWeight: 700, padding: "2px 5px", borderRadius: 4, letterSpacing: "0.02em" },
  addBtn: { background: T.orange, color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 2px 0 ${T.orangeDeep}` },
  qtyControl: { display: "flex", alignItems: "center", gap: 6, background: T.ink, borderRadius: 8, padding: "3px 6px" },
  qtyBtn: { background: T.orange, border: "none", borderRadius: 5, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  qtyNum: { color: "#fff", fontSize: 12, fontWeight: 700, minWidth: 14, textAlign: "center" },
  emptyState: { gridColumn: "1 / -1", textAlign: "center", color: T.inkSoft, padding: "40px 0", fontSize: 13 },
  emptyCart: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "70px 20px" },
  cartRow: { display: "flex", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${T.surface2}` },
  removeBtn: { background: "none", border: "none", cursor: "pointer", marginLeft: 6, padding: 4 },
  summaryBox: { background: T.surface2, margin: 16, padding: 16, borderRadius: 14, border: `1px solid ${T.hairline}` },
  summaryRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: T.inkSoft, marginBottom: 8 },
  summaryTotal: { fontSize: 15, fontWeight: 800, color: T.ink, borderTop: `1px solid ${T.hairline}`, paddingTop: 10, marginTop: 4 },
  primaryBtn: { width: "100%", background: T.orange, color: "#fff", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 14, fontWeight: 700, marginTop: 12, cursor: "pointer", fontFamily: "'Oswald',sans-serif", letterSpacing: "0.03em", boxShadow: `0 3px 0 ${T.orangeDeep}` },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: T.inkSoft, margin: "14px 0 6px" },
  textInput: { width: "100%", border: `1px solid ${T.hairline}`, background: "#fff", borderRadius: 10, padding: "11px 12px", fontSize: 13, color: T.ink, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  payOptions: { display: "flex", gap: 8 },
  payChip: { flex: 1, textAlign: "center", border: `1px solid ${T.hairline}`, background: "#fff", color: T.inkSoft, padding: "10px 0", borderRadius: 10, fontSize: 12, fontWeight: 600 },
  payChipActive: { background: T.ink, color: "#fff", borderColor: T.ink },
  successWrap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px" },
  successIcon: { width: 64, height: 64, borderRadius: "50%", background: T.green, display: "flex", alignItems: "center", justifyContent: "center" },
  adminSectionTitle: { display: "flex", alignItems: "center", gap: 6, fontWeight: 800, fontSize: 13, color: T.ink, marginBottom: 10, fontFamily: "'Oswald',sans-serif", textTransform: "uppercase", letterSpacing: "0.04em" },
  orderCard: { background: "#fff", border: `1px solid ${T.hairline}`, borderRadius: 12, padding: 10, marginBottom: 10 },
  orderTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  orderStatusTag: { fontSize: 10, background: T.surface2, color: T.inkSoft, padding: "2px 8px", borderRadius: 999, fontWeight: 700 },
  statusRow: { display: "flex", gap: 6, marginTop: 6 },
  statusBtn: { flex: 1, fontSize: 10, border: `1px solid ${T.hairline}`, background: "#fff", color: T.inkSoft, borderRadius: 8, padding: "5px 0", cursor: "pointer", fontFamily: "inherit" },
  statusBtnActive: { background: T.green, color: "#fff", borderColor: T.green },
  productRow: { display: "flex", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.surface2}` },
};

/* Independence Day wishes banner — tricolor card shown at the top of the
   home screen, automatically disappears after INDEPENDENCE_BANNER_END. */
const INDEPENDENCE_BANNER_END = "2026-08-16T12:30:00+05:30";
function IndependenceDayBanner() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(INDEPENDENCE_BANNER_END).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(INDEPENDENCE_BANNER_END).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        overflow: "hidden",
        padding: "16px 14px",
        marginBottom: 10,
        background: "linear-gradient(135deg, #FF9933 0%, #FF9933 32%, #ffffff 32%, #ffffff 68%, #138808 68%, #138808 100%)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
        textAlign: "center",
      }}
    >
      <span style={{ position: "absolute", top: 6, left: 10, fontSize: 20 }}>🇮🇳</span>
      <span style={{ position: "absolute", top: 6, right: 10, fontSize: 20 }}>🇮🇳</span>
      <div style={{ fontSize: 22, color: "#000080", letterSpacing: 2 }}>☸</div>
      <div style={{ margin: "4px 0 2px", fontSize: 19, fontWeight: 900, color: "#1a1a2e", textShadow: "0 1px 0 rgba(255,255,255,0.5)" }}>
        Happy Independence Day!
      </div>
      <div style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#333" }}>15 ઓગસ્ટ — જય હિન્દ 🎉</div>
    </div>
  );
}

/* Bold homepage attention-grabber banner — "AAJ MUJHE ORDERS CHAHIYE"
   energy, but original graphics/typography only (no real person's
   likeness). Push URGENT_BANNER_END further out to keep it live longer. */
const URGENT_BANNER_END = "2026-08-26T15:39:00+05:30";
/* Janmashtami "Coming Soon" banner — festive, respectful use of Lord
   Krishna imagery for the Janmashtami season (4 Sept 2026), not tied to
   any aggressive sales framing. Auto-hides after JANMASHTAMI_BANNER_END. */
const JANMASHTAMI_BANNER_END = "2026-09-05T23:59:00+05:30";
const KRISHNA_IMG = I.i91;
/* Home banner timer — Gita + "This Diwali No Online" banners, 10 second na timer sathe
   ek pachhi ek badlay chhe (loop). Photos code ma j inbuilt (base64). */
const HOME_BANNER_GITA_IMG = I.i92;
const HOME_BANNER_DIWALI_IMG = I.i93;
const HOME_BANNER_SELLER_IMG = I.i94;
const JOB_AD_EXEC_IMG = I.i95;
const JOB_AD_OFFICER_IMG = I.i96;
const JOB_AD_DELIVERY_IMG = I.i97;
/* Diwali Bonus poster ad (7th ad) — sirf 72 kalak mate. END time pachhi aa ad aapoaap hide thai jashe.
   72 kalak = 8 Nov 2026 06:15 IST thi 11 Nov 2026 06:15 IST. Jo publish modu kari to aa date badli nakho. */
const DIWALI_BONUS_AD_END = "2026-11-11T06:15:00+05:30";
const HOME_BANNER_DIWALI_BONUS_IMG = I.i98;
const HOME_BANNERS = [
  { src: HOME_BANNER_GITA_IMG, alt: "Bhagavad Gita 18.43" },
  { src: HOME_BANNER_DIWALI_IMG, alt: "This Diwali No Online - Apni Dukan" },
  { src: HOME_BANNER_SELLER_IMG, alt: "Become a Seller - Apni Dukan", action: "sellerLogin" },
  // Job ads — APPLY NOW par tap karo to form khule. hot = [left%, top%, width%, height%]
  { src: JOB_AD_EXEC_IMG, alt: "Sales Executive - We are hiring", job: "Sales Executive", hot: [36, 88, 34, 10] },
  { src: JOB_AD_OFFICER_IMG, alt: "Sales Officer - We are hiring", job: "Sales Officer", hot: [69, 84, 21, 12] },
  { src: JOB_AD_DELIVERY_IMG, alt: "Delivery Partners - Apni Dukan", job: "Delivery Partner", hot: [48, 92, 34, 7] },
  // 7th ad: Happy Diwali / Claim Diwali Bonus (16:9 poster, 72 kalak). interleave = darek ad pachhi aa poster aave. Tap karo to form khule.
  { src: HOME_BANNER_DIWALI_BONUS_IMG, alt: "Happy Diwali - Claim Diwali Bonus - Apni Dukan", interleave: true, end: DIWALI_BONUS_AD_END, hot: [28, 56, 46, 29], hotAction: "diwaliBonus" },  // hot = "Claim Diwali Bonus Now" box par tap
];
const HOME_BANNER_SECONDS = 10;          // normal ad time (jyare Diwali poster na hoy)
const HOME_BANNER_AD_SECONDS_WITH_POSTER = 5;   // Diwali poster chalu hoy tyare darek ad ketla sec
const HOME_BANNER_POSTER_SECONDS = 5;           // Diwali poster ketla sec batave

function activeHomeBanners() {
  // "end" vali ad (jem ke Diwali Bonus) fakt tya sudhi j batave
  return HOME_BANNERS.filter((b) => !b.end || Date.now() < new Date(b.end).getTime());
}

// Kramma: ad1 -> poster -> ad2 -> poster ... (poster = interleave:true vali ad)
function buildHomeSequence(banners) {
  const normals = [], posters = [];
  banners.forEach((b, i) => (b.interleave ? posters : normals).push(i));
  if (!posters.length) return normals.map((i) => ({ i, secs: HOME_BANNER_SECONDS }));
  const seq = [];
  normals.forEach((n) => {
    seq.push({ i: n, secs: HOME_BANNER_AD_SECONDS_WITH_POSTER });
    posters.forEach((p) => seq.push({ i: p, secs: HOME_BANNER_POSTER_SECONDS }));
  });
  return seq;
}

function HomeBannerTimer({ onBannerClick }) {
  const [banners, setBanners] = React.useState(activeHomeBanners);
  const seq = React.useMemo(() => buildHomeSequence(banners), [banners]);
  const [pos, setPos] = React.useState(0);
  const safePos = seq.length ? pos % seq.length : 0;
  const cur = seq[safePos] || { i: 0, secs: HOME_BANNER_SECONDS };
  const [left, setLeft] = React.useState(cur.secs);
  const bannersRef = React.useRef(banners);
  bannersRef.current = banners;

  // Dar 1 minute e check: koi ad ni end time puri thai hoy to hatavi do
  React.useEffect(() => {
    const t = setInterval(() => {
      const next = activeHomeBanners();
      if (next.length !== bannersRef.current.length) { setBanners(next); setPos(0); }
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Darek slide mate timer: time puro thay to next slide
  React.useEffect(() => {
    if (!seq.length) return undefined;
    const secs = cur.secs;
    const start = Date.now();
    setLeft(secs);
    const t = setInterval(() => {
      const rem = secs - (Date.now() - start) / 1000;
      if (rem <= 0) { clearInterval(t); setPos((p) => (p + 1) % seq.length); }
      else setLeft(rem);
    }, 100);
    return () => clearInterval(t);
  }, [safePos, seq]);

  const curBanner = cur.i;
  const dotIdx = banners.map((b, i) => (b.interleave ? -1 : i)).filter((i) => i >= 0);
  let activeDot = curBanner;
  if (banners[curBanner] && banners[curBanner].interleave) {
    for (let p = safePos; p >= 0; p--) { if (!banners[seq[p].i].interleave) { activeDot = seq[p].i; break; } }
  }
  function goTo(i) {
    const p = seq.findIndex((x) => x.i === i);
    if (p >= 0) setPos(p);
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#000", aspectRatio: "16 / 9" }}>
        {banners.map((b, i) => (
          <img
            key={i}
            src={b.src}
            alt={b.alt}
            loading={i === 0 ? "eager" : "lazy"}
            onClick={b.action && i === curBanner ? () => onBannerClick && onBannerClick(b.action) : undefined}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", opacity: i === curBanner ? 1 : 0, transition: "opacity 0.6s ease",
              cursor: b.action && i === curBanner ? "pointer" : "default",
              pointerEvents: i === curBanner ? "auto" : "none",
            }}
          />
        ))}
        {banners.map((b, i) => (b.hot && i === curBanner) ? (
          <button
            key={"hot" + i}
            aria-label={b.job ? "Apply Now - " + b.job : "Claim Diwali Bonus"}
            onClick={() => onBannerClick && onBannerClick(b.job ? "job:" + b.job : b.hotAction)}
            style={{
              position: "absolute", left: b.hot[0] + "%", top: b.hot[1] + "%", width: b.hot[2] + "%", height: b.hot[3] + "%",
              background: "transparent", border: "none", borderRadius: b.job ? 999 : 16, cursor: "pointer", padding: 0,
            }}
          />
        ) : null)}
        <span style={{
          position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff",
          fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
        }}>
          {Math.ceil(left)}s
        </span>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 5, background: "rgba(255,255,255,0.3)" }}>
          <div style={{ height: "100%", width: `${((cur.secs - left) / cur.secs) * 100}%`, background: T.orange }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
        {dotIdx.map((i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`banner ${i + 1}`}
            style={{
              width: i === activeDot ? 18 : 6, height: 6, borderRadius: 999, border: "none", padding: 0,
              background: i === activeDot ? T.orange : T.hairline, transition: "all 0.25s",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* Swipeable banner carousel — swipe left/right (touch) to move between
   slides, with dot indicators at the bottom. Used for the Krishna
   (Janmashtami) banner and the Om Mobile sponsored ad. */
function BannerCarousel({ slides }) {
  const [index, setIndex] = React.useState(0);
  const touchStartX = React.useRef(null);

  // Auto-advance every 4 seconds, looping back to the first slide.
  React.useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [slides.length]);

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e) {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > 40) {
      if (deltaX < 0 && index < slides.length - 1) setIndex(index + 1);
      if (deltaX > 0 && index > 0) setIndex(index - 1);
    }
    touchStartX.current = null;
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{ overflow: "hidden", borderRadius: 16 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          style={{
            display: "flex",
            transform: `translateX(-${index * 100}%)`,
            transition: "transform 0.35s ease",
          }}
        >
          {slides.map((slide, i) => (
            <div key={i} style={{ flex: "0 0 100%", minWidth: "100%" }}>
              {slide}
            </div>
          ))}
        </div>
      </div>
      {slides.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`slide ${i + 1}`}
              style={{
                width: i === index ? 18 : 6, height: 6, borderRadius: 999,
                background: i === index ? T.orange : T.hairline, border: "none",
                padding: 0, transition: "all 0.25s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JanmashtamiBanner() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(JANMASHTAMI_BANNER_END).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(JANMASHTAMI_BANNER_END).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "relative", borderRadius: 16, overflow: "hidden",
        minHeight: 200, marginBottom: 10, background: "#1a1440",
      }}
    >
      <img
        src={KRISHNA_IMG}
        alt="Janmashtami"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.88 }}
      />
      <div
        style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(20,10,50,0.15) 0%, rgba(20,10,50,0.55) 60%, rgba(20,10,50,0.85) 100%)",
        }}
      />
      <span style={{ position: "absolute", top: 14, right: 16, fontSize: 22, zIndex: 2 }}>🪈🦚</span>
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 16, minHeight: 200 }}>
        <div
          style={{
            display: "inline-block", background: "#F2C744", color: "#3d2a00",
            fontWeight: 800, fontSize: 11, letterSpacing: "0.08em",
            padding: "4px 12px", borderRadius: 999, width: "fit-content", marginBottom: 8,
          }}
        >
          ✨ COMING SOON ✨
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1.15, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
          જન્માષ્ટમી <span style={{ color: "#F2C744" }}>સ્પેશિયલ ઑફર</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#e8e0ff", fontWeight: 600, marginTop: 6, textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
          4 સપ્ટેમ્બર — ટૂંક સમયમાં ખાસ ડિસ્કાઉન્ટ સાથે 🙏
        </div>
      </div>
    </div>
  );
}

/* Om Mobile — paid sponsored ad, shown right after the Janmashtami
   banner (slide 2). Runs for 7 days from when this was added; extend
   OM_MOBILE_AD_END further out to keep it live longer. */
const OM_MOBILE_AD_END = "2026-09-02T23:59:00+05:30";
const OM_MOBILE_PHONES_IMG = I.i99;
function OmMobileAdBanner() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(OM_MOBILE_AD_END).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(OM_MOBILE_AD_END).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <a
      href="https://wa.me/919067962167"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block", position: "relative", borderRadius: 16, overflow: "hidden",
        background: "linear-gradient(135deg, #1a1a2e, #2c1a4d)",
        padding: 16, textDecoration: "none",
      }}
    >
      <div
        style={{
          display: "inline-block", background: "#F2C744", color: "#3d2a00",
          fontWeight: 800, fontSize: 9.5, letterSpacing: "0.06em",
          padding: "3px 10px", borderRadius: 999, marginBottom: 8,
        }}
      >
        ✨ SPONSORED
      </div>
      <div style={{ fontWeight: 800, fontSize: 19, color: "#fff", marginBottom: 2 }}>OM MOBILE</div>
      <div style={{ fontSize: 11.5, color: "#c9c9d4", fontWeight: 600, marginBottom: 6 }}>
        📱 મોબાઈલ ફોન Buy or Sell • Exchange • રિપેરિંગ
      </div>
      <div style={{ fontSize: 12, color: "#F2C744", fontWeight: 700, marginBottom: 10 }}>
        જુના મોબાઈલ Buy Sell કરો — સારા ભાવ મળશે!
      </div>
      <img
        src={OM_MOBILE_PHONES_IMG}
        alt="Om Mobile"
        style={{ width: "100%", borderRadius: 10, marginBottom: 10, display: "block" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {["🍎 iPhone", "1+ OnePlus", "Vivo", "Oppo", "Samsung"].map((b) => (
          <span
            key={b}
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}
          >
            {b}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          background: "#25D366", color: "#fff", fontWeight: 800, fontSize: 12.5, padding: "9px 0", borderRadius: 8,
        }}
      >
        💬 WhatsApp પર સંપર્ક કરો — 9067962167
      </div>
    </a>
  );
}

/* Apni Dukan promo banner — slide 3, tapping opens WhatsApp only
   (9898154548), no call option. */
const APNIDUKAN_PROMO_END = "2026-09-27T23:59:00+05:30";
const APNIDUKAN_LOGO_IMG = I.i100;
const BHAGAT_SINGH_IMG = I.i101;

/* Green Sanskrit marquee — sits right under the ad banner, scrolls
   right-to-left, auto-hides after SANSKRIT_MARQUEE_END. */
const SANSKRIT_MARQUEE_END = "2026-09-29T23:59:00+05:30";
function SanskritMarquee() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(SANSKRIT_MARQUEE_END).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(SANSKRIT_MARQUEE_END).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const text = "आत्मानं तर्पय, न समाजम्.";
  return (
    <div
      style={{
        display: "block",
        overflow: "hidden",
        whiteSpace: "nowrap",
        margin: "8px 0 10px",
      }}
    >
      <div style={{ display: "inline-flex", animation: "adStripScroll 12s linear infinite" }}>
        <span style={{ paddingRight: 40, color: "#1e9c3a", fontWeight: 800, fontSize: 14 }}>{text}</span>
        <span style={{ paddingRight: 40, color: "#1e9c3a", fontWeight: 800, fontSize: 14 }}>{text}</span>
        <span style={{ paddingRight: 40, color: "#1e9c3a", fontWeight: 800, fontSize: 14 }}>{text}</span>
        <span style={{ paddingRight: 40, color: "#1e9c3a", fontWeight: 800, fontSize: 14 }}>{text}</span>
      </div>
    </div>
  );
}

/* Shaheed Bhagat Singh birth anniversary banner — replaces the Aluminium
   Bharat slide. Single photo only. Auto-hides at 23:58 IST on 28 Sept 2026. */
const BHAGAT_SINGH_END = "2026-09-28T23:58:00+05:30";
function BhagatSinghBanner() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(BHAGAT_SINGH_END).getTime());
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(BHAGAT_SINGH_END).getTime()) {
        setVisible(false);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div>
      <div
        style={{
          display: "block", position: "relative", borderRadius: 16, overflow: "hidden",
          background: "#0f1420",
        }}
      >
        {playing ? (
          <video
            src="/bhagat.mp4"
            autoPlay
            playsInline
            controls
            onEnded={() => setPlaying(false)}
            style={{ width: "100%", aspectRatio: "3 / 2", display: "block", background: "#000" }}
          />
        ) : (
          <img
            src={BHAGAT_SINGH_IMG}
            alt="Shaheed Bhagat Singh"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        )}
      </div>
      <button
        onClick={() => {
          if (playing) {
            setPlaying(false);
          } else {
            bumpTributeCount();
            setPlaying(true);
          }
        }}
        style={{
          width: "100%", marginTop: 8, padding: "10px 14px", borderRadius: 12,
          border: "none", background: playing ? "#5a5a5a" : "#d8531f", color: "#fff",
          fontWeight: 800, fontSize: 14, cursor: "pointer",
        }}
      >
        {playing ? "✕ વીડિયો બંધ કરો" : "🙏 Tribute"}
      </button>
    </div>
  );
}

/* APK download banner — a clean strip in the space below the carousel,
   linking directly to the hosted APK file so it downloads on tap. */
/* Duck animation — a small walking GIF fixed at the very bottom of the
   screen, moving left-right continuously across the viewport. */
function DuckAnimation() {
  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, height: 110,
        pointerEvents: "none", overflow: "hidden", zIndex: 9998,
      }}
    >
      <img
        src="/duck-animation.gif"
        alt="duck"
        style={{
          position: "absolute", bottom: 0, width: 100,
          animation: "duckWalk 8s linear infinite",
        }}
      />
      <style>{`
        @keyframes duckWalk {
          0%   { left: -60px; transform: scaleX(1); }
          49%  { left: calc(100% + 0px); transform: scaleX(1); }
          50%  { left: calc(100% + 0px); transform: scaleX(-1); }
          99%  { left: -60px; transform: scaleX(-1); }
          100% { left: -60px; transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}

function ApkDownloadBanner() {
  return (
    <a
      href="/Download/Apni%20Dukan%20se.apk"
      download
      style={{
        display: "flex", alignItems: "center", gap: 12,
        background: "linear-gradient(90deg, #1F5C40, #2a7a56)",
        borderRadius: 14, padding: "12px 16px", marginBottom: 10,
        textDecoration: "none",
      }}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
        }}
      >
        📲
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 13.5 }}>Apni Dukan App ડાઉનલોડ કરો</div>
        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>Android APK — ફાસ્ટ ઍક્સેસ મેળવો</div>
      </div>
      <div
        style={{
          background: "#fff", color: T.green, fontWeight: 800, fontSize: 11.5,
          padding: "7px 14px", borderRadius: 8, flexShrink: 0,
        }}
      >
        ⬇ Download
      </div>
    </a>
  );
}

function UrgentOrdersBanner() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(URGENT_BANNER_END).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(URGENT_BANNER_END).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "relative", borderRadius: 16, overflow: "hidden",
        padding: "26px 20px", marginBottom: 10, minHeight: 150,
        background:
          "radial-gradient(circle at 15% 20%, rgba(216,83,31,0.5), transparent 40%)," +
          "radial-gradient(circle at 85% 80%, rgba(31,92,64,0.5), transparent 40%)," +
          "linear-gradient(135deg, #1a1a2e, #0f0f1a)",
      }}
    >
      <div
        style={{
          position: "absolute", inset: 0,
          background:
            "linear-gradient(115deg, transparent 48%, rgba(255,140,0,0.15) 50%, transparent 52%)," +
            "linear-gradient(65deg, transparent 48%, rgba(255,0,120,0.12) 50%, transparent 52%)",
        }}
      />
      <span style={{ position: "absolute", top: 14, right: 20, fontSize: 26, transform: "rotate(15deg)" }}>⚡</span>
      <span style={{ position: "absolute", bottom: 16, right: 44, fontSize: 18, opacity: 0.6 }}>⚡</span>
      <div
        style={{
          position: "relative", zIndex: 2, display: "inline-block", background: "#fff",
          color: T.ink, fontWeight: 800, fontSize: 13, letterSpacing: "0.1em",
          padding: "4px 14px", borderRadius: 4, transform: "rotate(-2deg)",
          marginBottom: 8, boxShadow: "0 3px 0 rgba(0,0,0,0.3)",
        }}
      >
        AAJ HI
      </div>
      <div
        style={{
          position: "relative", zIndex: 2, fontWeight: 800, fontSize: 26, lineHeight: 1.1,
          color: "#fff", textShadow: "0 0 20px rgba(255,140,0,0.6)", margin: "0 0 4px",
        }}
      >
        મારે <span style={{ color: "#FF3E7F" }}>ORDERS</span><br />જોઈએ છે!
      </div>
      <div style={{ position: "relative", zIndex: 2, fontSize: 12, color: "#c9c9d4", fontWeight: 600, marginTop: 6 }}>
        Best price • Fast delivery • Genuine products
      </div>
      <div
        style={{
          position: "relative", zIndex: 2, marginTop: 14, display: "inline-flex",
          alignItems: "center", gap: 6, background: T.orange, color: "#fff",
          fontWeight: 800, fontSize: 13, padding: "9px 18px", borderRadius: 999,
          boxShadow: "0 6px 16px rgba(216,83,31,0.5)",
        }}
      >
        🛒 હમણાં ખરીદી કરો
      </div>
    </div>
  );
}

/* Scrolling WhatsApp ad strip — shown between the eco slogan and the
   search bar on the home screen, right-to-left marquee, and automatically
   disappears after AD_STRIP_END_TIME. No manual removal needed — it just
   stops rendering once the time has passed. */
const AD_STRIP_END_TIME = "2026-08-24T15:39:00+05:30";
function AdStrip() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(AD_STRIP_END_TIME).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(AD_STRIP_END_TIME).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const text = "🌞 Shaurya's Solar System — Switch to Solar, Pay EMI instead of Electricity Bill — WhatsApp: 7048169567";
  return (
    <a
      href="https://wa.me/917048169567"
      style={{
        display: "block",
        background: "linear-gradient(90deg, #1f3a1f, #2f6b3a)",
        color: "#fff",
        padding: "8px 0",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textDecoration: "none",
        borderRadius: 10,
        margin: "0 0 10px",
      }}
    >
      <div style={{ display: "inline-flex", animation: "adStripScroll 12s linear infinite", fontSize: 13, fontWeight: 700 }}>
        <span style={{ paddingRight: 40 }}>{text}</span>
        <span style={{ paddingRight: 40 }}>{text}</span>
        <span style={{ paddingRight: 40 }}>{text}</span>
        <span style={{ paddingRight: 40 }}>{text}</span>
      </div>
    </a>
  );
}

/* Falling-logo ad boxes — each brand logo drifts from top to bottom of its
   own rectangle, swaying left-right like a falling leaf, looping forever.
   Tapping a box opens that brand's product catalogue in a new tab. Same
   auto-expiry pattern as the other ad strips: push VERTICAL_AD_END_TIME
   further out whenever these should stay live longer. */
const VERTICAL_AD_END_TIME = "2026-08-20T14:41:00+05:30";
const JANATICS_LOGO = I.i102;
const YUKEN_LOGO = I.i103;
const FALLING_AD_INSTANCES = [
  { logo: "janatics", left: 10, duration: 4.5, delay: 0 },
  { logo: "yuken",    left: 55, duration: 5.2, delay: 1.2 },
  { logo: "janatics", left: 32, duration: 4.8, delay: 2.4 },
];
const FALLING_LOGO_HREFS = {
  janatics: "https://www.janatics.com/assets/images/resources/catalogue/pneumatic_actuators.pdf",
  yuken: "https://www.thuykhidien.com.vn/res/download/yuken-3.pdf",
};
/* Falling-logo ad strip — confined to a fixed-height band at the bottom of
   the screen (not the whole page). Each logo falls top-to-bottom inside
   this strip with a randomized left-right sway, looping forever, and is
   tappable to open that brand's catalogue. Same auto-expiry pattern: push
   VERTICAL_AD_END_TIME further out to keep it live longer. */
function FallingLogoAdsOverlay() {
  const [visible, setVisible] = React.useState(() => Date.now() < new Date(VERTICAL_AD_END_TIME).getTime());
  React.useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(VERTICAL_AD_END_TIME).getTime()) {
        setVisible(false);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999,
        maxWidth: 480, margin: "0 auto",
        width: "100%", height: 80,
        background: "#fff", overflow: "hidden",
        borderTop: `1px solid ${T.hairline}`,
        boxShadow: "0 -4px 14px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          position: "absolute", top: 4, left: 0, right: 0, textAlign: "center",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
          color: T.orange, textTransform: "uppercase", zIndex: 5,
        }}
      >
        ✨ Coming Soon ✨
      </div>
      {FALLING_AD_INSTANCES.map((inst, i) => (
        <a
          key={i}
          href={FALLING_LOGO_HREFS[inst.logo]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "absolute", top: -50, left: `${inst.left}%`, width: 56,
            animation: `fallDrop ${inst.duration}s linear infinite, fallH${i} ${inst.duration}s ease-in-out infinite`,
            animationDelay: `${inst.delay}s, ${inst.delay}s`,
          }}
        >
          <img
            src={inst.logo === "janatics" ? JANATICS_LOGO : YUKEN_LOGO}
            alt={inst.logo}
            style={{ width: "100%", height: "auto", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.25))" }}
          />
          <span
            style={{
              display: "block", textAlign: "center", fontSize: 8, fontWeight: 800,
              color: T.ink, marginTop: 2, background: "rgba(242,239,228,0.9)",
              borderRadius: 4, padding: "1px 0",
            }}
          >
            {inst.logo === "janatics" ? "Janatics" : "Yuken"}
          </span>
        </a>
      ))}
    </div>
  );
}

/* small decorative tree/plant/flower illustration used in the top strip */
function TopBarNature() {
  return (
    <svg style={styles.topBarLeaf} viewBox="0 0 160 120" fill="none">
      <rect x="112" y="70" width="7" height="34" rx="2" fill="#7A5B3A" />
      <circle cx="115" cy="55" r="26" fill="#4FA870" />
      <circle cx="100" cy="65" r="18" fill="#3C8A5B" />
      <circle cx="132" cy="66" r="19" fill="#5CB77E" />
      <path d="M60 104c0-14 6-22 6-22s6 8 6 22" stroke="#2E6B3F" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M66 92c-8-2-12-9-12-9s9-2 15 3" fill="#5CB77E" />
      <path d="M66 92c8-2 12-9 12-9s-9-2-15 3" fill="#4FA870" />
      <circle cx="30" cy="80" r="4" fill="#D99B2B" />
      <circle cx="22" cy="76" r="4" fill="#E8A33D" />
      <circle cx="38" cy="76" r="4" fill="#E8A33D" />
      <circle cx="26" cy="86" r="4" fill="#E8A33D" />
      <circle cx="34" cy="86" r="4" fill="#E8A33D" />
      <rect x="28.5" y="84" width="3" height="20" rx="1.5" fill="#2E6B3F" />
    </svg>
  );
}
