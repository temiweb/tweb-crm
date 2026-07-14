// scripts/seed-demo.js
// ------------------------------------------------------------------
// Seeds THROWAWAY demo data for a training-walkthrough recording.
// Additive only — inserts 1 test agent (+ its stock) and 12 demo orders.
// Every order is stamped source="demo"; wipe it all with delete-demo.js.
//
// Reads SEED_SUPABASE_URL + SEED_SERVICE_ROLE_KEY from .env.seed (gitignored).
// Run:  node scripts/seed-demo.js
// ------------------------------------------------------------------
import fs from "node:fs";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Everything comes from .env.seed — you only edit that one file.
const env = { ...loadEnv(".env.seed"), ...process.env };
const URL = env.SEED_SUPABASE_URL;
const KEY = env.SEED_SERVICE_ROLE_KEY;
const CONFIG = {
  callerEmail: env.SEED_CALLER_EMAIL || "temmyadeweb@gmail.com",
  demoPhone: env.SEED_DEMO_PHONE || "",
};

const DEMO_SOURCE = "demo";
const AGENT_NAME = "TEST AGENT — DEMO";

if (!URL || !KEY) { console.error("✗ Open .env.seed and fill in SEED_SUPABASE_URL and SEED_SERVICE_ROLE_KEY."); process.exit(1); }
if (!CONFIG.demoPhone || CONFIG.demoPhone.includes("X")) { console.error("✗ Open .env.seed and set SEED_DEMO_PHONE to your phone number."); process.exit(1); }

async function api(method, path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}

const now = Date.now();
const hAgo = (h) => new Date(now - h * 3600e3).toISOString();
const P = CONFIG.demoPhone;

// 12 orders: 5 Pending, 2 Call Back, 2 Confirmed, 2 In Transit, 1 Delivered
const specs = [
  { n: "Demo Customer One",    st: "pending",    age: 30, state: "Lagos",     addr: "14 Adeniyi Jones Ave, Ikeja",           lm: "Opposite GTBank",              prod: "Net Repair Tape",       pack: "Buy 1 Net Repair Tape",       qty: 1, price: 5500,  pref: "Today" },
  { n: "Demo Customer Two",    st: "pending",    age: 26, state: "Lagos",     addr: "7 Admiralty Way, Lekki Phase 1",        lm: "Near Circle Mall",             prod: "Heavy Duty Mesh Tape",  pack: "Buy 2 Heavy-Duty Mesh Tapes", qty: 2, price: 28000, pref: "Tomorrow" },
  { n: "Demo Customer Three",  st: "pending",    age: 20, state: "FCT Abuja", addr: "22 Aminu Kano Cres, Wuse 2",            lm: "Beside Sahad Stores",          prod: "Net Repair Tape",       pack: "Buy 2 Net Repair Tapes",      qty: 2, price: 9500,  pref: "Today" },
  { n: "Demo Customer Four",   st: "pending",    age: 14, state: "FCT Abuja", addr: "5 Gana St, Maitama",                    lm: "Off IBB Way",                  prod: "Heavy Duty Mesh Tape",  pack: "Buy 3 Heavy-Duty Mesh Tapes", qty: 3, price: 40000, pref: "Tomorrow" },
  { n: "Demo Customer Five",   st: "pending",    age: 8,  state: "Rivers",    addr: "18 Aba Rd, Port Harcourt",              lm: "Near Garrison Junction",       prod: "Net Repair Tape",       pack: "Buy 1 Net Repair Tape",       qty: 1, price: 5500,  pref: "Today" },
  { n: "Demo Customer Six",    st: "call_back",  age: 24, state: "Oyo",       addr: "3 Ring Rd, Ibadan",                     lm: "Opposite Cocoa House",         prod: "Heavy Duty Mesh Tape",  pack: "Buy 2 Heavy-Duty Mesh Tapes", qty: 2, price: 28000, pref: "Tomorrow" },
  { n: "Demo Customer Seven",  st: "call_back",  age: 10, state: "Lagos",     addr: "9 Bode Thomas St, Surulere",            lm: "Near Leventis",                prod: "Net Repair Tape",       pack: "Buy 2 Net Repair Tapes",      qty: 2, price: 9500,  pref: "Today" },
  { n: "Demo Customer Eight",  st: "confirmed",  age: 6,  state: "FCT Abuja", addr: "11 Ademola Adetokunbo Cres, Wuse 2",    lm: "Near Transcorp Hilton",        prod: "Net Repair Tape",       pack: "Buy 1 Net Repair Tape",       qty: 1, price: 5500,  pref: "Today" },
  { n: "Demo Customer Nine",   st: "confirmed",  age: 5,  state: "Rivers",    addr: "27 Woji Rd, GRA Phase 2, Port Harcourt", lm: "Near Pizza Jungle",           prod: "Heavy Duty Mesh Tape",  pack: "Buy 2 Heavy-Duty Mesh Tapes", qty: 2, price: 28000, pref: "Tomorrow" },
  { n: "Demo Customer Ten",    st: "in_transit", age: 12, state: "Lagos",     addr: "6 Allen Ave, Ikeja",                    lm: "Near Computer Village",        prod: "Net Repair Tape",       pack: "Buy 2 Net Repair Tapes",      qty: 2, price: 9500,  pref: "Today" },
  { n: "Demo Customer Eleven", st: "in_transit", age: 9,  state: "Lagos",     addr: "40 Awolowo Rd, Ikoyi",                  lm: "Near Falomo Roundabout",       prod: "Heavy Duty Mesh Tape",  pack: "Buy 3 Heavy-Duty Mesh Tapes", qty: 3, price: 40000, pref: "Today" },
  { n: "Demo Customer Twelve", st: "delivered",  age: 36, state: "Lagos",     addr: "2 Ogunlana Dr, Surulere",               lm: "Near National Stadium",        prod: "Net Repair Tape",       pack: "Buy 1 Net Repair Tape",       qty: 1, price: 5500,  pref: "Today" },
];

function buildRow(s, callerUid, agentId) {
  const created = hAgo(s.age);
  // Every row carries the SAME keys (PostgREST bulk-insert requires it);
  // status-specific values are filled below.
  const row = {
    name: s.n, phone: P, whatsapp: P,
    address: s.addr, landmark: s.lm, state: s.state,
    product: s.prod, pack_name: s.pack, qty: s.qty, price: s.price,
    status: s.st, country: "nigeria",
    delivery_pref: s.pref || "", payment_option: "Payment on Delivery (Pay in full at delivery)",
    notes: "DEMO — training walkthrough (delete after recording)",
    source: DEMO_SOURCE,
    assigned_to: callerUid, assigned_at: created,
    delivery_fee: 0, actual_qty_delivered: 0, actual_price_collected: 0,
    created_at: created,
    confirmed_at: null, dispatched_at: null, delivered_at: null,
    agent_id: null, agent_name: "", call_attempts: 0,
  };
  const confirmed = hAgo(Math.max(0, s.age - 0.5));
  const dispatched = hAgo(Math.max(0, s.age - 1));
  const delivered = hAgo(Math.max(0, s.age - 1.5));
  if (s.st === "confirmed") row.confirmed_at = confirmed;
  if (s.st === "in_transit") { row.confirmed_at = confirmed; row.dispatched_at = dispatched; row.agent_id = agentId; row.agent_name = AGENT_NAME; }
  if (s.st === "delivered") { row.confirmed_at = confirmed; row.dispatched_at = dispatched; row.delivered_at = delivered; row.agent_id = agentId; row.agent_name = AGENT_NAME; row.actual_qty_delivered = s.qty; row.actual_price_collected = s.price; }
  if (s.st === "call_back") row.call_attempts = 1;
  return row;
}

(async () => {
  console.log(`\nSeeding DEMO data into: ${URL}`);
  console.log(`(Ctrl-C now if that is not the project you intended.)\n`);

  // 1. Resolve the caller's user id from their Staff email
  const staffRows = await api("GET", `staff?email=eq.${encodeURIComponent(CONFIG.callerEmail)}&select=auth_user_id`);
  if (!staffRows.length || !staffRows[0].auth_user_id) {
    console.error(`✗ No Staff account found for ${CONFIG.callerEmail}. Add them in the CRM (Staff → Add staff), or fix CONFIG.callerEmail.`);
    process.exit(1);
  }
  const callerUid = staffRows[0].auth_user_id;

  // 2. Test agent
  const [agent] = await api("POST", "agents", { name: AGENT_NAME, phone: P, states: ["Lagos"], country: "nigeria" });
  console.log(`✔ Test agent created: "${AGENT_NAME}"`);

  // 3. Stock for the test agent (so demo deliveries don't touch real agents)
  await api("POST", "inventory", [
    { agent_id: agent.id, product_name: "Net Repair Tape", qty: 50 },
    { agent_id: agent.id, product_name: "Heavy Duty Mesh Tape", qty: 50 },
  ]);
  console.log(`✔ Test agent stocked: 50× Net Repair Tape, 50× Heavy Duty Mesh Tape`);

  // 4. Orders
  const rows = specs.map((s) => buildRow(s, callerUid, agent.id));
  const created = await api("POST", "orders", rows);
  const byStatus = created.reduce((m, o) => ((m[o.status] = (m[o.status] || 0) + 1), m), {});
  console.log(`✔ ${created.length} demo orders created, assigned to ${CONFIG.callerEmail}:`);
  console.log(`   ${Object.entries(byStatus).map(([k, v]) => `${v}× ${k}`).join(", ")}`);

  console.log(`\nAll demo rows are marked source="demo".`);
  console.log(`When you're done recording, wipe everything with:  node scripts/delete-demo.js\n`);
})().catch((e) => { console.error("\n✗ Seed failed:", e.message); process.exit(1); });
