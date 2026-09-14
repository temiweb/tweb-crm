// ============================================================
// vdl-orders-probe — THROWAWAY. Delete after use.
//
// Pages GET /orders and reports (1) every distinct model_state seen — the
// real, complete list of VDL states you use, to map for stock reconciliation
// — and (2) a PII-stripped sample order, to confirm the list response shape
// (does each order carry products + quantities + state?).
//
//   supabase functions deploy vdl-orders-probe
//   curl -X POST "$SUPABASE_URL/functions/v1/vdl-orders-probe" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
//   supabase functions delete vdl-orders-probe
// ============================================================

const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const json = (s: number, o: unknown) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

// Drop customer-identifying fields; keep structure (products, state, financials).
function stripPII(o: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...o };
  for (const k of ["customer_name", "customer_phone_number", "customer_location", "customer_geolocation", "comment", "waybill_meta"]) delete clone[k];
  return clone;
}

Deno.serve(async () => {
  if (!VDL_BASE || !VDL_TOKEN) return json(400, { ok: false, error: "VDL secrets not set" });

  const states: Record<string, Record<string, unknown>> = {};
  let scanned = 0;
  let sample: Record<string, unknown> | null = null;

  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${VDL_BASE}/orders?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json" } });
    if (!r.ok) return json(r.status, { ok: false, error: (await r.text()).slice(0, 300) });
    const body = await r.json();
    const container = (body?.data ?? body) as Record<string, unknown>;
    const rows: Record<string, unknown>[] = Array.isArray(container) ? container : ((container?.data as Record<string, unknown>[]) ?? []);
    for (const o of rows) {
      scanned++;
      const ms = (o.model_state ?? {}) as Record<string, unknown>;
      const key = String(ms.label ?? o.order_status ?? "unknown");
      if (!states[key]) states[key] = { id: ms.id ?? null, label: ms.label ?? null, state: ms.state ?? o.order_status ?? null, count: 0, has_products: Array.isArray(o.products) };
      (states[key].count as number)++;
      if (!sample) sample = stripPII(o);
    }
    const next = (Array.isArray(container) ? body?.next_page_url : container?.next_page_url) ?? null;
    if (!next || rows.length === 0) break;
  }

  return json(200, {
    ok: true,
    scanned,
    distinct_states: Object.values(states).sort((a, b) => (b.count as number) - (a.count as number)),
    sample_order_shape: sample,
  });
});
