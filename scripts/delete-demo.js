// scripts/delete-demo.js
// ------------------------------------------------------------------
// Removes everything seed-demo.js created: all orders with source="demo"
// (their status-history cascades automatically) and the TEST AGENT + its
// stock. Touches nothing else. Safe to run more than once.
//
// Reads SEED_SUPABASE_URL + SEED_SERVICE_ROLE_KEY from .env.seed (gitignored).
// Run:  node scripts/delete-demo.js
// ------------------------------------------------------------------
import fs from "node:fs";

const AGENT_NAME = "TEST AGENT — DEMO";

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

const env = { ...loadEnv(".env.seed"), ...process.env };
const URL = env.SEED_SUPABASE_URL;
const KEY = env.SEED_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("✗ Missing SEED_SUPABASE_URL / SEED_SERVICE_ROLE_KEY in .env.seed"); process.exit(1); }

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

(async () => {
  console.log(`\nDeleting DEMO data from: ${URL}\n`);

  // 1. Delete demo orders (source="demo"). order_status_events cascade via FK.
  const delOrders = await api("DELETE", "orders?source=eq.demo&select=id");
  console.log(`✔ Deleted ${Array.isArray(delOrders) ? delOrders.length : 0} demo orders`);

  // 2. Delete the test agent(s) + their stock.
  const agents = await api("GET", `agents?name=eq.${encodeURIComponent(AGENT_NAME)}&select=id`);
  for (const a of agents) {
    await api("DELETE", `inventory?agent_id=eq.${a.id}`);
    await api("DELETE", `agents?id=eq.${a.id}`);
  }
  console.log(`✔ Deleted ${agents.length} test agent(s) and their stock`);

  console.log(`\nDone — the CRM is back to just your real data.\n`);
})().catch((e) => { console.error("\n✗ Teardown failed:", e.message); process.exit(1); });
