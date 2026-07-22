import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, ClipboardList, Boxes, Truck, MessageSquare,
  Search, Bell, ChevronDown, PanelLeftClose, PanelLeftOpen,
  Phone, MessageCircle, Plus, ArrowUpRight, ArrowDownRight,
  Store, RefreshCw, LogOut, Upload, Download, Users, Pencil, Trash2, X,
  Package, TrendingUp, Wallet, CheckCircle2, Clock, Filter,
  Copy, UserPlus, AlertTriangle
} from "lucide-react";

/*
 * INFINISTORES CRM v5 — Supabase Edition
 * Design system v2: deep-green command rail + delivery funnel.
 * Real-time database, multi-device, mobile-first.
 */

// Env vars override (used by local .env to point at staging); production has
// none set on Vercel, so it falls back to the hardcoded prod values below.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://amdcmtfuytnplrzxabip.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_vQ7vHaXXhmLprI6Ph07cDA_wbXkLhB2";

// ═══════════════════════════════════════════════
// SUPABASE CLIENT (lightweight, no SDK needed)
// ═══════════════════════════════════════════════

// Current user's access token (set after login); data calls use it as the
// bearer so RLS can scope by user. Falls back to the anon key when logged out.
let authToken = null;

const sb = {
  get headers() { return { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${authToken || SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" }; },
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
  async upsert(table, data, onConflict) {
    const q = onConflict ? `?on_conflict=${onConflict}` : "";
    const r = await this.fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, { method: "POST", headers: { ...this.headers, "Prefer": "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(Array.isArray(data) ? data : [data]) });
    if (!r.ok) { const e = await r.text(); throw new Error(`Failed to save (${r.status}): ${e}`); }
    return r.json();
  }
};

// ═══════════════════════════════════════════════
// AUTH (Supabase Auth via REST — no SDK)
// ═══════════════════════════════════════════════
const AUTH_KEY = "inf-session";
const auth = {
  session: null,
  load() {
    try { const s = JSON.parse(localStorage.getItem(AUTH_KEY)); if (s?.access_token) { this.session = s; authToken = s.access_token; } } catch (e) {}
    return this.session;
  },
  save(d) {
    this.session = d ? { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, user: d.user } : null;
    authToken = d?.access_token || null;
    if (d) localStorage.setItem(AUTH_KEY, JSON.stringify(this.session)); else localStorage.removeItem(AUTH_KEY);
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || d.error || "Sign in failed");
    this.save(d);
    return d;
  },
  async refresh() {
    if (!this.session?.refresh_token) return false;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
      if (!r.ok) { this.save(null); return false; }
      this.save(await r.json());
      return true;
    } catch (e) { return false; }
  },
  async ensureFresh() {
    if (!this.session) return false;
    const expMs = (this.session.expires_at || 0) * 1000;
    if (Date.now() > expMs - 60000) return await this.refresh();
    return true;
  },
  async getUser() {
    if (!authToken) return null;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${authToken}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (this.session) { this.session.user = u; localStorage.setItem(AUTH_KEY, JSON.stringify(this.session)); }
    return u;
  },
  async recover(email) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.msg || d.error_description || "Could not send the reset email"); }
  },
  async setPassword(password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { method: "PUT", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.msg || d.error_description || d.error || "Could not set password");
    return d;
  },
  signOut() { this.save(null); },
};

// Parse the auth tokens an invite/recovery email drops in the URL hash
function parseAuthHash() {
  const h = window.location.hash;
  if (!h || h.length < 2) return null;
  const p = new URLSearchParams(h.slice(1));
  const access_token = p.get("access_token");
  if (!access_token) return null;
  return {
    access_token,
    refresh_token: p.get("refresh_token"),
    expires_at: p.get("expires_at") ? +p.get("expires_at") : Math.floor(Date.now() / 1000) + (+(p.get("expires_in") || 3600)),
    type: p.get("type"),
  };
}

// Role → capability map (drives UI gating; RLS enforces the same server-side)
const CAPS = {
  admin:      { orders: "edit", del: true, inventory: "edit", agents: "edit", analytics: true, staff: true, settings: true },
  manager:    { orders: "edit", del: true, inventory: "edit", agents: "edit", analytics: true, staff: false, settings: true },
  accountant: { orders: "view", del: false, inventory: "view", agents: "view", analytics: true, staff: false, settings: false },
  caller:     { orders: "edit", del: false, inventory: "view", agents: "view", analytics: false, staff: false, settings: false },
  viewer:     { orders: "view", del: false, inventory: "view", agents: "view", analytics: false, staff: false, settings: false },
};
const capsFor = role => CAPS[role] || CAPS.viewer;

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
  // In progress
  { value: "pending", label: "Pending", group: "progress", color: "#b45309", bg: "#fff4e8", icon: "⏳" },
  { value: "confirmed", label: "Confirmed", group: "progress", color: "#1d4ed8", bg: "#e8f1ff", icon: "✓" },
  { value: "in_transit", label: "In Transit", group: "progress", color: "#0e7490", bg: "#e0f2fe", icon: "🚚" },
  { value: "call_back", label: "Call Back", group: "progress", color: "#4338ca", bg: "#eef0ff", icon: "📞" },
  { value: "follow_up", label: "Follow Up", group: "progress", color: "#0f766e", bg: "#e6f5f3", icon: "🔁" },
  { value: "postponed", label: "Postponed", group: "progress", color: "#6d28d9", bg: "#f3ecfe", icon: "⏸" },
  // Couldn't reach
  { value: "not_reachable", label: "Not Reachable", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "📵" },
  { value: "number_busy", label: "Number Busy", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "📳" },
  { value: "switched_off", label: "Switched Off", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "📴" },
  { value: "not_answering", label: "Not Answering", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "🔕" },
  { value: "not_available", label: "Not Available", group: "noreach", color: "#475569", bg: "#eef1f5", icon: "🚫" },
  // Didn't go through
  { value: "cancelled", label: "Cancelled", group: "failed", color: "#b91c1c", bg: "#fdecec", icon: "✕" },
  { value: "rejected", label: "Rejected", group: "failed", color: "#9f1239", bg: "#fff1f2", icon: "🙅" },
  { value: "failed_delivery", label: "Failed Delivery", group: "failed", color: "#9f1239", bg: "#fff1f2", icon: "❌" },
  { value: "out_of_stock", label: "Out of Stock", group: "failed", color: "#546e7a", bg: "#eceff1", icon: "📦" },
  // Completed
  { value: "delivered", label: "Delivered", group: "done", color: "#15673f", bg: "#e9f4ee", icon: "✅" },
];

const getStatus = v => STATUSES.find(s => s.value === v) || STATUSES[0];

// ── Phase 7: Caller workflow (feature-flagged; dark in prod until VITE_FEATURE_CALLER=true) ──
const FEATURE_CALLER = import.meta.env.VITE_FEATURE_CALLER === "true";
const STALE_HOURS = 48; // an In Transit order older than this shows on the chase-up list

// status → effectiveness stage (report-only grouping; separate from the dropdown GROUPS)
const STAGE_OF = {
  pending: "in_progress", call_back: "in_progress", postponed: "in_progress", follow_up: "in_progress",
  confirmed: "moving", in_transit: "moving",
  delivered: "delivered",
  not_reachable: "lost_on_call", number_busy: "lost_on_call", switched_off: "lost_on_call",
  not_answering: "lost_on_call", not_available: "lost_on_call", cancelled: "lost_on_call", rejected: "lost_on_call",
  failed_delivery: "lost_on_delivery",
  out_of_stock: "unfulfilled",
};
const CALLER_QUEUE_STATUSES = ["pending", "call_back", "postponed", "follow_up"];

// One order → clean WhatsApp-group payload for the clipboard
function orderClipboard(o, cur) {
  const wa = cleanPhone(o.whatsapp);
  const stateLabel = o.country === "ghana" ? "Region" : "State";
  return [
    `NEW ORDER — ${o.product || ""} x${o.qty || 1}`,
    `Name: ${o.name || ""}`,
    `Phone: ${cleanPhone(o.phone)}`,
    wa && wa !== cleanPhone(o.phone) ? `WhatsApp: ${wa}` : null,
    `Address: ${o.address || ""}`,
    o.landmark ? `Landmark: ${o.landmark}` : null,
    o.state ? `${stateLabel}: ${o.state}` : null,
    `Amount to collect: ${cur}${(o.price || 0).toLocaleString()}`,
    o.notes ? `Note: ${o.notes}` : null,
  ].filter(Boolean).join("\n");
}

const WB_STATUS = {
  pending: { label: "Pending", color: "#b45309", bg: "#fff4e8" },
  in_transit: { label: "In transit", color: "#1d4ed8", bg: "#e8f1ff" },
  delivered: { label: "Delivered", color: "#15673f", bg: "#e9f4ee" },
};

// ═══════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════

function parsePackage(pkg, country) {
  if (!pkg) return { packName: "", qty: 1, price: 0 };
  if (country === "ghana") {
    const qm = pkg.match(/Buy\s+(\d+)/i), pm = pkg.match(/=\s*GH₵([\d,]+)/);
    return { packName: `Buy ${qm?.[1] || 1} Pack`, qty: qm ? +qm[1] : 1, price: pm ? +pm[1].replace(/,/g, "") : 0 };
  }
  // Handles both "Buy 3 ... = ₦28,000 (...)" and "Product (10 Net ...) = ₦12,000"
  const qtyM = pkg.match(/buy\s+(\d+)/i) || pkg.match(/\((\d+)\s+/);
  const priceM = pkg.match(/₦\s*([\d,]+)/), nm = pkg.match(/^([^=(]+)/);
  return { packName: (nm ? nm[1] : pkg).trim(), qty: qtyM ? +qtyM[1] : 1, price: priceM ? +priceM[1].replace(/,/g, "") : 0 };
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

// ─── Delivery-date helpers ───
// Parse "MM/DD/YYYY", "YYYY-MM-DD", or anything Date can read → Date | null
function parseDateStr(s) {
  if (!s) return null;
  const mdy = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
// Concrete delivery date for an order: explicit date wins; otherwise derive
// from the "Today"/"Tomorrow" preference relative to when it was ordered.
function deliveryDateOf(o) {
  const explicit = parseDateStr(o.delivery_date);
  if (explicit) return explicit;
  const pref = (o.delivery_pref || "").toLowerCase();
  const base = o.created_at ? new Date(o.created_at) : new Date();
  if (pref.includes("today")) return new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (pref.includes("tomorrow")) { const d = new Date(base.getFullYear(), base.getMonth(), base.getDate()); d.setDate(d.getDate() + 1); return d; }
  return null;
}
function toISODate(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : parseDateStr(d);
  if (!x || isNaN(x)) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function fmtDate(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : parseDateStr(d);
  if (!x || isNaN(x)) return "";
  return x.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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

// Demand-relative stock signal shown on an order (state × product).
// signal = { kind: "ok"|"short"|"none"|"noagent", supply, demand, state }
function StockBadge({ signal }) {
  if (!signal) return null;
  const meta = {
    ok:      { bg: T.accentLight, color: T.accentDark, text: `In stock · ${signal.supply}` },
    short:   { bg: T.warningBg,   color: T.warning,    text: `Low · ${signal.supply} left, ${signal.demand} needed` },
    none:    { bg: T.dangerBg,    color: T.danger,     text: "Out of stock" },
    noagent: { bg: T.surfaceAlt,  color: T.textMuted,  text: `No agent in ${signal.state || "state"}` },
  }[signal.kind];
  if (!meta) return null;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: "6px", whiteSpace: "nowrap" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: meta.color, flexShrink: 0 }} />{meta.text}</span>;
}

// ── CSV export (dependency-free; opens in Excel / Google Sheets) ──
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(columns, rows) {
  const head = columns.map(c => csvCell(c.label)).join(",");
  const body = rows.map(r => columns.map(c => csvCell(c.get(r))).join(",")).join("\n");
  return head + "\n" + body;
}
function downloadCSV(filename, csv) {
  // Leading BOM so Excel reads UTF-8 (naira sign, accented names) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

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

function SetPasswordScreen({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setError("Passwords don't match."); return; }
    setBusy(true); setError("");
    try { await auth.setPassword(pw); await onDone(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const inp = { width: "100%", padding: "12px 13px", border: `1.5px solid ${T.border}`, borderRadius: "10px", fontSize: "14px", outline: "none", fontFamily: T.f, boxSizing: "border-box", marginBottom: "10px", background: "#fff", color: T.text };
  return (
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div style={{ background: "#fff", borderRadius: "18px", padding: "36px 32px", width: "360px", boxShadow: T.shl }}>
        <div style={{ textAlign: "center", marginBottom: "22px" }}>
          <div style={{ width: "52px", height: "52px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "#fff" }}><Store size={26} /></div>
          <div style={{ fontFamily: T.fd, fontWeight: 800, fontSize: "22px", color: T.text, marginBottom: "6px" }}>Welcome to Infinistores</div>
          <div style={{ color: T.textMuted, fontSize: "13px" }}>Set a password to finish setting up your account</div>
        </div>
        <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={e => { setPw(e.target.value); setError(""); }} onKeyDown={e => e.key === "Enter" && submit()} style={inp} />
        <input type="password" autoComplete="new-password" placeholder="Confirm password" value={pw2} onChange={e => { setPw2(e.target.value); setError(""); }} onKeyDown={e => e.key === "Enter" && submit()} style={inp} />
        {error && <div style={{ color: T.danger, fontSize: "12px", margin: "2px 0 10px", fontWeight: 700 }}>{error}</div>}
        <button onClick={submit} disabled={busy}
          style={{ width: "100%", padding: "13px", background: busy ? T.textLight : `linear-gradient(135deg,${T.accent},${T.accentDark})`, color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: T.f, marginTop: "4px" }}>{busy ? "Saving…" : "Set password & continue"}</button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await auth.signIn(email.trim(), password);
      await onLogin();
    } catch (e) {
      setError(e.message === "Invalid login credentials" ? "Wrong email or password." : e.message);
      setBusy(false);
    }
  };
  const forgot = async () => {
    if (!email.trim()) { setError("Enter your email above first, then tap “Forgot password?”"); return; }
    setBusy(true); setError(""); setNotice("");
    try { await auth.recover(email.trim()); setNotice("Reset link sent — check your email."); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  const inp = { width: "100%", padding: "12px 13px", border: `1.5px solid ${T.border}`, borderRadius: "10px", fontSize: "14px", outline: "none", fontFamily: T.f, boxSizing: "border-box", marginBottom: "10px", background: "#fff", color: T.text };
  return (
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div style={{ background: "#fff", borderRadius: "18px", padding: "36px 32px", width: "360px", boxShadow: T.shl }}>
        <div style={{ textAlign: "center", marginBottom: "22px" }}>
          <div style={{ width: "52px", height: "52px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "#fff" }}><Store size={26} /></div>
          <div style={{ fontFamily: T.fd, fontWeight: 800, fontSize: "22px", color: T.text, marginBottom: "6px" }}>Infinistores</div>
          <div style={{ color: T.textMuted, fontSize: "13px" }}>Sign in to continue</div>
        </div>
        <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }} onKeyDown={e => e.key === "Enter" && submit()} style={inp} />
        <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => { setPassword(e.target.value); setError(""); }} onKeyDown={e => e.key === "Enter" && submit()} style={inp} />
        {error && <div style={{ color: T.danger, fontSize: "12px", margin: "2px 0 10px", fontWeight: 700 }}>{error}</div>}
        {notice && <div style={{ color: T.accent, fontSize: "12px", margin: "2px 0 10px", fontWeight: 700 }}>{notice}</div>}
        <button onClick={submit} disabled={busy}
          style={{ width: "100%", padding: "13px", background: busy ? T.textLight : `linear-gradient(135deg,${T.accent},${T.accentDark})`, color: "#fff", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: T.f, marginTop: "4px" }}>{busy ? "Signing in…" : "Sign in"}</button>
        <button onClick={forgot} disabled={busy} style={{ width: "100%", padding: "10px", background: "none", border: "none", color: T.textMuted, fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: T.f, marginTop: "6px" }}>Forgot password?</button>
      </div>
    </div>
  );
}

// ── Shared blocks (top-level so they keep identity across renders; defining
//    these inside the main component made React remount them on every state
//    change — e.g. the custom date inputs lost focus while typing) ──

function PeriodFilter({ range, setRange, from, setFrom, to, setTo }) {
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
      <span className="cx-eyebrow" style={{ marginRight: "2px" }}>Period</span>
      {[{ v: "today", l: "Today" }, { v: "week", l: "Week" }, { v: "lastweek", l: "Last week" }, { v: "month", l: "Month" }, { v: "lastmonth", l: "Last month" }, { v: "30d", l: "30d" }, { v: "90d", l: "90d" }, { v: "all", l: "All time" }, { v: "custom", l: "Custom" }].map(r => (
        <button key={r.v} onClick={() => setRange(r.v)} style={{ padding: "5px 13px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, fontFamily: T.f, cursor: "pointer", border: "none", background: range === r.v ? T.accent : T.surface, color: range === r.v ? "#fff" : T.textMuted, boxShadow: range === r.v ? "none" : `0 0 0 1.5px ${T.border}` }}>{r.l}</button>
      ))}
      {range === "custom" && <>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "12px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
        <span style={{ fontSize: "12px", color: T.textMuted }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: "5px 10px", borderRadius: T.rs, fontSize: "12px", border: `1.5px solid ${T.border}`, background: T.surface, fontFamily: T.f }} />
      </>}
    </div>
  );
}

function StatsStrip({ cards, ...period }) {
  return (
    <>
      <PeriodFilter {...period} />
      <div className="cx-grid cx-kpis" style={{ marginBottom: "18px" }}>
        {cards.map(c => <KPI key={c.l} accent={c.accent} v={c.v} l={c.l} d={c.d} dir={c.dir} icon={c.icon} />)}
      </div>
    </>
  );
}

function CountrySeg({ inRail, country, onChange, counts }) {
  return (
    <div className="cx-seg2" style={inRail ? { background: "rgba(255,255,255,0.07)", border: "none" } : {}}>
      {[{ v: "nigeria", f: "🇳🇬", l: "NG" }, { v: "ghana", f: "🇬🇭", l: "GH" }].map(c => (
        <button key={c.v} className={country === c.v ? "on" : ""} onClick={() => onChange(c.v)} style={inRail ? { color: country === c.v ? "#fff" : "rgba(255,255,255,0.55)", background: country === c.v ? "rgba(255,255,255,0.15)" : "transparent" } : {}}>
          {c.f} {c.l} <span style={{ fontSize: "10px", fontWeight: 800, opacity: 0.7 }}>{counts[c.v] || 0}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

export default function InfinistoresCRM() {
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState(null);            // current staff row { role, full_name, ... }
  const [authChecking, setAuthChecking] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const caps = capsFor(me?.role);
  const [orders, setOrders] = useState([]);
  const [agents, setAgents] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [waybills, setWaybills] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [faulty, setFaulty] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [templates, setTemplates] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Ref mirror of `loaded` for use inside the 30s poll: the interval captures
  // loadAll from the render where it was registered, so reading the `loaded`
  // STATE there sees a stale false — which made transient poll failures
  // escalate to the full-screen Connection Error instead of the ⚠ Offline badge.
  const loadedRef = useRef(false);
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
  const [invTab, setInvTab] = useState("products");
  const [collapsed, setCollapsed] = useState(false);
  const [country, setCountry] = useState("nigeria");
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [stateF, setStateF] = useState("all");
  const [agentF, setAgentF] = useState("all");
  const [callerF, setCallerF] = useState("all"); // Phase 7: filter by assigned caller
  const [queueMode, setQueueMode] = useState(true); // Phase 7: caller's focused queue vs all their orders
  const [dupeF, setDupeF] = useState(false);
  const [productF, setProductF] = useState("all");
  const [statsRange, setStatsRange] = useState("all");
  const [statsFrom, setStatsFrom] = useState("");
  const [statsTo, setStatsTo] = useState("");
  const [sel, setSel] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [ordersPage, setOrdersPage] = useState(0);
  const [ordersPageSize, setOrdersPageSize] = useState(50);

  const [viewOrder, setViewOrder] = useState(null);
  const [orderEvents, setOrderEvents] = useState([]);
  const [editOrder, setEditOrder] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAssign, setShowAssign] = useState(null);
  const [assignAll, setAssignAll] = useState(false);
  const [editAgent, setEditAgent] = useState(null);
  const [showStock, setShowStock] = useState(null);
  const [showAddWaybill, setShowAddWaybill] = useState(false);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showAddFaulty, setShowAddFaulty] = useState(false);
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [importCountry, setImportCountry] = useState("auto");

  const cur = country === "ghana" ? "GH₵" : "₦";
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);

  // ─── LOAD ALL DATA ───
  const loadAll = async (retries = 3) => {
    try {
      // If the session can't be refreshed, sign out cleanly — otherwise the
      // queries would run with the anon key and RLS would return empty arrays,
      // showing a logged-in-looking dashboard with zero orders.
      if (auth.session && !(await auth.ensureFresh())) {
        doSignOut();
        showToast("Your session expired — please sign in again.");
        return;
      }
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
      loadedRef.current = true;
      setSyncError(false);
      // Phase 4 tables — best-effort (may not exist in older environments)
      try {
        const [wb, pu, fa, tr] = await Promise.all([
          sb.query("waybills", "order=created_at.desc"),
          sb.query("stock_purchases", "order=created_at.desc"),
          sb.query("faulty_stock", "order=created_at.desc"),
          sb.query("stock_transfers", "order=created_at.desc"),
        ]);
        setWaybills(wb || []); setPurchases(pu || []); setFaulty(fa || []); setTransfers(tr || []);
      } catch { /* inventory tables not present yet */ }
      try { setStaff(await sb.query("staff", "order=created_at.asc") || []); } catch { /* staff table not present yet */ }
    } catch (e) {
      if (!loadedRef.current) {
        if (retries > 1) {
          await new Promise(r => setTimeout(r, 1500));
          return loadAll(retries - 1);
        }
        setLoadError(e.message);
        setLoaded(true);
      } else {
        // Already have data — a failed poll is just a sync hiccup (⚠ Offline badge)
        setSyncError(true);
      }
    }
  };
  // ─── AUTH: current staff + session restore ───
  const loadMe = async () => {
    let uid = auth.session?.user?.id;
    if (!uid) { const u = await auth.getUser(); uid = u?.id; }
    if (!uid) return null;
    try { const [s] = await sb.query("staff", `auth_user_id=eq.${uid}&select=*`); setMe(s || null); return s || null; }
    catch (e) { return null; }
  };

  const onPasswordSet = async () => {
    const s = await loadMe();
    if (!s || !s.active) { auth.signOut(); setNeedsPassword(false); throw new Error("No active staff profile for this account."); }
    setNeedsPassword(false); setAuthed(true);
    await loadAll();
  };

  const onLogin = async () => {
    const s = await loadMe();
    if (!s) { auth.signOut(); throw new Error("No staff profile for this account — contact your admin."); }
    if (!s.active) { auth.signOut(); setMe(null); throw new Error("Your account is inactive."); }
    setAuthed(true);
    await loadAll();
  };

  const doSignOut = () => { auth.signOut(); setAuthed(false); setMe(null); setLoaded(false); loadedRef.current = false; };

  useEffect(() => {
    (async () => {
      // Coming back from an invite / password-recovery email?
      const hash = parseAuthHash();
      if (hash && (hash.type === "invite" || hash.type === "recovery")) {
        auth.save(hash);
        window.history.replaceState(null, "", window.location.pathname);
        setNeedsPassword(true);
        setAuthChecking(false);
        return;
      }
      auth.load();
      if (auth.session) {
        const ok = await auth.ensureFresh();
        if (ok) { const s = await loadMe(); if (s && s.active) { setAuthed(true); await loadAll(); } else auth.signOut(); }
        else auth.signOut();
      }
      setAuthChecking(false);
    })();
  }, []);

  // Auto-refresh every 30s for multi-device sync (only while signed in)
  useEffect(() => { if (!authed) return; const i = setInterval(loadAll, 30000); return () => clearInterval(i); }, [authed]);

  // Load status history when an order detail is opened (best-effort)
  useEffect(() => {
    if (!viewOrder) { setOrderEvents([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const ev = await sb.query("order_status_events", `order_id=eq.${viewOrder.id}&order=changed_at.desc`);
        if (!cancelled) setOrderEvents(ev || []);
      } catch { if (!cancelled) setOrderEvents([]); }
    })();
    return () => { cancelled = true; };
  }, [viewOrder]);

  // ─── Derived ───
  const cOrders = useMemo(() => orders.filter(o => o.country === country), [orders, country]);
  const cAgents = useMemo(() => agents.filter(a => a.country === country), [agents, country]);
  const callers = useMemo(() => staff.filter(s => s.role === "caller" && s.active), [staff]);
  const staffByUid = useMemo(() => { const m = {}; staff.forEach(s => { if (s.auth_user_id) m[s.auth_user_id] = s; }); return m; }, [staff]);

  const dupeMap = useMemo(() => {
    const pm = {}; cOrders.forEach(o => { const k = cleanPhone(o.phone); if (k) { if (!pm[k]) pm[k] = []; pm[k].push(o.id); } });
    const d = {}; Object.values(pm).filter(v => v.length > 1).forEach(ids => ids.forEach(id => { d[id] = true; })); return d;
  }, [cOrders]);

  // One date range drives BOTH the overview stats and the orders list below.
  const periodRange = useMemo(() => {
    if (statsRange === "all") return { from: null, to: null };
    const now = new Date();
    const monday = d => { const day = d.getDay(), diff = day === 0 ? 6 : day - 1; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff); };
    let from = null, to = null;
    if (statsRange === "today") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (statsRange === "week") from = monday(now);
    else if (statsRange === "lastweek") { const m = monday(now); from = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7); to = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 1, 23, 59, 59); }
    else if (statsRange === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (statsRange === "lastmonth") { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); }
    else if (statsRange === "30d") from = new Date(now - 30 * 864e5);
    else if (statsRange === "90d") from = new Date(now - 90 * 864e5);
    else if (statsRange === "custom") { if (statsFrom) from = new Date(statsFrom); if (statsTo) to = new Date(statsTo + "T23:59:59"); }
    return { from, to };
  }, [statsRange, statsFrom, statsTo]);

  const filtered = useMemo(() => cOrders.filter(o => {
    if (statusF !== "all" && o.status !== statusF) return false;
    if (stateF !== "all" && o.state !== stateF) return false;
    if (agentF === "unassigned" && o.agent_id) return false;
    if (agentF !== "all" && agentF !== "unassigned" && o.agent_id !== agentF) return false;
    if (callerF === "unassigned" && o.assigned_to) return false;
    if (callerF !== "all" && callerF !== "unassigned" && o.assigned_to !== callerF) return false;
    if (dupeF && !dupeMap[o.id]) return false;
    if (productF !== "all" && o.product !== productF) return false;
    if (periodRange.from && new Date(o.created_at) < periodRange.from) return false;
    if (periodRange.to && new Date(o.created_at) > periodRange.to) return false;
    if (search) { const s = search.toLowerCase(); return [o.name, cleanPhone(o.phone), o.address, o.state, o.product, o.notes].some(f => (f || "").toLowerCase().includes(s)); }
    return true;
  }), [cOrders, statusF, stateF, agentF, callerF, dupeF, periodRange, search, dupeMap, productF]);

  // Caller queue mode: only working statuses, oldest-first (work the backlog)
  const isCaller = me?.role === "caller";
  // View-only roles (viewer/accountant) get read-only order rows — no status
  // dropdown, edit, assign, or selection (RLS blocks those writes anyway;
  // this stops the UI offering controls that would only fail).
  const canEditOrders = caps.orders === "edit";
  const viewOrders = useMemo(() => {
    if (FEATURE_CALLER && isCaller && queueMode) {
      return filtered.filter(o => CALLER_QUEUE_STATUSES.includes(o.status))
        .slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return filtered;
  }, [filtered, isCaller, queueMode]);

  useEffect(() => { setOrdersPage(0); }, [search, statusF, stateF, agentF, callerF, dupeF, productF, periodRange, country, queueMode]);

  const pagedOrders = useMemo(() => viewOrders.slice(ordersPage * ordersPageSize, (ordersPage + 1) * ordersPageSize), [viewOrders, ordersPage, ordersPageSize]);

  const states = useMemo(() => [...new Set(cOrders.map(o => o.state).filter(Boolean))].sort(), [cOrders]);
  const productsList = useMemo(() => [...new Set(cOrders.map(o => o.product).filter(Boolean))].sort(), [cOrders]);

  const statsOrders = useMemo(() => {
    const { from, to } = periodRange;
    if (!from && !to) return cOrders;
    return cOrders.filter(o => {
      const d = new Date(o.created_at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [cOrders, periodRange]);

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

  // Order-derived numbers follow the selected period (statsOrders); live
  // stock stays current (from inventory, not time-scoped).
  const agentSt = useMemo(() => {
    const m = {};
    cAgents.forEach(a => {
      const ao = statsOrders.filter(o => o.agent_id === a.id);
      const del = ao.filter(o => o.status === "delivered");
      const inTransit = ao.filter(o => o.status === "in_transit").length;
      const cancelled = ao.filter(o => o.status === "cancelled" || o.status === "rejected").length;
      const failed = ao.filter(o => o.status === "failed_delivery").length;
      m[a.id] = {
        total: ao.length, delivered: del.length, inTransit, cancelled, failed,
        rate: ao.length > 0 ? ((del.length / ao.length) * 100).toFixed(0) : "-",
        stock: inventory.filter(i => i.agent_id === a.id).reduce((s, i) => s + i.qty, 0),
        fees: ao.reduce((s, o) => s + (o.delivery_fee || 0), 0),
        revenue: del.reduce((s, o) => s + (o.actual_price_collected || o.price || 0), 0),
      };
    });
    return m;
  }, [cAgents, statsOrders, inventory]);

  const agentTotals = useMemo(() => {
    const vals = Object.values(agentSt);
    const assigned = vals.reduce((s, v) => s + v.total, 0);
    const delivered = vals.reduce((s, v) => s + v.delivered, 0);
    return {
      assigned, delivered,
      rate: assigned > 0 ? Math.round(delivered / assigned * 100) : 0,
      units: vals.reduce((s, v) => s + v.stock, 0),
      revenue: vals.reduce((s, v) => s + v.revenue, 0),
    };
  }, [agentSt]);

  // ── Stock vs demand, keyed by state (demand-relative low-stock signals) ──
  // Supply = stock held by agents who cover a state. An agent covering two
  // states counts toward both (they share one pool) — surfaced as a note.
  const stockByState = useMemo(() => {
    const m = {};
    cAgents.forEach(a => (a.states || []).forEach(st => { (m[st] = m[st] || { agents: [], stock: {} }).agents.push(a); }));
    cAgents.forEach(a => {
      const sts = a.states || [];
      if (!sts.length) return;
      inventory.filter(i => i.agent_id === a.id).forEach(i => sts.forEach(st => { if (m[st]) m[st].stock[i.product_name] = (m[st].stock[i.product_name] || 0) + (i.qty || 0); }));
    });
    return m;
  }, [cAgents, inventory]);

  // Demand = units on open orders ("in progress" group) per state × product.
  const demandByState = useMemo(() => {
    const m = {};
    cOrders.forEach(o => {
      if (getStatus(o.status).group !== "progress" || !o.state || !o.product) return;
      (m[o.state] = m[o.state] || {})[o.product] = (m[o.state][o.product] || 0) + (o.qty || 0);
    });
    return m;
  }, [cOrders]);

  const stockSignal = (o) => {
    const cover = stockByState[o.state];
    if (!cover || !cover.agents.length) return { kind: "noagent", state: o.state };
    const supply = cover.stock[o.product] || 0;
    const demand = (demandByState[o.state] || {})[o.product] || 0;
    return { kind: supply === 0 ? "none" : supply < demand ? "short" : "ok", supply, demand, state: o.state };
  };

  // Every state × product where open demand outruns stock (or no agent covers it).
  const stockShortfalls = useMemo(() => {
    const rows = [];
    Object.entries(demandByState).forEach(([st, prods]) => Object.entries(prods).forEach(([prod, demand]) => {
      const cover = stockByState[st];
      const hasAgent = !!cover?.agents.length;
      const supply = cover?.stock[prod] || 0;
      if (hasAgent && supply >= demand) return;
      rows.push({ state: st, product: prod, supply, demand, shortfall: demand - supply, hasAgent });
    }));
    return rows.sort((a, b) => b.shortfall - a.shortfall);
  }, [demandByState, stockByState]);

  // Phase 7: per-caller effectiveness (over the selected stats period)
  const callerStats = useMemo(() => callers.map(c => {
    const co = statsOrders.filter(o => o.assigned_to === c.auth_user_id);
    const by = stage => co.filter(o => STAGE_OF[o.status] === stage).length;
    const delivered = by("delivered"), lostCall = by("lost_on_call"), lostDel = by("lost_on_delivery"), unfulfilled = by("unfulfilled");
    const open = Math.max(0, co.length - delivered - lostCall - lostDel - unfulfilled);
    const pct = n => co.length ? Math.round(n / co.length * 100) : 0;
    return { id: c.id, name: c.full_name || c.email, assigned: co.length, delivered, lostCall, lostDel, open, rate: pct(delivered), lostCallPct: pct(lostCall), lostDelPct: pct(lostDel) };
  }), [callers, statsOrders]);

  // Phase 7: stale in-transit orders (dispatched > STALE_HOURS ago)
  const staleOrders = useMemo(() => cOrders.filter(o => o.status === "in_transit" && o.dispatched_at && (Date.now() - new Date(o.dispatched_at).getTime()) > STALE_HOURS * 3600 * 1000), [cOrders]);

  // ── Exports (respect the current filters + period, so "export what I see") ──
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportOrders = () => {
    const cols = [
      { label: "Date", get: o => (o.created_at || "").slice(0, 10) },
      { label: "Name", get: o => o.name },
      { label: "Phone", get: o => cleanPhone(o.phone) },
      { label: "WhatsApp", get: o => cleanPhone(o.whatsapp) },
      { label: country === "ghana" ? "Region" : "State", get: o => o.state },
      { label: "Address", get: o => o.address },
      { label: "Product", get: o => o.product },
      { label: "Package", get: o => o.pack_name },
      { label: "Qty", get: o => o.qty },
      { label: "Price", get: o => o.price },
      { label: "Status", get: o => getStatus(o.status).label },
      { label: "Agent", get: o => o.agent_name },
      { label: "Delivery fee", get: o => o.delivery_fee },
      { label: "Qty delivered", get: o => o.actual_qty_delivered },
      { label: "Collected", get: o => o.actual_price_collected },
      { label: "Delivery date", get: o => o.delivery_date || "" },
      { label: "Payment", get: o => o.payment_option },
      { label: "Caller", get: o => o.assigned_to ? (staffByUid[o.assigned_to]?.full_name || staffByUid[o.assigned_to]?.email || "") : "" },
      { label: "Notes", get: o => o.notes },
    ];
    downloadCSV(`orders-${country}-${stamp()}.csv`, toCSV(cols, viewOrders));
  };
  const exportAgents = () => {
    const cols = [
      { label: "Agent", get: a => a.name },
      { label: "Phone", get: a => cleanPhone(a.phone) },
      { label: country === "ghana" ? "Regions" : "States", get: a => (a.states || []).join("; ") },
      { label: "Assigned", get: a => agentSt[a.id]?.total || 0 },
      { label: "Delivered", get: a => agentSt[a.id]?.delivered || 0 },
      { label: "Delivery rate %", get: a => agentSt[a.id]?.rate ?? "-" },
      { label: "In transit", get: a => agentSt[a.id]?.inTransit || 0 },
      { label: "Cancelled/failed", get: a => (agentSt[a.id]?.cancelled || 0) + (agentSt[a.id]?.failed || 0) },
      { label: "Stock in field", get: a => agentSt[a.id]?.stock || 0 },
      { label: "Revenue delivered", get: a => agentSt[a.id]?.revenue || 0 },
    ];
    downloadCSV(`agents-${country}-${stamp()}.csv`, toCSV(cols, cAgents));
  };

  // ─── DB ACTIONS ───
  // Best-effort status history (won't block or error the status change if the
  // order_status_events table isn't present yet in a given environment).
  const logStatus = async (orderId, from, to) => {
    if (!to || from === to) return;
    try { await sb.insert("order_status_events", { order_id: orderId, from_status: from || null, to_status: to }); } catch (e) { /* best-effort */ }
  };

  // Milestone timestamps stamped on status transitions (Phase 7; flag-gated so it
  // never sends these columns to a prod DB that hasn't run migration 0006 yet).
  const stampFor = (order, status) => {
    if (!FEATURE_CALLER) return {};
    const now = new Date().toISOString();
    const p = {};
    if (status === "confirmed" && !order?.confirmed_at) p.confirmed_at = now;
    if (status === "in_transit" && !order?.dispatched_at) p.dispatched_at = now;
    if (status === "delivered") p.delivered_at = now;
    return p;
  };

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
    const stamp = stampFor(order, status);
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...stamp } : o));
    try {
      await sb.update("orders", { id }, { status, ...stamp });
      logStatus(id, order?.status, status);
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
    if (data.status) Object.assign(data, stampFor(oldOrder, data.status));
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...data } : o));
    try {
      await sb.update("orders", { id }, data);
      logStatus(id, oldOrder?.status, data.status);
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
    const prevStatus = new Map(orders.filter(o => sel.has(o.id)).map(o => [o.id, o.status]));
    const byId = new Map(orders.map(o => [o.id, o]));
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, status, ...stampFor(o, status) } : o));
    setSel(new Set());
    try {
      await Promise.all(ids.map(id => sb.update("orders", { id }, { status, ...stampFor(byId.get(id), status) })));
      ids.forEach(id => logStatus(id, prevStatus.get(id), status));
    } catch (err) { showToast(err.message); await loadAll(); }
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

  // ─── Phase 7: assign orders to a caller (by their auth user id) ───
  const doBulkAssignCaller = async (authUid) => {
    const ids = [...sel];
    const patch = { assigned_to: authUid || null, assigned_at: authUid ? new Date().toISOString() : null };
    setOrders(prev => prev.map(o => sel.has(o.id) ? { ...o, ...patch } : o));
    setSel(new Set());
    try { await Promise.all(ids.map(id => sb.update("orders", { id }, patch))); } catch (err) { showToast(err.message); await loadAll(); }
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

  const doEditAgent = async (data) => {
    const id = editAgent.id;
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...data } : a));
    setEditAgent(null);
    try { await sb.update("agents", { id }, data); } catch (err) { showToast(err.message); await loadAll(); }
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

  // ─── Phase 4: warehouse / waybills / purchases / faulty ───
  const doSetWarehouseQty = async (prod, qty) => {
    const q = Math.max(0, qty);
    setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, warehouse_qty: q } : p));
    try { await sb.update("products", { id: prod.id }, { warehouse_qty: q }); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doAddPurchase = async (data) => {
    try {
      const res = await sb.insert("stock_purchases", data);
      setPurchases(prev => [...(res || []), ...prev]);
      const prod = products.find(p => p.name === data.product_name);
      if (prod) {
        const newQty = (prod.warehouse_qty || 0) + (data.quantity || 0);
        await sb.update("products", { id: prod.id }, { warehouse_qty: newQty });
        setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, warehouse_qty: newQty } : p));
      }
    } catch (err) { showToast(err.message); }
    setShowAddPurchase(false);
  };

  const doAddWaybill = async (data) => {
    try {
      const res = await sb.insert("waybills", { ...data, status: "pending" });
      setWaybills(prev => [...(res || []), ...prev]);
    } catch (err) { showToast(err.message); }
    setShowAddWaybill(false);
  };

  const doSetWaybillStatus = async (wb, status) => {
    const wasDelivered = wb.status === "delivered";
    const nowDelivered = status === "delivered";
    const patch = { status };
    if (nowDelivered && !wasDelivered) patch.delivered_at = new Date().toISOString();
    setWaybills(prev => prev.map(w => w.id === wb.id ? { ...w, ...patch } : w));
    try {
      await sb.update("waybills", { id: wb.id }, patch);
      if (nowDelivered && !wasDelivered) {
        const prod = products.find(p => p.name === wb.product_name);
        if (prod) {
          const newWh = Math.max(0, (prod.warehouse_qty || 0) - wb.quantity);
          await sb.update("products", { id: prod.id }, { warehouse_qty: newWh });
          setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, warehouse_qty: newWh } : p));
        }
        if (wb.agent_id) {
          const inv = inventory.find(i => i.agent_id === wb.agent_id && i.product_name === wb.product_name);
          if (inv) {
            const newQ = inv.qty + wb.quantity;
            await sb.update("inventory", { id: inv.id }, { qty: newQ });
            setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newQ } : i));
          } else {
            const res = await sb.insert("inventory", { agent_id: wb.agent_id, product_name: wb.product_name, qty: wb.quantity });
            setInventory(prev => [...prev, ...(res || [])]);
          }
        }
      }
    } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doAddFaulty = async (data) => {
    try {
      const res = await sb.insert("faulty_stock", { ...data, agent_id: data.agent_id || null });
      setFaulty(prev => [...(res || []), ...prev]);
      if (data.agent_id) {
        const inv = inventory.find(i => i.agent_id === data.agent_id && i.product_name === data.product_name);
        if (inv) {
          const newQ = Math.max(0, inv.qty - data.quantity);
          await sb.update("inventory", { id: inv.id }, { qty: newQ });
          setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, qty: newQ } : i));
        }
      } else {
        const prod = products.find(p => p.name === data.product_name);
        if (prod) {
          const newWh = Math.max(0, (prod.warehouse_qty || 0) - data.quantity);
          await sb.update("products", { id: prod.id }, { warehouse_qty: newWh });
          setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, warehouse_qty: newWh } : p));
        }
      }
    } catch (err) { showToast(err.message); }
    setShowAddFaulty(false);
  };

  const doAddTransfer = async (data) => {
    const { from_agent_id, to_agent_id, product_name, quantity } = data;
    try {
      const res = await sb.insert("stock_transfers", data);
      setTransfers(prev => [...(res || []), ...prev]);
      const fromInv = inventory.find(i => i.agent_id === from_agent_id && i.product_name === product_name);
      if (fromInv) {
        const nq = Math.max(0, fromInv.qty - quantity);
        await sb.update("inventory", { id: fromInv.id }, { qty: nq });
        setInventory(prev => prev.map(i => i.id === fromInv.id ? { ...i, qty: nq } : i));
      }
      const toInv = inventory.find(i => i.agent_id === to_agent_id && i.product_name === product_name);
      if (toInv) {
        const nq = toInv.qty + quantity;
        await sb.update("inventory", { id: toInv.id }, { qty: nq });
        setInventory(prev => prev.map(i => i.id === toInv.id ? { ...i, qty: nq } : i));
      } else {
        const ins = await sb.insert("inventory", { agent_id: to_agent_id, product_name, qty: quantity });
        setInventory(prev => [...prev, ...(ins || [])]);
      }
    } catch (err) { showToast(err.message); await loadAll(); }
    setShowAddTransfer(false);
  };

  const doInviteStaff = async (data) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Invite failed");
      setStaff(prev => [...prev, d.staff]);
      showToast(`Invite sent to ${data.email}`, "success");
    } catch (e) { showToast(e.message); }
    setShowAddStaff(false);
  };

  const doUpdateStaff = async (id, patch) => {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    try { await sb.update("staff", { id }, patch); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doDeleteStaff = async (id) => {
    if (!window.confirm("Remove this staff member? They will lose access.")) return;
    setStaff(prev => prev.filter(s => s.id !== id));
    try { await sb.delete("staff", { id }); } catch (err) { showToast(err.message); await loadAll(); }
  };

  const doSaveTemplate = async (key, msg) => {
    try {
      await sb.upsert("templates", { status_key: key, message: msg }, "status_key");
      setTemplates(prev => ({ ...prev, [key]: msg }));
      showToast("Message saved", "success");
    } catch (err) { showToast(err.message); throw err; }
  };

  const doAddOrder = async (data) => {
    try { await sb.insert("orders", { ...data, country }); await loadAll(); } catch (err) { showToast(err.message); }
    setShowAddOrder(false);
  };

  const getWALink = (o, statusOverride) => waLink(o.whatsapp || o.phone, fillTpl(templates[statusOverride || o.status] || templates.pending || "", o), o.country);

  const copyOrder = async (o) => {
    try { await navigator.clipboard.writeText(orderClipboard(o, cur)); showToast("Order details copied", "success"); }
    catch { showToast("Couldn't copy — please try again"); }
  };

  const toggleSel = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { const all = pagedOrders.map(o => o.id); setSel(all.every(id => sel.has(id)) ? new Set() : new Set(all)); };

  // ─── SCREENS ───

  if (authChecking) return (
    <div className="cx-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg }}>
      <link href={FONTS} rel="stylesheet" />
      <style>{CSS}</style>
      <div style={{ width: "48px", height: "48px", background: `linear-gradient(135deg,${T.accent},${T.accentDark})`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", animation: "pulse 1.5s infinite" }}><Store size={24} /></div>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.96)}}`}</style>
    </div>
  );

  if (needsPassword) return <SetPasswordScreen onDone={onPasswordSet} />;

  if (!authed) return <LoginScreen onLogin={onLogin} />;

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
        <Btn onClick={() => { setLoadError(null); setLoaded(false); loadedRef.current = false; loadAll(); }}>Retry</Btn>
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
      ...(caps.analytics ? [{ id: "analytics", label: "Analytics", icon: LayoutDashboard }] : []),
      ...(caps.settings ? [{ id: "templates", label: "Messages", icon: MessageSquare }] : []),
    ] },
    ...(caps.staff ? [{ sec: "People", items: [{ id: "staff", label: "Staff", icon: Users }] }] : []),
  ].filter(g => g.items.length);
  const navFlat = NAV.flatMap(g => g.items);
  const activeMeta = navFlat.find(n => n.id === tab) || navFlat[0];

  const setCountrySafe = (v) => { setCountry(v); setStatusF("all"); setStateF("all"); setAgentF("all"); setCallerF("all"); setProductF("all"); setDupeF(false); setSel(new Set()); setShowFilters(false); };

  const showStatsStrip = tab === "orders" || tab === "analytics";

  // ── shared content blocks ──
  const kpiCards = [
    { l: "Orders", v: stats.total, accent: "#1a7a4c", icon: ClipboardList },
    { l: "Delivered", v: stats.delivered, d: `${stats.rate}% rate`, dir: "flat", accent: "#1d4ed8", icon: CheckCircle2 },
    { l: "Units sold", v: stats.unitsSold, d: `of ${stats.totalUnitsOrdered}`, dir: "flat", accent: "#7c3aed", icon: Package },
    { l: "Pending", v: stats.pending, accent: "#b45309", icon: Clock },
    { l: "Failed", v: stats.failed, accent: "#b91c1c", icon: X },
    // financial cards — only for roles with analytics/finance access
    ...(caps.analytics ? [
      { l: "Revenue", v: `${cur}${stats.rev.toLocaleString()}`, accent: "#1d4ed8", icon: Wallet },
      { l: "Fees", v: `${cur}${stats.fees.toLocaleString()}`, accent: "#ea580c", icon: Truck },
      { l: "Net", v: `${cur}${stats.net.toLocaleString()}`, accent: "#1a7a4c", icon: TrendingUp },
    ] : []),
  ];

  // Rendered via a JSX variable so both screens share one instance definition.
  // (Plain object, NOT useMemo — this line sits after the early returns above,
  // so a hook here would violate the Rules of Hooks.)
  const statsStrip = <StatsStrip cards={kpiCards} range={statsRange} setRange={setStatsRange} from={statsFrom} setFrom={setStatsFrom} to={statsTo} setTo={setStatsTo} />;
  const countryCounts = { nigeria: orders.filter(o => o.country === "nigeria").length, ghana: orders.filter(o => o.country === "ghana").length };

  // ── ORDERS ──
  const OrdersScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Orders</h1><div className="cx-sub">Confirm, assign and track every order</div></div>
        <div style={{ display: "flex", gap: "8px" }}>
          {caps.analytics && <Btn v="secondary" onClick={exportOrders}><Download size={15} />Export</Btn>}
          {caps.del && <Btn v="secondary" onClick={() => setShowImport(true)}><Upload size={15} />Import CSV</Btn>}
          {caps.del && <Btn onClick={() => setShowAddOrder(true)}><Plus size={16} />New order</Btn>}
        </div>
      </div>

      {statsStrip}

      {FEATURE_CALLER && staleOrders.length > 0 && <Card style={{ padding: "12px 16px", marginBottom: "12px", background: T.warningBg, border: `1.5px solid #fcd9a8` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}><AlertTriangle size={16} style={{ color: T.warning }} /><span style={{ fontWeight: 700, color: T.warning, fontSize: "13px" }}>{staleOrders.length} order{staleOrders.length !== 1 ? "s" : ""} stuck in transit over {STALE_HOURS}h — chase these up</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {staleOrders.slice(0, 12).map(o => <button key={o.id} onClick={() => setViewOrder(o)} style={{ fontSize: "12px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "4px 9px", cursor: "pointer", fontFamily: T.f }}>{o.name} · {Math.floor((Date.now() - new Date(o.dispatched_at).getTime()) / 3600000)}h</button>)}
        </div>
      </Card>}

      {cAgents.length > 0 && stockShortfalls.length > 0 && <Card style={{ padding: "12px 16px", marginBottom: "12px", background: T.dangerBg, border: `1.5px solid #f5c2c2` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}><AlertTriangle size={16} style={{ color: T.danger }} /><span style={{ fontWeight: 700, color: T.danger, fontSize: "13px" }}>Stock won't cover pending orders in {stockShortfalls.length} spot{stockShortfalls.length !== 1 ? "s" : ""}</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {stockShortfalls.slice(0, 8).map(r => (
            <button key={`${r.state}|${r.product}`} onClick={() => { setStateF(r.state); setStatusF("all"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "7px 11px", cursor: "pointer", fontFamily: T.f, textAlign: "left" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: T.text }}>{r.state} · {r.product}</span>
              <span style={{ fontSize: "11px", color: T.textMuted, whiteSpace: "nowrap" }}>{r.hasAgent ? <>{r.supply} in stock · {r.demand} needed <b style={{ color: T.danger }}>(short {r.shortfall})</b></> : <b style={{ color: T.danger }}>no agent covers this state</b>}</span>
            </button>
          ))}
        </div>
        {cAgents.some(a => (a.states || []).length > 1) && <div style={{ fontSize: "10px", color: T.textMuted, marginTop: "8px" }}>ⓘ Some agents cover multiple states; their stock is counted toward each.</div>}
      </Card>}

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div className="cx-searchbar" style={{ maxWidth: "300px", flex: 1, minWidth: "180px" }}>
          <Search size={15} />
          <input placeholder="Name, phone or address…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {FEATURE_CALLER && isCaller && <div className="cx-seg2">
          <button className={queueMode ? "on" : ""} onClick={() => setQueueMode(true)}>My queue</button>
          <button className={!queueMode ? "on" : ""} onClick={() => setQueueMode(false)}>All mine</button>
        </div>}
        {isMobile ? <Btn v="secondary" sz="sm" onClick={() => setShowFilters(!showFilters)} style={{ background: showFilters ? T.accentLight : T.surface, color: showFilters ? T.accent : T.text }}><Filter size={14} />Filters</Btn> : <>
          <span className={`cx-sel ${statusF !== "all" ? "act" : ""}`}><select value={statusF} onChange={e => setStatusF(e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select></span>
          <span className={`cx-sel ${stateF !== "all" ? "act" : ""}`}><select value={stateF} onChange={e => setStateF(e.target.value)}><option value="all">All {country === "ghana" ? "regions" : "states"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select></span>
          <span className={`cx-sel ${agentF !== "all" ? "act" : ""}`}><select value={agentF} onChange={e => setAgentF(e.target.value)}><option value="all">All agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></span>
          {FEATURE_CALLER && !isCaller && callers.length > 0 && <span className={`cx-sel ${callerF !== "all" ? "act" : ""}`}><select value={callerF} onChange={e => setCallerF(e.target.value)}><option value="all">All callers</option><option value="unassigned">⚠ No caller</option>{callers.map(c => <option key={c.id} value={c.auth_user_id}>{c.full_name || c.email}</option>)}</select></span>}
          <span className={`cx-sel ${productF !== "all" ? "act" : ""}`}><select value={productF} onChange={e => setProductF(e.target.value)}><option value="all">All products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select></span>
        </>}
        <Btn v={dupeF ? "warning" : "secondary"} sz="sm" onClick={() => setDupeF(!dupeF)}><Users size={14} />{dupeF ? "Dupes ✕" : "Dupes"}</Btn>
      </div>

      {isMobile && showFilters && <Card style={{ padding: "14px", marginBottom: "12px" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
        <select value={stateF} onChange={e => setStateF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface }}><option value="all">All {country === "ghana" ? "regions" : "states"}</option>{states.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={agentF} onChange={e => setAgentF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All agents</option><option value="unassigned">⚠ Unassigned</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {FEATURE_CALLER && !isCaller && callers.length > 0 && <select value={callerF} onChange={e => setCallerF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All callers</option><option value="unassigned">⚠ No caller</option>{callers.map(c => <option key={c.id} value={c.auth_user_id}>{c.full_name || c.email}</option>)}</select>}
        <select value={productF} onChange={e => setProductF(e.target.value)} style={{ padding: "9px 10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "12px", background: T.surface, gridColumn: "1/-1" }}><option value="all">All products</option>{productsList.map(p => <option key={p} value={p}>{p}</option>)}</select>
      </div></Card>}

      {sel.size > 0 && <div style={{ display: "flex", gap: "6px", marginBottom: "12px", alignItems: "center", background: T.accentLight, padding: "10px 14px", borderRadius: T.rs, border: `1.5px solid ${T.accentMid}`, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: T.accent, fontSize: "13px" }}>{sel.size} selected</span>
        {isMobile ? <select onChange={e => { if (e.target.value) doBulkStatus(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Set status…</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</select>
          : STATUSES.map(s => <Btn key={s.value} v="secondary" sz="xs" onClick={() => doBulkStatus(s.value)} title={s.label}>{s.icon} {s.label}</Btn>)}
        {cAgents.length > 0 && <select onChange={e => { if (e.target.value) doBulkAssign(e.target.value); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Assign agent…</option>{cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        {FEATURE_CALLER && caps.del && callers.length > 0 && <select onChange={e => { const v = e.target.value; if (v === "__none__") doBulkAssignCaller(null); else if (v) doBulkAssignCaller(v); e.target.value = ""; }} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1px solid ${T.border}`, fontSize: "12px", background: T.surface, fontFamily: T.f }}><option value="">Assign caller…</option><option value="__none__">— Unassign —</option>{callers.map(c => <option key={c.id} value={c.auth_user_id}>{c.full_name || c.email}</option>)}</select>}
        {caps.del && <Btn v="danger" sz="xs" onClick={doBulkDelete} style={{ marginLeft: "auto" }}><Trash2 size={13} />Delete {sel.size}</Btn>}
        <Btn v="ghost" sz="xs" onClick={() => setSel(new Set())}>✕</Btn>
      </div>}

      {/* MOBILE CARDS */}
      {isMobile ? <div style={{ display: "grid", gap: "10px" }}>
        {viewOrders.length === 0 && <Card style={{ padding: "48px 20px", textAlign: "center", color: T.textMuted }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No orders match your filters."}</Card>}
        {pagedOrders.map(o => <Card key={o.id} style={{ padding: "14px", background: sel.has(o.id) ? T.accentLight : T.surface, border: sel.has(o.id) ? `1.5px solid ${T.accentMid}` : `1px solid ${T.border}` }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            {canEditOrders && <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: T.accent, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => setViewOrder(o)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "4px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: T.text }}>
                  {o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 5px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}
                </div>
                <span className="cx-num" style={{ fontWeight: 700, fontSize: "14px", flexShrink: 0 }}>{cur}{(o.price || 0).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>{cleanPhone(o.phone)} · {o.state} · {o.product} ×{o.qty}</div>
              {cAgents.length > 0 && getStatus(o.status).group === "progress" && <div style={{ marginBottom: "8px" }}><StockBadge signal={stockSignal(o)} /></div>}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {canEditOrders ? <StatusSelect value={o.status} onChange={e => { e.stopPropagation(); doUpdateStatus(o.id, e.target.value); }} /> : <Pill status={o.status} />}
                {o.agent_name ? <span style={{ fontSize: "11px", color: T.textMuted, background: T.surfaceAlt, padding: "3px 8px", borderRadius: "6px" }}>{o.agent_name}</span> : canEditOrders ? <Btn v="ghost" sz="xs" onClick={e => { e.stopPropagation(); setShowAssign(o.id); }} style={{ color: T.accent }}>+ Assign</Btn> : null}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${T.borderLight}`, justifyContent: "flex-end" }}>
            {FEATURE_CALLER && <Btn v="secondary" sz="xs" onClick={() => copyOrder(o)}><Copy size={13} />Copy</Btn>}
            <a href={`tel:${cleanPhone(o.phone)}`}><Btn v="secondary" sz="xs"><Phone size={13} />Call</Btn></a>
            <a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs"><MessageCircle size={13} />WhatsApp</Btn></a>
            {canEditOrders && <Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}><Pencil size={13} />Edit</Btn>}
            {caps.del && <Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}><Trash2 size={13} /></Btn>}
          </div>
        </Card>)}
        <Pagination page={ordersPage} total={viewOrders.length} pageSize={ordersPageSize} onPage={setOrdersPage} onPageSize={n => { setOrdersPageSize(n); setOrdersPage(0); }} />
      </div> : (
        /* DESKTOP TABLE */
        <Card className="cx-tablewrap" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="cx-table">
              <thead><tr>
                <th style={{ width: "40px" }}>{canEditOrders && <input type="checkbox" checked={pagedOrders.length > 0 && pagedOrders.every(o => sel.has(o.id))} onChange={toggleAll} style={{ width: "15px", height: "15px", accentColor: T.accent }} />}</th>
                <th>Customer</th><th>Product</th><th>{country === "ghana" ? "Region" : "State"}</th><th>Status</th><th>Agent</th><th className="r">Price</th><th className="r">Actions</th>
              </tr></thead>
              <tbody>
                {viewOrders.length === 0 && <tr><td colSpan={8} style={{ padding: "56px", textAlign: "center", color: T.textMuted, fontSize: "14px" }}>{cOrders.length === 0 ? "Import a CSV to get started." : "No orders match your filters."}</td></tr>}
                {pagedOrders.map(o => <tr key={o.id} className={sel.has(o.id) ? "sel" : ""}>
                  <td>{canEditOrders && <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} style={{ width: "15px", height: "15px", accentColor: T.accent }} />}</td>
                  <td className="cx-cust" style={{ cursor: "pointer" }} onClick={() => setViewOrder(o)}>
                    <b>{o.name}{dupeMap[o.id] && <span style={{ background: T.warningBg, color: T.warning, fontSize: "9px", padding: "1px 6px", borderRadius: "4px", marginLeft: "6px", fontWeight: 700 }}>DUPE</span>}</b>
                    <span>{cleanPhone(o.phone)}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: T.text }}>{o.product}</div>
                    <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>{o.pack_name} · ×{o.qty}</div>
                  </td>
                  <td style={{ fontSize: "12px", color: T.textMuted }}>{o.state}{cAgents.length > 0 && getStatus(o.status).group === "progress" && <div style={{ marginTop: "4px" }}><StockBadge signal={stockSignal(o)} /></div>}</td>
                  <td>{canEditOrders ? <StatusSelect value={o.status} onChange={e => doUpdateStatus(o.id, e.target.value)} /> : <Pill status={o.status} />}</td>
                  <td>{o.agent_name ? <span style={{ fontSize: "12px", fontWeight: 600, background: T.surfaceAlt, padding: "3px 9px", borderRadius: "6px" }}>{o.agent_name}</span> : canEditOrders ? <Btn v="ghost" sz="xs" onClick={() => setShowAssign(o.id)} style={{ color: T.accent }}>+ Assign</Btn> : <span style={{ color: T.textLight, fontSize: "12px" }}>—</span>}</td>
                  <td className="r">
                    <div className="cx-num" style={{ fontWeight: 700, fontSize: "13px" }}>{cur}{(o.price || 0).toLocaleString()}</div>
                    {o.delivery_fee > 0 && <div style={{ fontSize: "10px", color: T.danger, marginTop: "1px" }}>-{cur}{o.delivery_fee.toLocaleString()} fee</div>}
                  </td>
                  <td className="r"><div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>{FEATURE_CALLER && <Btn v="secondary" sz="xs" title="Copy for WhatsApp" onClick={() => copyOrder(o)}><Copy size={13} /></Btn>}<a href={`tel:${cleanPhone(o.phone)}`}><Btn v="secondary" sz="xs" title="Call customer"><Phone size={13} /></Btn></a><a href={getWALink(o)} target="_blank" rel="noopener noreferrer"><Btn v="whatsapp" sz="xs"><MessageCircle size={13} /></Btn></a>{canEditOrders && <Btn v="secondary" sz="xs" onClick={() => setEditOrder({ ...o })}><Pencil size={13} /></Btn>}{caps.del && <Btn v="ghost" sz="xs" onClick={() => doDeleteOrder(o.id)} style={{ color: T.danger }}><Trash2 size={13} /></Btn>}</div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "8px 14px", borderTop: `1px solid ${T.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.surfaceAlt }}>
            <span style={{ fontSize: "11px", color: T.textMuted }}>{viewOrders.length} of {cOrders.length} orders{Object.keys(dupeMap).length > 0 && ` · ${Object.keys(dupeMap).length} duplicates`}</span>
            <Pagination page={ordersPage} total={viewOrders.length} pageSize={ordersPageSize} onPage={setOrdersPage} onPageSize={n => { setOrdersPageSize(n); setOrdersPage(0); }} />
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
        <div style={{ display: "flex", gap: "8px" }}>
          {cAgents.length > 0 && <Btn v="secondary" onClick={exportAgents}><Download size={15} />Export</Btn>}
          {caps.agents === "edit" && <Btn onClick={() => setShowAddAgent(true)}><Plus size={16} />Add agent</Btn>}
        </div>
      </div>
      {cAgents.length > 0 && <PeriodFilter range={statsRange} setRange={setStatsRange} from={statsFrom} setFrom={setStatsFrom} to={statsTo} setTo={setStatsTo} />}
      {cAgents.length > 0 && <div className="cx-grid cx-kpis" style={{ marginBottom: "16px" }}>
        <KPI accent="#1a7a4c" v={agentTotals.assigned} l="Total assigned" icon={ClipboardList} />
        <KPI accent="#1d4ed8" v={agentTotals.delivered} l="Delivered" icon={CheckCircle2} />
        <KPI accent="#f57c00" v={`${agentTotals.rate}%`} l="Avg delivery rate" icon={TrendingUp} />
        <KPI accent="#7c3aed" v={agentTotals.units} l="Units in field" icon={Package} />
        <KPI accent="#1a7a4c" v={`${cur}${agentTotals.revenue.toLocaleString()}`} l="Revenue delivered" icon={Wallet} />
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(320px,1fr))", gap: "14px" }}>
        {cAgents.length === 0 && <Card className="cx-empty" style={{ gridColumn: "1/-1" }}><Truck size={40} /><div className="cx-section-t" style={{ color: T.text }}>No agents yet</div><p style={{ marginTop: "4px" }}>Add your first delivery agent to get started.</p></Card>}
        {cAgents.map(a => { const as = agentSt[a.id] || {}; const rn = parseInt(as.rate); const open = Math.max(0, (as.total || 0) - (as.delivered || 0) - (as.inTransit || 0) - (as.cancelled || 0) - (as.failed || 0)); const tot = (as.total || 0) || 1; const seg = [{ v: as.delivered || 0, c: "#1a7a4c" }, { v: as.inTransit || 0, c: "#1d4ed8" }, { v: (as.cancelled || 0) + (as.failed || 0), c: "#b91c1c" }, { v: open, c: "#cbd5e1" }]; return (
          <Card key={a.id} style={{ padding: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, fontFamily: T.fd, fontSize: "15px", color: T.text }}>{a.name}</div>
                <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>{cleanPhone(a.phone)} · {(a.states || []).join(", ")}</div>
              </div>
              <div className="cx-num" style={{ background: rn >= 70 ? T.accentLight : rn >= 40 ? T.warningBg : as.rate === "-" ? T.surfaceAlt : T.dangerBg, color: rn >= 70 ? T.accent : rn >= 40 ? T.warning : as.rate === "-" ? T.textMuted : T.danger, padding: "5px 12px", borderRadius: "20px", fontSize: "14px", fontWeight: 800 }}>{as.rate === "-" ? "—" : as.rate + "%"}</div>
            </div>
            <div style={{ display: "flex", height: "8px", borderRadius: "6px", overflow: "hidden", background: T.surfaceAlt, marginBottom: "12px" }}>
              {seg.map((s, i) => s.v > 0 && <div key={i} style={{ width: `${(s.v / tot) * 100}%`, background: s.c }} />)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "10px" }}>
              {[{ l: "Assigned", v: as.total || 0, c: T.text }, { l: "Delivered", v: as.delivered || 0, c: T.accent }, { l: "In transit", v: as.inTransit || 0, c: "#1d4ed8" }, { l: "Cancelled", v: (as.cancelled || 0) + (as.failed || 0), c: T.danger }, { l: "Units", v: as.stock || 0, c: "#7c3aed" }, { l: "Revenue", v: `${cur}${(as.revenue || 0).toLocaleString()}`, c: T.accent }].map(m => (
                <div key={m.l} style={{ textAlign: "center", padding: "8px 4px", background: T.surfaceAlt, borderRadius: T.rs }}>
                  <div className="cx-num" style={{ fontWeight: 800, fontSize: m.l === "Revenue" ? "13px" : "18px", color: m.c }}>{m.v}</div>
                  <div style={{ fontSize: "9px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.5px", marginTop: "2px" }}>{m.l}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <Btn v="secondary" sz="sm" onClick={() => setShowStock(a.id)} style={{ flex: 1, justifyContent: "center" }}><Boxes size={14} />{caps.inventory === "edit" ? "Manage stock" : "View stock"}</Btn>
              {caps.agents === "edit" && <Btn v="secondary" sz="sm" onClick={() => setEditAgent(a)}><Pencil size={14} />Edit</Btn>}
              {caps.agents === "edit" && <Btn v="ghost" sz="sm" onClick={() => doDeleteAgent(a.id)} style={{ color: T.danger }}><Trash2 size={14} /></Btn>}
            </div>
          </Card>
        ); })}
      </div>
    </div>
  );

  // ── INVENTORY ──
  const invSubs = [
    { id: "products", label: "Products" },
    { id: "agent", label: "Agent stock" },
    { id: "waybills", label: "Waybills" },
    { id: "transfers", label: "Transfers" },
    { id: "buy", label: "Buy stock" },
    { id: "faulty", label: "Faulty stock" },
  ];
  const withAgents = name => cAgents.reduce((s, a) => s + (inventory.find(i => i.agent_id === a.id && i.product_name === name)?.qty || 0), 0);
  const agentName = id => agents.find(a => a.id === id)?.name || "—";
  const invHeaderBtn = {
    products: <Btn onClick={() => setShowAddProduct(true)}><Plus size={16} />Add product</Btn>,
    waybills: <Btn onClick={() => setShowAddWaybill(true)}><Plus size={16} />New waybill</Btn>,
    transfers: <Btn onClick={() => setShowAddTransfer(true)}><Plus size={16} />New transfer</Btn>,
    buy: <Btn onClick={() => setShowAddPurchase(true)}><Plus size={16} />Record purchase</Btn>,
    faulty: <Btn onClick={() => setShowAddFaulty(true)}><Plus size={16} />Log faulty</Btn>,
  }[invTab];

  const InventoryScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Inventory &amp; stock</h1><div className="cx-sub">Warehouse and field stock in one place</div></div>
        {caps.inventory === "edit" && invHeaderBtn}
      </div>
      <div className="cx-tabs">{invSubs.map(s => <button key={s.id} className={`cx-tab ${invTab === s.id ? "on" : ""}`} onClick={() => setInvTab(s.id)}>{s.label}</button>)}</div>

      {invTab === "products" && (products.length === 0 ? <Card className="cx-empty"><Boxes size={40} /><div className="cx-section-t" style={{ color: T.text }}>No products yet</div></Card> :
        <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Product</th><th className="r">In warehouse</th><th className="r">With agents</th><th className="r">Total</th></tr></thead>
          <tbody>{products.map(p => { const wa = withAgents(p.name); const wh = p.warehouse_qty || 0; return (
            <tr key={p.id}>
              <td><b style={{ fontWeight: 600 }}>{p.name}</b></td>
              <td className="r">{caps.inventory === "edit" ? <input type="number" defaultValue={wh} key={wh} onBlur={e => { const v = Math.max(0, +e.target.value || 0); if (v !== wh) doSetWarehouseQty(p, v); }} style={{ width: "72px", textAlign: "right", padding: "5px 8px", border: `1.5px solid ${T.border}`, borderRadius: "6px", fontFamily: T.fd, fontWeight: 700 }} /> : <span className="cx-num" style={{ fontWeight: 700 }}>{wh}</span>}</td>
              <td className="r cx-num" style={{ color: wa ? T.accent : T.textLight }}>{wa}</td>
              <td className="r cx-num" style={{ fontWeight: 800 }}>{wh + wa}</td>
            </tr>
          ); })}</tbody>
        </table></div></Card>
      )}

      {invTab === "agent" && (cAgents.length === 0 ? <Card className="cx-empty"><Truck size={40} /><div className="cx-section-t" style={{ color: T.text }}>No agents yet</div></Card> :
        <div style={{ display: "grid", gap: "10px" }}>{products.map(p => (
          <Card key={p.id} style={{ padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}><span style={{ fontWeight: 700, fontFamily: T.fd, fontSize: "15px" }}>{p.name}</span><span className="cx-num" style={{ fontWeight: 800, fontSize: "18px", color: withAgents(p.name) ? T.accent : T.textLight }}>{withAgents(p.name)} <span style={{ fontSize: "12px", color: T.textMuted, fontWeight: 600 }}>with agents</span></span></div>
            {cAgents.map(a => { const q = inventory.find(i => i.agent_id === a.id && i.product_name === p.name)?.qty || 0; return (
              <div key={a.id} className="cx-list-row" style={{ padding: "7px 0", fontSize: "13px" }}><span style={{ color: T.textMuted }}>{a.name}</span><span className="cx-num" style={{ fontWeight: 700, color: q <= 5 && q > 0 ? T.danger : q === 0 ? T.textLight : T.text }}>{q}{q > 0 && q <= 5 && " ⚠"}</span></div>
            ); })}
          </Card>
        ))}</div>
      )}

      {invTab === "waybills" && (waybills.length === 0 ? <Card className="cx-empty"><Truck size={40} /><div className="cx-section-t" style={{ color: T.text }}>No waybills yet</div><p style={{ marginTop: "4px" }}>Dispatch warehouse stock to an agent; mark it delivered to move it into their stock.</p></Card> :
        <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Date</th><th>Product</th><th>Agent</th><th className="r">Qty</th><th>Status</th><th className="r">Action</th></tr></thead>
          <tbody>{waybills.map(w => { const st = WB_STATUS[w.status] || WB_STATUS.pending; return (
            <tr key={w.id}>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{new Date(w.created_at).toLocaleDateString()}</td>
              <td>{w.product_name}</td>
              <td style={{ fontSize: "12px" }}>{agentName(w.agent_id)}</td>
              <td className="r cx-num" style={{ fontWeight: 700 }}>{w.quantity}</td>
              <td><span className="cx-pill" style={{ color: st.color, background: st.bg }}><span className="dot" />{st.label}</span></td>
              <td className="r">{w.status === "delivered" ? <span style={{ fontSize: "11px", color: T.textMuted }}>{w.delivered_at ? new Date(w.delivered_at).toLocaleDateString() : "✓"}</span> : <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>{w.status === "pending" && <Btn v="secondary" sz="xs" onClick={() => doSetWaybillStatus(w, "in_transit")}>In transit</Btn>}<Btn sz="xs" onClick={() => doSetWaybillStatus(w, "delivered")}>Delivered</Btn></div>}</td>
            </tr>
          ); })}</tbody>
        </table></div></Card>
      )}

      {invTab === "transfers" && (transfers.length === 0 ? <Card className="cx-empty"><Truck size={40} /><div className="cx-section-t" style={{ color: T.text }}>No transfers yet</div><p style={{ marginTop: "4px" }}>Move stock from one agent to another to rebalance the field.</p></Card> :
        <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Date</th><th>Product</th><th>From</th><th>To</th><th className="r">Qty</th></tr></thead>
          <tbody>{transfers.map(t => (
            <tr key={t.id}>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{new Date(t.created_at).toLocaleDateString()}</td>
              <td>{t.product_name}</td>
              <td style={{ fontSize: "12px" }}>{agentName(t.from_agent_id)}</td>
              <td style={{ fontSize: "12px" }}>{agentName(t.to_agent_id)}</td>
              <td className="r cx-num" style={{ fontWeight: 700 }}>{t.quantity}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}

      {invTab === "buy" && (purchases.length === 0 ? <Card className="cx-empty"><Package size={40} /><div className="cx-section-t" style={{ color: T.text }}>No purchases logged</div></Card> :
        <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Date</th><th>Product</th><th className="r">Qty</th><th className="r">Unit cost</th><th className="r">Total</th><th>Note</th></tr></thead>
          <tbody>{purchases.map(pu => (
            <tr key={pu.id}>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{new Date(pu.created_at).toLocaleDateString()}</td>
              <td>{pu.product_name}</td>
              <td className="r cx-num">{pu.quantity}</td>
              <td className="r cx-num">{pu.unit_cost != null ? cur + (+pu.unit_cost).toLocaleString() : "—"}</td>
              <td className="r cx-num" style={{ fontWeight: 700 }}>{pu.unit_cost != null ? cur + (pu.quantity * +pu.unit_cost).toLocaleString() : "—"}</td>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{pu.note}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}

      {invTab === "faulty" && (faulty.length === 0 ? <Card className="cx-empty"><Package size={40} /><div className="cx-section-t" style={{ color: T.text }}>No faulty stock logged</div></Card> :
        <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Date</th><th>Product</th><th>From</th><th className="r">Qty</th><th>Reason</th></tr></thead>
          <tbody>{faulty.map(f => (
            <tr key={f.id}>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{new Date(f.created_at).toLocaleDateString()}</td>
              <td>{f.product_name}</td>
              <td style={{ fontSize: "12px" }}>{f.agent_id ? agentName(f.agent_id) : "Warehouse"}</td>
              <td className="r cx-num" style={{ fontWeight: 700 }}>{f.quantity}</td>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{f.reason}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
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
      {statsStrip}

      {FEATURE_CALLER && callers.length > 0 && <Card style={{ overflow: "hidden", marginBottom: "14px" }}>
        <div style={{ padding: "16px 16px 4px" }}><span className="cx-section-t">Caller effectiveness</span><span className="cx-sub" style={{ marginLeft: "8px" }}>of the orders given to each caller, where did they land</span></div>
        <div style={{ overflowX: "auto" }}><table className="cx-table">
          <thead><tr><th>Caller</th><th className="r">Assigned</th><th className="r">Delivered</th><th>Delivery rate</th><th className="r">Lost on call</th><th className="r">Lost at delivery</th><th className="r">In progress</th></tr></thead>
          <tbody>
            {callerStats.length === 0 && <tr><td colSpan={7} style={{ padding: "30px", textAlign: "center", color: T.textMuted }}>No callers yet.</td></tr>}
            {callerStats.map(c => (
              <tr key={c.id}>
                <td className="cx-cust"><b>{c.name}</b></td>
                <td className="r cx-num">{c.assigned}</td>
                <td className="r cx-num" style={{ fontWeight: 700, color: T.accent }}>{c.delivered}</td>
                <td><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ flex: 1, maxWidth: "90px", background: T.surfaceAlt, borderRadius: "5px", height: "8px", overflow: "hidden" }}><div style={{ width: `${c.rate}%`, height: "100%", background: c.rate >= 60 ? T.accent : c.rate >= 40 ? T.warning : T.danger }} /></div><span className="cx-num" style={{ fontSize: "12px", fontWeight: 700 }}>{c.rate}%</span></div></td>
                <td className="r cx-num" style={{ color: c.lostCall ? T.danger : T.textMuted }}>{c.lostCall} <span style={{ fontSize: "11px", color: T.textMuted }}>({c.lostCallPct}%)</span></td>
                <td className="r cx-num" style={{ color: T.textMuted }}>{c.lostDel} <span style={{ fontSize: "11px" }}>({c.lostDelPct}%)</span></td>
                <td className="r cx-num">{c.open}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div style={{ padding: "8px 16px", fontSize: "11px", color: T.textMuted, borderTop: `1px solid ${T.borderLight}` }}>Lost on call = phone-skill signal (caller-influenced). Lost at delivery = more about the agent/area.</div>
      </Card>}

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
        <Card style={{ padding: "18px", gridColumn: isMobile ? "auto" : "1/-1" }}>
          <div className="cx-section-t" style={{ marginBottom: "12px" }}>By product</div>
          {(() => {
            const prods = [...new Set(statsOrders.map(o => o.product).filter(Boolean))];
            if (prods.length === 0) return <div style={{ color: T.textMuted, fontSize: "13px" }}>No data yet.</div>;
            const rows = prods.map(p => {
              const po = statsOrders.filter(o => o.product === p);
              const del = po.filter(o => o.status === "delivered");
              return { p, orders: po.length, delivered: del.length, rate: po.length ? Math.round(del.length / po.length * 100) : 0, units: del.reduce((s, o) => s + (o.actual_qty_delivered || o.qty || 0), 0), rev: del.reduce((s, o) => s + (o.actual_price_collected || o.price || 0), 0) };
            }).sort((a, b) => b.rev - a.rev);
            const maxRev = Math.max(...rows.map(r => r.rev), 1);
            return rows.map(r => (
              <div key={r.p} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}><span style={{ width: isMobile ? "90px" : "160px", fontSize: "11px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.p}</span><div style={{ flex: 1, background: T.surfaceAlt, borderRadius: "4px", height: "14px", overflow: "hidden" }}><div style={{ width: `${r.rev / maxRev * 100}%`, background: T.accent, height: "100%", borderRadius: "4px", minWidth: r.rev > 0 ? "2px" : 0 }} /></div><span className="cx-num" style={{ width: "90px", textAlign: "right", fontSize: "11px", fontWeight: 700 }}>{cur}{r.rev.toLocaleString()}</span><span style={{ width: isMobile ? "58px" : "110px", textAlign: "right", fontSize: "10px", color: T.textMuted }}>{r.delivered}/{r.orders} · {r.rate}%{!isMobile && ` · ${r.units}u`}</span></div>
            ));
          })()}
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
      <Card style={{ padding: "12px 16px", marginBottom: "12px", fontSize: "12px", color: T.textMuted }}><strong>Placeholders:</strong> {["{name}","{product}","{address}","{price}","{qty}","{state}","{agent}","{pack}","{phone}","{notes}"].map(p => <code key={p} style={{ marginLeft: "3px", color: T.accent, fontWeight: 700 }}>{p}</code>)}<div style={{ marginTop: "6px" }}>Tip: press <strong>Enter</strong> for a new line, and Enter twice for a blank line between paragraphs — WhatsApp keeps your spacing.</div></Card>
      <div style={{ display: "grid", gap: "10px" }}>{STATUSES.map(s => <TemplateEditor key={s.value} status={s} value={templates[s.value] || ""} onSave={doSaveTemplate} />)}</div>
    </div>
  );

  const ROLE_OPTS = [
    { v: "admin", l: "Admin" }, { v: "manager", l: "Manager" }, { v: "accountant", l: "Accountant" }, { v: "caller", l: "Caller" }, { v: "viewer", l: "Viewer" },
  ];
  const StaffScreen = (
    <div>
      <div className="cx-head">
        <div><h1 className="cx-h1">Staff</h1><div className="cx-sub">Invite people and set what they can access</div></div>
        <Btn onClick={() => setShowAddStaff(true)}><Plus size={16} />Add staff</Btn>
      </div>
      <Card style={{ overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table className="cx-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th className="r">Actions</th></tr></thead>
        <tbody>
          {staff.length === 0 && <tr><td colSpan={5} style={{ padding: "40px", textAlign: "center", color: T.textMuted }}>No staff yet.</td></tr>}
          {staff.map(s => { const isSelf = s.auth_user_id === me?.auth_user_id; return (
            <tr key={s.id}>
              <td className="cx-cust"><b>{s.full_name || "—"}</b>{isSelf && <span style={{ fontSize: "10px", color: T.accent, fontWeight: 700, marginLeft: "6px" }}>YOU</span>}</td>
              <td style={{ fontSize: "12px", color: T.textMuted }}>{s.email}</td>
              <td>
                <select value={s.role} disabled={isSelf} onChange={e => doUpdateStaff(s.id, { role: e.target.value })} style={{ padding: "5px 8px", borderRadius: T.rs, border: `1.5px solid ${T.border}`, fontSize: "12px", background: isSelf ? T.surfaceAlt : T.surface, fontFamily: T.f, cursor: isSelf ? "default" : "pointer" }}>
                  {ROLE_OPTS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </td>
              <td><span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "20px", background: s.active ? T.accentLight : T.dangerBg, color: s.active ? T.accent : T.danger }}>{s.active ? "Active" : "Inactive"}</span></td>
              <td className="r"><div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                {!isSelf && <Btn v="secondary" sz="xs" onClick={() => doUpdateStaff(s.id, { active: !s.active })}>{s.active ? "Deactivate" : "Activate"}</Btn>}
                {!isSelf && <Btn v="ghost" sz="xs" onClick={() => doDeleteStaff(s.id)} style={{ color: T.danger }}><Trash2 size={13} /></Btn>}
              </div></td>
            </tr>
          ); })}
        </tbody>
      </table></div></Card>
      <div style={{ fontSize: "12px", color: T.textMuted, marginTop: "10px" }}>Invited staff receive an email to set their own password. Roles take effect on their next sign-in.</div>
    </div>
  );

  const screen = { orders: OrdersScreen, agents: AgentsScreen, inventory: InventoryScreen, analytics: AnalyticsScreen, templates: TemplatesScreen, staff: caps.staff ? StaffScreen : OrdersScreen }[tab] || OrdersScreen;

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
            {cAgents.length > 0 && <div style={{ gridColumn: "1/-1" }}><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700, marginBottom: "3px" }}>Stock in {o.state || "state"}</div><StockBadge signal={stockSignal(o)} /></div>}
            {(deliveryDateOf(o) || o.delivery_pref) && <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Delivery date</div><div style={{ fontWeight: 600, fontSize: "13px" }}>{fmtDate(deliveryDateOf(o)) || o.delivery_pref}</div></div>}
            {o.payment_option && <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Payment</div><div style={{ fontWeight: 600, fontSize: "13px" }}>{o.payment_option}</div></div>}
            {FEATURE_CALLER && !isCaller && <div><div style={{ fontSize: "10px", color: T.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Caller</div><div style={{ fontWeight: 600, fontSize: "13px" }}>{o.assigned_to ? (staffByUid[o.assigned_to]?.full_name || staffByUid[o.assigned_to]?.email || "Assigned") : "— Unassigned —"}</div></div>}
            {o.notes && <div style={{ gridColumn: "1/-1", background: T.warningBg, padding: "10px 12px", borderRadius: T.rs }}><div style={{ fontSize: "10px", color: T.warning, textTransform: "uppercase", fontWeight: 700 }}>Notes</div><div style={{ fontSize: "13px", color: "#92400e" }}>{o.notes}</div></div>}
          </div>
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "12px", marginBottom: "8px", display: "flex", gap: "8px" }}>
            <a href={`tel:${cleanPhone(o.phone)}`} style={{ textDecoration: "none", flex: 1 }}><Btn v="secondary" style={{ width: "100%", justifyContent: "center" }}><Phone size={15} />Call customer</Btn></a>
            {FEATURE_CALLER && <Btn v="secondary" onClick={() => copyOrder(o)} style={{ flex: 1, justifyContent: "center" }}><Copy size={15} />Copy for WhatsApp</Btn>}
          </div>
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "12px" }}><div style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "6px", textTransform: "uppercase" }}>Send WhatsApp</div><div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>{STATUSES.map(s => <a key={s.value} href={getWALink(o, s.value)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><Btn v={o.status === s.value ? "whatsapp" : "secondary"} sz="sm" style={{ fontSize: "11px" }}>{s.icon} {s.label}</Btn></a>)}</div></div>
          {orderEvents.length > 0 && <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "12px", marginTop: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "8px", textTransform: "uppercase" }}>Status history</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {orderEvents.map(ev => (
                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                  <span style={{ color: T.textLight, minWidth: "112px" }}>{new Date(ev.changed_at).toLocaleString()}</span>
                  {ev.from_status && <><Pill status={ev.from_status} /><span style={{ color: T.textLight }}>→</span></>}
                  <Pill status={ev.to_status} />
                </div>
              ))}
            </div>
          </div>}
        </div>; })()}
      </Modal>

      <Modal open={!!editOrder} onClose={() => setEditOrder(null)} title="Edit order" wide>
        {editOrder && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 10px" }}>
          <Inp label="Name" value={editOrder.name} onChange={e => setEditOrder(p => ({ ...p, name: e.target.value }))} />
          <Inp label="Phone" value={editOrder.phone} onChange={e => setEditOrder(p => ({ ...p, phone: e.target.value }))} />
          <Inp label="WhatsApp" value={editOrder.whatsapp} onChange={e => setEditOrder(p => ({ ...p, whatsapp: e.target.value }))} />
          <Inp label={country === "ghana" ? "Region" : "State"} value={editOrder.state} onChange={e => setEditOrder(p => ({ ...p, state: e.target.value }))} />
          <div style={{ gridColumn: "1/-1" }}><Inp label="Address" value={editOrder.address} onChange={e => setEditOrder(p => ({ ...p, address: e.target.value }))} /></div>
          {FEATURE_CALLER && <div style={{ gridColumn: "1/-1" }}><Inp label="Landmark" value={editOrder.landmark || ""} onChange={e => setEditOrder(p => ({ ...p, landmark: e.target.value }))} /></div>}
          <Inp label="Product" value={editOrder.product} onChange={e => setEditOrder(p => ({ ...p, product: e.target.value }))} />
          <Inp label="Pack" value={editOrder.pack_name} onChange={e => setEditOrder(p => ({ ...p, pack_name: e.target.value }))} />
          <Inp label="Qty" type="number" disabled={isCaller} value={editOrder.qty} onChange={e => setEditOrder(p => ({ ...p, qty: +e.target.value || 1 }))} />
          <Inp label={`Price (${cur})`} type="number" disabled={isCaller} value={editOrder.price} onChange={e => setEditOrder(p => ({ ...p, price: +e.target.value || 0 }))} />
          <Inp label="Qty delivered" type="number" value={editOrder.actual_qty_delivered} onChange={e => setEditOrder(p => ({ ...p, actual_qty_delivered: +e.target.value || 0 }))} />
          <Inp label={`Collected (${cur})`} type="number" value={editOrder.actual_price_collected} onChange={e => setEditOrder(p => ({ ...p, actual_price_collected: +e.target.value || 0 }))} />
          <Inp label={`Delivery fee (${cur})`} type="number" disabled={isCaller} value={editOrder.delivery_fee} onChange={e => setEditOrder(p => ({ ...p, delivery_fee: +e.target.value || 0 }))} />
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Agent</label>
            <select value={editOrder.agent_id || ""} onChange={e => { const a = agents.find(x => x.id === e.target.value); setEditOrder(p => ({ ...p, agent_id: e.target.value || null, agent_name: a?.name || "" })); }} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>
              <option value="">Unassigned</option>
              {cAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "10px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "4px", textTransform: "uppercase" }}>Status</label>
            <select value={editOrder.status} onChange={e => setEditOrder(p => ({ ...p, status: e.target.value }))} style={{ width: "100%", padding: "10px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "13px", background: T.surfaceAlt }}>{GROUPS.map(g => <optgroup key={g.id} label={g.label}>{STATUSES.filter(s => s.group === g.id).map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}</optgroup>)}</select></div>
          <Inp label="Delivery date" type="date" value={toISODate(editOrder.delivery_date) || toISODate(deliveryDateOf(editOrder))} onChange={e => setEditOrder(p => ({ ...p, delivery_date: e.target.value }))} />
          <div style={{ gridColumn: "1/-1" }}><Inp label="Payment option" value={editOrder.payment_option || ""} onChange={e => setEditOrder(p => ({ ...p, payment_option: e.target.value }))} /></div>
          <div style={{ gridColumn: "1/-1" }}><Inp label="Notes" value={editOrder.notes} onChange={e => setEditOrder(p => ({ ...p, notes: e.target.value }))} /></div>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}><Btn onClick={() => doSaveOrder(editOrder)} style={{ flex: 1, justifyContent: "center" }}>Save</Btn><Btn v="secondary" onClick={() => setEditOrder(null)}>Cancel</Btn></div>
        </div>}
      </Modal>

      <Modal open={!!showAssign} onClose={() => { setShowAssign(null); setAssignAll(false); }} title="Assign agent">
        {(() => {
          if (cAgents.length === 0) return <p style={{ color: T.textMuted, textAlign: "center", padding: "20px" }}>No agents yet.</p>;
          const order = orders.find(o => o.id === showAssign);
          const oState = order?.state || "", oProduct = order?.product || "", need = order?.qty || 1;
          const covering = cAgents.filter(a => (a.states || []).includes(oState));
          const showList = assignAll || covering.length === 0 ? cAgents : covering;
          const stockOf = a => inventory.filter(i => i.agent_id === a.id && i.product_name === oProduct).reduce((s, i) => s + i.qty, 0);
          return <div style={{ display: "grid", gap: "6px" }}>
            <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "2px" }}>
              {covering.length > 0 && !assignAll ? <>Agents covering <b style={{ color: T.text }}>{oState}</b></> : <>All agents{oState && covering.length === 0 ? <> · <span style={{ color: T.danger, fontWeight: 700 }}>none cover {oState}</span></> : null}</>}
            </div>
            {showList.map(a => { const stk = stockOf(a); return (
              <button key={a.id} onClick={() => doAssign(showAssign, a.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: T.surfaceAlt, border: `1.5px solid ${T.border}`, borderRadius: T.r, cursor: "pointer", fontFamily: T.f, width: "100%", textAlign: "left" }}>
                <div><div style={{ fontWeight: 700 }}>{a.name}</div><div style={{ fontSize: "11px", color: T.textMuted }}>{(a.states || []).join(", ") || "no states set"}</div></div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: "12px", color: stk === 0 ? T.danger : stk < need ? T.warning : T.accent }}>{stk} in stock</div>
                  <div className="cx-num" style={{ fontSize: "11px", color: T.textMuted }}>{agentSt[a.id]?.rate ?? "—"}% delivered</div>
                </div>
              </button>
            ); })}
            {covering.length > 0 && <button onClick={() => setAssignAll(v => !v)} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontFamily: T.f, fontSize: "12px", fontWeight: 700, padding: "6px" }}>{assignAll ? `Show only agents in ${oState}` : "Show all agents (other states)"}</button>}
          </div>;
        })()}
      </Modal>

      <Modal open={showAddAgent} onClose={() => setShowAddAgent(false)} title="Add agent">
        <AgentForm onSubmit={doAddAgent} country={country} knownStates={states} />
      </Modal>

      <Modal open={!!editAgent} onClose={() => setEditAgent(null)} title="Edit agent">
        {editAgent && <AgentForm key={editAgent.id} agent={editAgent} onSubmit={doEditAgent} country={country} knownStates={states} />}
      </Modal>

      <Modal open={showAddProduct} onClose={() => setShowAddProduct(false)} title="Add product">
        <ProductForm onSubmit={doAddProduct} />
      </Modal>

      <Modal open={showAddOrder} onClose={() => setShowAddOrder(false)} title="Add order" wide>
        <OrderForm country={country} cur={cur} onSubmit={doAddOrder} />
      </Modal>

      <Modal open={!!showStock} onClose={() => setShowStock(null)} title={`Stock — ${agents.find(a => a.id === showStock)?.name || ""}`}>
        {showStock && <StockMgr agentId={showStock} products={products} inventory={inventory} onUpdate={doUpdateStock} canEdit={caps.inventory === "edit"} />}
      </Modal>

      <Modal open={showAddWaybill} onClose={() => setShowAddWaybill(false)} title="New waybill">
        <WaybillForm products={products} agents={cAgents} onSubmit={doAddWaybill} />
      </Modal>

      <Modal open={showAddPurchase} onClose={() => setShowAddPurchase(false)} title="Record purchase">
        <PurchaseForm products={products} cur={cur} onSubmit={doAddPurchase} />
      </Modal>

      <Modal open={showAddFaulty} onClose={() => setShowAddFaulty(false)} title="Log faulty / returned stock">
        <FaultyForm products={products} agents={cAgents} onSubmit={doAddFaulty} />
      </Modal>

      <Modal open={showAddTransfer} onClose={() => setShowAddTransfer(false)} title="Transfer stock between agents">
        <TransferForm products={products} agents={cAgents} onSubmit={doAddTransfer} />
      </Modal>

      <Modal open={showAddStaff} onClose={() => setShowAddStaff(false)} title="Invite staff member">
        <StaffForm onSubmit={doInviteStaff} />
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
            <CountrySeg inRail country={country} onChange={setCountrySafe} counts={countryCounts} />
            <button onClick={doSignOut} title={`Sign out${me ? " — " + me.full_name : ""}`} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.7)", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}><LogOut size={15} /></button>
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
            <CountrySeg country={country} onChange={setCountrySafe} counts={countryCounts} />
            <button className="cx-iconbtn" onClick={() => { setSyncError(false); loadAll(); }} title="Refresh"><RefreshCw size={16} /></button>
            {me && <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 4px 0 8px", borderLeft: `1px solid ${T.border}` }}>
              <div style={{ textAlign: "right", lineHeight: 1.15 }}>
                <div style={{ fontSize: "12.5px", fontWeight: 700, color: T.text }}>{me.full_name || me.email}</div>
                <div style={{ fontSize: "10px", color: T.textMuted, textTransform: "capitalize" }}>{me.role}</div>
              </div>
              <button className="cx-iconbtn" onClick={doSignOut} title="Sign out"><LogOut size={16} /></button>
            </div>}
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

function AgentForm({ onSubmit, country, agent, knownStates = [] }) {
  const [n, sN] = useState(agent?.name || "");
  const [p, sP] = useState(agent?.phone || "");
  const [s, sS] = useState((agent?.states || []).join(", "));
  const label = country === "ghana" ? "region" : "state";
  const current = s.split(",").map(x => x.trim()).filter(Boolean);
  const addState = st => sS(current.includes(st) ? s : [...current, st].join(", "));
  const missing = knownStates.filter(st => !current.includes(st));
  return <div>
    <Inp label="Name" value={n} onChange={e => sN(e.target.value)} />
    <Inp label="Phone" value={p} onChange={e => sP(e.target.value)} />
    <Inp label={`${country === "ghana" ? "Regions" : "States"} (comma-separated)`} value={s} onChange={e => sS(e.target.value)} />
    {missing.length > 0 && <div style={{ marginTop: "-4px", marginBottom: "10px" }}>
      <div style={{ fontSize: "10px", color: T.textMuted, marginBottom: "5px" }}>Tap a {label} from your orders to add it exactly as spelt:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {missing.map(st => <button key={st} type="button" onClick={() => addState(st)} style={{ fontSize: "11px", background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "3px 8px", cursor: "pointer", fontFamily: T.f, color: T.text }}>+ {st}</button>)}
      </div>
    </div>}
    <Btn onClick={() => { if (n) onSubmit({ name: n, phone: p, states: current }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>{agent ? "Save changes" : "Add agent"}</Btn>
  </div>;
}

function ProductForm({ onSubmit }) {
  const [n, sN] = useState("");
  return <div><Inp label="Product name" value={n} onChange={e => sN(e.target.value)} /><Btn onClick={() => { if (n) onSubmit(n); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Add product</Btn></div>;
}

const fLbl = { display: "block", fontSize: "11px", fontWeight: 700, color: T.textMuted, marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.6px" };
const fSel = { width: "100%", padding: "10px 13px", border: `1.5px solid ${T.border}`, borderRadius: T.rs, fontSize: "14px", fontFamily: T.f, background: T.surface, marginBottom: "12px", boxSizing: "border-box" };

function WaybillForm({ products, agents, onSubmit }) {
  const [pn, setPn] = useState(products[0]?.name || "");
  const [ag, setAg] = useState("");
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState("");
  return <div>
    {products.length === 0 && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "8px" }}>Add a product first.</div>}
    {agents.length === 0 && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "8px" }}>Add an agent first.</div>}
    <label style={fLbl}>Product</label>
    <select value={pn} onChange={e => setPn(e.target.value)} style={fSel}>{products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
    <label style={fLbl}>Agent</label>
    <select value={ag} onChange={e => setAg(e.target.value)} style={fSel}><option value="">Select agent…</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <Inp label="Quantity" type="number" value={qty} onChange={e => setQty(+e.target.value || 0)} />
    {err && <div style={{ color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>{err}</div>}
    <Btn onClick={() => { if (!pn) return setErr("Pick a product."); if (!ag) return setErr("Pick an agent."); if (qty < 1) return setErr("Quantity must be at least 1."); onSubmit({ product_name: pn, agent_id: ag, quantity: qty }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Create waybill</Btn>
  </div>;
}

function PurchaseForm({ products, cur, onSubmit }) {
  const [pn, setPn] = useState(products[0]?.name || "");
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return <div>
    {products.length === 0 && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "8px" }}>Add a product first.</div>}
    <label style={fLbl}>Product</label>
    <select value={pn} onChange={e => setPn(e.target.value)} style={fSel}>{products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
    <Inp label="Quantity" type="number" value={qty} onChange={e => setQty(+e.target.value || 0)} />
    <Inp label={`Unit cost (${cur}) — optional`} type="number" value={cost} onChange={e => setCost(e.target.value)} />
    <Inp label="Note — optional" value={note} onChange={e => setNote(e.target.value)} />
    {err && <div style={{ color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>{err}</div>}
    <Btn onClick={() => { if (!pn) return setErr("Pick a product."); if (qty < 1) return setErr("Quantity must be at least 1."); onSubmit({ product_name: pn, quantity: qty, unit_cost: cost === "" ? null : +cost, note }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Record purchase</Btn>
  </div>;
}

function TemplateEditor({ status, value, onSave }) {
  const [text, setText] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { setText(value || ""); }, [value]);
  const dirty = text !== (value || "");
  const save = async () => {
    setSaving(true);
    try { await onSave(status.value, text); setJustSaved(true); setTimeout(() => setJustSaved(false), 2000); }
    catch { /* toast shown by onSave */ }
    setSaving(false);
  };
  return (
    <Card style={{ padding: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <Pill status={status.value} />
        {dirty ? <Btn sz="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
          : justSaved ? <span style={{ fontSize: "12px", color: T.accent, fontWeight: 700 }}>✓ Saved</span>
            : <span style={{ fontSize: "11px", color: T.textLight }}>Up to date</span>}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
        placeholder="Write the WhatsApp message for this status. Use {name}, {product}, {price} etc. Press Enter for line breaks."
        style={{ width: "100%", padding: "10px", border: `1.5px solid ${dirty ? T.accent : T.border}`, borderRadius: T.rs, fontSize: "13px", fontFamily: T.f, resize: "vertical", boxSizing: "border-box", outline: "none", background: T.surfaceAlt, lineHeight: 1.5 }} />
      {dirty && <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "4px" }}>Unsaved changes — click Save.</div>}
    </Card>
  );
}

function StaffForm({ onSubmit }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("caller");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!fullName.trim()) return setErr("Name is required.");
    if (!email.trim()) return setErr("Email is required.");
    setErr(""); setBusy(true);
    await onSubmit({ full_name: fullName.trim(), email: email.trim(), role, phone: phone.trim() });
    setBusy(false);
  };
  return <div>
    <Inp label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} />
    <Inp label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
    <Inp label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
    <label style={fLbl}>Role</label>
    <select value={role} onChange={e => setRole(e.target.value)} style={fSel}>
      <option value="admin">Admin — full access</option>
      <option value="manager">Manager — everything except staff</option>
      <option value="accountant">Accountant — view + analytics</option>
      <option value="caller">Caller — confirm orders</option>
      <option value="viewer">Viewer — read only</option>
    </select>
    {err && <div style={{ color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>{err}</div>}
    <Btn onClick={submit} disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>{busy ? "Sending invite…" : "Send invite"}</Btn>
    <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "10px", textAlign: "center" }}>They'll get an email to set their own password.</div>
  </div>;
}

function TransferForm({ products, agents, onSubmit }) {
  const [pn, setPn] = useState(products[0]?.name || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState("");
  return <div>
    {agents.length < 2 && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "8px" }}>You need at least two agents to transfer between.</div>}
    <label style={fLbl}>Product</label>
    <select value={pn} onChange={e => setPn(e.target.value)} style={fSel}>{products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
    <label style={fLbl}>From agent</label>
    <select value={from} onChange={e => setFrom(e.target.value)} style={fSel}><option value="">Select agent…</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <label style={fLbl}>To agent</label>
    <select value={to} onChange={e => setTo(e.target.value)} style={fSel}><option value="">Select agent…</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <Inp label="Quantity" type="number" value={qty} onChange={e => setQty(+e.target.value || 0)} />
    {err && <div style={{ color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>{err}</div>}
    <Btn onClick={() => { if (!pn) return setErr("Pick a product."); if (!from) return setErr("Pick the source agent."); if (!to) return setErr("Pick the destination agent."); if (from === to) return setErr("Source and destination must be different."); if (qty < 1) return setErr("Quantity must be at least 1."); onSubmit({ product_name: pn, from_agent_id: from, to_agent_id: to, quantity: qty }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Transfer</Btn>
  </div>;
}

function FaultyForm({ products, agents, onSubmit }) {
  const [pn, setPn] = useState(products[0]?.name || "");
  const [src, setSrc] = useState("warehouse");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  return <div>
    {products.length === 0 && <div style={{ color: T.danger, fontSize: "12px", marginBottom: "8px" }}>Add a product first.</div>}
    <label style={fLbl}>Product</label>
    <select value={pn} onChange={e => setPn(e.target.value)} style={fSel}>{products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
    <label style={fLbl}>From</label>
    <select value={src} onChange={e => setSrc(e.target.value)} style={fSel}><option value="warehouse">Warehouse</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <Inp label="Quantity" type="number" value={qty} onChange={e => setQty(+e.target.value || 0)} />
    <Inp label="Reason — optional" value={reason} onChange={e => setReason(e.target.value)} />
    {err && <div style={{ color: T.danger, fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>{err}</div>}
    <Btn onClick={() => { if (!pn) return setErr("Pick a product."); if (qty < 1) return setErr("Quantity must be at least 1."); onSubmit({ product_name: pn, agent_id: src === "warehouse" ? null : src, quantity: qty, reason }); }} style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}>Log faulty</Btn>
  </div>;
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

function StockItem({ agentId, product, qty, onUpdate, canEdit }) {
  const [local, setLocal] = useState(qty);
  useEffect(() => { setLocal(qty); }, [qty]);
  const commit = (val) => { const n = Math.max(0, val); setLocal(n); onUpdate(agentId, product, n); };
  if (!canEdit) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: T.surfaceAlt, borderRadius: T.rs }}>
      <div style={{ fontWeight: 700, fontSize: "13px" }}>{product}</div>
      <div className="cx-num" style={{ fontWeight: 800, fontSize: "16px" }}>{qty}</div>
    </div>
  );
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

function StockMgr({ agentId, products, inventory, onUpdate, canEdit }) {
  const getQ = pid => inventory.find(i => i.agent_id === agentId && i.product_name === pid)?.qty || 0;
  return products.length === 0 ? <p style={{ color: T.textMuted, textAlign: "center", padding: "20px" }}>No products yet.</p> : (
    <div style={{ display: "grid", gap: "8px" }}>
      {products.map(p => <StockItem key={p.id} agentId={agentId} product={p.name} qty={getQ(p.name)} onUpdate={onUpdate} canEdit={canEdit} />)}
    </div>
  );
}
