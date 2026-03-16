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
  async query(table, params = "") {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
    if (!r.ok) throw new Error(`GET ${table}: ${r.status}`);
    return r.json();
  },
  async insert(table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: this.headers, body: JSON.stringify(Array.isArray(data) ? data : [data]) });
    if (!r.ok) { const e = await r.text(); throw new Error(`INSERT ${table}: ${r.status} ${e}`); }
    return r.json();
  },
  async update(table, match, data) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join("&");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method: "PATCH", headers: this.headers, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`UPDATE ${table}: ${r.status}`);
    return r.json();
  },
  async delete(table, match) {
    const params = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join("&");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method: "DELETE", headers: this.headers });
    if (!r.ok) throw new Error(`DELETE ${table}: ${r.status}`);
  },
  async deleteIn(table, col, ids) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=in.(${ids.map(i => `"${i}"`).join(",")})`, { method: "DELETE", headers: this.headers });
    if (!r.ok) throw new Error(`DELETE_IN ${table}: ${r.status}`);
  },
  async upsert(table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...this.headers, "Prefer": "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(Array.isArray(data) ? data : [data]) });
    if (!r.ok) { const e = await r.text(); throw new Error(`UPSERT ${table}: ${r.status} ${e}`); }
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
  bg: "#F5F0EB", surface: "#FFFFFF", surfaceAlt: "#FAF8F5", sidebar: "#1A1A2E", sidebarActive: "#2D2D4A",
  accent: "#0F7B5F", accentLight: "#E8F5EF", text: "#1A1A2E", textMuted: "#8C8C9E", textLight: "#B0B0BE",
  border: "#E8E4DF", borderLight: "#F0ECE7", danger: "#C62828", dangerBg: "#FFEBEE", warning: "#E6A817",
  warningBg: "#FFF8E1", whatsapp: "#25D366", r: "10px", rs: "7px", rl: "14px",
  sh: "0 1px 3px rgba(26,26,46,0.06)", shm: "0 4px 12px rgba(26,26,46,0.08)", shl: "0 12px 40px rgba(26,26,46,0.12)",
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
      <div style={{ position: "absolute", inset: 0, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: T.surface, borderRadius: "20px 20px 0 0", padding: "20px", width: "100%", maxWidth: wide ? "700px" : "480px", maxHeight: "90vh", overflow: "auto", boxShadow: T.shl, animation: "sUp .25s ease" }}>
        <div style={{ width: "40px", height: "4px", background: T.border, borderRadius: "2px", margin: "0 auto 16px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, fontFamily: T.fd }}>{title}</h3>
          <button onClick={onClose} style={{ background: T.surfaceAlt, border: "none", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted }}>✕</button>
        </div>
        {children}
      </div>
      <style>{`@keyframes sUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
};

const Inp = ({ label, ...p }) => (
  <div style={{ marginBottom: "10px" }}>
    {label && <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: T.f }}>{label}</label>}
    <input {...p} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "14px", fontFamily: T.f, boxSizing: "border-box", outline: "none", background: T.surfaceAlt, color: T.text, ...p.style }}
      onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.border} />
  </div>
);

const Btn = ({ children, v, sz, ...p }) => {
  const vs = { primary: { background: T.accent, color: "#fff", border: "none" }, secondary: { background: T.surfaceAlt, color: T.text, border: `1.5px solid ${T.border}` }, danger: { background: T.danger, color: "#fff", border: "none" }, whatsapp: { background: T.whatsapp, color: "#fff", border: "none" }, ghost: { background: "transparent", color: T.textMuted, border: "none" }, warning: { background: T.warning, color: "#fff", border: "none" } };
  const s = vs[v || "primary"];
  const zs = sz === "sm" ? { padding: "6px 12px", fontSize: "12px" } : sz === "xs" ? { padding: "4px 8px", fontSize: "11px" } : { padding: "10px 18px", fontSize: "13px" };
  return <button {...p} style={{ ...s, ...zs, borderRadius: T.rs, cursor: "pointer", fontWeight: 700, fontFamily: T.f, display: "inline-flex", alignItems: "center", gap: "5px", transition: "all .15s", whiteSpace: "nowrap", ...p.style }}>{children}</button>;
};

const Badge = ({ status }) => { const s = getStatus(status); return <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{s.icon} {s.label}</span>; };

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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F5F0EB", fontFamily: "'Nunito Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Nunito+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderRadius: "16px", padding: "32px", width: "320px", textAlign: "center", boxShadow: "0 4px 12px rgba(26,26,46,0.08)" }}>
        <div style={{ width: "48px", height: "48px", background: "#0F7B5F", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff", fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: "22px" }}>T</div>
        <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: "20px", marginBottom: "4px" }}>Tweb CRM</div>
        <div style={{ color: "#8C8C9E", fontSize: "13px", marginBottom: "20px" }}>Enter PIN to continue</div>
        <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => { setPin(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="••••"
          style={{ width: "100%", padding: "12px", border: `2px solid ${error ? "#C62828" : "#E8E4DF"}`, borderRadius: "10px", fontSize: "20px", textAlign: "center", letterSpacing: "8px", outline: "none", fontFamily: "'Outfit',sans-serif", boxSizing: "border-box", marginBottom: "12px" }} />
        {error && <div style={{ color: "#C62828", fontSize: "12px", marginBottom: "8px", fontWeight: 600 }}>Wrong PIN</div>}
        <button onClick={handleSubmit}
          style={{ width: "100%", padding: "12px", background: "#0F7B5F", color: "#fff", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "'Nunito Sans',sans-serif" }}>Unlock</button>
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

  const [tab, setTab] = useState("orders");
  const [country, setCountry] = useState("nigeria");
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [stateF, setStateF] = useState("all");
  const [agentF, setAgentF] = useState("all");
  const [dupeF, setDupeF] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sel, setSel] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);

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
  const loadAll = async () => {
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
      setLoaded(true);
    } catch (e) { setLoadError(e.message); setLoaded(true); }
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
    if (dateFrom) { const d = new Date(o.created_at); if (d < new Date(dateFrom)) return false; }
    if (dateTo) { const d = new Date(o.created_at); if (d > new Date(dateTo + "T23:59:59")) return false; }
    if (search) { const s = search.toLowerCase(); return [o.name, cleanPhone(o.phone), o.address, o.state, o.product, o.notes].some(f => (f || "").toLowerCase().includes(s)); }
    return true;
  }), [cOrders, statusF, stateF, agentF, dupeF, dateFrom, dateTo, search, dupeMap]);

  const states = useMemo(() => [...new Set(cOrders.map(o => o.state).filter(Boolean))].sort(), [cOrders]);

  const stats = useMemo(() => {
    const del = cOrders.filter(o => o.status === "delivered");
    const rev = del.reduce((s, o) => s + (o.actual_price_collected || o.price || 0), 0);
    const fees = cOrders.reduce((s, o) => s + (o.delivery_fee || 0), 0);
    return { total: cOrders.length, delivered: del.length, pending: cOrders.filter(o => o.status === "pending").length, failed: cOrders.filter(o => o.status === "failed_delivery").length, rev, fees, net: rev - fees, rate: cOrders.length > 0 ? ((del.length / cOrders.length) * 100).toFixed(1) : "0" };
  }, [cOrders]);

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
    } catch (err) { alert("Import error: " + err.message); }
    setSaving(false); setShowImport(false); e.target.value = "";
  };

  const doUpdateStatus = async (id, status) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    try {
      await sb.update("orders", { id }, { status });
      const order = orders.find(o => o.id === id);
      if (status === "delivered" && order?.agent_id) {
        const inv = inventory.find(i => i.agent_id === order.agent_id && i.product_name === order.product);
        if (inv) {
          const newQty = Math.max(0, inv.qty - (order.actual_qty_delivered || order.qty));
          await sb.update("inventory", { id: inv.id }, { qty: newQty });
          setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newQty } : i));
        }
      }
    } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doAssign = async (orderId, agentId) => {
    const a = agents.find(x => x.id === agentId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, agent_id: agentId, agent_name: a?.name || "" } : o));
    try { await sb.update("orders", { id: orderId }, { agent_id: agentId, agent_name: a?.name || "" }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
    setShowAssign(null);
  };

  const doSaveOrder = async (order) => {
    const { id, created_at, updated_at, ...data } = order;
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...data } : o));
    try { await sb.update("orders", { id }, data); } catch (err) { alert("Error: " + err.message); await loadAll(); }
    setEditOrder(null);
  };

  const doDeleteOrder = async (id) => {
    setOrders(prev => prev.filter(o => o.id !== id));
    try { await sb.delete("orders", { id }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doBulkStatus = async (status) => {
    const ids = [...sel];
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, status } : o));
    setSel(new Set());
    try { for (const id of ids) await sb.update("orders", { id }, { status }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doBulkDelete = async () => {
    const ids = [...sel];
    setOrders(prev => prev.filter(o => !sel.has(o.id)));
    setSel(new Set());
    try { await sb.deleteIn("orders", "id", ids); } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doBulkAssign = async (agentId) => {
    const a = agents.find(x => x.id === agentId);
    const ids = [...sel];
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, agent_id: agentId, agent_name: a?.name || "" } : o));
    setSel(new Set());
    try { for (const id of ids) await sb.update("orders", { id }, { agent_id: agentId, agent_name: a?.name || "" }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doAddAgent = async (data) => {
    try { await sb.insert("agents", { ...data, country }); await loadAll(); } catch (err) { alert("Error: " + err.message); }
    setShowAddAgent(false);
  };

  const doDeleteAgent = async (id) => {
    setAgents(prev => prev.filter(a => a.id !== id));
    try { await sb.delete("agents", { id }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
  };

  const doAddProduct = async (name) => {
    try { await sb.insert("products", { name }); await loadAll(); } catch (err) { alert("Error: " + err.message); }
    setShowAddProduct(false);
  };

  const doUpdateStock = async (agentId, productName, qty) => {
    const existing = inventory.find(i => i.agent_id === agentId && i.product_name === productName);
    if (existing) {
      setInventory(prev => prev.map(i => i.id === existing.id ? { ...i, qty } : i));
      try { await sb.update("inventory", { id: existing.id }, { qty }); } catch (err) { alert("Error: " + err.message); await loadAll(); }
    } else {
      try { const res = await sb.insert("inventory", { agent_id: agentId, product_name: productName, qty }); setInventory(prev => [...prev, ...(res || [])]); } catch (err) { alert("Error: " + err.message); await loadAll(); }
    }
  };

  const doSaveTemplate = async (key, msg) => {
    setTemplates(prev => ({ ...prev, [key]: msg }));
    try { await sb.upsert("templates", { status_key: key, message: msg }); } catch (err) { alert("Error: " + err.message); }
  };

  const doAddOrder = async (data) => {
    try { await sb.insert("orders", { ...data, country }); await loadAll(); } catch (err) { alert("Error: " + err.message); }
    setShowAddOrder(false);
  };

  const getWALink = (o, statusOverride) => waLink(o.whatsapp || o.phone, fillTpl(templates[statusOverride || o.status] || templates.pending || "", o), o.country);

  const toggleSel = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { const all = filtered.map(o => o.id); setSel(all.every(id => sel.has(id)) ? new Set() : new Set(all)); };

  // ─── SCREENS ───
  
  if (!authed) return <PinScreen onUnlock={() => setAuthed(true)} />;
  
  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, fontFamily: T.f }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px", animation: "pulse 1.5s infinite" }}>📋</div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px" }}>Connecting to database...</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginTop: "4px" }}>Loading your CRM data</div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>
    </div>
  );

  if (loadError) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, fontFamily: T.f }}>
      <Card style={{ padding: "30px", maxWidth: "400px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>Connection Error</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginBottom: "16px" }}>{loadError}</div>
        <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "16px" }}>Make sure you've run the SQL schema in Supabase first.</div>
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
      <div style={{ background: T.sidebar, padding: isMobile ? "12px 16px" : "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", background: T.accent, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: T.fd, fontWeight: 800, fontSize: "15px" }}>T</div>
          {!isMobile && <div><div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "15px", color: "#fff" }}>Tweb CRM</div><div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>Live Database</div></div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {saving && <span style={{ color: T.whatsapp, fontSize: "11px", fontWeight: 700 }}>Saving...</span>}
          <Btn v="ghost" sz="xs" onClick={loadAll} style={{ color: "rgba(255,255,255,0.6)" }}>🔄</Btn>
          <Btn v="ghost" sz="xs" onClick={() => { sessionStorage.removeItem("tweb-auth-ts"); setAuthed(false); }} style={{ color: "rgba(255,255,255,0.4)" }}>🚪</Btn>
          {[{ v: "nigeria", f: "🇳🇬", l: "NG", fl: "Nigeria" }, { v: "ghana", f: "🇬🇭", l: "GH", fl: "Ghana" }].map(c => (
            <button key={c.v} onClick={() => { setCountry(c.v); setStatusF("all"); setStateF("all"); setAgentF("all"); setDupeF(false); setSel(new Set()); }}
              style={{ padding: "6px 12px", borderRadius: "8px", border: country === c.v ? `2px solid ${T.accent}` : "2px solid transparent", background: country === c.v ? T.sidebarActive : "rgba(255,255,255,0.06)", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 700, fontFamily: T.f, display: "flex", alignItems: "center", gap: "4px" }}>
              {c.f} {isMobile ? c.l : c.fl} <span style={{ background: "rgba(255,255,255,0.15)", padding: "0 5px", borderRadius: "4px", fontSize: "10px" }}>{orders.filter(o => o.country === c.v).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* DESKTOP TABS */}
      {!isMobile && <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", gap: "2px" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "12px 16px", border: "none", borderBottom: tab === t.id ? `2.5px solid ${T.accent}` : "2.5px solid transparent", background: "none", color: tab === t.id ? T.accent : T.textMuted, fontWeight: tab === t.id ? 700 : 600, cursor: "pointer", fontSize: "13px", fontFamily: T.f, display: "flex", alignItems: "center", gap: "6px" }}>
            <span>{t.icon}</span> {t.label}
            {t.count !== undefined && <span style={{ background: tab === t.id ? T.accentLight : T.surfaceAlt, color: tab === t.id ? T.accent : T.textMuted, fontSize: "10px", fontWeight: 800, padding: "1px 6px", borderRadius: "10px" }}>{t.count}</span>}
          </button>
        ))}
      </div>}

      {/* STATS */}
      <div style={{ padding: isMobile ? "12px 12px 8px" : "16px 24px", display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(120px,1fr))", gap: isMobile ? "8px" : "10px" }}>
        {[{ l: "Orders", v: stats.total, a: T.sidebar }, { l: "Delivered", v: stats.delivered, s: `${stats.rate}%`, a: "#2E7D32" }, { l: "Pending", v: stats.pending, a: T.warning }, { l: "Failed", v: stats.failed, a: T.danger }, { l: "Revenue", v: `${cur}${stats.rev.toLocaleString()}`, a: "#1976D2" },
          ...(!isMobile ? [{ l: "Fees", v: `${cur}${stats.fees.toLocaleString()}`, a: "#E65100" }, { l: "Net", v: `${cur}${stats.net.toLocaleString()}`, a: "#2E7D32" }] : [])
        ].map((c, i) => (
          <Card key={i} style={{ padding: isMobile ? "10px 12px" : "14px 16px", borderLeft: `3px solid ${c.a}` }}>
            <div style={{ fontSize: "9px", color: T.textMuted, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}>{c.l}</div>
            <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 800, fontFamily: T.fd }}>{c.v}</div>
            {c.s && <div style={{ fontSize: "10px", color: T.textMuted }}>{c.s}</div>}
          </Card>
        ))}
      </div>

      <div style={{ padding: isMobile ? "0 12px 16px" : "0 24px 24px" }}>

        {/* ═══ ORDERS ═══ */}
        {tab === "orders" && <div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
            <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: "140px", padding: "9px 12px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", fontFamily: T.f, outline: "none", background: T.surface }} />
            {isMobile ? <Btn v="secondary" sz="sm" onClick={() => setShowFilters(!showFilters)}>🔽</Btn> : <>
              <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="all">All Statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
              <select value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="all">All {country === "ghana" ? "Regions" : "States"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
              <select value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="all">All Agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, fontFamily: T.f }} title="From date" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, fontFamily: T.f }} title="To date" />
            </>}
            <Btn v={dupeF ? "warning" : "secondary"} sz="sm" onClick={() => setDupeF(!dupeF)}>{dupeF ? "✕" : "👥"}</Btn>
            <Btn sz="sm" onClick={() => setShowImport(true)}>📥 Import</Btn>
            <Btn v="secondary" sz="sm" onClick={() => setShowAddOrder(true)}>+ Add</Btn>
          </div>

          {isMobile && showFilters && <Card style={{ padding: "12px", marginBottom: "10px" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surfaceAlt }}><option value="all">All Statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
            <select value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surfaceAlt }}><option value="all">All {country === "ghana" ? "Regions" : "States"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <select value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surfaceAlt, gridColumn: "1/-1" }}><option value="all">All Agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surfaceAlt }} placeholder="From" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "8px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surfaceAlt }} placeholder="To" />
          </div></Card>}

          {sel.size > 0 && <div style={{ display: "flex", gap: "6px", marginBottom: "10px", alignItems: "center", background: "#E3F2FD", padding: "8px 12px", borderRadius: T.rs, border: "1px solid #90CAF9", flexWrap: "wrap", fontSize: "12px" }}>
            <span style={{ fontWeight: 700, color: "#1565C0" }}>{sel.size} selected →</span>
            {isMobile ? <select onChange={e => { if (e.target.value) doBulkStatus(e.target.value); e.target.value = ""; }} style={{ padding: "4px 6px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: "11px", background: "#fff" }}><option value="">Status...</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
              : STATUSES.map(s => <Btn key={s.value} v="secondary" sz="xs" onClick={() => doBulkStatus(s.value)}>{s.icon}</Btn>)}
            {cAgents.length > 0 && <select onChange={e => { if (e.target.value) doBulkAssign(e.target.value); e.target.value = ""; }} style={{ padding: "4px 6px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: "11px", background: "#fff" }}><option value="">Assign...</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
            <Btn v="danger" sz="xs" onClick={doBulkDelete} style={{ marginLeft: "auto" }}>🗑 Delete</Btn>
            <Btn v="ghost" sz="xs" onClick={() => setSel(new Set())}>✕</Btn>
          </div>}

          {/* MOBILE CARDS */}
          {isMobile ? <div style={{ display: "grid", gap: "8px" }}>
            {filtered.length === 0 && <Card style={{ padding: "40px 20px", textAlign: "center", color: T.textMuted }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No matches."}</Card>}
            {filtered.map(o => <Card key={o.id} style={{ padding: "12px", background: sel.has(o.id) ? "#E3F2FD" : T.surface }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: T.accent }} />
                <div style={{ flex: 1 }} onClick={() => setViewOrder(o)}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <div style={{ fontWeight: 700, fontSize: "14px", fontFamily: T.fd }}>{o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 5px", borderRadius: "4px", marginLeft: "5px" }}>DUPE</span>}</div>
                    <span style={{ fontWeight: 800, fontFamily: T.fd }}>{cur}{(o.price || 0).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "6px" }}>{cleanPhone(o.phone)} · {o.state} · {o.product} ×{o.qty}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <select value={o.status} onChange={e => { e.stopPropagation(); doUpdateStatus(o.id, e.target.value); }} style={{ padding: "3px 6px", borderRadius: "6px", border: `1.5px solid ${getStatus(o.status).color}40`, background: getStatus(o.status).bg, color: getStatus(o.status).color, fontSize: "11px", fontWeight: 700 }}>
                      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
                    </select>
                    {o.agent_name ? <span style={{ fontSize: "11px", color: T.textMuted }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={e => { e.stopPropagation(); setShowAssign(o.id); }} style={{ color: "#1976D2" }}>Assign</Btn>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${T.borderLight}`, justifyContent: "flex-end" }}>
                <a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs">💬 WhatsApp</Btn></a>
                <Btn v="ghost" sz="xs" onClick={() => setEditOrder({ ...o })}>✏️</Btn>
                <Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}>🗑</Btn>
              </div>
            </Card>)}
          </div> : (
            /* DESKTOP TABLE */
            <Card style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead><tr style={{ background: T.surfaceAlt }}>
                    <th style={{ padding: "10px 8px", width: "36px", borderBottom: `1px solid ${T.border}` }}><input type="checkbox" checked={filtered.length > 0 && filtered.every(o => sel.has(o.id))} onChange={toggleAll} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></th>
                    {["Customer", "Product", country === "ghana" ? "Region" : "State", "Status", "Agent", "Price", ""].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: T.textMuted, fontSize: "10px", textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: "40px", textAlign: "center", color: T.textMuted }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No matches."}</td></tr>}
                    {filtered.map(o => <tr key={o.id} style={{ borderBottom: `1px solid ${T.borderLight}`, background: sel.has(o.id) ? "#E3F2FD" : "" }} onMouseEnter={e => { if (!sel.has(o.id)) e.currentTarget.style.background = T.surfaceAlt; }} onMouseLeave={e => { if (!sel.has(o.id)) e.currentTarget.style.background = ""; }}>
                      <td style={{ padding: "10px 8px" }}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></td>
                      <td style={{ padding: "10px 12px", cursor: "pointer" }} onClick={() => setViewOrder(o)}><div style={{ fontWeight: 700, fontSize: "13px", fontFamily: T.fd }}>{o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 5px", borderRadius: "4px", marginLeft: "5px" }}>DUPE</span>}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{cleanPhone(o.phone)}</div></td>
                      <td style={{ padding: "10px 12px" }}><div style={{ fontWeight: 600, fontSize: "12px" }}>{o.product}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{o.pack_name} (×{o.qty})</div></td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: T.textMuted }}>{o.state}</td>
                      <td style={{ padding: "10px 12px" }}><select value={o.status} onChange={e => doUpdateStatus(o.id, e.target.value)} style={{ padding: "4px 6px", borderRadius: "6px", border: `1.5px solid ${getStatus(o.status).color}40`, background: getStatus(o.status).bg, color: getStatus(o.status).color, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: T.f }}>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select></td>
                      <td style={{ padding: "10px 12px" }}>{o.agent_name ? <span style={{ fontSize: "11px", fontWeight: 600 }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={() => setShowAssign(o.id)} style={{ color: "#1976D2" }}>Assign</Btn>}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 800, fontFamily: T.fd, fontSize: "13px" }}>{cur}{(o.price || 0).toLocaleString()}{o.delivery_fee > 0 && <div style={{ fontSize: "10px", color: T.danger }}>-{cur}{o.delivery_fee.toLocaleString()}</div>}</td>
                      <td style={{ padding: "10px 12px" }}><div style={{ display: "flex", gap: "4px" }}><a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs">💬</Btn></a><Btn v="ghost" sz="xs" onClick={() => setEditOrder({ ...o })}>✏️</Btn><Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}>🗑</Btn></div></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.borderLight}`, fontSize: "11px", color: T.textMuted, display: "flex", justifyContent: "space-between" }}><span>{filtered.length} of {cOrders.length}</span>{Object.keys(dupeMap).length > 0 && <span>{Object.keys(dupeMap).length} dupes</span>}</div>
            </Card>
          )}
        </div>}

        {/* ═══ AGENTS ═══ */}
        {tab === "agents" && <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h3 style={{ margin: 0, fontFamily: T.fd }}>Delivery Agents</h3><Btn sz="sm" onClick={() => setShowAddAgent(true)}>+ Add</Btn></div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: "10px" }}>
            {cAgents.length === 0 && <Card style={{ padding: "40px", textAlign: "center", color: T.textMuted, gridColumn: "1/-1" }}>No agents yet.</Card>}
            {cAgents.map(a => { const as = agentSt[a.id] || {}; const rn = parseInt(as.rate); return (
              <Card key={a.id} style={{ padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div><div style={{ fontWeight: 700, fontFamily: T.fd }}>{a.name}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{cleanPhone(a.phone)} · {(a.states || []).join(", ")}</div></div>
                  <div style={{ background: rn >= 70 ? "#E8F5E9" : rn >= 40 ? T.warningBg : as.rate === "-" ? T.surfaceAlt : T.dangerBg, color: rn >= 70 ? "#2E7D32" : rn >= 40 ? T.warning : as.rate === "-" ? T.textMuted : T.danger, padding: "4px 10px", borderRadius: "8px", fontSize: "14px", fontWeight: 800, fontFamily: T.fd }}>{as.rate === "-" ? "—" : as.rate + "%"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "6px" }}>
                  {[{ l: "Orders", v: as.total || 0 }, { l: "Done", v: as.delivered || 0 }, { l: "Failed", v: as.failed || 0 }, { l: "Stock", v: as.stock || 0 }].map(m => <div key={m.l} style={{ textAlign: "center", padding: "6px", background: T.surfaceAlt, borderRadius: "6px" }}><div style={{ fontWeight: 800, fontSize: "16px", fontFamily: T.fd }}>{m.v}</div><div style={{ fontSize: "9px", color: T.textMuted, textTransform: "uppercase" }}>{m.l}</div></div>)}
                </div>
                <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}><Btn v="secondary" sz="sm" onClick={() => setShowStock(a.id)} style={{ flex: 1 }}>📦 Stock</Btn><Btn v="ghost" sz="sm" onClick={() => doDeleteAgent(a.id)} style={{ color: T.danger }}>🗑</Btn></div>
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
      {isMobile && <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-around", padding: "6px 0 env(safe-area-inset-bottom,6px)", zIndex: 100, boxShadow: "0 -2px 10px rgba(0,0,0,0.05)" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", padding: "6px 8px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: tab === t.id ? T.accent : T.textMuted, fontFamily: T.f }}><span style={{ fontSize: "18px" }}>{t.icon}</span><span style={{ fontSize: "9px", fontWeight: tab === t.id ? 800 : 600 }}>{t.label}</span></button>)}
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
  const set = (k, v) => sF(p => ({ ...p, [k]: v }));
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
    <Inp label="Name" value={f.name} onChange={e => set("name", e.target.value)} />
    <Inp label="Phone" value={f.phone} onChange={e => set("phone", e.target.value)} />
    <Inp label="WhatsApp" value={f.whatsapp} onChange={e => set("whatsapp", e.target.value)} />
    <Inp label={country === "ghana" ? "Region" : "State"} value={f.state} onChange={e => set("state", e.target.value)} />
    <div style={{ gridColumn: "1/-1" }}><Inp label="Address" value={f.address} onChange={e => set("address", e.target.value)} /></div>
    <Inp label="Product" value={f.product} onChange={e => set("product", e.target.value)} />
    <Inp label="Pack" value={f.pack_name} onChange={e => set("pack_name", e.target.value)} />
    <Inp label="Qty" type="number" value={f.qty} onChange={e => set("qty", +e.target.value || 1)} />
    <Inp label={`Price (${cur})`} type="number" value={f.price} onChange={e => set("price", +e.target.value || 0)} />
    <div style={{ gridColumn: "1/-1" }}><Inp label="Notes" value={f.notes} onChange={e => set("notes", e.target.value)} /></div>
    <div style={{ gridColumn: "1/-1" }}><Btn onClick={() => { if (f.name && f.phone) onSubmit({ ...f, actual_qty_delivered: f.qty, actual_price_collected: f.price }); }} style={{ width: "100%", justifyContent: "center" }}>Add Order</Btn></div>
  </div>;
}

function StockMgr({ agentId, products, inventory, onUpdate }) {
  const getQ = pid => inventory.find(i => i.agent_id === agentId && i.product_name === pid)?.qty || 0;
  return products.length === 0 ? <p style={{ color: "#8C8C9E", textAlign: "center", padding: "20px" }}>No products yet.</p> : (
    <div style={{ display: "grid", gap: "8px" }}>{products.map(p => {
      const q = getQ(p.name);
      return <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#FAF8F5", borderRadius: "8px", flexWrap: "wrap", gap: "6px" }}>
        <div style={{ fontWeight: 700, fontSize: "13px" }}>{p.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {[-5, -1].map(d => <button key={d} onClick={() => onUpdate(agentId, p.name, Math.max(0, q + d))} style={{ padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #E8E4DF", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: "'Nunito Sans',sans-serif" }}>{d}</button>)}
          <input type="number" value={q} onChange={e => onUpdate(agentId, p.name, Math.max(0, +e.target.value || 0))} style={{ width: "50px", textAlign: "center", padding: "5px", border: "1.5px solid #E8E4DF", borderRadius: "6px", fontWeight: 800, fontFamily: "'Outfit',sans-serif", fontSize: "14px" }} />
          {[1, 5, 10].map(d => <button key={d} onClick={() => onUpdate(agentId, p.name, q + d)} style={{ padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #E8E4DF", background: d === 10 ? "#0F7B5F" : "#fff", color: d === 10 ? "#fff" : "#1A1A2E", cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: "'Nunito Sans',sans-serif" }}>+{d}</button>)}
        </div>
      </div>;
    })}</div>
  );
}
