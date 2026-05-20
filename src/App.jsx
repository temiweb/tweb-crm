import { useState, useEffect, useMemo, useRef } from "react";

/*
 * TWEB SHOP CRM v4 — Supabase Edition
 * Real-time database, multi-device, mobile-first
 */

const SUPABASE_URL = "https://amdcmtfuytnplrzxabip.supabase.co";
const SUPABASE_KEY = "sb_publishable_vQ7vHaXXhmLprI6Ph07cDA_wbXkLhB2";
const ACCESS_PIN = "4285"; // Change this to your real PIN

// ═══════════════════════════════════════════════
// SUPABASE CLIENT (lightweight, no SDK needed)
// ═══════════════════════════════════════════════

const sb = {
  headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
  async fetch(url, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") throw new Error("Request timed out — check your connection.");
      throw new Error("Connection lost — check your internet and try again.");
    }
  },
  async query(table, params = "") {
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
    if (!r.ok) throw new Error(`Failed to load ${table} (${r.status})`);
    return r.json();
  },
  async insert(table, data) {
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: this.headers, body: JSON.stringify(Array.isArray(data) ? data : [data]) });
    if (!r.ok) { const e = await r.text(); throw new Error(`Failed to save (${r.status}): ${e}`); }
    return r.json();
  },
  async update(table, match, data) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join("&");
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method: "PATCH", headers: this.headers, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`Failed to update ${table} (${r.status})`);
    return r.json();
  },
  async delete(table, match) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join("&");
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method: "DELETE", headers: this.headers });
    if (!r.ok) throw new Error(`Failed to delete (${r.status})`);
  },
  async deleteIn(table, col, ids) {
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=in.(${ids.map(i => `"${i}"`).join(",")})`, { method: "DELETE", headers: this.headers });
    if (!r.ok) throw new Error(`Failed to delete (${r.status})`);
  },
  async upsert(table, data) {
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...this.headers, "Prefer": "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(Array.isArray(data) ? data : [data]) });
    if (!r.ok) { const e = await r.text(); throw new Error(`Failed to save (${r.status}): ${e}`); }
    return r.json();
  }
};

// ═══════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════

const STATUSES = [
  { value: "pending", label: "Pending", color: "#E6A817", bg: "#FFF8E1", icon: "⏳" },
  { value: "confirmed", label: "Confirmed", color: "#1976D2", bg: "#E3F2FD", icon: "✓" },
  { value: "not_reachable", label: "Not Reachable", color: "#7B1FA2", bg: "#F3E5F5", icon: "📵" },
  { value: "cancelled", label: "Cancelled", color: "#C62828", bg: "#FFEBEE", icon: "✕" },
  { value: "postponed", label: "Postponed", color: "#E65100", bg: "#FFF3E0", icon: "⏸" },
  { value: "delivered", label: "Delivered", color: "#2E7D32", bg: "#E8F5E9", icon: "✅" },
  { value: "failed_delivery", label: "Failed Delivery", color: "#B71C1C", bg: "#FFEBEE", icon: "❌" },
  { value: "out_of_stock", label: "Out of Stock", color: "#546E7A", bg: "#ECEFF1", icon: "📦" },
];

const getStatus = v => STATUSES.find(s => s.value === v) || STATUSES[0];

function parsePackage(pkg, country) {
  if (!pkg) return { packName: "", qty: 1, price: 0 };
  if (country === "ghana") {
    const qm = pkg.match(/Buy\s+(\d+)/i), pm = pkg.match(/=\s*GH₵([\d,]+)/);
    return { packName: `Buy ${qm?.[1] || 1} Pack`, qty: qm ? +qm[1] : 1, price: pm ? +pm[1].replace(/,/g, "") : 0 };
  }
  const qm = pkg.match(/\((\d+)\s+Net/i), pm = pkg.match(/=\s*₦([\d,]+)/), nm = pkg.match(/^([^(]+)/);
  return { packName: nm ? nm[1].trim() : pkg, qty: qm ? +qm[1] : 1, price: pm ? +pm[1].replace(/,/g, "") : 0 };
}

function cleanPhone(p) {
  if (!p) return "";
  let s = String(p).replace(/['\s+\-()]/g, "");
  if (s.startsWith("234") && s.length > 10) s = "0" + s.slice(3);
  if (s.startsWith("44234")) s = "0" + s.slice(5);
  if (s.startsWith("1") && s.length > 11) s = "0" + s.slice(1);
  return s;
}

function waLink(phone, msg, country) {
  let p = cleanPhone(phone);
  if (country === "ghana") { if (p.startsWith("0")) p = "233" + p.slice(1); }
  else { if (p.startsWith("0")) p = "234" + p.slice(1); }
  return `https://wa.me/${p}?text=${encodeURIComponent(msg)}`;
}

function fillTpl(tpl, o) {
  const c = o.country === "ghana" ? "GH₵" : "₦";
  return (tpl || "").replace(/{name}/g, o.name || "").replace(/{product}/g, o.product || "").replace(/{address}/g, o.address || "").replace(/{price}/g, o.price ? `${c}${o.price.toLocaleString()}` : "").replace(/{qty}/g, o.qty || "1").replace(/{state}/g, o.state || "").replace(/{agent}/g, o.agent_name || "").replace(/{pack}/g, o.pack_name || "").replace(/{phone}/g, cleanPhone(o.phone) || "").replace(/{notes}/g, o.notes || "");
}

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQ = false; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i += 2; } else { inQ = false; i++; } } else { field += ch; i++; } }
    else { if (ch === '"') { inQ = true; i++; } else if (ch === ',') { row.push(field); field = ""; i++; } else if (ch === '\r' || ch === '\n') { row.push(field); field = ""; if (row.some(f => f.trim())) rows.push(row); row = []; if (ch === '\r' && text[i+1] === '\n') i++; i++; } else { field += ch; i++; } }
  }
  row.push(field); if (row.some(f => f.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const hdrs = rows[0].map(h => h.trim());
  return rows.slice(1).map(v => { const o = {}; hdrs.forEach((h, j) => { o[h] = (v[j] || "").trim(); }); return o; });
}

function csvToDbRows(rows, forceCountry) {
  if (!rows.length) return [];
  const country = forceCountry || (Object.keys(rows[0]).some(k => k === "Your Region") ? "ghana" : "nigeria");
  return rows.map(r => {
    const pkg = parsePackage(r["Select A Package"] || "", country);
    const wa = r["Other Phone Number (Or Whatsapp Number)"] || r["Phone Number (To Confirm Your Order)"] || "";
    const state = country === "ghana" ? (r["Your Region"] || "") : (r["Your State"] || "");
    return {
      name: (r["Your Name"] || "").trim(), phone: r["Phone Number (To Confirm Your Order)"] || "", whatsapp: wa,
      address: (r["Full Delivery Address"] || "").replace(/[\r\n]+/g, ", "), state,
      product: r["Product Name"] || "Net Repair Tape", pack_name: pkg.packName, qty: pkg.qty, price: pkg.price,
      delivery_pref: r["When would you like to receive your order?"] || "", delivery_date: r["Delivery Date"] || "",
      payment_option: r["Payment Option"] || "", notes: (r["Additional Notes"] || "").replace(/[\r\n]+/g, " "),
      status: "pending", agent_id: null, agent_name: "", country,
      delivery_fee: 0, actual_qty_delivered: pkg.qty, actual_price_collected: pkg.price,
    };
  });
}

// ═══════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════
const T = {
  bg: "#F4F2EF",
  surface: "#FFFFFF", surfaceAlt: "#F8F7F5", surfaceHover: "#F1EFEC",
  sidebar: "#0F172A", sidebarActive: "#1E293B",
  accent: "#059669", accentLight: "#ECFDF5", accentMid: "#A7F3D0",
  text: "#0F172A", textMuted: "#64748B", textLight: "#94A3B8",
  border: "#E2E8F0", borderLight: "#F1F5F9",
  danger: "#DC2626", dangerBg: "#FEF2F2",
  warning: "#D97706", warningBg: "#FFFBEB",
  whatsapp: "#25D366",
  r: "12px", rs: "8px", rl: "16px",
  sh: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)",
  shm: "0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)",
  shl: "0 20px 50px rgba(0,0,0,0.16), 0 4px 12px rgba(0,0,0,0.08)",
  f: "'Nunito Sans',sans-serif", fd: "'Outfit',sans-serif",
};

// ═══════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════

const Card = ({ children, style, ...p }) => <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rl, boxShadow: T.sh, ...style }} {...p}>{children}</div>;

const Modal = ({ open, onClose, title, children, wide }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: T.surface, borderRadius: "22px 22px 0 0", width: "100%", maxWidth: wide ? "680px" : "460px", maxHeight: "92vh", overflow: "hidden", boxShadow: T.shl, animation: "sUp .25s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
          <div style={{ width: "36px", height: "4px", background: T.border, borderRadius: "2px", margin: "0 auto 14px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "14px", borderBottom: `1px solid ${T.borderLight}` }}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, fontFamily: T.fd, color: T.text }}>{title}</h3>
            <button onClick={onClose} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, flexShrink: 0 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: "16px 20px 24px", overflow: "auto", flex: 1 }}>{children}</div>
      </div>
      <style>{`@keyframes sUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
};

const Inp = ({ label, ...p }) => (
  <div style={{ marginBottom: "12px" }}>
    {label && <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.6px", fontFamily: T.f }}>{label}</label>}
    <input {...p} style={{ width: "100%", padding: "10px 13px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "14px", fontFamily: T.f, boxSizing: "border-box", outline: "none", background: T.surface, color: T.text, transition: "border-color .15s, box-shadow .15s", ...p.style }}
      onFocus={e => { e.target.style.borderColor = T.accent; e.target.style.boxShadow = `0 0 0 3px ${T.accentLight}`; }}
      onBlur={e => { e.target.style.borderColor = T.border; e.target.style.boxShadow = "none"; }} />
  </div>
);

const Btn = ({ children, v, sz, ...p }) => {
  const vs = {
    primary: { background: T.accent, color: "#fff", border: "none", boxShadow: "0 1px 3px rgba(5,150,105,0.35)" },
    secondary: { background: T.surface, color: T.text, border: `1.5px solid ${T.border}` },
    danger: { background: T.danger, color: "#fff", border: "none" },
    whatsapp: { background: T.whatsapp, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: T.textMuted, border: "none" },
    warning: { background: T.warning, color: "#fff", border: "none" },
  };
  const s = vs[v || "primary"];
  const zs = sz === "sm" ? { padding: "7px 14px", fontSize: "12px" } : sz === "xs" ? { padding: "4px 10px", fontSize: "11px" } : { padding: "10px 20px", fontSize: "13px" };
  return <button {...p} style={{ ...s, ...zs, borderRadius: T.rs, cursor: "pointer", fontWeight: 700, fontFamily: T.f, display: "inline-flex", alignItems: "center", gap: "5px", transition: "opacity .15s", whiteSpace: "nowrap", ...p.style }}>{children}</button>;
};

const Badge = ({ status }) => { const s = getStatus(status); return <span style={{ background: s.bg, color: s.color, padding: "4px 12px", borderRadius: "20px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "4px" }}>{s.icon} {s.label}</span>; };

const Toasts = ({ toasts, onDismiss }) => (
  <div style={{ position: "fixed", bottom: "80px", right: "16px", zIndex: 2000, display: "flex", flexDirection: "column", gap: "8px", maxWidth: "340px", pointerEvents: "none" }}>
    {toasts.map(t => (
      <div key={t.id} style={{ background: t.type === "error" ? T.danger : T.accent, color: "#fff", padding: "12px 16px", borderRadius: T.r, boxShadow: T.shl, fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "flex-start", gap: "10px", pointerEvents: "all", animation: "sUp .2s ease" }}>
        <span style={{ flex: 1 }}>{t.type === "error" ? "⚠ " : "✓ "}{t.msg}</span>
        <button onClick={() => onDismiss(t.id)} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "6px", cursor: "pointer", padding: "2px 8px", fontSize: "12px", flexShrink: 0 }}>✕</button>
      </div>
    ))}
  </div>
);

const Pagination = ({ page, total, pageSize, onPage, onPageSize }) => {
  const totalPages = Math.ceil(total / pageSize);
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 0", flexWrap: "wrap", justifyContent: "center" }}>
      <select value={pageSize} onChange={e => onPageSize(+e.target.value)} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1.5px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f, cursor: "pointer" }}>
        {[50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
      </select>
      <Btn v="secondary" sz="sm" onClick={() => onPage(0)} disabled={page === 0} style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? "default" : "pointer" }}>«</Btn>
      <Btn v="secondary" sz="sm" onClick={() => onPage(page - 1)} disabled={page === 0} style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? "default" : "pointer" }}>‹</Btn>
      <span style={{ fontSize: "12px", color: T.textMuted, fontWeight: 600, whiteSpace: "nowrap" }}>
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <Btn v="secondary" sz="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} style={{ opacity: page >= totalPages - 1 ? 0.4 : 1, cursor: page >= totalPages - 1 ? "default" : "pointer" }}>›</Btn>
      <Btn v="secondary" sz="sm" onClick={() => onPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ opacity: page >= totalPages - 1 ? 0.4 : 1, cursor: page >= totalPages - 1 ? "default" : "pointer" }}>»</Btn>
    </div>
  );
};

// ═══════════════════════════════════════════════
// PIN SCREEN
// ═══════════════════════════════════════════════

function PinScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const handleSubmit = () => {
    if (pin === ACCESS_PIN) { 
      sessionStorage.setItem("tweb-auth-ts", Date.now().toString()); 
      onUnlock(); 
    } else { 
      setError(true); 
      setPin(""); 
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F4F2EF", fontFamily: "'Nunito Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Nunito+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderRadius: "20px", padding: "36px 32px", width: "340px", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ width: "52px", height: "52px", background: "linear-gradient(135deg,#059669,#047857)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "#fff", fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: "24px", boxShadow: "0 4px 12px rgba(5,150,105,0.35)" }}>T</div>
        <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: "22px", color: "#0F172A", marginBottom: "6px" }}>Tweb CRM</div>
        <div style={{ color: "#64748B", fontSize: "13px", marginBottom: "24px" }}>Enter your PIN to continue</div>
        <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => { setPin(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="••••"
          style={{ width: "100%", padding: "13px", border: `2px solid ${error ? "#DC2626" : "#E2E8F0"}`, borderRadius: "12px", fontSize: "22px", textAlign: "center", letterSpacing: "10px", outline: "none", fontFamily: "'Outfit',sans-serif", boxSizing: "border-box", marginBottom: "8px", transition: "border-color .15s" }} />
        {error && <div style={{ color: "#DC2626", fontSize: "12px", marginBottom: "10px", fontWeight: 700 }}>Incorrect PIN — try again</div>}
        {!error && <div style={{ marginBottom: "10px" }} />}
        <button onClick={handleSubmit}
          style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "'Nunito Sans',sans-serif", boxShadow: "0 2px 8px rgba(5,150,105,0.35)" }}>Unlock</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

export default function TwebCRM() {
  const [authed, setAuthed] = useState(() => {
  const ts = sessionStorage.getItem("tweb-auth-ts");
  if (!ts) return false;
  const hoursElapsed = (Date.now() - parseInt(ts)) / (1000 * 60 * 60);
  if (hoursElapsed > 8) { sessionStorage.removeItem("tweb-auth-ts"); return false; }
  return true;});
  const [orders, setOrders] = useState([]);
  const [agents, setAgents] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [templates, setTemplates] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [toasts, setToasts] = useState([]);
  const showToast = (msg, type = "error") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };
  const dismissToast = id => setToasts(prev => prev.filter(t => t.id !== id));

  const [tab, setTab] = useState("orders");
  const [country, setCountry] = useState("nigeria");
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [stateF, setStateF] = useState("all");
  const [agentF, setAgentF] = useState("all");
  const [dupeF, setDupeF] = useState(false);
  const [productF, setProductF] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statsRange, setStatsRange] = useState("all"); 
  const [statsFrom, setStatsFrom] = useState(""); 
  const [statsTo, setStatsTo] = useState("");
  const [sel, setSel] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [ordersPage, setOrdersPage] = useState(0);
  const [ordersPageSize, setOrdersPageSize] = useState(50);

  const [viewOrder, setViewOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAssign, setShowAssign] = useState(null);
  const [showStock, setShowStock] = useState(null);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [importCountry, setImportCountry] = useState("auto");

  const cur = country === "ghana" ? "GH₵" : "₦";
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);

  // ─── LOAD ALL DATA ───
  const loadAll = async (retries = 3) => {
  try {
    const [o, a, p, inv, t] = await Promise.all([
      sb.query("orders", "order=created_at.desc"),
      sb.query("agents", "order=created_at.asc"),
      sb.query("products", "order=created_at.asc"),
      sb.query("inventory"),
      sb.query("templates"),
    ]);
    setOrders(o || []); setAgents(a || []); setProducts(p || []); setInventory(inv || []);
    const tMap = {};
    (t || []).forEach(r => { tMap[r.status_key] = r.message; });
    setTemplates(tMap);
    setLoadError(null);
    setLoaded(true);
    setSyncError(false);
  } catch (e) {
    if (!loaded) {
      if (retries > 1) {
        await new Promise(r => setTimeout(r, 1500));
        return loadAll(retries - 1);
      }
      setLoadError(e.message);
      setLoaded(true);
    } else {
      setSyncError(true);
    }
  }
  };
  useEffect(() => { loadAll(); }, []);

  // Auto-refresh every 30s for multi-device sync
  useEffect(() => { const i = setInterval(loadAll, 30000); return () => clearInterval(i); }, []);

  // ─── Derived ───
  const cOrders = useMemo(() => orders.filter(o => o.country === country), [orders, country]);
  const cAgents = useMemo(() => agents.filter(a => a.country === country), [agents, country]);

  const dupeMap = useMemo(() => {
    const pm = {}; cOrders.forEach(o => { const k = cleanPhone(o.phone); if (k) { if (!pm[k]) pm[k] = []; pm[k].push(o.id); } });
    const d = {}; Object.values(pm).filter(v => v.length > 1).forEach(ids => ids.forEach(id => { d[id] = true; })); return d;
  }, [cOrders]);

  const filtered = useMemo(() => cOrders.filter(o => {
    if (statusF !== "all" && o.status !== statusF) return false;
    if (stateF !== "all" && o.state !== stateF) return false;
    if (agentF === "unassigned" && o.agent_id) return false;
    if (agentF !== "all" && agentF !== "unassigned" && o.agent_id !== agentF) return false;
    if (dupeF && !dupeMap[o.id]) return false;
    if (productF !== "all" && o.product !== productF) return false;
    if (dateFrom) { const d = new Date(o.created_at); if (d < new Date(dateFrom)) return false; }
    if (dateTo) { const d = new Date(o.created_at); if (d > new Date(dateTo + "T23:59:59")) return false; }
    if (search) { const s = search.toLowerCase(); return [o.name, cleanPhone(o.phone), o.address, o.state, o.product, o.notes].some(f => (f || "").toLowerCase().includes(s)); }
    return true;
  }), [cOrders, statusF, stateF, agentF, dupeF, dateFrom, dateTo, search, dupeMap, productF]);

  useEffect(() => { setOrdersPage(0); }, [search, statusF, stateF, agentF, dupeF, productF, dateFrom, dateTo, country]);

  const pagedOrders = useMemo(() => filtered.slice(ordersPage * ordersPageSize, (ordersPage + 1) * ordersPageSize), [filtered, ordersPage, ordersPageSize]);

  const states = useMemo(() => [...new Set(cOrders.map(o => o.state).filter(Boolean))].sort(), [cOrders]);
  const productsList = useMemo(() => [...new Set(cOrders.map(o => o.product).filter(Boolean))].sort(), [cOrders]);

 const statsOrders = useMemo(() => {
   if (statsRange === "all") return cOrders;
   const now = new Date();
   let from, to;
   if (statsRange === "today") {
     from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
   } else if (statsRange === "week") {
     const day = now.getDay();
     const diff = day === 0 ? 6 : day - 1;
     from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
   } else if (statsRange === "month") {
     from = new Date(now.getFullYear(), now.getMonth(), 1);
   } else if (statsRange === "30d") {
     from = new Date(now - 30 * 24 * 60 * 60 * 1000);
   } else if (statsRange === "90d") {
     from = new Date(now - 90 * 24 * 60 * 60 * 1000);
   } else if (statsRange === "custom") {
     if (statsFrom) from = new Date(statsFrom);
     if (statsTo) to = new Date(statsTo + "T23:59:59");
   }
   return cOrders.filter(o => {
     const d = new Date(o.created_at);
     if (from && d < from) return false;
     if (to && d > to) return false;
     return true;
   });
 }, [cOrders, statsRange, statsFrom, statsTo]);
  
  const stats = useMemo(() => {
    const del = statsOrders.filter(o => o.status === "delivered");
    const rev = del.reduce((s, o) => s + (o.actual_price_collected || o.price || 0), 0);
    const fees = statsOrders.reduce((s, o) => s + (o.delivery_fee || 0), 0);
    const unitsSold = del.reduce((s, o) => s + (o.actual_qty_delivered || o.qty || 0), 0);
    const totalUnitsOrdered = statsOrders.reduce((s, o) => s + (o.qty || 0), 0);
    return { total: statsOrders.length, delivered: del.length, pending: statsOrders.filter(o => o.status === "pending").length, failed: statsOrders.filter(o => o.status === "failed_delivery").length, rev, fees, net: rev - fees, rate: statsOrders.length > 0 ? ((del.length / statsOrders.length) * 100).toFixed(1) : "0", unitsSold, totalUnitsOrdered };
  }, [statsOrders]);

  const agentSt = useMemo(() => {
    const m = {};
    cAgents.forEach(a => {
      const ao = cOrders.filter(o => o.agent_id === a.id);
      const del = ao.filter(o => o.status === "delivered");
      m[a.id] = { total: ao.length, delivered: del.length, failed: ao.filter(o => o.status === "failed_delivery").length, rate: ao.length > 0 ? ((del.length / ao.length) * 100).toFixed(0) : "-", stock: inventory.filter(i => i.agent_id === a.id).reduce((s, i) => s + i.qty, 0), fees: ao.reduce((s, o) => s + (o.delivery_fee || 0), 0) };
    });
    return m;
  }, [cAgents, cOrders, inventory]);

  // ─── DB ACTIONS ───
  const doImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setSaving(true);
    const text = await file.text();
    const rows = parseCSV(text);
    const det = importCountry === "auto" ? (rows.length > 0 ? (Object.keys(rows[0]).some(k => k === "Your Region") ? "ghana" : "nigeria") : country) : importCountry;
    const dbRows = csvToDbRows(rows, det);
    try {
      for (let i = 0; i < dbRows.length; i += 50) {
        await sb.insert("orders", dbRows.slice(i, i + 50));
      }
      setCountry(det);
      await loadAll();
    } catch (err) { showToast("Import failed: " + err.message); }
    setSaving(false); setShowImport(false); e.target.value = "";
  };

  const doUpdateStatus = async (id, status) => {
    const order = orders.find(o => o.id === id);
    const wasDelivered = order?.status === "delivered";
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    try {
      await sb.update("orders", { id }, { status });
      if (order?.agent_id) {
        const inv = inventory.find(i => i.agent_id === order.agent_id && i.product_name === order.product);
        if (inv) {
          const qty = order.actual_qty_delivered || order.qty || 0;
          if (status === "delivered" && !wasDelivered) {
            const [fresh] = await sb.query("inventory", `id=eq.${inv.id}`);
            const newQty = Math.max(0, (fresh?.qty ?? inv.qty) - qty);
            await sb.update("inventory", { id: inv.id }, { qty: newQty });
            setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newQty } : i));
          } else if (wasDelivered && status !== "delivered") {
            const [fresh] = await sb.query("inventory", `id=eq.${inv.id}`);
            const newQty = (fresh?.qty ?? inv.qty) + qty;
            await sb.update("inventory", { id: inv.id }, { qty: newQty });
            setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newQty } : i));
          }
        }
      }
    } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doAssign = async (orderId, agentId) => {
    const a = agents.find(x => x.id === agentId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, agent_id: agentId, agent_name: a?.name || "" } : o));
    try { await sb.update("orders", { id: orderId }, { agent_id: agentId, agent_name: a?.name || "" }); } catch (err) { showToast(err.message); await loadAll(); }
    setShowAssign(null);
  };

  const doSaveOrder = async (order) => {
    const { id, created_at, updated_at, ...data } = order;
    const oldOrder = orders.find(o => o.id === id);
    const wasDelivered = oldOrder?.status === "delivered";
    const nowDelivered = data.status === "delivered";
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...data } : o));
    try {
      await sb.update("orders", { id }, data);
      const agentId = data.agent_id || oldOrder?.agent_id;
      if (agentId) {
        const inv = inventory.find(i => i.agent_id === agentId && i.product_name === (data.product || oldOrder?.product));
        if (inv) {
          const oldQty = oldOrder?.actual_qty_delivered || oldOrder?.qty || 0;
          const newQtyDelivered = data.actual_qty_delivered || data.qty || 0;
          const [fresh] = await sb.query("inventory", `id=eq.${inv.id}`);
          const currentStock = fresh?.qty ?? inv.qty;
          let newStock = currentStock;
          if (nowDelivered && !wasDelivered) {
            newStock = Math.max(0, currentStock - newQtyDelivered);
          } else if (wasDelivered && !nowDelivered) {
            newStock = currentStock + oldQty;
          } else if (wasDelivered && nowDelivered && oldQty !== newQtyDelivered) {
            newStock = Math.max(0, currentStock + (oldQty - newQtyDelivered));
          }
          if (newStock !== currentStock) {
            await sb.update("inventory", { id: inv.id }, { qty: newStock });
            setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newStock } : i));
          }
        }
      }
    } catch (err) { showToast(err.message); await loadAll(); }
    setEditOrder(null);
  };

  const doDeleteOrder = async (id) => {
    if (!window.confirm("Delete this order? This cannot be undone.")) return;
    setOrders(prev => prev.filter(o => o.id !== id));
    try { await sb.delete("orders", { id }); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doBulkStatus = async (status) => {
    const ids = [...sel];
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, status } : o));
    setSel(new Set());
    try { await Promise.all(ids.map(id => sb.update("orders", { id }, { status }))); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doBulkDelete = async () => {
    if (!window.confirm(`Delete ${sel.size} order${sel.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    const ids = [...sel];
    setOrders(prev => prev.filter(o => !sel.has(o.id)));
    setSel(new Set());
    try { await sb.deleteIn("orders", "id", ids); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doBulkAssign = async (agentId) => {
    const a = agents.find(x => x.id === agentId);
    const ids = [...sel];
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, agent_id: agentId, agent_name: a?.name || "" } : o));
    setSel(new Set());
    try { await Promise.all(ids.map(id => sb.update("orders", { id }, { agent_id: agentId, agent_name: a?.name || "" }))); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doAddAgent = async (data) => {
    try { await sb.insert("agents", { ...data, country }); await loadAll(); } catch (err) { showToast(err.message); }
    setShowAddAgent(false);
  };

  const doDeleteAgent = async (id) => {
    if (!window.confirm("Delete this agent?")) return;
    setAgents(prev => prev.filter(a => a.id !== id));
    try { await sb.delete("agents", { id }); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doAddProduct = async (name) => {
    try { await sb.insert("products", { name }); await loadAll(); } catch (err) { showToast(err.message); }
    setShowAddProduct(false);
  };

  const doUpdateStock = async (agentId, productName, qty) => {
    const existing = inventory.find(i => i.agent_id === agentId && i.product_name === productName);
    if (existing) {
      setInventory(prev => prev.map(i => i.id === existing.id ? { ...i, qty } : i));
      try { await sb.update("inventory", { id: existing.id }, { qty }); } catch (err) { showToast(err.message); await loadAll(); }
    } else {
      try { const res = await sb.insert("inventory", { agent_id: agentId, product_name: productName, qty }); setInventory(prev => [...prev, ...(res || [])]); } catch (err) { showToast(err.message); await loadAll(); }
    }
  };

  const doSaveTemplate = async (key, msg) => {
    setTemplates(prev => ({ ...prev, [key]: msg }));
    try { await sb.upsert("templates", { status_key: key, message: msg }); } catch (err) { showToast(err.message); }
  };

  const doAddOrder = async (data) => {
    try { await sb.insert("orders", { ...data, country }); await loadAll(); } catch (err) { showToast(err.message); }
    setShowAddOrder(false);
  };

  const getWALink = (o, statusOverride) => waLink(o.whatsapp || o.phone, fillTpl(templates[statusOverride || o.status] || templates.pending || "", o), o.country);

  const toggleSel = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { const all = pagedOrders.map(o => o.id); setSel(all.every(id => sel.has(id)) ? new Set() : new Set(all)); };

  // ─── SCREENS ───
  
  if (!authed) return <PinScreen onUnlock={() => setAuthed(true)} />;
  
  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, fontFamily: T.f }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", background: `linear-gradient(135deg,${T.accent},#047857)`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#fff", fontFamily: T.fd, fontWeight: 800, fontSize: "22px", animation: "pulse 1.5s infinite" }}>T</div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px", color: T.text }}>Loading your data…</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginTop: "6px" }}>Connecting to Supabase</div>
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.96)}}`}</style>
      </div>
    </div>
  );

  if (loadError) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, fontFamily: T.f }}>
      <Card style={{ padding: "30px", maxWidth: "400px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>Connection Error</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginBottom: "20px" }}>{loadError}</div>
        <Btn onClick={() => { setLoadError(null); setLoaded(false); loadAll(); }}>Retry</Btn>
      </Card>
    </div>
  );

  const tabs = [
    { id: "orders", label: "Orders", icon: "📋", count: cOrders.length },
    { id: "agents", label: "Agents", icon: "🚚", count: cAgents.length },
    { id: "inventory", label: "Stock", icon: "📦" },
    { id: "analytics", label: "Stats", icon: "📊" },
    { id: "templates", label: "Messages", icon: "💬" },
  ];

  // ═══════════════════════════════════════════════
  return (
    <div style={{ fontFamily: T.f, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: isMobile ? "70px" : 0 }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Nunito+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: T.sidebar, padding: isMobile ? "0 16px" : "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, height: "56px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34px", height: "34px", background: `linear-gradient(135deg,${T.accent},#047857)`, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: T.fd, fontWeight: 800, fontSize: "16px", flexShrink: 0 }}>T</div>
          {!isMobile && <div><div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "15px", color: "#fff", lineHeight: 1.2 }}>Tweb CRM</div><div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", letterSpacing: "1px", textTransform: "uppercase" }}>Live</div></div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {saving && <span style={{ color: "#34D399", fontSize: "11px", fontWeight: 700, background: "rgba(52,211,153,0.12)", padding: "3px 10px", borderRadius: "6px" }}>Saving…</span>}
          {syncError && <span onClick={() => { setSyncError(false); loadAll(); }} style={{ color: "#FCA5A5", fontSize: "11px", fontWeight: 700, background: "rgba(220,38,38,0.15)", padding: "3px 10px", borderRadius: "6px", cursor: "pointer" }}>⚠ Offline</span>}
          <button onClick={() => { setSyncError(false); loadAll(); }} title="Refresh" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", borderRadius: "8px", width: "32px", height: "32px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>↻</button>
          <button onClick={() => { sessionStorage.removeItem("tweb-auth-ts"); setAuthed(false); }} title="Lock" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: "8px", width: "32px", height: "32px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>⎋</button>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: "10px", padding: "3px", gap: "2px" }}>
            {[{ v: "nigeria", f: "🇳🇬", l: "NG", fl: "Nigeria" }, { v: "ghana", f: "🇬🇭", l: "GH", fl: "Ghana" }].map(c => (
              <button key={c.v} onClick={() => { setCountry(c.v); setStatusF("all"); setStateF("all"); setAgentF("all"); setProductF("all"); setDupeF(false); setSel(new Set()); setShowFilters(false); }}
                style={{ padding: "5px 12px", borderRadius: "8px", border: "none", background: country === c.v ? "rgba(255,255,255,0.15)" : "transparent", color: country === c.v ? "#fff" : "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: "12px", fontWeight: 700, fontFamily: T.f, display: "flex", alignItems: "center", gap: "5px", transition: "all .15s" }}>
                {c.f} {isMobile ? c.l : c.fl}
                <span style={{ background: "rgba(255,255,255,0.15)", padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 800 }}>{orders.filter(o => o.country === c.v).length}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DESKTOP TABS */}
      {!isMobile && <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "8px 24px", display: "flex", gap: "4px" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", border: "none", borderRadius: T.rs, background: tab === t.id ? T.accentLight : "transparent", color: tab === t.id ? T.accent : T.textMuted, fontWeight: tab === t.id ? 700 : 600, cursor: "pointer", fontSize: "13px", fontFamily: T.f, display: "flex", alignItems: "center", gap: "6px", transition: "all .15s" }}>
            {t.icon} {t.label}
            {t.count !== undefined && <span style={{ background: tab === t.id ? T.accentMid : T.borderLight, color: tab === t.id ? T.accent : T.textMuted, fontSize: "10px", fontWeight: 800, padding: "1px 7px", borderRadius: "10px" }}>{t.count}</span>}
          </button>
        ))}
      </div>}

      {/* STATS PERIOD FILTER */}
      <div style={{ padding: isMobile ? "12px 12px 0" : "16px 24px 0", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "2px" }}>Period</span>
        {[{ v: "today", l: "Today" }, { v: "week", l: "Week" }, { v: "month", l: "Month" }, { v: "30d", l: "30d" }, { v: "90d", l: "90d" }, { v: "all", l: "All time" }, { v: "custom", l: "Custom" }].map(r => (
          <button key={r.v} onClick={() => setStatsRange(r.v)} style={{ padding: "5px 13px", borderRadius: "20px", fontSize: "11px", fontWeight: 700, fontFamily: T.f, cursor: "pointer", border: "none", background: statsRange === r.v ? T.accent : T.surface, color: statsRange === r.v ? "#fff" : T.textMuted, boxShadow: statsRange === r.v ? "none" : `0 0 0 1.5px ${T.border}`, transition: "all .15s" }}>{r.l}</button>
        ))}
        {statsRange === "custom" && <>
          <input type="date" value={statsFrom} onChange={e => setStatsFrom(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "11px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
          <span style={{ fontSize: "11px", color: T.textMuted }}>→</span>
          <input type="date" value={statsTo} onChange={e => setStatsTo(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "11px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
        </>}
      </div>

      {/* METRIC CARDS */}
      <div style={{ padding: isMobile ? "12px 12px 8px" : "16px 24px", display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(130px,1fr))", gap: isMobile ? "8px" : "10px" }}>
        {[
          { l: "Orders", v: stats.total, icon: "📋", a: T.text, bg: T.surfaceAlt },
          { l: "Delivered", v: stats.delivered, s: `${stats.rate}% rate`, icon: "✅", a: "#16A34A", bg: "#F0FDF4" },
          { l: "Units Sold", v: stats.unitsSold, s: `of ${stats.totalUnitsOrdered}`, icon: "📦", a: "#7C3AED", bg: "#FAF5FF" },
          { l: "Pending", v: stats.pending, icon: "⏳", a: T.warning, bg: T.warningBg },
          { l: "Failed", v: stats.failed, icon: "✕", a: T.danger, bg: T.dangerBg },
          { l: "Revenue", v: `${cur}${stats.rev.toLocaleString()}`, icon: "💰", a: "#1D4ED8", bg: "#EFF6FF" },
          ...(!isMobile ? [
            { l: "Fees", v: `${cur}${stats.fees.toLocaleString()}`, icon: "🚚", a: "#EA580C", bg: "#FFF7ED" },
            { l: "Net", v: `${cur}${stats.net.toLocaleString()}`, icon: "📈", a: "#16A34A", bg: "#F0FDF4" },
          ] : [])
        ].map((c, i) => (
          <Card key={i} style={{ padding: isMobile ? "12px 14px" : "14px 16px", background: c.bg, border: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px" }}>{c.icon}</span>
              <span style={{ fontSize: "10px", color: c.a, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.l}</span>
            </div>
            <div style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 800, fontFamily: T.fd, color: T.text, lineHeight: 1.1 }}>{c.v}</div>
            {c.s && <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>{c.s}</div>}
          </Card>
        ))}
      </div>
      
      <div style={{ padding: isMobile ? "0 12px 16px" : "0 24px 24px" }}>

        {/* ═══ ORDERS ═══ */}
        {tab === "orders" && <div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "160px", position: "relative" }}>
              <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: T.textMuted, fontSize: "14px", pointerEvents: "none" }}>🔍</span>
              <input placeholder="Search orders…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: "100%", padding: "9px 12px 9px 34px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", fontFamily: T.f, outline: "none", background: T.surface, boxSizing: "border-box", transition: "border-color .15s" }}
                onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.border} />
            </div>
            {isMobile ? <Btn v="secondary" sz="sm" onClick={() => setShowFilters(!showFilters)} style={{ background: showFilters ? T.accentLight : T.surface, color: showFilters ? T.accent : T.text, borderColor: showFilters ? T.accentMid : T.border }}>Filters {showFilters ? "▲" : "▼"}</Btn> : <>
              {[
                <select key="s" value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${statusF !== "all" ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: statusF !== "all" ? T.accentLight : T.surface, fontFamily: T.f, color: statusF !== "all" ? T.accent : T.text }}><option value="all">All Statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>,
                <select key="st" value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${stateF !== "all" ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: stateF !== "all" ? T.accentLight : T.surface, fontFamily: T.f, color: stateF !== "all" ? T.accent : T.text }}><option value="all">All {country === "ghana" ? "Regions" : "States"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                <select key="ag" value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${agentF !== "all" ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: agentF !== "all" ? T.accentLight : T.surface, fontFamily: T.f, color: agentF !== "all" ? T.accent : T.text }}><option value="all">All Agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>,
                <input key="df" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${dateFrom ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: dateFrom ? T.accentLight : T.surface, fontFamily: T.f }} title="From date" />,
                <input key="dt" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${dateTo ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: dateTo ? T.accentLight : T.surface, fontFamily: T.f }} title="To date" />,
                <select key="pr" value={productF} onChange={e => setProductF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${productF !== "all" ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "12px", background: productF !== "all" ? T.accentLight : T.surface, fontFamily: T.f, color: productF !== "all" ? T.accent : T.text }}><option value="all">All Products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select>,
              ]}
            </>}
            <Btn v={dupeF ? "warning" : "secondary"} sz="sm" onClick={() => setDupeF(!dupeF)} title="Show duplicates">{dupeF ? "✕ Dupes" : "👥 Dupes"}</Btn>
            <Btn sz="sm" onClick={() => setShowImport(true)}>📥 Import</Btn>
            <Btn v="secondary" sz="sm" onClick={() => setShowAddOrder(true)}>+ Add Order</Btn>
          </div>

          {isMobile && showFilters && <Card style={{ padding: "14px", marginBottom: "12px" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All Statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
            <select value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All {country === "ghana" ? "Regions" : "States"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <select value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All Agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }} placeholder="From" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }} placeholder="To" />
            <select value={productF} onChange={e => setProductF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All Products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select>
          </div></Card>}

          {sel.size > 0 && <div style={{ display: "flex", gap: "6px", marginBottom: "12px", alignItems: "center", background: T.accentLight, padding: "10px 14px", borderRadius: T.rs, border: `1.5px solid ${T.accentMid}`, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: T.accent, fontSize: "13px" }}>{sel.size} selected</span>
            <span style={{ color: T.accentMid }}>→</span>
            {isMobile ? <select onChange={e => { if (e.target.value) doBulkStatus(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Set status…</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
              : STATUSES.map(s => <Btn key={s.value} v="secondary" sz="xs" onClick={() => doBulkStatus(s.value)} title={s.label}>{s.icon} {s.label}</Btn>)}
            {cAgents.length > 0 && <select onChange={e => { if (e.target.value) doBulkAssign(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Assign to…</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
            <Btn v="danger" sz="xs" onClick={doBulkDelete} style={{ marginLeft: "auto" }}>🗑 Delete {sel.size}</Btn>
            <Btn v="ghost" sz="xs" onClick={() => setSel(new Set())}>✕</Btn>
          </div>}

          {/* MOBILE CARDS */}
          {isMobile ? <div style={{ display: "grid", gap: "10px" }}>
            {filtered.length === 0 && <Card style={{ padding: "48px 20px", textAlign: "center", color: T.textMuted }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No orders match your filters."}</Card>}
            {pagedOrders.map(o => <Card key={o.id} style={{ padding: "14px", background: sel.has(o.id) ? T.accentLight : T.surface, border: sel.has(o.id) ? `1.5px solid ${T.accentMid}` : `1px solid ${T.border}` }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: T.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => setViewOrder(o)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "4px" }}>
                    <div style={{ fontWeight: 700, fontSize: "14px", fontFamily: T.fd, color: T.text }}>
                      {o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 5px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}
                    </div>
                    <span style={{ fontWeight: 800, fontFamily: T.fd, fontSize: "14px", flexShrink: 0 }}>{cur}{(o.price || 0).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>{cleanPhone(o.phone)} · {o.state} · {o.product} ×{o.qty}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <select value={o.status} onChange={e => { e.stopPropagation(); doUpdateStatus(o.id, e.target.value); }} style={{ padding: "4px 8px", borderRadius: "20px", border: `1.5px solid ${getStatus(o.status).color}40`, background: getStatus(o.status).bg, color: getStatus(o.status).color, fontSize: "11px", fontWeight: 700 }}>
                      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
                    </select>
                    {o.agent_name ? <span style={{ fontSize: "11px", color: T.textMuted, background: T.surfaceAlt, padding: "3px 8px", borderRadius: "6px" }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={e => { e.stopPropagation(); setShowAssign(o.id); }} style={{ color: T.accent }}>+ Assign</Btn>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${T.borderLight}`, justifyContent: "flex-end" }}>
                <a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs">💬 WhatsApp</Btn></a>
                <Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}>✏️ Edit</Btn>
                <Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}>🗑</Btn>
              </div>
            </Card>)}
            <Pagination page={ordersPage} total={filtered.length} pageSize={ordersPageSize} onPage={setOrdersPage} onPageSize={n => { setOrdersPageSize(n); setOrdersPage(0); }} />
          </div> : (
            /* DESKTOP TABLE */
            <Card style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead><tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                    <th style={{ padding: "11px 12px", width: "40px" }}><input type="checkbox" checked={pagedOrders.length > 0 && pagedOrders.every(o => sel.has(o.id))} onChange={toggleAll} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></th>
                    {["Customer", "Product", country === "ghana" ? "Region" : "State", "Status", "Agent", "Price", ""].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: T.textMuted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.6px" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: "56px", textAlign: "center", color: T.textMuted, fontSize: "14px" }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No orders match your filters."}</td></tr>}
                    {pagedOrders.map((o, idx) => <tr key={o.id}
                      style={{ borderBottom: `1px solid ${T.borderLight}`, background: sel.has(o.id) ? T.accentLight : idx % 2 === 0 ? T.surface : T.surfaceAlt, transition: "background .1s" }}
                      onMouseEnter={e => { if (!sel.has(o.id)) e.currentTarget.style.background = T.accentLight + "60"; }}
                      onMouseLeave={e => { if (!sel.has(o.id)) e.currentTarget.style.background = idx % 2 === 0 ? T.surface : T.surfaceAlt; }}>
                      <td style={{ padding: "12px 12px" }}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></td>
                      <td style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setViewOrder(o)}>
                        <div style={{ fontWeight: 700, fontSize: "13px", fontFamily: T.fd, color: T.text }}>{o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 6px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}</div>
                        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>{cleanPhone(o.phone)}</div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: T.text }}>{o.product}</div>
                        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>{o.pack_name} · ×{o.qty}</div>
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: "12px", color: T.textMuted }}>{o.state}</td>
                      <td style={{ padding: "12px 14px" }}><select value={o.status} onChange={e => doUpdateStatus(o.id, e.target.value)} style={{ padding: "5px 8px", borderRadius: "20px", border: `1.5px solid ${getStatus(o.status).color}30`, background: getStatus(o.status).bg, color: getStatus(o.status).color, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: T.f }}>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select></td>
                      <td style={{ padding: "12px 14px" }}>{o.agent_name ? <span style={{ fontSize: "12px", fontWeight: 600, background: T.surfaceAlt, padding: "3px 9px", borderRadius: "6px" }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={() => setShowAssign(o.id)} style={{ color: T.accent }}>+ Assign</Btn>}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 800, fontFamily: T.fd, fontSize: "13px" }}>{cur}{(o.price || 0).toLocaleString()}</div>
                        {o.delivery_fee > 0 && <div style={{ fontSize: "10px", color: T.danger, marginTop: "1px" }}>-{cur}{o.delivery_fee.toLocaleString()} fee</div>}
                      </td>
                      <td style={{ padding: "12px 14px" }}><div style={{ display: "flex", gap: "4px" }}><a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs">💬</Btn></a><Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}>✏️</Btn><Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}>🗑</Btn></div></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "8px 14px", borderTop: `1px solid ${T.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.surfaceAlt }}>
                <span style={{ fontSize: "11px", color: T.textMuted }}>{filtered.length} of {cOrders.length} orders{Object.keys(dupeMap).length > 0 && ` · ${Object.keys(dupeMap).length} duplicates`}</span>
                <Pagination page={ordersPage} total={filtered.length} pageSize={ordersPageSize} onPage={setOrdersPage} onPageSize={n => { setOrdersPageSize(n); setOrdersPage(0); }} />
              </div>
            </Card>
          )}
        </div>}

        {/* ═══ AGENTS ═══ */}
        {tab === "agents" && <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h3 style={{ margin: 0, fontFamily: T.fd, fontSize: "17px", color: T.text }}>Delivery Agents</h3>
            <Btn sz="sm" onClick={() => setShowAddAgent(true)}>+ Add Agent</Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: "12px" }}>
            {cAgents.length === 0 && <Card style={{ padding: "48px", textAlign: "center", color: T.textMuted, gridColumn: "1/-1" }}>No agents yet. Add your first agent to get started.</Card>}
            {cAgents.map(a => { const as = agentSt[a.id] || {}; const rn = parseInt(as.rate); return (
              <Card key={a.id} style={{ padding: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontFamily: T.fd, fontSize: "15px", color: T.text }}>{a.name}</div>
                    <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>{cleanPhone(a.phone)} · {(a.states || []).join(", ")}</div>
                  </div>
                  <div style={{ background: rn >= 70 ? "#F0FDF4" : rn >= 40 ? T.warningBg : as.rate === "-" ? T.surfaceAlt : T.dangerBg, color: rn >= 70 ? "#16A34A" : rn >= 40 ? T.warning : as.rate === "-" ? T.textMuted : T.danger, padding: "5px 12px", borderRadius: "20px", fontSize: "14px", fontWeight: 800, fontFamily: T.fd }}>{as.rate === "-" ? "—" : as.rate + "%"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "12px" }}>
                  {[{ l: "Orders", v: as.total || 0, c: T.text }, { l: "Done", v: as.delivered || 0, c: "#16A34A" }, { l: "Failed", v: as.failed || 0, c: T.danger }, { l: "Stock", v: as.stock || 0, c: T.accent }].map(m => (
                    <div key={m.l} style={{ textAlign: "center", padding: "8px 4px", background: T.surfaceAlt, borderRadius: T.rs }}>
                      <div style={{ fontWeight: 800, fontSize: "18px", fontFamily: T.fd, color: m.c }}>{m.v}</div>
                      <div style={{ fontSize: "9px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", marginTop: "2px" }}>{m.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <Btn v="secondary" sz="sm" onClick={() => setShowStock(a.id)} style={{ flex: 1, justifyContent: "center" }}>📦 Manage Stock</Btn>
                  <Btn v="ghost" sz="sm" onClick={() => doDeleteAgent(a.id)} style={{ color: T.danger }}>🗑</Btn>
                </div>
              </Card>
            ); })}
          </div>
        </div>}

        {/* ═══ INVENTORY ═══ */}
        {tab === "inventory" && <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h3 style={{ margin: 0, fontFamily: T.fd }}>Inventory</h3><Btn sz="sm" onClick={() => setShowAddProduct(true)}>+ Product</Btn></div>
          {products.length === 0 ? <Card style={{ padding: "40px", textAlign: "center", color: T.textMuted }}>No products yet.</Card> : <div style={{ display: "grid", gap: "8px" }}>
            {products.map(p => { const total = cAgents.reduce((s, a) => s + (inventory.find(i => i.agent_id === a.id && i.product_name === p.name)?.qty || 0), 0); return (
              <Card key={p.id} style={{ padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: cAgents.length ? "8px" : 0 }}><span style={{ fontWeight: 700, fontFamily: T.fd }}>{p.name}</span><span style={{ fontWeight: 800, fontFamily: T.fd, fontSize: "18px", color: total === 0 ? T.textLight : T.accent }}>{total} total</span></div>
                {cAgents.map(a => { const q = inventory.find(i => i.agent_id === a.id && i.product_name === p.name)?.qty || 0; return (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "12px" }}><span style={{ color: T.textMuted }}>{a.name}</span><span style={{ fontWeight: 700, color: q <= 5 && q > 0 ? T.danger : q === 0 ? T.textLight : T.text }}>{q}{q > 0 && q <= 5 && " ⚠"}</span></div>
                ); })}
              </Card>
            ); })}
          </div>}
        </div>}

        {/* ═══ ANALYTICS ═══ */}
        {tab === "analytics" && <div style={{ display: "grid", gap: "12px" }}>
          <Card style={{ padding: "18px" }}>
            <div style={{ fontWeight: 700, fontFamily: T.fd, marginBottom: "12px" }}>Status Breakdown</div>
            {STATUSES.map(s => { const c = cOrders.filter(o => o.status === s.value).length; const p = cOrders.length > 0 ? c / cOrders.length * 100 : 0; return (
              <div key={s.value} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ width: isMobile ? "70px" : "100px", fontSize: "11px", color: T.textMuted, fontWeight: 600 }}>{s.icon} {s.label}</span>
                <div style={{ flex: 1, background: T.surfaceAlt, borderRadius: "4px", height: "20px", overflow: "hidden" }}><div style={{ width: `${p}%`, background: s.color, height: "100%", borderRadius: "4px", minWidth: c > 0 ? "2px" : 0 }} /></div>
                <span style={{ width: "35px", textAlign: "right", fontWeight: 800, fontFamily: T.fd }}>{c}</span>
                <span style={{ width: "35px", textAlign: "right", fontSize: "10px", color: T.textMuted }}>{p.toFixed(0)}%</span>
              </div>
            ); })}
          </Card>
          <Card style={{ padding: "18px" }}>
            <div style={{ fontWeight: 700, fontFamily: T.fd, marginBottom: "12px" }}>Revenue</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
              {[{ l: "Collected", v: stats.rev, c: "#2E7D32", bg: "#E8F5E9" }, { l: "Fees", v: stats.fees, c: T.danger, bg: T.dangerBg }, { l: "Net", v: stats.net, c: "#1976D2", bg: "#E3F2FD" }].map(r => <div key={r.l} style={{ padding: "14px", background: r.bg, borderRadius: T.r, textAlign: "center" }}><div style={{ fontSize: "10px", color: r.c, textTransform: "uppercase", fontWeight: 700 }}>{r.l}</div><div style={{ fontSize: "22px", fontWeight: 800, fontFamily: T.fd, color: r.c }}>{cur}{r.v.toLocaleString()}</div></div>)}
            </div>
          </Card>
          <Card style={{ padding: "18px" }}>
            <div style={{ fontWeight: 700, fontFamily: T.fd, marginBottom: "12px" }}>By {country === "ghana" ? "Region" : "State"}</div>
            {states.map(st => { const so = cOrders.filter(o => o.state === st); const d = so.filter(o => o.status === "delivered").length; const p = cOrders.length > 0 ? so.length / cOrders.length * 100 : 0; return (
              <div key={st} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}><span style={{ width: isMobile ? "90px" : "150px", fontSize: "11px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st}</span><div style={{ flex: 1, background: T.surfaceAlt, borderRadius: "4px", height: "14px", overflow: "hidden" }}><div style={{ width: `${p}%`, background: T.accent, height: "100%", borderRadius: "4px", minWidth: so.length > 0 ? "2px" : 0 }} /></div><span style={{ width: "25px", textAlign: "right", fontWeight: 800, fontFamily: T.fd, fontSize: "12px" }}>{so.length}</span><span style={{ width: "50px", textAlign: "right", fontSize: "10px", color: T.textMuted }}>{d} done</span></div>
            ); })}
          </Card>
        </div>}

        {/* ═══ TEMPLATES ═══ */}
        {tab === "templates" && <div>
          <Card style={{ padding: "10px 14px", marginBottom: "12px", fontSize: "12px", color: T.textMuted }}><strong>Placeholders:</strong> {["{name}","{product}","{address}","{price}","{qty}","{state}","{agent}","{pack}","{phone}","{notes}"].map(p => <code key={p} style={{ background: T.surfaceAlt, padding: "1px 5px", borderRadius: "4px", marginLeft: "3px", fontSize: "11px", color: T.accent, fontWeight: 700 }}>{p}</code>)}</Card>
          <div style={{ display: "grid", gap: "10px" }}>{STATUSES.map(s => <Card key={s.value} style={{ padding: "14px" }}>
            <div style={{ marginBottom: "8px" }}><Badge status={s.value} /></div>
            <textarea value={templates[s.value] || ""} onChange={e => doSaveTemplate(s.value, e.target.value)} rows={3} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", fontFamily: T.f, resize: "vertical", boxSizing: "border-box", outline: "none", background: T.surfaceAlt, lineHeight: 1.5 }} />
          </Card>)}</div>
        </div>}
      </div>

      {/* MOBILE NAV */}
      {isMobile && <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-around", padding: "8px 0 env(safe-area-inset-bottom,8px)", zIndex: 100, boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", padding: "4px 10px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", color: tab === t.id ? T.accent : T.textLight, fontFamily: T.f, flex: 1 }}>
          <span style={{ fontSize: "20px", lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: "9px", fontWeight: tab === t.id ? 800 : 600, letterSpacing: "0.2px" }}>{t.label}</span>
          {tab === t.id && <span style={{ width: "18px", height: "2px", background: T.accent, borderRadius: "2px", marginTop: "1px" }} />}
        </button>)}
      </div>}

      {/* ═══ MODALS ═══ */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Orders">
        <p style={{ fontSize: "13px", color: T.textMuted, marginBottom: "12px" }}>Upload WPForms CSV. Auto-detects Nigeria/Ghana.</p>
        <div style={{ marginBottom: "12px" }}><label style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, display: "block", marginBottom: "4px", textTransform: "uppercase" }}>Country</label>
          <select value={importCountry} onChange={e => setImportCountry(e.target.value)} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}><option value="auto">Auto-detect</option><option value="nigeria">🇳🇬 Nigeria</option><option value="ghana">🇬🇭 Ghana</option></select></div>
        <input type="file" accept=".csv" onChange={doImport} style={{ width: "100%", padding: "16px", border: `2px dashed ${T.border}`, borderRadius: T.r, fontSize: "13px", cursor: "pointer", boxSizing: "border-box", background: T.surfaceAlt }} />
        {saving && <div style={{ textAlign: "center", marginTop: "12px", color: T.accent, fontWeight: 700 }}>Importing...</div>}
      </Modal>

      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)} title="Order Details" wide>
        {viewOrder && (() => { const o = orders.find(x => x.id === viewOrder.id) || viewOrder; return <div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
            {[{ l: "Customer", v: o.name }, { l: "Phone", v: cleanPhone(o.phone) }, { l: "WhatsApp", v: cleanPhone(o.whatsapp || o.phone) }, { l: country === "ghana" ? "Region" : "State", v: o.state }].map(f => <div key={f.l}><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>{f.l}</div><div style={{ fontWeight: 600, fontSize: "14px" }}>{f.v}</div></div>)}
            <div style={{ gridColumn: "1/-1" }}><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Address</div><div style={{ fontSize: "13px" }}>{o.address}</div></div>
            <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Product</div><div style={{ fontWeight: 700 }}>{o.product} — {o.pack_name} (×{o.qty})</div></div>
            <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Price</div><div style={{ fontWeight: 800, fontFamily: T.fd, fontSize: "16px" }}>{cur}{(o.price || 0).toLocaleString()}</div></div>
            {o.notes && <div style={{ gridColumn: "1/-1", background: T.warningBg, padding: "10px 12px", borderRadius: T.rs }}><div style={{ fontSize: "10px", color: "#F57F17", textTransform: "uppercase", fontWeight: 700 }}>Notes</div><div style={{ fontSize: "13px", color: "#E65100" }}>{o.notes}</div></div>}
          </div>
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "12px" }}><div style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "6px", textTransform: "uppercase" }}>WhatsApp</div><div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>{STATUSES.map(s => <a key={s.value} href={getWALink(o, s.value)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><Btn v={o.status === s.value ? "whatsapp" : "secondary"} sz="sm" style={{ fontSize: "11px" }}>{s.icon} {s.label}</Btn></a>)}</div></div>
        </div>; })()}
      </Modal>

      <Modal open={!!editOrder} onClose={() => setEditOrder(null)} title="Edit Order" wide>
        {editOrder && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 10px" }}>
          <Inp label="Name" value={editOrder.name} onChange={e => setEditOrder(p => ({ ...p, name: e.target.value }))} />
          <Inp label="Phone" value={editOrder.phone} onChange={e => setEditOrder(p => ({ ...p, phone: e.target.value }))} />
          <Inp label="WhatsApp" value={editOrder.whatsapp} onChange={e => setEditOrder(p => ({ ...p, whatsapp: e.target.value }))} />
          <Inp label={country === "ghana" ? "Region" : "State"} value={editOrder.state} onChange={e => setEditOrder(p => ({ ...p, state: e.target.value }))} />
          <div style={{ gridColumn: "1/-1" }}><Inp label="Address" value={editOrder.address} onChange={e => setEditOrder(p => ({ ...p, address: e.target.value }))} /></div>
          <Inp label="Product" value={editOrder.product} onChange={e => setEditOrder(p => ({ ...p, product: e.target.value }))} />
          <Inp label="Pack" value={editOrder.pack_name} onChange={e => setEditOrder(p => ({ ...p, pack_name: e.target.value }))} />
          <Inp label="Qty" type="number" value={editOrder.qty} onChange={e => setEditOrder(p => ({ ...p, qty: +e.target.value || 1 }))} />
          <Inp label={`Price (${cur})`} type="number" value={editOrder.price} onChange={e => setEditOrder(p => ({ ...p, price: +e.target.value || 0 }))} />
          <Inp label="Qty Delivered" type="number" value={editOrder.actual_qty_delivered} onChange={e => setEditOrder(p => ({ ...p, actual_qty_delivered: +e.target.value || 0 }))} />
          <Inp label={`Collected (${cur})`} type="number" value={editOrder.actual_price_collected} onChange={e => setEditOrder(p => ({ ...p, actual_price_collected: +e.target.value || 0 }))} />
          <Inp label={`Delivery Fee (${cur})`} type="number" value={editOrder.delivery_fee} onChange={e => setEditOrder(p => ({ ...p, delivery_fee: +e.target.value || 0 }))} />
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Agent</label>
            <select value={editOrder.agent_id || ""} onChange={e => { const a = agents.find(x => x.id === e.target.value); setEditOrder(p => ({ ...p, agent_id: e.target.value || null, agent_name: a?.name || "" })); }} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>
              <option value="">Unassigned</option>
              {cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Status</label>
            <select value={editOrder.status} onChange={e => setEditOrder(p => ({ ...p, status: e.target.value }))} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select></div>
          <div style={{ gridColumn: "1/-1" }}><Inp label="Notes" value={editOrder.notes} onChange={e => setEditOrder(p => ({ ...p, notes: e.target.value }))} /></div>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}><Btn onClick={() => doSaveOrder(editOrder)} style={{ flex: 1, justifyContent: "center" }}>Save</Btn><Btn v="secondary" onClick={() => setEditOrder(null)}>Cancel</Btn></div>
        </div>}
      </Modal>

      <Modal open={!!showAssign} onClose={() => setShowAssign(null)} title="Assign Agent">
        {cAgents.length === 0 ? <p style={{ color: T.textMuted, textAlign: "center", padding: "20px" }}>No agents yet.</p> : <div style={{ display: "grid", gap: "6px" }}>
          {cAgents.map(a => <button key={a.id} onClick={() => doAssign(showAssign, a.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: T.surfaceAlt, border: `1.5px solid ${T.border}`, borderRadius: T.r, cursor: "pointer", fontFamily: T.f, width: "100%", textAlign: "left" }}><div><div style={{ fontWeight: 700 }}>{a.name}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{(a.states || []).join(", ")}</div></div><span style={{ fontWeight: 800, color: "#2E7D32", fontFamily: T.fd }}>{agentSt[a.id]?.rate || "—"}%</span></button>)}
        </div>}
      </Modal>

      <Modal open={showAddAgent} onClose={() => setShowAddAgent(false)} title="Add Agent">
        <AgentForm onSubmit={doAddAgent} country={country} />
      </Modal>

      <Modal open={showAddProduct} onClose={() => setShowAddProduct(false)} title="Add Product">
        <ProductForm onSubmit={doAddProduct} />
      </Modal>

      <Modal open={showAddOrder} onClose={() => setShowAddOrder(false)} title="Add Order" wide>
        <OrderForm country={country} cur={cur} onSubmit={doAddOrder} />
      </Modal>

      <Modal open={!!showStock} onClose={() => setShowStock(null)} title={`Stock — ${agents.find(a => a.id === showStock)?.name || ""}`}>
        {showStock && <StockMgr agentId={showStock} products={products} inventory={inventory} onUpdate={doUpdateStock} />}
      </Modal>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ═══════════════════════════════════════════════
// FORM COMPONENTS
// ═══════════════════════════════════════════════

function AgentForm({ onSubmit, country }) {
  const [n, sN] = useState(""); const [p, sP] = useState(""); const [s, sS] = useState("");
  return <div><Inp label="Name" value={n} onChange={e => sN(e.target.value)} /><Inp label="Phone" value={p} onChange={e => sP(e.target.value)} /><Inp label={`${country === "ghana" ? "Regions" : "States"} (comma-separated)`} value={s} onChange={e => sS(e.target.value)} /><Btn onClick={() => { if (n) onSubmit({ name: n, phone: p, states: s.split(",").map(x => x.trim()).filter(Boolean) }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Add Agent</Btn></div>;
}

function ProductForm({ onSubmit }) {
  const [n, sN] = useState("");
  return <div><Inp label="Product Name" value={n} onChange={e => sN(e.target.value)} /><Btn onClick={() => { if (n) onSubmit(n); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Add Product</Btn></div>;
}

function OrderForm({ onSubmit, country, cur }) {
  const [f, sF] = useState({ name: "", phone: "", whatsapp: "", address: "", state: "", product: "", pack_name: "", qty: 1, price: 0, notes: "", status: "pending", delivery_fee: 0 });
  const [err, setErr] = useState("");
  const set = (k, v) => sF(p => ({ ...p, [k]: v }));
  const handleSubmit = () => {
    if (!f.name.trim()) return setErr("Customer name is required.");
    if (!f.phone.trim()) return setErr("Phone number is required.");
    if (!f.product.trim()) return setErr("Product is required.");
    setErr("");
    onSubmit({ ...f, actual_qty_delivered: f.qty, actual_price_collected: f.price });
  };
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
    <Inp label="Name *" value={f.name} onChange={e => set("name", e.target.value)} />
    <Inp label="Phone *" value={f.phone} onChange={e => set("phone", e.target.value)} />
    <Inp label="WhatsApp" value={f.whatsapp} onChange={e => set("whatsapp", e.target.value)} />
    <Inp label={country === "ghana" ? "Region" : "State"} value={f.state} onChange={e => set("state", e.target.value)} />
    <div style={{ gridColumn: "1/-1" }}><Inp label="Address" value={f.address} onChange={e => set("address", e.target.value)} /></div>
    <Inp label="Product *" value={f.product} onChange={e => set("product", e.target.value)} />
    <Inp label="Pack" value={f.pack_name} onChange={e => set("pack_name", e.target.value)} />
    <Inp label="Qty" type="number" value={f.qty} onChange={e => set("qty", +e.target.value || 1)} />
    <Inp label={`Price (${cur})`} type="number" value={f.price} onChange={e => set("price", +e.target.value || 0)} />
    <div style={{ gridColumn: "1/-1" }}><Inp label="Notes" value={f.notes} onChange={e => set("notes", e.target.value)} /></div>
    {err && <div style={{ gridColumn: "1/-1", color: "#C62828", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>{err}</div>}
    <div style={{ gridColumn: "1/-1" }}><Btn onClick={handleSubmit} style={{ width: "100%", justifyContent: "center" }}>Add Order</Btn></div>
  </div>;
}

function StockItem({ agentId, product, qty, onUpdate }) {
  const [local, setLocal] = useState(qty);
  useEffect(() => { setLocal(qty); }, [qty]);
  const commit = (val) => { const n = Math.max(0, val); setLocal(n); onUpdate(agentId, product, n); };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#FAF8F5", borderRadius: "8px", flexWrap: "wrap", gap: "6px" }}>
      <div style={{ fontWeight: 700, fontSize: "13px" }}>{product}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {[-5, -1].map(d => <button key={d} onClick={() => commit(local + d)} style={{ padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #E8E4DF", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: "'Nunito Sans',sans-serif" }}>{d}</button>)}
        <input type="number" value={local} onChange={e => setLocal(+e.target.value || 0)} onBlur={() => commit(local)} style={{ width: "50px", textAlign: "center", padding: "5px", border: "1.5px solid #E8E4DF", borderRadius: "6px", fontWeight: 800, fontFamily: "'Outfit',sans-serif", fontSize: "14px" }} />
        {[1, 5, 10].map(d => <button key={d} onClick={() => commit(local + d)} style={{ padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #E8E4DF", background: d === 10 ? "#0F7B5F" : "#fff", color: d === 10 ? "#fff" : "#1A1A2E", cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: "'Nunito Sans',sans-serif" }}>+{d}</button>)}
      </div>
    </div>
  );
}

function StockMgr({ agentId, products, inventory, onUpdate }) {
  const getQ = pid => inventory.find(i => i.agent_id === agentId && i.product_name === pid)?.qty || 0;
  return products.length === 0 ? <p style={{ color: "#8C8C9E", textAlign: "center", padding: "20px" }}>No products yet.</p> : (
    <div style={{ display: "grid", gap: "8px" }}>
      {products.map(p => <StockItem key={p.id} agentId={agentId} product={p.name} qty={getQ(p.name)} onUpdate={onUpdate} />)}
    </div>
  );
}
