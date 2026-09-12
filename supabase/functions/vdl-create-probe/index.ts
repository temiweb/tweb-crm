// ============================================================
// vdl-create-probe — THROWAWAY diagnostic. Delete after use.
//
// Takes the OLDEST 'approved' Ghana order and tries POST /orders/create
// three ways, STOPPING at the first that succeeds, to isolate why VDL 500s:
//   1. json-numeric      — JSON body, numeric types (what the worker sends)
//   2. json-string       — JSON body, values as strings (their template shows "")
//   3. form-urlencoded    — form body (their /authenticate uses form-data)
//
// On the first success a REAL VDL order is created; the probe marks that
// order 'synced' so the real worker won't push it again. On all-fail it
// changes nothing — strong evidence the fault is VDL-side.
//
//   supabase functions deploy vdl-create-probe
//   curl -X POST "$SUPABASE_URL/functions/v1/vdl-create-probe" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
//   supabase functions delete vdl-create-probe   # when done
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

const json = (s: number, o: unknown) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toForm(b: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const k of ["customer_name", "customer_location", "customer_phone_number", "amount_received_from_customer", "comment", "region_id"]) p.set(k, String(b[k]));
  (b.products as Record<string, unknown>[]).forEach((pr, i) => {
    p.set(`products[${i}][code]`, String(pr.code));
    p.set(`products[${i}][quantity]`, String(pr.quantity));
    p.set(`products[${i}][discount_amount]`, String(pr.discount_amount));
  });
  return p.toString();
}

Deno.serve(async () => {
  if (!VDL_BASE || !VDL_TOKEN) return json(400, { ok: false, error: "VDL secrets not set" });

  const [v] = await (await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?vdl_sync_status=eq.approved&order=created_at.asc&limit=1`, { headers: svc })).json();
  if (!v) return json(200, { ok: false, error: "No 'approved' Ghana order to probe — approve one test order first." });
  const [o] = await (await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${v.order_id}&select=name,phone,address,notes`, { headers: svc })).json();
  const [reg] = await (await fetch(`${SUPABASE_URL}/rest/v1/gh_regions?name=eq.${encodeURIComponent(v.gh_region_name)}&select=vdl_region_id`, { headers: svc })).json();
  const rid = reg?.vdl_region_id;
  const qty = v.gh_quantity, disc = Number(v.gh_discount_amount || 0);

  const base: Record<string, unknown> = {
    customer_name: o?.name ?? "", customer_location: v.gh_location || o?.address || "",
    customer_phone_number: o?.phone ?? "", amount_received_from_customer: 0,
    comment: o?.notes ?? "", region_id: rid,
    products: [{ code: v.gh_product_code, quantity: qty, discount_amount: disc }],
  };
  const stringy: Record<string, unknown> = {
    ...base, amount_received_from_customer: "0", region_id: String(rid),
    products: [{ code: v.gh_product_code, quantity: String(qty), discount_amount: String(disc) }],
  };

  const auth = { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json" };
  const tries = [
    { name: "json-numeric", ct: "application/json", body: JSON.stringify(base) },
    { name: "json-string", ct: "application/json", body: JSON.stringify(stringy) },
    { name: "form-urlencoded", ct: "application/x-www-form-urlencoded", body: toForm(base) },
  ];

  const attempts: unknown[] = [];
  let success: string | null = null;
  for (const t of tries) {
    try {
      const r = await fetch(`${VDL_BASE}/orders/create`, { method: "POST", headers: { ...auth, "Content-Type": t.ct }, body: t.body });
      const text = await r.text();
      attempts.push({ variant: t.name, status: r.status, body: text.slice(0, 300) });
      if (r.ok) {
        success = t.name;
        let d: Record<string, unknown> = {}; try { d = (JSON.parse(text).data) ?? JSON.parse(text); } catch { /* */ }
        // Mark synced so the real worker won't create a duplicate.
        await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?order_id=eq.${v.order_id}`, { method: "PATCH", headers: svc, body: JSON.stringify({ vdl_sync_status: "synced", vdl_synced_at: new Date().toISOString(), vdl_tracking_id: d.tracking_id ?? null, vdl_order_id: d.id ?? null, vdl_amount_due_customer: d.amount_due_customer ?? null }) });
        break;
      }
    } catch (e) { attempts.push({ variant: t.name, error: e instanceof Error ? e.message : String(e) }); }
    await sleep(800);
  }

  return json(200, {
    ok: true, success, attempts,
    note: success
      ? `A REAL VDL order was created via '${success}'. Tell Claude which variant so the worker is switched to it.`
      : "All three failed — our request is provably correct; this is VDL-side. Send the brief to support.",
  });
});
