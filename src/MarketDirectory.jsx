import React from "react";
import { ChevronRight, ArrowLeft, Store } from "lucide-react";

// ---------------------------------------------------------------------------
// Ahmedabad markets. Pincodes: confirm / correct anywhere here (Amdupura, Memco and
// Meena Bazar are best guesses).
// ---------------------------------------------------------------------------
export const MARKETS = [
  { name: "Kalupur", pin: "380002" },
  { name: "Relief Road", pin: "380001" },
  { name: "Gandhi Road", pin: "380001" },
  { name: "Lal Darwaja", pin: "380001" },
  { name: "Ghee Kanta", pin: "380001" },
  { name: "Madhupura", pin: "380004" },
  { name: "Amdupura", pin: "380004" },
  { name: "Dariapur", pin: "380001" },
  { name: "Memco", pin: "380026" },
  { name: "Naroda", pin: "382330" },
  { name: "Rakhiyal", pin: "380023" },
  { name: "Odhav", pin: "382415" },
  { name: "Vatva", pin: "382440" },
  { name: "Kubernagar", pin: "382340" },
  { name: "Meena Bazar", pin: "380001" },
  { name: "Narol", pin: "382405" },
];

// Sellers who are already registered but have no "market" set yet. Admin panel ma
// seller ni market select karo to e j chalse (admin ni pasand upar rahe chhe).
const SEED_SELLER_MARKET = [{ re: /balaji/i, market: "Kalupur" }];

export function marketOfSeller(s) {
  if (!s) return "";
  if (s.market) return s.market;
  const hit = SEED_SELLER_MARKET.find((x) => x.re.test(s.name || ""));
  return hit ? hit.market : "";
}

// Seller registration ma "area" lakhyu hoy to market ni naam match kari ne guess kare chhe.
export function guessMarket(text) {
  const t = (text || "").toLowerCase();
  const m = MARKETS.find((x) => t.includes(x.name.toLowerCase()));
  return m ? m.name : "";
}

const ORANGE = "#B5541C";
const NAVY = "#0B1F5C";
const YELLOW = "#FFD21F";
const GREEN = "#1F5C40";

export function MarketList({ sellers, onSelect }) {
  const count = (name) => sellers.filter((s) => marketOfSeller(s) === name).length;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 24px" }}>
      <div style={{ fontSize: 12.5, color: "#6b6555", marginBottom: 10 }}>
        માર્કેટ પર ટેપ કરો, ત્યાંના સેલર દેખાશે
      </div>
      {MARKETS.map((m, i) => {
        const n = count(m.name);
        return (
          <button
            key={m.name}
            onClick={() => onSelect(m.name)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "none",
              borderRadius: 12, padding: "11px 12px", marginBottom: 7, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
            }}
          >
            <span style={{ width: 26, height: 26, borderRadius: 8, background: "#F3E3D6", color: ORANGE, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              {i + 1}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "#1a1d26" }}>{m.name}</span>
            <span style={{ fontSize: 12, color: "#6b6555" }}>{m.pin}</span>
            {n > 0 && (
              <span style={{ background: GREEN, color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 10 }}>{n} seller</span>
            )}
            <ChevronRight size={16} color="#9aa0ad" />
          </button>
        );
      })}
    </div>
  );
}

export function MarketDetail({ marketName, sellers, onBack, onOpenSeller }) {
  const m = MARKETS.find((x) => x.name === marketName) || { name: marketName, pin: "" };
  const list = sellers.filter((s) => marketOfSeller(s) === marketName);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 24px" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#6b6555", padding: 0, marginBottom: 10 }}>
        <ArrowLeft size={15} /> બધા માર્કેટ
      </button>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1a1d26" }}>{m.name}</div>
      <div style={{ fontSize: 12.5, color: "#6b6555", marginBottom: 12 }}>Pincode: {m.pin}</div>

      {list.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "26px 16px", textAlign: "center" }}>
          <Store size={30} color="#9aa0ad" />
          <div style={{ fontWeight: 700, margin: "8px 0 4px" }}>હજુ કોઈ સેલર નથી</div>
          <div style={{ fontSize: 12.5, color: "#6b6555" }}>{m.name} ના સેલર જલ્દી ઉમેરાશે.</div>
        </div>
      )}

      {list.map((s) => (
        <button
          key={s.id}
          onClick={() => onOpenSeller(s)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e1e4ea",
            borderRadius: 14, padding: 12, marginBottom: 8, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}
        >
          <span style={{ width: 40, height: 40, borderRadius: 10, background: NAVY, color: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Store size={22} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "#1a1d26" }}>{s.name}</span>
            <span style={{ display: "block", fontSize: 12, color: "#6b6555" }}>પ્રોડક્ટ જુઓ</span>
          </span>
          <ChevronRight size={18} color="#9aa0ad" />
        </button>
      ))}
    </div>
  );
}
