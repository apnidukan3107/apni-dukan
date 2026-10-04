import crypto from "crypto";

// ===== Settings (jarur hoy to ahi badlo) =====
const STORE = "store";                          // tamari app no collection
const PRODUCT_PREFIX = "product__";             // store/product__<id>
const ORDERS_DOC = "orders";                    // store/orders (value = JSON string)
const FREE_DELIVERY_PINCODES = ["382345", "382330"];

let SA = {};
try { SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}"); } catch (e) { SA = {}; }
const PROJECT = SA.project_id;
const DB = `projects/${PROJECT}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DB}`;

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

let cached = { token: null, exp: 0 };
async function getToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({
    iss: SA.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const sig = crypto
    .createSign("RSA-SHA256")
    .update(`${head}.${claim}`)
    .sign(SA.private_key)
    .toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claim}.${sig}`,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("google token failed");
  cached = { token: d.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return d.access_token;
}

async function gfetch(url, method = "GET", body) {
  const t = await getToken();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* ignore */ }
  if (!r.ok) {
    const err = new Error(data?.error?.message || "request failed");
    err.status = r.status;
    err.gmsg = data?.error?.message || "";
    throw err;
  }
  return data;
}

const toFs = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
};
const fromFs = (f) => {
  if (!f) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue;
  if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) return (f.arrayValue.values || []).map(fromFs);
  if ("mapValue" in f)
    return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
};
const money = (n) => Math.round(Number(n) * 100) / 100;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromFs(v)]));
const maskQ = (keys) => keys.map((k) => `updateMask.fieldPaths=${k}`).join("&");

// Password hash (scrypt) ane login token (HMAC, 30 divas)
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
}
function checkPw(pw, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(h, "hex");
  const b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tokKey = () => crypto.createHash("sha256").update("wallet-token:" + SA.private_key).digest();
const tagOf = (ph) => crypto.createHash("sha256").update(String(ph)).digest("hex").slice(0, 16);
function makeToken(uid, ph) {
  const p = Buffer.from(JSON.stringify({ u: uid, t: tagOf(ph), e: Date.now() + 30 * 86400000 })).toString("base64url");
  return p + "." + crypto.createHmac("sha256", tokKey()).update(p).digest("base64url");
}
function readToken(token) {
  const [p, sig] = String(token || "").split(".");
  if (!p || !sig) throw new HttpError(401, "LOGIN_REQUIRED");
  const good = crypto.createHmac("sha256", tokKey()).update(p).digest("base64url");
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) throw new HttpError(401, "LOGIN_REQUIRED");
  let o;
  try { o = JSON.parse(Buffer.from(p, "base64url").toString()); } catch (e) { throw new HttpError(401, "LOGIN_REQUIRED"); }
  if (!o || !/^\d{10}$/.test(o.u) || !(o.e > Date.now())) throw new HttpError(401, "LOGIN_REQUIRED");
  return o;
}
const txnFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toFs(v)]));

function sameSecret(a, b) {
  if (!a || !b) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// ---------- Admin actions ----------
async function createCustomer(b) {
  const name = String(b.name || "").trim().slice(0, 80);
  const mobile = String(b.mobile || "").trim();
  const password = String(b.password || "");
  const amount = money(b.amount || 0);
  if (!name) throw new HttpError(400, "NAME_REQUIRED");
  if (!/^[0-9]{10}$/.test(mobile)) throw new HttpError(400, "MOBILE_INVALID");
  if (password.length < 6) throw new HttpError(400, "PASSWORD_SHORT");
  if (!(amount >= 0)) throw new HttpError(400, "AMOUNT_INVALID");

  const uid = mobile;
  try {
    await gfetch(`${FS}/wallets/${uid}?currentDocument.exists=false`, "PATCH", {
      fields: txnFields({ name, mobile, balance: amount, passHash: hashPw(password), fails: 0, createdAt: new Date() }),
    });
  } catch (e) {
    if (e.status === 409 || /ALREADY_EXISTS|already exists/i.test(e.gmsg || "")) throw new HttpError(409, "MOBILE_EXISTS");
    throw e;
  }
  if (amount > 0) {
    await gfetch(`${FS}/wallets/${uid}/txns/open-${Date.now()}`, "PATCH", {
      fields: txnFields({ type: "topup", amount, note: "opening", createdAt: new Date() }),
    });
  }
  return { ok: true, uid };
}

async function topup(b) {
  const uid = String(b.uid || "");
  const amount = money(b.amount);
  if (!/^\d{10}$/.test(uid)) throw new HttpError(400, "UID_REQUIRED");
  if (!(amount > 0) || amount > 1000000) throw new HttpError(400, "AMOUNT_INVALID");
  try { await gfetch(`${FS}/wallets/${uid}`); }
  catch (e) { if (e.status === 404) throw new HttpError(404, "CUSTOMER_NOT_FOUND"); throw e; }
  await gfetch(`${FS}:commit`, "POST", {
    writes: [
      { transform: { document: `${DB}/wallets/${uid}`, fieldTransforms: [{ fieldPath: "balance", increment: { doubleValue: amount } }] } },
      { update: { name: `${DB}/wallets/${uid}/txns/top-${Date.now()}`, fields: txnFields({ type: "topup", amount, createdAt: new Date() }) }, currentDocument: { exists: false } },
    ],
  });
  return { ok: true };
}

async function resetPassword(b) {
  const uid = String(b.uid || "");
  const password = String(b.password || "");
  if (!/^\d{10}$/.test(uid)) throw new HttpError(400, "UID_REQUIRED");
  if (password.length < 6) throw new HttpError(400, "PASSWORD_SHORT");
  try { await gfetch(`${FS}/wallets/${uid}`); }
  catch (e) { if (e.status === 404) throw new HttpError(404, "CUSTOMER_NOT_FOUND"); throw e; }
  await gfetch(`${FS}/wallets/${uid}?${maskQ(["passHash", "fails", "lockUntil"])}`, "PATCH", {
    fields: txnFields({ passHash: hashPw(password), fails: 0, lockUntil: null }),
  });
  return { ok: true };
}

async function listCustomers() {
  const d = await gfetch(`${FS}/wallets?pageSize=300`);
  const customers = (d.documents || []).map((x) => {
    const f = Object.fromEntries(Object.entries(x.fields || {}).map(([k, v]) => [k, fromFs(v)]));
    return { uid: x.name.split("/").pop(), name: f.name, mobile: f.mobile, balance: f.balance || 0 };
  });
  return { ok: true, customers };
}

// ---------- Customer: login + wallet ----------
async function login(b) {
  const mobile = String(b.mobile || "").trim();
  const password = String(b.password || "");
  if (!/^\d{10}$/.test(mobile) || !password) throw new HttpError(401, "WRONG");
  let w;
  try { w = await gfetch(`${FS}/wallets/${mobile}`); }
  catch (e) { if (e.status === 404) { await delay(500); throw new HttpError(401, "WRONG"); } throw e; }
  const f = plain(w);
  if (f.lockUntil && Date.parse(f.lockUntil) > Date.now()) throw new HttpError(429, "LOCKED");
  if (!f.passHash || !checkPw(password, f.passHash)) {
    const fails = (f.fails || 0) + 1;
    const patch = fails >= 5 ? { fails: 0, lockUntil: new Date(Date.now() + 15 * 60000) } : { fails };
    await gfetch(`${FS}/wallets/${mobile}?${maskQ(Object.keys(patch))}`, "PATCH", { fields: txnFields(patch) });
    await delay(500);
    throw new HttpError(401, "WRONG");
  }
  if (f.fails) await gfetch(`${FS}/wallets/${mobile}?${maskQ(["fails"])}`, "PATCH", { fields: txnFields({ fails: 0 }) });
  return { ok: true, token: makeToken(mobile, f.passHash), name: f.name || "", balance: money(f.balance || 0) };
}

async function me(b) {
  const t = readToken(b.token);
  let w;
  try { w = await gfetch(`${FS}/wallets/${t.u}`); }
  catch (e) { if (e.status === 404) throw new HttpError(401, "LOGIN_REQUIRED"); throw e; }
  const f = plain(w);
  if (tagOf(f.passHash) !== t.t) throw new HttpError(401, "LOGIN_REQUIRED");
  return { ok: true, name: f.name || "", balance: money(f.balance || 0) };
}

async function pay(b) {
  const tk = readToken(b.token);
  const uid = tk.u;

  const c = b.customer || {};
  const cust = {
    name: String(c.name || "").trim().slice(0, 100),
    phone: String(c.phone || "").trim().slice(0, 15),
    address: String(c.address || "").trim().slice(0, 400),
    pincode: String(c.pincode || "").trim(),
  };
  if (!cust.name || !cust.phone || !cust.address || !/^\d{6}$/.test(cust.pincode)) throw new HttpError(400, "DETAILS_REQUIRED");
  const withBill = b.billOption === "with-bill";
  const gstNumber = withBill ? String(b.gstNumber || "").trim().slice(0, 30) : "";
  if (withBill && !gstNumber) throw new HttpError(400, "GST_REQUIRED");

  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length < 1 || items.length > 50) throw new HttpError(400, "CART_INVALID");
  const wanted = {};
  for (const it of items) {
    const id = String(it.id || "");
    const size = it.size ? String(it.size).slice(0, 40) : "";
    const qty = Number(it.qty);
    if (!id || id.includes("/") || !Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, "CART_INVALID");
    const key = id + "||" + size;
    wanted[key] = { id, size, qty: (wanted[key] ? wanted[key].qty : 0) + qty };
  }
  const lineList = Object.values(wanted);
  const ids = [...new Set(lineList.map((l) => l.id))];

  const docs = await gfetch(`${FS}:batchGet`, "POST", { documents: ids.map((id) => `${DB}/${STORE}/${PRODUCT_PREFIX}${id}`) });
  const found = {};
  for (const x of docs) if (x.found) found[x.found.name.split("/").pop().slice(PRODUCT_PREFIX.length)] = x.found.fields || {};
  const lines = [];
  let subtotal = 0;
  for (const l of lineList) {
    const f = found[l.id];
    const price = f && f.price ? money(fromFs(f.price)) : NaN;
    if (!f || !(price >= 0)) throw new HttpError(400, "PRODUCT_NOT_FOUND", { id: l.id });
    const nm = f.name ? fromFs(f.name) : l.id;
    const base = typeof nm === "string" ? nm : l.id;
    lines.push({ id: l.size ? `${l.id}__SIZE__${encodeURIComponent(l.size)}` : l.id, name: l.size ? `${base} (Size: ${l.size})` : base, price, qty: l.qty });
    subtotal += price * l.qty;
  }
  subtotal = money(subtotal);
  const deliveryFee = subtotal > 999 || FREE_DELIVERY_PINCODES.includes(cust.pincode) ? 0 : 49;
  const gstAmount = withBill ? Math.round(subtotal * 0.18) : 0;
  const total = money(subtotal + deliveryFee + gstAmount);
  if (!(total > 0)) throw new HttpError(400, "CART_INVALID");

  const { transaction } = await gfetch(`${FS}:beginTransaction`, "POST", { options: { readWrite: {} } });
  const tx = encodeURIComponent(transaction);
  let w;
  try { w = await gfetch(`${FS}/wallets/${uid}?transaction=${tx}`); }
  catch (e) { if (e.status === 404) throw new HttpError(401, "LOGIN_REQUIRED"); throw e; }
  if (tagOf(fromFs(w.fields.passHash)) !== tk.t) throw new HttpError(401, "LOGIN_REQUIRED");
  const balance = money(fromFs(w.fields.balance) || 0);

  if (total > balance) {
    try { await gfetch(`${FS}:rollback`, "POST", { transaction }); } catch (e) { /* ignore */ }
    throw new HttpError(400, "INSUFFICIENT", { balance, total, short: money(total - balance) });
  }

  let od = null;
  try { od = await gfetch(`${FS}/${STORE}/${ORDERS_DOC}?transaction=${tx}`); }
  catch (e) { if (e.status !== 404) throw e; }
  let list = [];
  if (od && od.fields && od.fields.value) { try { list = JSON.parse(fromFs(od.fields.value)) || []; } catch (e) { list = []; } }

  const newBalance = money(balance - total);
  const orderId = "ord_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const order = {
    id: orderId,
    items: lines,
    subtotal, deliveryFee,
    billOption: withBill ? "with-bill" : "no-bill",
    gstAmount, promoDiscountAmount: 0, total,
    customer: cust,
    payment: "વૉલેટ (પ્રીપેડ)",
    status: "નવો",
    createdAt: new Date().toISOString(),
    paidByWallet: true,
    walletUid: uid,
  };
  if (withBill) order.gstNumber = gstNumber;
  const nextList = [order, ...list];

  try {
    await gfetch(`${FS}:commit`, "POST", {
      transaction,
      writes: [
        { update: { name: `${DB}/wallets/${uid}`, fields: { balance: toFs(newBalance) } }, updateMask: { fieldPaths: ["balance"] }, currentDocument: { updateTime: w.updateTime } },
        { update: { name: `${DB}/${STORE}/${ORDERS_DOC}`, fields: { value: toFs(JSON.stringify(nextList)) } }, updateMask: { fieldPaths: ["value"] }, currentDocument: od ? { updateTime: od.updateTime } : { exists: false } },
        { update: { name: `${DB}/wallets/${uid}/txns/${orderId}`, fields: txnFields({ type: "order", amount: -total, orderId, orderJson: JSON.stringify(order), createdAt: new Date() }) }, currentDocument: { exists: false } },
      ],
    });
  } catch (e) {
    if (e.status === 409 || /ABORTED|contention|precondition/i.test(e.gmsg || "")) throw new HttpError(409, "TRY_AGAIN");
    throw e;
  }
  return { ok: true, orderId, total, balance: newBalance, orderNumber: nextList.length };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // Browser ma /api/wallet kholo to aa check dekhase (koi gupt vaat nathi dekhati)
  if (req.method === "GET") {
    return res.status(200).json({ api: "ok", serviceAccount: !!(PROJECT && SA.private_key), adminSecret: !!process.env.ADMIN_SECRET });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST_ONLY" });
  try {
    if (!PROJECT || !SA.private_key) throw new HttpError(500, "NO_SERVICE_ACCOUNT");
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (b.action === "pay") return res.status(200).json(await pay(b));
    if (b.action === "me") return res.status(200).json(await me(b));
    if (b.action === "login") return res.status(200).json(await login(b));

    if (!process.env.ADMIN_SECRET) throw new HttpError(500, "NO_ADMIN_SECRET");
    if (!sameSecret(b.secret, process.env.ADMIN_SECRET)) {
      await new Promise((r) => setTimeout(r, 700));
      throw new HttpError(401, "ADMIN_ONLY");
    }
    if (b.action === "create") return res.status(200).json(await createCustomer(b));
    if (b.action === "topup") return res.status(200).json(await topup(b));
    if (b.action === "reset") return res.status(200).json(await resetPassword(b));
    if (b.action === "list") return res.status(200).json(await listCustomers());
    throw new HttpError(400, "UNKNOWN_ACTION");
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.code, ...e.extra });
    console.error("wallet api error:", e.message);
    return res.status(500).json({ error: "SERVER" });
  }
}
