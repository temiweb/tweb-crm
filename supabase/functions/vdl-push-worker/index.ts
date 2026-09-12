// ============================================================
// vdl-push-worker — pushes APPROVED Ghana orders to VDL /orders/create.
// Invoke manually during Phase 3; schedule (every ~5 min) only once proven.
//
// Safety: only touches vdl_sync_status='approved' rows; claims them
// atomically via claim_vdl_push_batch (no double-push); serialises calls;
// on a 200 runs the price guard; on 401 halts globally; on 5xx trips a
// circuit breaker; a timeout is NEVER blind-retried — the next attempt
// first searches VDL by phone so a timed-out-but-created order is not
// duplicated (there is no cancel endpoint).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), VDL_API_BASE_URL,
//      VDL_API_TOKEN, VDL_DISCOUNT_PER_UNIT (true/false), VDL_PUSH_BATCH
//      (default 3), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const DISCOUNT_PER_UNIT = (Deno.env.get("VDL_DISCOUNT_PER_UNIT") ?? "false").toLowerCase() === "true";
const BATCH = parseInt(Deno.env.get("VDL_PUSH_BATCH") ?? "3", 10);
const BACKOFF_MIN = [2, 8, 30, 120, 480];

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
const vdlHeaders = { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json", "Content-Type": "application/json" };

async function alert(level: "info" | "warn" | "error", message: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  const text = `${{ info: "ℹ️", warn: "🟠", error: "🔴" }[level]} ${message}`;
  if (!token || !chatId) { console.error(`[alert:${level}] ${message}`); return; }
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }), signal: ctrl.signal }).finally(() => clearTimeout(t));
  } catch (e) { console.error(`[alert] ${e instanceof Error ? e.message : String(e)}`); }
}

const patch = (orderId: string, body: Record<string, unknown>) =>
  fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?order_id=eq.${orderId}`, { method: "PATCH", headers: svc, body: JSON.stringify(body) });

async function hold(v: Record<string, unknown>, error: string, name: string) {
  await patch(v.order_id as string, { vdl_sync_status: "held", vdl_sync_error: error });
  await alert("warn", `Ghana push held (${error}): ${name} — fix in Ghana → Held`);
}

async function backoff(v: Record<string, unknown>) {
  const n = ((v.vdl_sync_attempts as number) || 0) + 1;
  if (n >= 5) {
    await patch(v.order_id as string, { vdl_sync_status: "failed", vdl_sync_error: "retries exhausted", vdl_sync_attempts: n });
    await alert("error", `Ghana push failed after ${n} attempts (order ${v.order_id}). Needs manual handling.`);
  } else {
    const mins = BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)];
    await patch(v.order_id as string, { vdl_sync_status: "approved", vdl_sync_attempts: n, vdl_next_attempt_at: new Date(Date.now() + mins * 60000).toISOString() });
  }
}

// Write the VDL response onto the sidecar and mark synced.
async function writeSynced(orderId: string, d: Record<string, unknown>) {
  await patch(orderId, {
    vdl_sync_status: "synced", vdl_synced_at: new Date().toISOString(), vdl_sync_error: null,
    vdl_order_id: d.id ?? null, vdl_tracking_id: d.tracking_id ?? null,
    vdl_state_label: (d.model_state as Record<string, unknown>)?.label ?? null,
    vdl_amount_due_customer: d.amount_due_customer ?? null, vdl_vendor_amount_due: d.vendor_amount_due ?? null,
    vdl_commission_amount: d.commission_amount ?? null, vdl_delivery_fee: d.delivery_fee ?? null,
    vdl_packaging_fee: d.packaging_fee ?? null,
  });
}

// On a retry, check whether a timed-out push actually created the order.
async function findRecentVdlOrder(phone: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${VDL_BASE}/orders?search=${encodeURIComponent(phone)}&per_page=20`, { headers: vdlHeaders });
    if (!r.ok) return null;
    const body = await r.json();
    const container = body?.data ?? body;
    const rows: Record<string, unknown>[] = Array.isArray(container) ? container : (container?.data ?? []);
    const cutoff = Date.now() - 3600_000; // within the last hour
    return rows.find(o => {
      const ph = String(o.customer_phone_number ?? "").replace(/\D/g, "");
      const created = Date.parse(String(o.created_at ?? "")) || 0;
      return ph.endsWith(phone.replace(/\D/g, "").slice(-9)) && created >= cutoff;
    }) ?? null;
  } catch { return null; }
}

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async () => {
  if (!VDL_BASE || !VDL_TOKEN) return json(400, { ok: false, error: "VDL_API_BASE_URL / VDL_API_TOKEN not set" });

  // 0) Reclaim any orders orphaned in 'pushing' by a prior crashed run (>15 min).
  await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?vdl_sync_status=eq.pushing&updated_at=lt.${new Date(Date.now() - 15 * 60000).toISOString()}`,
    { method: "PATCH", headers: svc, body: JSON.stringify({ vdl_sync_status: "approved" }) }).catch(() => {});

  // 1) Claim a batch atomically.
  const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_vdl_push_batch`, { method: "POST", headers: svc, body: JSON.stringify({ p_limit: BATCH }) });
  if (!claimRes.ok) { const t = await claimRes.text(); await alert("error", `vdl-push-worker: claim failed ${claimRes.status}: ${t.slice(0, 150)}`); return json(502, { ok: false, error: t }); }
  const claimed: Record<string, unknown>[] = await claimRes.json();
  if (!claimed.length) return json(200, { ok: true, pushed: 0, message: "nothing approved" });

  // 2) Reference data + order details.
  const regRows = await (await fetch(`${SUPABASE_URL}/rest/v1/gh_regions?select=name,vdl_region_id`, { headers: svc })).json();
  const regionId: Record<string, number> = {}; regRows.forEach((r: Record<string, unknown>) => { regionId[String(r.name).trim().toLowerCase()] = r.vdl_region_id as number; });
  const prodRows = await (await fetch(`${SUPABASE_URL}/rest/v1/gh_products?select=code,active,quantity_available`, { headers: svc })).json();
  const prod: Record<string, { active: boolean; qty: number }> = {}; prodRows.forEach((p: Record<string, unknown>) => { prod[String(p.code)] = { active: p.active !== false, qty: Number(p.quantity_available || 0) }; });
  const ids = claimed.map(c => c.order_id).join(",");
  const orderRows = await (await fetch(`${SUPABASE_URL}/rest/v1/orders?id=in.(${ids})&select=id,name,phone,address,notes`, { headers: svc })).json();
  const orderById: Record<string, Record<string, unknown>> = {}; orderRows.forEach((o: Record<string, unknown>) => { orderById[String(o.id)] = o; });

  const results: unknown[] = [];
  let breaker = 0;

  for (const v of claimed) {
    const o = orderById[String(v.order_id)] || {};
    const name = String(o.name ?? "?");
    const phone = String(o.phone ?? "");

    // Preflight guards.
    const rid = regionId[String(v.gh_region_name ?? "").trim().toLowerCase()];
    if (!rid) { await hold(v, "unknown_region", name); results.push({ order: v.order_id, outcome: "held", error: "unknown_region", region: v.gh_region_name }); continue; }
    const p = prod[String(v.gh_product_code ?? "")];
    if (!p || !p.active) { await hold(v, "unknown_product", name); results.push({ order: v.order_id, outcome: "held", error: "unknown_product", code: v.gh_product_code }); continue; }
    if (v.gh_quantity == null || v.gh_expected_total == null) { await hold(v, "missing_structured_fields", name); results.push({ order: v.order_id, outcome: "held", error: "missing_structured_fields" }); continue; }
    if (p.qty < (v.gh_quantity as number)) { await hold(v, "insufficient_stock", name); results.push({ order: v.order_id, outcome: "held", error: "insufficient_stock", have: p.qty, need: v.gh_quantity }); continue; }

    // Timeout dedup: a prior attempt may have created the order despite a timeout.
    if (((v.vdl_sync_attempts as number) || 0) > 0 && !v.vdl_tracking_id && phone) {
      const existing = await findRecentVdlOrder(phone);
      if (existing) { await writeSynced(String(v.order_id), (existing.data as Record<string, unknown>) ?? existing); results.push({ order: v.order_id, deduped: true }); continue; }
    }

    // Build the request.
    const qty = v.gh_quantity as number;
    const discount = DISCOUNT_PER_UNIT && qty ? Math.round((Number(v.gh_discount_amount || 0) / qty) * 100) / 100 : Number(v.gh_discount_amount || 0);
    const reqBody: Record<string, unknown> = {
      customer_name: name,
      customer_location: (v.gh_location as string) || String(o.address ?? ""),
      customer_phone_number: phone,
      amount_received_from_customer: 0,
      comment: String(o.notes ?? ""),
      region_id: rid,
      products: [{ code: v.gh_product_code, quantity: qty, discount_amount: discount }],
    };
    if (v.gh_gps_address) reqBody.ghana_post_gps = v.gh_gps_address; // §3.5 — see if VDL echoes it

    let r: Response, text: string;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      r = await fetch(`${VDL_BASE}/orders/create`, { method: "POST", headers: vdlHeaders, body: JSON.stringify(reqBody), signal: ctrl.signal }).finally(() => clearTimeout(t));
      text = await r.text();
    } catch (_e) {
      await backoff(v); results.push({ order: v.order_id, outcome: "timeout_backoff" }); continue; // never blind-retry a timeout
    }

    if (r.status === 401) { await patch(String(v.order_id), { vdl_sync_status: "auth_failed", vdl_sync_error: "401" }); await alert("error", "🔴 VDL auth failed (401) — Ghana push loop HALTED. Refresh VDL_API_TOKEN (mint via vdl-authenticate)."); results.push({ order: v.order_id, outcome: "auth_failed_401" }); break; }
    if (r.status >= 500) { breaker++; await backoff(v); results.push({ order: v.order_id, outcome: "vdl_5xx", status: r.status, body: text.slice(0, 200) }); if (breaker >= 3) { await alert("error", "VDL returning 5xx repeatedly — pausing the Ghana push loop this run."); break; } continue; }
    if (!r.ok) { await patch(String(v.order_id), { vdl_sync_status: "failed", vdl_sync_error: `${r.status}: ${text.slice(0, 200)}` }); await alert("error", `Ghana push failed (${r.status}) for ${name}: ${text.slice(0, 150)}`); results.push({ order: v.order_id, outcome: "vdl_4xx", status: r.status, body: text.slice(0, 200) }); continue; }

    breaker = 0;
    let data: Record<string, unknown> = {}; try { data = JSON.parse(text); } catch { /* */ }
    const d = (data.data as Record<string, unknown>) ?? data;
    await writeSynced(String(v.order_id), d);

    // Price guard — the single most important check.
    const due = Number(d.amount_due_customer);
    const expected = Number(v.gh_expected_total);
    if (Number.isFinite(due) && Math.abs(due - expected) > 0.01) {
      await alert("error", `🔴 Ghana PRICE MISMATCH: ${name} · tracking ${d.tracking_id} · VDL charges GH₵${due}, advertised GH₵${expected}. The order EXISTS at VDL — reconcile now.`);
    }
    results.push({ order: v.order_id, tracking: d.tracking_id, amount_due: due, expected });
    await new Promise(res => setTimeout(res, 1000)); // serialise — rate limits unknown
  }

  const pushed = results.filter((x) => (x as Record<string, unknown>).tracking).length;
  return json(200, { ok: true, claimed: claimed.length, pushed, outcomes: results });
});
