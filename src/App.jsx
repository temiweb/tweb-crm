import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, ClipboardList, Boxes, Truck, MessageSquare,
  Search, Bell, ChevronDown, PanelLeftClose, PanelLeftOpen,
  Phone, MessageCircle, Plus, ArrowUpRight, ArrowDownRight,
  Store, RefreshCw, LogOut, Upload, Users, Pencil, Trash2, X,
  Package, TrendingUp, Wallet, CheckCircle2, Clock, Filter
} from "lucide-react";

/*
 * INFINISTORES CRM v5 — Supabase Edition
 * Design system v2: deep-green command rail + delivery funnel.
 * Real-time database, multi-device, mobile-first.
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
  async queryAll(table, params = "") {
    // Supabase caps single requests at 1000 rows — page through until exhausted
    const pageSize = 1000;
    let all = [];
    let offset = 0;
    while (true) {
      const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        headers: { ...this.headers, "Range-Unit": "items", "Range": `${offset}-${offset + pageSize - 1}` }
      });
      if (!r.ok) throw new Error(`Failed to load ${table} (${r.status})`);
      const rows = await r.json();
      all = all.concat(rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return all;
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
// STATUS MODEL — grouped reason-code clusters (visual)
// DB values unchanged; .group drives pill colour + dropdown grouping.
// ═══════════════════════════════════════════════

const GROUPS = [
  { id: "progress", label: "In progress", c: "#1d4ed8" },
  { id: "noreach", label: "Couldn't reach", c: "#475569" },
  { id: "failed", label: "Didn't go through", c: "#b91c1c" },
  { id: "done", label: "Completed", c: "#15673f" },
];

const STATUSES = [
  { value: "pending", label: "Pending", group: "progress", color: "#b45309", bg: "#fff4e8", icon: "⏳" },
  { value: "confirmed", label: "Confirmed", group: "progress", color: "#1d4ed8", bg: "#e8f1ff", icon: "✓" },
  { value: "postponed", label: "Postponed", group: "progress", color: "#6d28d9", bg: "#f3ecfe", icon: "⏸" },
  { value: "not_reachable", label: "Not Reachable", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "📵" },
  { value: "out_of_stock", label: "Out of Stock", group: "noreach", color: "#546e7a", bg: "#eceff1", icon: "📦" },
  { value: "cancelled", label: "Cancelled", group: "failed", color: "#b91c1c", bg: "#fdecec", icon: "✕" },
  { value: "failed_delivery", label: "Failed Delivery", group: "failed", color: "#9f1239", bg: "#fff1f2", icon: "❌" },
  { value: "delivered", label: "Delivered", group: "done", color: "#15673f", bg: "#e9f4ee", icon: "✅" },
];

const getStatus = v => STATUSES.find(s => s.value === v) || STATUSES[0];

// ═══════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════

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
// THEME (aligned to design-system v2 tokens)
// ═══════════════════════════════════════════════
const T = {
  bg: "#f4f7f4",
  surface: "#FFFFFF", surfaceAlt: "#f4f7f4", surfaceHover: "#eef2ef",
  accent: "#1a7a4c", accentDark: "#15673f", accentLight: "#e9f4ee", accentMid: "#d2e8db",
  text: "#0c1b14", textMuted: "#6f7d75", textLight: "#94a3b8",
  border: "#e6ebe7", borderLight: "#eef2ef",
  danger: "#b91c1c", dangerBg: "#fdecec",
  warning: "#b45309", warningBg: "#fff4e8",
  whatsapp: "#1a8a4f",
  r: "12px", rs: "10px", rl: "14px",
  sh: "0 1px 2px rgba(12,27,20,.04),0 1px 3px rgba(12,27,20,.05)",
  shm: "0 4px 12px rgba(12,27,20,.08), 0 1px 3px rgba(12,27,20,.04)",
  shl: "0 10px 34px rgba(12,27,20,.16), 0 4px 12px rgba(12,27,20,.08)",
  f: "'DM Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  fd: "'Montserrat','DM Sans',sans-serif",
};

// ═══════════════════════════════════════════════
// DESIGN-SYSTEM CSS (v2) — scoped under .cx-app
// ═══════════════════════════════════════════════
const CSS = `
.cx-app *{box-sizing:border-box}
.cx-app{
  --brand:#1a7a4c; --brand-600:#15673f; --brand-700:#0f4d31;
  --brand-light:#57c089; --brand-50:#e9f4ee; --brand-100:#d2e8db;
  --rail:#0c3a26; --rail-2:#0a3020; --rail-line:rgba(255,255,255,.08);
  --rail-fg:#bfd6c9; --rail-fg-dim:rgba(255,255,255,.45);
  --accent:#f57c00; --rose:#b5446e;
  --ink:#0c1b14; --ink-2:#3a4a42; --muted:#6f7d75;
  --line:#e6ebe7; --line-2:#eef2ef; --bg:#f4f7f4; --card:#fff;
  --radius:14px; --radius-sm:10px;
  --shadow:0 1px 2px rgba(12,27,20,.04),0 1px 3px rgba(12,27,20,.05);
  --shadow-lg:0 10px 34px rgba(12,27,20,.13);
  font-family:'DM Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  color:var(--ink); background:var(--bg);
  -webkit-font-smoothing:antialiased; line-height:1.45;
}
.cx-num{font-family:'Montserrat','DM Sans',sans-serif;font-feature-settings:"tnum" 1;letter-spacing:-.015em}
.cx-app button{font-family:inherit;cursor:pointer}
.cx-app *:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px}
.cx-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}

.cx-shell{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
.cx-shell.collapsed{grid-template-columns:74px 1fr}

/* ---- command rail (signature) ---- */
.cx-side{background:linear-gradient(180deg,var(--rail),var(--rail-2));
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh;color:var(--rail-fg)}
.cx-brand{display:flex;align-items:center;gap:11px;padding:20px 18px 16px}
.cx-logo{width:32px;height:32px;border-radius:9px;background:var(--brand-light);
  display:grid;place-items:center;color:var(--rail);flex-shrink:0}
.cx-brand b{font-size:18px;font-family:'Montserrat';letter-spacing:-.02em;color:#fff;white-space:nowrap}
.cx-collapse{margin-left:auto;color:var(--rail-fg-dim);padding:5px;border-radius:7px;background:none;border:none}
.cx-collapse:hover{background:var(--rail-line);color:#fff}
.cx-navwrap{flex:1;overflow-y:auto;padding:6px 12px}
.cx-navlabel{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
  color:var(--rail-fg-dim);padding:16px 10px 6px}
.cx-nav{position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:9px 11px;
  border-radius:var(--radius-sm);color:var(--rail-fg);font-size:14px;font-weight:500;
  text-align:left;transition:background .12s,color .12s;background:none;border:none}
.cx-nav:hover{background:var(--rail-line);color:#fff}
.cx-nav.on{background:rgba(87,192,137,.16);color:#fff;font-weight:600}
.cx-nav.on svg{color:var(--brand-light)}
.cx-nav.on::before{content:"";position:absolute;left:-12px;top:7px;bottom:7px;width:3px;
  border-radius:0 3px 3px 0;background:var(--brand-light)}
.cx-nav svg{flex-shrink:0;color:var(--rail-fg-dim)}
.cx-nav .cnt{margin-left:auto;font-size:11px;font-weight:700;background:var(--rail-line);
  color:var(--rail-fg);padding:1px 8px;border-radius:20px}
.cx-storecard{margin:12px;padding:11px;border:1px solid var(--rail-line);
  border-radius:var(--radius-sm);display:flex;align-items:center;gap:10px}
.cx-storeic{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.1);
  color:#fff;display:grid;place-items:center;flex-shrink:0}
.cx-storecard b{color:#fff;font-size:13px}
.collapsed .cx-brand b,.collapsed .cx-navlabel,.collapsed .cx-nav span,
.collapsed .cx-nav .cnt,.collapsed .cx-storecard div{display:none}
.collapsed .cx-nav{justify-content:center} .collapsed .cx-nav.on::before{display:none}

/* ---- topbar ---- */
.cx-main{display:flex;flex-direction:column;min-width:0}
.cx-top{display:flex;align-items:center;gap:12px;padding:13px 26px;
  background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.cx-searchbar{flex:1;max-width:420px;display:flex;align-items:center;gap:9px;
  background:var(--bg);border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:8px 12px;color:var(--muted);font-size:14px}
.cx-searchbar input{border:none;background:none;outline:none;flex:1;font:inherit;color:var(--ink)}
.cx-seg2{display:flex;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:3px}
.cx-seg2 button{padding:4px 11px;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--muted);background:none;border:none;display:flex;align-items:center;gap:5px}
.cx-seg2 button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.cx-iconbtn{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;
  color:var(--ink-2);border:1px solid var(--line);position:relative;background:var(--card)}
.cx-iconbtn:hover{background:var(--bg)}

.cx-content{padding:22px 26px 64px;max-width:1320px;width:100%}
.cx-h1{font-size:22px;font-family:'Montserrat';letter-spacing:-.02em;margin:0}
.cx-sub{color:var(--muted);font-size:14px;margin-top:3px}
.cx-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap}

.cx-grid{display:grid;gap:14px}
.cx-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}

/* ---- KPI ---- */
.cx-kpis{grid-template-columns:repeat(auto-fit,minmax(178px,1fr))}
.cx-kpi{padding:15px 16px;border-top:2px solid var(--accent-color,#1a7a4c);position:relative;min-width:0}
.cx-kpi .row{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.cx-kpi .v{font-size:26px;font-weight:700;margin-top:9px;line-height:1.05;white-space:nowrap}
.cx-kpi .d{font-size:12px;margin-top:6px;display:inline-flex;align-items:center;gap:4px;font-weight:600}
.cx-up{color:var(--brand)} .cx-down{color:#b91c1c} .cx-flat{color:var(--muted)}

/* ---- delivery funnel (signature) ---- */
.cx-funnel{padding:20px 22px}
.cx-funnel .lead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.cx-funnel .big{font-size:38px;font-weight:800;font-family:'Montserrat';letter-spacing:-.03em;color:var(--brand-700)}
.cx-steps{display:flex;align-items:stretch;gap:0;margin:18px 0 14px;flex-wrap:wrap}
.cx-step{flex:1;text-align:left;min-width:90px}
.cx-step .n{font-size:22px;font-weight:700}
.cx-step .lbl{font-size:12px;color:var(--muted)}
.cx-leak{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 6px;min-width:78px}
.cx-leak .chip{font-size:11px;font-weight:700;color:#9a3412;background:#fff4e8;padding:2px 8px;border-radius:20px;white-space:nowrap}
.cx-leak .arr{color:var(--line);font-size:18px;line-height:1}
.cx-outbar{display:flex;height:12px;border-radius:8px;overflow:hidden;background:var(--bg)}
.cx-outbar .s{height:100%}
.cx-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:12px}
.cx-legend i{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}

/* ---- pills ---- */
.cx-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:30px;font-size:12px;font-weight:600;white-space:nowrap}
.cx-pill .dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.cx-statussel{appearance:none;-webkit-appearance:none;border:none;border-radius:30px;padding:4px 24px 4px 11px;
  font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat:no-repeat;background-position:right 8px center}

/* ---- table ---- */
.cx-tablewrap{overflow-x:auto}
.cx-table{width:100%;border-collapse:collapse;font-size:14px}
.cx-table thead th{position:sticky;top:0;background:var(--card);z-index:1}
.cx-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;padding:11px 14px;border-bottom:1px solid var(--line)}
.cx-table td{padding:11px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}
.cx-table tbody tr{transition:background .1s}
.cx-table tbody tr:hover{background:#f3f8f5}
.cx-table tbody tr.sel{background:var(--brand-50)}
.cx-table .r{text-align:right} .cx-table th.r{text-align:right}
.cx-cust b{font-weight:600} .cx-cust span{display:block;font-size:12px;color:var(--muted)}

/* ---- tabs / filters ---- */
.cx-tabs{display:flex;gap:4px;background:var(--bg);padding:4px;border-radius:11px;width:fit-content;margin-bottom:14px;flex-wrap:wrap}
.cx-tab{padding:7px 14px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--muted);background:none;border:none}
.cx-tab.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.cx-sel{display:flex;align-items:center;gap:6px;border:1.5px solid var(--line);background:var(--card);border-radius:10px;padding:8px 11px;font-size:13px;color:var(--ink-2)}
.cx-sel.act{border-color:var(--brand);background:var(--brand-50);color:var(--brand-600)}
.cx-sel select,.cx-sel input{border:none;background:none;outline:none;font:inherit;color:inherit}

.cx-empty{padding:54px 20px;text-align:center;color:var(--muted)}
.cx-empty svg{margin:0 auto 12px;color:var(--line);display:block}
.cx-section-t{font-size:15px;font-weight:700;font-family:'Montserrat';letter-spacing:-.01em}
.cx-list-row{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--line-2);gap:10px}
.cx-list-row:last-child{border-bottom:none}
.cx-app code{background:var(--bg);padding:1px 6px;border-radius:5px;font-size:12px}

/* ---- mobile ---- */
.cx-mobitop{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--rail);color:#fff;position:sticky;top:0;z-index:50}
.cx-bottomnav{position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--line);
  display:flex;justify-content:space-around;padding:8px 0 env(safe-area-inset-bottom,8px);z-index:80;box-shadow:0 -4px 16px rgba(12,27,20,.06)}
.cx-bn{background:none;border:none;display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;color:var(--muted)}
.cx-bn.on{color:var(--brand)}
.cx-bn span{font-size:9.5px;font-weight:700}

@media(prefers-reduced-motion:reduce){.cx-app *{transition:none!important}}
`;

// ═══════════════════════════════════════════════
// UI PRIMITIVES
// ═══════════════════════════════════════════════

const Card = ({ children, style, className = "", ...p }) => <div className={`cx-card ${className}`} style={style} {...p}>{children}</div>;

const Btn = ({ children, v, sz, ...p }) => {
  const vs = {
    primary: { background: T.accent, color: "#fff", border: "none" },
    secondary: { background: T.surface, color: T.text, border: `1.5px solid ${T.border}` },
    danger: { background: T.danger, color: "#fff", border: "none" },
    whatsapp: { background: T.whatsapp, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: T.textMuted, border: "none" },
    warning: { background: T.warning, color: "#fff", border: "none" },
  };
  const s = vs[v || "primary"];
  const zs = sz === "sm" ? { padding: "7px 13px", fontSize: "13px" } : sz === "xs" ? { padding: "5px 10px", fontSize: "12px" } : { padding: "9px 16px", fontSize: "14px" };
  return <button {...p} style={{ ...s, ...zs, borderRadius: T.rs, cursor: "pointer", fontWeight: 600, fontFamily: T.f, display: "inline-flex", alignItems: "center", gap: "6px", transition: "opacity .12s, background .12s", whiteSpace: "nowrap", ...p.style }}>{children}</button>;
};

const Modal = ({ open, onClose, title, children, wide }) => {
  if (!open) return null;
  return (
    <div className="cx-app" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(12,27,20,0.5)", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: T.surface, borderRadius: T.rl, width: "calc(100% - 24px)", maxWidth: wide ? "680px" : "460px", maxHeight: "92vh", overflow: "hidden", boxShadow: T.shl, animation: "sUp .22s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 22px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.borderLight}` }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, fontFamily: T.fd, color: T.text }}>{title}</h3>
          <button onClick={onClose} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, flexShrink: 0 }}><X size={15} /></button>
        </div>
        <div style={{ padding: "18px 22px 24px", overflow: "auto", flex: 1 }}>{children}</div>
      </div>
      <style>{`@keyframes sUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
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

const Pill = ({ status }) => { const s = getStatus(status); return <span className="cx-pill" style={{ color: s.color, background: s.bg }}><span className="dot" />{s.label}</span>; };

// Grouped status <select> styled as a pill (keeps inline status-change UX)
const StatusSelect = ({ value, onChange, style }) => {
  const s = getStatus(value);
  return (
    <select className="cx-statussel" value={value} onChange={onChange} style={{ color: s.color, background: s.bg, ...style }}>
      {GROUPS.map(g => (
        <optgroup key={g.id} label={g.label}>
          {STATUSES.filter(x => x.group === g.id).map(x => <option key={x.value} value={x.value} style={{ background: "#fff", color: "#0c1b14" }}>{x.icon} {x.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
};

const KPI = ({ accent, v, l, d, dir, icon: Ic }) => {
  const len = String(v).length;
  const vFont = len >= 14 ? "15px" : len >= 12 ? "16px" : len >= 10 ? "18px" : len >= 8 ? "22px" : len >= 7 ? "24px" : "26px";
  return (
  <div className="cx-card cx-kpi" style={{ "--accent-color": accent }}>
    <div className="row">
      <span className="cx-eyebrow">{l}</span>
      {Ic && <Ic size={16} style={{ color: accent }} />}
    </div>
    <div className="cx-num v" style={{ fontSize: vFont }}>{v}</div>
    {d && <div className={`d ${dir === "up" ? "cx-up" : dir === "down" ? "cx-down" : "cx-flat"}`}>
      {dir === "up" && <ArrowUpRight size={13} />}{dir === "down" && <ArrowDownRight size={13} />}{d}</div>}
  </div>
  );
};

const Toasts = ({ toasts, onDismiss }) => (
  <div className="cx-app" style={{ position: "fixed", bottom: "80px", right: "16px", zIndex: 2000, display: "flex", flexDirection: "column", gap: "8px", maxWidth: "340px", pointerEvents: "none" }}>
    {toasts.map(t => (
      <div key={t.id} style={{ background: t.type === "error" ? T.danger : T.accent, color: "#fff", padding: "12px 16px", borderRadius: T.r, boxShadow: T.shl, fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "flex-start", gap: "10px", pointerEvents: "all" }}>
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
      <select value={pageSize} onChange={e => onPageSize(+e.target.value)} style={{ padding: "6px 8px", borderRadius: T.rs, border: `1.5px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f, cursor: "pointer" }}>
        {[50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
      </select>
      <Btn v="secondary" sz="sm" onClick={() => onPage(0)} disabled={page === 0} style={{ opacity: page === 0 ? 0.4 : 1 }}>«</Btn>
      <Btn v="secondary" sz="sm" onClick={() => onPage(page - 1)} disabled={page === 0} style={{ opacity: page === 0 ? 0.4 : 1 }}>‹</Btn>
      <span style={{ fontSize: "12px", color: T.textMuted, fontWeight: 600, whiteSpace: "nowrap" }}>
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <Btn v="secondary" sz="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} style={{ opacity: page >= totalPages - 1 ? 0.4 : 1 }}>›</Btn>
      <Btn v="secondary" sz="sm" onClick={() => onPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ opacity: page >= totalPages - 1 ? 0.4 : 1 }}>»</Btn>
    </div>
  );
};

const FONTS = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Montserrat:wght@600;700;800&display=swap";

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
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div style={{ background: "#fff", borderRadius: "18px", padding: "36px 32px", width: "340px", textAlign: "center", boxShadow: T.shl }}>
        <div style={{ width: "52px", height: "52px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "#fff" }}><Store size={26} /></div>
        <div style={{ fontFamily: T.fd, fontWeight: 800, fontSize: "22px", color: T.text, marginBottom: "6px" }}>Infinistores</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginBottom: "24px" }}>Enter your PIN to continue</div>
        <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => { setPin(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="••••"
          style={{ width: "100%", padding: "13px", border: `2px solid ${error ? T.danger : T.border}`, borderRadius: "12px", fontSize: "22px", textAlign: "center", letterSpacing: "10px", outline: "none", fontFamily: T.fd, boxSizing: "border-box", marginBottom: "8px", transition: "border-color .15s" }} />
        {error && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "10px", fontWeight: 700 }}>Incorrect PIN — try again</div>}
        {!error && <div style={{ marginBottom: "10px" }} />}
        <button onClick={handleSubmit}
          style={{ width: "100%", padding: "13px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: T.f }}>Unlock</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

export default function InfinistoresCRM() {
  const [authed, setAuthed] = useState(() => {
    const ts = sessionStorage.getItem("tweb-auth-ts");
    if (!ts) return false;
    const hoursElapsed = (Date.now() - parseInt(ts)) / (1000 * 60 * 60);
    if (hoursElapsed > 8) { sessionStorage.removeItem("tweb-auth-ts"); return false; }
    return true;
  });
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
  const [collapsed, setCollapsed] = useState(false);
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
        sb.queryAll("orders", "order=created_at.desc"),
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

  // Delivery funnel (signature) — computed from real data
  const funnel = useMemo(() => {
    const by = g => statsOrders.filter(o => getStatus(o.status).group === g).length;
    const placed = statsOrders.length;
    const delivered = statsOrders.filter(o => o.status === "delivered").length;
    const neverReached = by("noreach");
    const failedG = by("failed");
    const inProgress = by("progress");
    const reached = placed - neverReached;
    return { placed, reached, delivered, neverReached, failed: failedG, inProgress };
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
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#fff", animation: "pulse 1.5s infinite" }}><Store size={24} /></div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px", color: T.text }}>Loading your data…</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginTop: "6px" }}>Connecting to Infinistores</div>
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.96)}}`}</style>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <Card style={{ padding: "30px", maxWidth: "400px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
        <div style={{ fontFamily: T.fd, fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>Connection Error</div>
        <div style={{ color: T.textMuted, fontSize: "13px", marginBottom: "20px" }}>{loadError}</div>
        <Btn onClick={() => { setLoadError(null); setLoaded(false); loadAll(); }}>Retry</Btn>
      </Card>
    </div>
  );

  const NAV = [
    { sec: "Operations", items: [
      { id: "orders", label: "Orders", icon: ClipboardList, count: cOrders.length },
      { id: "agents", label: "Agents", icon: Truck, count: cAgents.length },
      { id: "inventory", label: "Inventory", icon: Boxes },
    ] },
    { sec: "Insights", items: [
      { id: "analytics", label: "Analytics", icon: LayoutDashboard },
      { id: "templates", label: "Messages", icon: MessageSquare },
    ] },
  ];
  const navFlat = NAV.flatMap(g => g.items);
  const activeMeta = navFlat.find(n => n.id === tab) || navFlat[0];

  const setCountrySafe = (v) => { setCountry(v); setStatusF("all"); setStateF("all"); setAgentF("all"); setProductF("all"); setDupeF(false); setSel(new Set()); setShowFilters(false); };

  const showStatsStrip = tab === "orders" || tab === "analytics";

  // ── shared content blocks ──
  const PeriodFilter = () => (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
      <span className="cx-eyebrow" style={{ marginRight: "2px" }}>Period</span>
      {[{ v: "today", l: "Today" }, { v: "week", l: "Week" }, { v: "month", l: "Month" }, { v: "30d", l: "30d" }, { v: "90d", l: "90d" }, { v: "all", l: "All time" }, { v: "custom", l: "Custom" }].map(r => (
        <button key={r.v} onClick={() => setStatsRange(r.v)} style={{ padding: "5px 13px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, fontFamily: T.f, cursor: "pointer", border: "none", background: statsRange === r.v ? T.accent : T.surface, color: statsRange === r.v ? "#fff" : T.textMuted, boxShadow: statsRange === r.v ? "none" : `0 0 0 1.5px ${T.border}` }}>{r.l}</button>
      ))}
      {statsRange === "custom" && <>
        <input type="date" value={statsFrom} onChange={e => setStatsFrom(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "12px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
        <span style={{ fontSize: "12px", color: T.textMuted }}>→</span>
        <input type="date" value={statsTo} onChange={e => setStatsTo(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "12px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
      </>}
    </div>
  );

  const kpiCards = [
    { l: "Orders", v: stats.total, accent: "#1a7a4c", icon: ClipboardList },
    { l: "Delivered", v: stats.delivered, d: `${stats.rate}% rate`, dir: "flat", accent: "#1d4ed8", icon: CheckCircle2 },
    { l: "Units sold", v: stats.unitsSold, d: `of ${stats.totalUnitsOrdered}`, dir: "flat", accent: "#7c3aed", icon: Package },
    { l: "Pending", v: stats.pending, accent: "#b45309", icon: Clock },
    { l: "Failed", v: stats.failed, accent: "#b91c1c", icon: X },
    { l: "Revenue", v: `${cur}${stats.rev.toLocaleString()}`, accent: "#1d4ed8", icon: Wallet },
    { l: "Fees", v: `${cur}${stats.fees.toLocaleString()}`, accent: "#ea580c", icon: Truck },
    { l: "Net", v: `${cur}${stats.net.toLocaleString()}`, accent: "#1a7a4c", icon: TrendingUp },
  ];

  const StatsStrip = () => (
    <>
      <PeriodFilter />
      <div className="cx-grid cx-kpis" style={{ marginBottom: "18px" }}>
        {kpiCards.map(c => <KPI key={c.l} accent={c.accent} v={c.v} l={c.l} d={c.d} dir={c.dir} icon={c.icon} />)}
      </div>
    </>
  );

  // ── ORDERS ──
  const OrdersScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Orders</h1><div className="cx-sub">Confirm, assign and track every order</div></div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Btn v="secondary" onClick={() => setShowImport(true)}><Upload size={15} />Import CSV</Btn>
          <Btn onClick={() => setShowAddOrder(true)}><Plus size={16} />New order</Btn>
        </div>
      </div>

      <StatsStrip />

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div className="cx-searchbar" style={{ maxWidth: "300px", flex: 1, minWidth: "180px" }}>
          <Search size={15} />
          <input placeholder="Name, phone or address…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {isMobile ? <Btn v="secondary" sz="sm" onClick={() => setShowFilters(!showFilters)} style={{ background: showFilters ? T.accentLight : T.surface, color: showFilters ? T.accent : T.text }}><Filter size={14} />Filters</Btn> : <>
          <span className={`cx-sel ${statusF !== "all" ? "act" : ""}`}><select value={statusF} onChange={e => setStatusF(e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select></span>
          <span className={`cx-sel ${stateF !== "all" ? "act" : ""}`}><select value={stateF} onChange={e => setStateF(e.target.value)}><option value="all">All {country === "ghana" ? "regions" : "states"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select></span>
          <span className={`cx-sel ${agentF !== "all" ? "act" : ""}`}><select value={agentF} onChange={e => setAgentF(e.target.value)}><option value="all">All agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></span>
          <span className={`cx-sel ${productF !== "all" ? "act" : ""}`}><select value={productF} onChange={e => setProductF(e.target.value)}><option value="all">All products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select></span>
          <span className={`cx-sel ${dateFrom ? "act" : ""}`}><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" /></span>
          <span className={`cx-sel ${dateTo ? "act" : ""}`}><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" /></span>
        </>}
        <Btn v={dupeF ? "warning" : "secondary"} sz="sm" onClick={() => setDupeF(!dupeF)}><Users size={14} />{dupeF ? "Dupes ✕" : "Dupes"}</Btn>
      </div>

      {isMobile && showFilters && <Card style={{ padding: "14px", marginBottom: "12px" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
        <select value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All {country === "ghana" ? "regions" : "states"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }} />
        <select value={productF} onChange={e => setProductF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select>
      </div></Card>}

      {sel.size > 0 && <div style={{ display: "flex", gap: "6px", marginBottom: "12px", alignItems: "center", background: T.accentLight, padding: "10px 14px", borderRadius: T.rs, border: `1.5px solid ${T.accentMid}`, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: T.accent, fontSize: "13px" }}>{sel.size} selected</span>
        {isMobile ? <select onChange={e => { if (e.target.value) doBulkStatus(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Set status…</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
          : STATUSES.map(s => <Btn key={s.value} v="secondary" sz="xs" onClick={() => doBulkStatus(s.value)} title={s.label}>{s.icon} {s.label}</Btn>)}
        {cAgents.length > 0 && <select onChange={e => { if (e.target.value) doBulkAssign(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Assign to…</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        <Btn v="danger" sz="xs" onClick={doBulkDelete} style={{ marginLeft: "auto" }}><Trash2 size={13} />Delete {sel.size}</Btn>
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
                <div style={{ fontWeight: 700, fontSize: "14px", color: T.text }}>
                  {o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 5px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}
                </div>
                <span className="cx-num" style={{ fontWeight: 700, fontSize: "14px", flexShrink: 0 }}>{cur}{(o.price || 0).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>{cleanPhone(o.phone)} · {o.state} · {o.product} ×{o.qty}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <StatusSelect value={o.status} onChange={e => { e.stopPropagation(); doUpdateStatus(o.id, e.target.value); }} />
                {o.agent_name ? <span style={{ fontSize: "11px", color: T.textMuted, background: T.surfaceAlt, padding: "3px 8px", borderRadius: "6px" }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={e => { e.stopPropagation(); setShowAssign(o.id); }} style={{ color: T.accent }}>+ Assign</Btn>}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${T.borderLight}`, justifyContent: "flex-end" }}>
            <a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs"><MessageCircle size={13} />WhatsApp</Btn></a>
            <Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}><Pencil size={13} />Edit</Btn>
            <Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}><Trash2 size={13} /></Btn>
          </div>
        </Card>)}
        <Pagination page={ordersPage} total={filtered.length} pageSize={ordersPageSize} onPage={setOrdersPage} onPageSize={n => { setOrdersPageSize(n); setOrdersPage(0); }} />
      </div> : (
        /* DESKTOP TABLE */
        <Card className="cx-tablewrap" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="cx-table">
              <thead><tr>
                <th style={{ width: "40px" }}><input type="checkbox" checked={pagedOrders.length > 0 && pagedOrders.every(o => sel.has(o.id))} onChange={toggleAll} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></th>
                <th>Customer</th><th>Product</th><th>{country === "ghana" ? "Region" : "State"}</th><th>Status</th><th>Agent</th><th className="r">Price</th><th className="r">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: "56px", textAlign: "center", color: T.textMuted, fontSize: "14px" }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No orders match your filters."}</td></tr>}
                {pagedOrders.map(o => <tr key={o.id} className={sel.has(o.id) ? "sel" : ""}>
                  <td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ width: "15px", height: "15px", accentColor: T.accent }} /></td>
                  <td className="cx-cust" style={{ cursor: "pointer" }} onClick={() => setViewOrder(o)}>
                    <b>{o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 6px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}</b>
                    <span>{cleanPhone(o.phone)}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: T.text }}>{o.product}</div>
                    <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>{o.pack_name} · ×{o.qty}</div>
                  </td>
                  <td style={{ fontSize: "12px", color: T.textMuted }}>{o.state}</td>
                  <td><StatusSelect value={o.status} onChange={e => doUpdateStatus(o.id, e.target.value)} /></td>
                  <td>{o.agent_name ? <span style={{ fontSize: "12px", fontWeight: 600, background: T.surfaceAlt, padding: "3px 9px", borderRadius: "6px" }}>{o.agent_name}</span> : <Btn v="ghost" sz="xs" onClick={() => setShowAssign(o.id)} style={{ color: T.accent }}>+ Assign</Btn>}</td>
                  <td className="r">
                    <div className="cx-num" style={{ fontWeight: 700, fontSize: "13px" }}>{cur}{(o.price || 0).toLocaleString()}</div>
                    {o.delivery_fee > 0 && <div style={{ fontSize: "10px", color: T.danger, marginTop: "1px" }}>-{cur}{o.delivery_fee.toLocaleString()} fee</div>}
                  </td>
                  <td className="r"><div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}><a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs"><MessageCircle size={13} /></Btn></a><Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}><Pencil size={13} /></Btn><Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}><Trash2 size={13} /></Btn></div></td>
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
    </div>
  );

  // ── AGENTS ──
  const AgentsScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Agents</h1><div className="cx-sub">Delivery agents and their performance</div></div>
        <Btn onClick={() => setShowAddAgent(true)}><Plus size={16} />Add agent</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: "14px" }}>
        {cAgents.length === 0 && <Card className="cx-empty" style={{ gridColumn: "1/-1" }}><Truck size={40} /><div className="cx-section-t" style={{ color: T.text }}>No agents yet</div><p style={{ marginTop: "4px" }}>Add your first delivery agent to get started.</p></Card>}
        {cAgents.map(a => { const as = agentSt[a.id] || {}; const rn = parseInt(as.rate); return (
          <Card key={a.id} style={{ padding: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <div style={{ fontWeight: 700, fontFamily: T.fd, fontSize: "15px", color: T.text }}>{a.name}</div>
                <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>{cleanPhone(a.phone)} · {(a.states || []).join(", ")}</div>
              </div>
              <div className="cx-num" style={{ background: rn >= 70 ? T.accentLight : rn >= 40 ? T.warningBg : as.rate === "-" ? T.surfaceAlt : T.dangerBg, color: rn >= 70 ? T.accent : rn >= 40 ? T.warning : as.rate === "-" ? T.textMuted : T.danger, padding: "5px 12px", borderRadius: "20px", fontSize: "14px", fontWeight: 800 }}>{as.rate === "-" ? "—" : as.rate + "%"}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "12px" }}>
              {[{ l: "Orders", v: as.total || 0, c: T.text }, { l: "Done", v: as.delivered || 0, c: T.accent }, { l: "Failed", v: as.failed || 0, c: T.danger }, { l: "Stock", v: as.stock || 0, c: "#1d4ed8" }].map(m => (
                <div key={m.l} style={{ textAlign: "center", padding: "8px 4px", background: T.surfaceAlt, borderRadius: T.rs }}>
                  <div className="cx-num" style={{ fontWeight: 800, fontSize: "18px", color: m.c }}>{m.v}</div>
                  <div style={{ fontSize: "9px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", marginTop: "2px" }}>{m.l}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <Btn v="secondary" sz="sm" onClick={() => setShowStock(a.id)} style={{ flex: 1, justifyContent: "center" }}><Boxes size={14} />Manage stock</Btn>
              <Btn v="ghost" sz="sm" onClick={() => doDeleteAgent(a.id)} style={{ color: T.danger }}><Trash2 size={14} /></Btn>
            </div>
          </Card>
        ); })}
      </div>
    </div>
  );

  // ── INVENTORY ──
  const InventoryScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Inventory</h1><div className="cx-sub">Field stock held by each agent</div></div>
        <Btn onClick={() => setShowAddProduct(true)}><Plus size={16} />Add product</Btn>
      </div>
      {products.length === 0 ? <Card className="cx-empty"><Boxes size={40} /><div className="cx-section-t" style={{ color: T.text }}>No products yet</div></Card> : <div style={{ display: "grid", gap: "10px" }}>
        {products.map(p => { const total = cAgents.reduce((s, a) => s + (inventory.find(i => i.agent_id === a.id && i.product_name === p.name)?.qty || 0), 0); return (
          <Card key={p.id} style={{ padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: cAgents.length ? "10px" : 0 }}><span style={{ fontWeight: 700, fontFamily: T.fd, fontSize: "15px" }}>{p.name}</span><span className="cx-num" style={{ fontWeight: 800, fontSize: "18px", color: total === 0 ? T.textLight : T.accent }}>{total} <span style={{ fontSize: "12px", color: T.textMuted, fontWeight: 600 }}>with agents</span></span></div>
            {cAgents.map(a => { const q = inventory.find(i => i.agent_id === a.id && i.product_name === p.name)?.qty || 0; return (
              <div key={a.id} className="cx-list-row" style={{ padding: "7px 0", fontSize: "13px" }}><span style={{ color: T.textMuted }}>{a.name}</span><span className="cx-num" style={{ fontWeight: 700, color: q <= 5 && q > 0 ? T.danger : q === 0 ? T.textLight : T.text }}>{q}{q > 0 && q <= 5 && " ⚠"}</span></div>
            ); })}
          </Card>
        ); })}
      </div>}
    </div>
  );

  // ── ANALYTICS (with delivery funnel signature) ──
  const outcomes = [
    { v: funnel.delivered, c: "#1a7a4c", t: "Delivered" },
    { v: funnel.failed, c: "#b91c1c", t: "Failed / cancelled" },
    { v: funnel.inProgress, c: "#f59e0b", t: "In progress" },
    { v: funnel.neverReached, c: "#94a3b8", t: "Never reached" },
  ];
  const outTot = funnel.placed || 1;
  const AnalyticsScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Analytics</h1><div className="cx-sub">{country === "ghana" ? "Ghana" : "Nigeria"} · order-to-doorstep performance</div></div>
      </div>
      <StatsStrip />

      {/* signature delivery funnel */}
      <Card className="cx-funnel" style={{ marginBottom: "14px" }}>
        <div className="lead">
          <span className="big cx-num">{funnel.placed > 0 ? Math.round(funnel.delivered / funnel.placed * 100) : 0}%</span>
          <div><div className="cx-section-t">Order-to-doorstep</div>
            <div className="cx-sub">{funnel.delivered} of {funnel.placed} orders delivered · where the rest leaked</div></div>
        </div>
        <div className="cx-steps">
          <div className="cx-step"><div className="n cx-num">{funnel.placed}</div><div className="lbl">Orders placed</div></div>
          <div className="cx-leak"><span className="arr">→</span>{funnel.neverReached > 0 && <span className="chip">−{funnel.neverReached} unreached</span>}</div>
          <div className="cx-step"><div className="n cx-num">{funnel.reached}</div><div className="lbl">Reached</div></div>
          <div className="cx-leak"><span className="arr">→</span>{(funnel.reached - funnel.delivered) > 0 && <span className="chip">−{funnel.reached - funnel.delivered} not delivered</span>}</div>
          <div className="cx-step"><div className="n cx-num" style={{ color: T.accent }}>{funnel.delivered}</div><div className="lbl">Delivered</div></div>
        </div>
        <div className="cx-outbar">
          {outcomes.map(o => o.v > 0 && <div key={o.t} className="s" style={{ width: (o.v / outTot) * 100 + "%", background: o.c }} title={`${o.t}: ${o.v}`} />)}
        </div>
        <div className="cx-legend">
          {outcomes.map(o => <span key={o.t}><i style={{ background: o.c }} />{o.t} · {o.v}</span>)}
        </div>
      </Card>

      <div className="cx-grid" style={{ gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr" }}>
        <Card style={{ padding: "18px" }}>
          <div className="cx-section-t" style={{ marginBottom: "12px" }}>Status breakdown</div>
          {STATUSES.map(s => { const c = statsOrders.filter(o => o.status === s.value).length; const p = statsOrders.length > 0 ? c / statsOrders.length * 100 : 0; return (
            <div key={s.value} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
              <span style={{ width: isMobile ? "80px" : "110px", fontSize: "11px", color: T.textMuted, fontWeight: 600 }}>{s.icon} {s.label}</span>
              <div style={{ flex: 1, background: T.surfaceAlt, borderRadius: "5px", height: "18px", overflow: "hidden" }}><div style={{ width: `${p}%`, background: s.color, height: "100%", borderRadius: "5px", minWidth: c > 0 ? "2px" : 0 }} /></div>
              <span className="cx-num" style={{ width: "35px", textAlign: "right", fontWeight: 800 }}>{c}</span>
            </div>
          ); })}
        </Card>
        <Card style={{ padding: "18px" }}>
          <div className="cx-section-t" style={{ marginBottom: "12px" }}>Revenue</div>
          <div style={{ display: "grid", gap: "10px" }}>
            {[{ l: "Collected", v: stats.rev, c: "#1a7a4c", bg: T.accentLight }, { l: "Delivery fees", v: stats.fees, c: T.danger, bg: T.dangerBg }, { l: "Net remittance", v: stats.net, c: "#1d4ed8", bg: "#e8f1ff" }].map(r => <div key={r.l} style={{ padding: "14px 16px", background: r.bg, borderRadius: T.r, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "12px", color: r.c, fontWeight: 700 }}>{r.l}</span><span className="cx-num" style={{ fontSize: "20px", fontWeight: 800, color: r.c }}>{cur}{r.v.toLocaleString()}</span></div>)}
          </div>
        </Card>
        <Card style={{ padding: "18px", gridColumn: isMobile ? "auto" : "1/-1" }}>
          <div className="cx-section-t" style={{ marginBottom: "12px" }}>By {country === "ghana" ? "region" : "state"}</div>
          {states.length === 0 && <div style={{ color: T.textMuted, fontSize: "13px" }}>No data yet.</div>}
          {states.map(st => { const so = statsOrders.filter(o => o.state === st); const d = so.filter(o => o.status === "delivered").length; const p = statsOrders.length > 0 ? so.length / statsOrders.length * 100 : 0; return (
            <div key={st} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}><span style={{ width: isMobile ? "90px" : "150px", fontSize: "11px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st}</span><div style={{ flex: 1, background: T.surfaceAlt, borderRadius: "4px", height: "14px", overflow: "hidden" }}><div style={{ width: `${p}%`, background: T.accent, height: "100%", borderRadius: "4px", minWidth: so.length > 0 ? "2px" : 0 }} /></div><span className="cx-num" style={{ width: "25px", textAlign: "right", fontWeight: 800, fontSize: "12px" }}>{so.length}</span><span style={{ width: "50px", textAlign: "right", fontSize: "10px", color: T.textMuted }}>{d} done</span></div>
          ); })}
        </Card>
      </div>
    </div>
  );

  // ── TEMPLATES ──
  const TemplatesScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Messages</h1><div className="cx-sub">WhatsApp templates per status</div></div>
      </div>
      <Card style={{ padding: "12px 16px", marginBottom: "12px", fontSize: "12px", color: T.textMuted }}><strong>Placeholders:</strong> {["{name}","{product}","{address}","{price}","{qty}","{state}","{agent}","{pack}","{phone}","{notes}"].map(p => <code key={p} style={{ marginLeft: "3px", color: T.accent, fontWeight: 700 }}>{p}</code>)}</Card>
      <div style={{ display: "grid", gap: "10px" }}>{STATUSES.map(s => <Card key={s.value} style={{ padding: "14px" }}>
        <div style={{ marginBottom: "8px" }}><Pill status={s.value} /></div>
        <textarea value={templates[s.value] || ""} onChange={e => doSaveTemplate(s.value, e.target.value)} rows={3} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", fontFamily: T.f, resize: "vertical", boxSizing: "border-box", outline: "none", background: T.surfaceAlt, lineHeight: 1.5 }} />
      </Card>)}</div>
    </div>
  );

  const screen = { orders: OrdersScreen, agents: AgentsScreen, inventory: InventoryScreen, analytics: AnalyticsScreen, templates: TemplatesScreen }[tab] || OrdersScreen;

  const CountrySeg = ({ inRail }) => (
    <div className="cx-seg2" style={inRail ? { background: "rgba(255,255,255,0.07)", border: "none" } : {}}>
      {[{ v: "nigeria", f: "🇳🇬", l: "NG" }, { v: "ghana", f: "🇬🇭", l: "GH" }].map(c => (
        <button key={c.v} className={country === c.v ? "on" : ""} onClick={() => setCountrySafe(c.v)} style={inRail ? { color: country === c.v ? "#fff" : "rgba(255,255,255,0.55)", background: country === c.v ? "rgba(255,255,255,0.15)" : "transparent" } : {}}>
          {c.f} {c.l} <span style={{ fontSize: "10px", fontWeight: 800, opacity: 0.7 }}>{orders.filter(o => o.country === c.v).length}</span>
        </button>
      ))}
    </div>
  );

  // ═══════════════════════════════════════════════
  // MODALS (shared between layouts)
  // ═══════════════════════════════════════════════
  const modals = (
    <>
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import orders">
        <p style={{ fontSize: "13px", color: T.textMuted, marginBottom: "12px" }}>Upload a WPForms CSV. Auto-detects Nigeria/Ghana.</p>
        <div style={{ marginBottom: "12px" }}><label style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, display: "block", marginBottom: "4px", textTransform: "uppercase" }}>Country</label>
          <select value={importCountry} onChange={e => setImportCountry(e.target.value)} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}><option value="auto">Auto-detect</option><option value="nigeria">🇳🇬 Nigeria</option><option value="ghana">🇬🇭 Ghana</option></select></div>
        <input type="file" accept=".csv" onChange={doImport} style={{ width: "100%", padding: "16px", border: `2px dashed ${T.border}`, borderRadius: T.r, fontSize: "13px", cursor: "pointer", boxSizing: "border-box", background: T.surfaceAlt }} />
        {saving && <div style={{ textAlign: "center", marginTop: "12px", color: T.accent, fontWeight: 700 }}>Importing…</div>}
      </Modal>

      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)} title="Order details" wide>
        {viewOrder && (() => { const o = orders.find(x => x.id === viewOrder.id) || viewOrder; return <div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
            {[{ l: "Customer", v: o.name }, { l: "Phone", v: cleanPhone(o.phone) }, { l: "WhatsApp", v: cleanPhone(o.whatsapp || o.phone) }, { l: country === "ghana" ? "Region" : "State", v: o.state }].map(f => <div key={f.l}><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>{f.l}</div><div style={{ fontWeight: 600, fontSize: "14px" }}>{f.v}</div></div>)}
            <div style={{ gridColumn: "1/-1" }}><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Address</div><div style={{ fontSize: "13px" }}>{o.address}</div></div>
            <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Product</div><div style={{ fontWeight: 700 }}>{o.product} — {o.pack_name} (×{o.qty})</div></div>
            <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Price</div><div className="cx-num" style={{ fontWeight: 800, fontSize: "16px" }}>{cur}{(o.price || 0).toLocaleString()}</div></div>
            {o.notes && <div style={{ gridColumn: "1/-1", background: T.warningBg, padding: "10px 12px", borderRadius: T.rs }}><div style={{ fontSize: "10px", color: T.warning, textTransform: "uppercase", fontWeight: 700 }}>Notes</div><div style={{ fontSize: "13px", color: "#92400e" }}>{o.notes}</div></div>}
          </div>
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "12px" }}><div style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "6px", textTransform: "uppercase" }}>Send WhatsApp</div><div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>{STATUSES.map(s => <a key={s.value} href={getWALink(o, s.value)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><Btn v={o.status === s.value ? "whatsapp" : "secondary"} sz="sm" style={{ fontSize: "11px" }}>{s.icon} {s.label}</Btn></a>)}</div></div>
        </div>; })()}
      </Modal>

      <Modal open={!!editOrder} onClose={() => setEditOrder(null)} title="Edit order" wide>
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
          <Inp label="Qty delivered" type="number" value={editOrder.actual_qty_delivered} onChange={e => setEditOrder(p => ({ ...p, actual_qty_delivered: +e.target.value || 0 }))} />
          <Inp label={`Collected (${cur})`} type="number" value={editOrder.actual_price_collected} onChange={e => setEditOrder(p => ({ ...p, actual_price_collected: +e.target.value || 0 }))} />
          <Inp label={`Delivery fee (${cur})`} type="number" value={editOrder.delivery_fee} onChange={e => setEditOrder(p => ({ ...p, delivery_fee: +e.target.value || 0 }))} />
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Agent</label>
            <select value={editOrder.agent_id || ""} onChange={e => { const a = agents.find(x => x.id === e.target.value); setEditOrder(p => ({ ...p, agent_id: e.target.value || null, agent_name: a?.name || "" })); }} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>
              <option value="">Unassigned</option>
              {cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Status</label>
            <select value={editOrder.status} onChange={e => setEditOrder(p => ({ ...p, status: e.target.value }))} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>{GROUPS.map(g => <optgroup key={g.id} label={g.label}>{STATUSES.filter(s => s.group === g.id).map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</optgroup>)}</select></div>
          <div style={{ gridColumn: "1/-1" }}><Inp label="Notes" value={editOrder.notes} onChange={e => setEditOrder(p => ({ ...p, notes: e.target.value }))} /></div>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}><Btn onClick={() => doSaveOrder(editOrder)} style={{ flex: 1, justifyContent: "center" }}>Save</Btn><Btn v="secondary" onClick={() => setEditOrder(null)}>Cancel</Btn></div>
        </div>}
      </Modal>

      <Modal open={!!showAssign} onClose={() => setShowAssign(null)} title="Assign agent">
        {cAgents.length === 0 ? <p style={{ color: T.textMuted, textAlign: "center", padding: "20px" }}>No agents yet.</p> : <div style={{ display: "grid", gap: "6px" }}>
          {cAgents.map(a => <button key={a.id} onClick={() => doAssign(showAssign, a.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: T.surfaceAlt, border: `1.5px solid ${T.border}`, borderRadius: T.r, cursor: "pointer", fontFamily: T.f, width: "100%", textAlign: "left" }}><div><div style={{ fontWeight: 700 }}>{a.name}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{(a.states || []).join(", ")}</div></div><span className="cx-num" style={{ fontWeight: 800, color: T.accent }}>{agentSt[a.id]?.rate || "—"}%</span></button>)}
        </div>}
      </Modal>

      <Modal open={showAddAgent} onClose={() => setShowAddAgent(false)} title="Add agent">
        <AgentForm onSubmit={doAddAgent} country={country} />
      </Modal>

      <Modal open={showAddProduct} onClose={() => setShowAddProduct(false)} title="Add product">
        <ProductForm onSubmit={doAddProduct} />
      </Modal>

      <Modal open={showAddOrder} onClose={() => setShowAddOrder(false)} title="Add order" wide>
        <OrderForm country={country} cur={cur} onSubmit={doAddOrder} />
      </Modal>

      <Modal open={!!showStock} onClose={() => setShowStock(null)} title={`Stock — ${agents.find(a => a.id === showStock)?.name || ""}`}>
        {showStock && <StockMgr agentId={showStock} products={products} inventory={inventory} onUpdate={doUpdateStock} />}
      </Modal>
    </>
  );

  // ═══════════════════════════════════════════════
  // MOBILE LAYOUT
  // ═══════════════════════════════════════════════
  if (isMobile) {
    return (
      <div className="cx-app" style={{ minHeight: "100vh", paddingBottom: "70px" }}>
        <link href={FONTS} rel="stylesheet" />
        <style>{CSS}</style>
        <div className="cx-mobitop">
          <span className="cx-logo" style={{ width: "30px", height: "30px" }}><Store size={16} /></span>
          <b style={{ fontFamily: T.fd, fontSize: "16px" }}>Infinistores</b>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            {saving && <span style={{ fontSize: "11px", fontWeight: 700, color: "#86efac" }}>Saving…</span>}
            {syncError && <span onClick={() => { setSyncError(false); loadAll(); }} style={{ fontSize: "11px", fontWeight: 700, color: "#fca5a5" }}>⚠ Offline</span>}
            <CountrySeg inRail />
            <button onClick={() => { sessionStorage.removeItem("tweb-auth-ts"); setAuthed(false); }} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.7)", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}><LogOut size={15} /></button>
          </div>
        </div>
        <div className="cx-content" style={{ padding: "16px 14px 24px" }}>{screen}</div>

        <div className="cx-bottomnav">
          {navFlat.map(n => { const Ic = n.icon; return (
            <button key={n.id} className={`cx-bn ${tab === n.id ? "on" : ""}`} onClick={() => setTab(n.id)}>
              <Ic size={20} /><span>{n.label}</span>
            </button>
          ); })}
        </div>

        {modals}
        <Toasts toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // DESKTOP LAYOUT
  // ═══════════════════════════════════════════════
  return (
    <div className="cx-app">
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div className={`cx-shell ${collapsed ? "collapsed" : ""}`}>
        <aside className="cx-side">
          <div className="cx-brand">
            <span className="cx-logo"><Store size={17} /></span>
            <b>Infinistores</b>
            <button className="cx-collapse" onClick={() => setCollapsed(c => !c)} title="Collapse">{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          </div>
          <nav className="cx-navwrap">
            {NAV.map(group => (
              <div key={group.sec}>
                <div className="cx-navlabel">{group.sec}</div>
                {group.items.map(n => { const Ic = n.icon; return (
                  <button key={n.id} className={`cx-nav ${tab === n.id ? "on" : ""}`} onClick={() => setTab(n.id)} title={n.label}>
                    <Ic size={18} /><span>{n.label}</span>{n.count !== undefined && <span className="cnt">{n.count}</span>}
                  </button>
                ); })}
              </div>
            ))}
          </nav>
          <div className="cx-storecard">
            <span className="cx-storeic"><Store size={15} /></span>
            <div><b>Infinistores</b><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>NG · GH</div></div>
          </div>
        </aside>

        <div className="cx-main">
          <header className="cx-top">
            <div className="cx-searchbar">
              <Search size={16} />
              <input placeholder="Search orders…" value={search} onChange={e => { setSearch(e.target.value); if (tab !== "orders") setTab("orders"); }} />
            </div>
            <div style={{ flex: 1 }} />
            {saving && <span style={{ color: T.accent, fontSize: "12px", fontWeight: 700, background: T.accentLight, padding: "5px 11px", borderRadius: "8px" }}>Saving…</span>}
            {syncError && <span onClick={() => { setSyncError(false); loadAll(); }} style={{ color: T.danger, fontSize: "12px", fontWeight: 700, background: T.dangerBg, padding: "5px 11px", borderRadius: "8px", cursor: "pointer" }}>⚠ Offline</span>}
            <CountrySeg />
            <button className="cx-iconbtn" onClick={() => { setSyncError(false); loadAll(); }} title="Refresh"><RefreshCw size={16} /></button>
            <button className="cx-iconbtn" onClick={() => { sessionStorage.removeItem("tweb-auth-ts"); setAuthed(false); }} title="Lock"><LogOut size={16} /></button>
          </header>
          <div className="cx-content">{screen}</div>
        </div>
      </div>

      {modals}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ═══════════════════════════════════════════════
// FORM COMPONENTS
// ═══════════════════════════════════════════════

function AgentForm({ onSubmit, country }) {
  const [n, sN] = useState(""); const [p, sP] = useState(""); const [s, sS] = useState("");
  return <div><Inp label="Name" value={n} onChange={e => sN(e.target.value)} /><Inp label="Phone" value={p} onChange={e => sP(e.target.value)} /><Inp label={`${country === "ghana" ? "Regions" : "States"} (comma-separated)`} value={s} onChange={e => sS(e.target.value)} /><Btn onClick={() => { if (n) onSubmit({ name: n, phone: p, states: s.split(",").map(x => x.trim()).filter(Boolean) }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Add agent</Btn></div>;
}

function ProductForm({ onSubmit }) {
  const [n, sN] = useState("");
  return <div><Inp label="Product name" value={n} onChange={e => sN(e.target.value)} /><Btn onClick={() => { if (n) onSubmit(n); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Add product</Btn></div>;
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
    {err && <div style={{ gridColumn: "1/-1", color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>{err}</div>}
    <div style={{ gridColumn: "1/-1" }}><Btn onClick={handleSubmit} style={{ width: "100%", justifyContent: "center" }}>Add order</Btn></div>
  </div>;
}

function StockItem({ agentId, product, qty, onUpdate }) {
  const [local, setLocal] = useState(qty);
  useEffect(() => { setLocal(qty); }, [qty]);
  const commit = (val) => { const n = Math.max(0, val); setLocal(n); onUpdate(agentId, product, n); };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: T.surfaceAlt, borderRadius: T.rs, flexWrap: "wrap", gap: "6px" }}>
      <div style={{ fontWeight: 700, fontSize: "13px" }}>{product}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {[-5, -1].map(d => <button key={d} onClick={() => commit(local + d)} style={{ padding: "4px 8px", borderRadius: "6px", border: `1.5px solid ${T.border}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: T.f }}>{d}</button>)}
        <input type="number" value={local} onChange={e => setLocal(+e.target.value || 0)} onBlur={() => commit(local)} style={{ width: "50px", textAlign: "center", padding: "5px", border: `1.5px solid ${T.border}`, borderRadius: "6px", fontWeight: 800, fontFamily: T.fd, fontSize: "14px" }} />
        {[1, 5, 10].map(d => <button key={d} onClick={() => commit(local + d)} style={{ padding: "4px 8px", borderRadius: "6px", border: `1.5px solid ${T.border}`, background: d === 10 ? T.accent : "#fff", color: d === 10 ? "#fff" : T.text, cursor: "pointer", fontWeight: 700, fontSize: "11px", fontFamily: T.f }}>+{d}</button>)}
      </div>
    </div>
  );
}

function StockMgr({ agentId, products, inventory, onUpdate }) {
  const getQ = pid => inventory.find(i => i.agent_id === agentId && i.product_name === pid)?.qty || 0;
  return products.length === 0 ? <p style={{ color: T.textMuted, textAlign: "center", padding: "20px" }}>No products yet.</p> : (
    <div style={{ display: "grid", gap: "8px" }}>
      {products.map(p => <StockItem key={p.id} agentId={agentId} product={p.name} qty={getQ(p.name)} onUpdate={onUpdate} />)}
    </div>
  );
}
