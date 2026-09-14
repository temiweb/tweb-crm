// ============================================================
// vdl-stock-reconcile — computes true in-country Ghana stock.
//
// VDL's quantity_available omits units committed to in-flight orders. This
// pages VDL's order list (READ-ONLY), sums in-flight units per product code
// (quantity - quantity_returned) across the in-flight states, and writes
// in_flight_units + stock_reconciled_at back to gh_products. The CRM then
// shows: available + in_flight = actual in country.
//
// Covers ALL orders (incl. ones entered manually before go-live), because
// it reads VDL's own list. Pages newest-first until orders age past the
// window (in-flight orders are recent), bounded by a page cap.
//
// Scheduled daily; safe to invoke manually. Env: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (auto), VDL_API_BASE_URL, VDL_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");

// Units in these states are still yours but out of VDL's "available" count.
// Confirmed by the vendor: VDL pulls a unit only at Packaged — so the
// pre-packaging states (Pending, Confirmed, Not Answering, Postponed) stay in
// "available" and are NOT added here. A unit isn't freed until Fulfilled
// (Delivery Completed still counts, unremitted) or comes back via Returned.
// ("Issue" kept as in-flight provisionally — pending confirmation of whether
// it can occur before packaging.)
const IN_FLIGHT = new Set([
  "Packaged", "Out for Delivery", "In Transit", "In Transit To Regional Hub",
  "Arrived At Regional Hub", "Issue", "Return Initiated", "Delivery Completed",
]);

const PAGE_CAP = 60;                       // safety bound on pagination
const WINDOW_DAYS = 120;                    // stop paging once orders are older than this

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
const json = (s: number, o: unknown) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

async function alert(level: "info" | "warn" | "error", message: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) { console.error(`[alert:${level}] ${message}`); return; }
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: `${{ info: "ℹ️", warn: "🟠", error: "🔴" }[level]} ${message}` }), signal: ctrl.signal }).finally(() => clearTimeout(t));
  } catch (e) { console.error(`[alert] ${e instanceof Error ? e.message : String(e)}`); }
}

Deno.serve(async () => {
  if (!VDL_BASE || !VDL_TOKEN) return json(400, { ok: false, error: "VDL secrets not set" });

  const inFlight: Record<string, number> = {};   // code -> units still out
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  let scanned = 0, counted = 0;

  try {
    for (let page = 1; page <= PAGE_CAP; page++) {
      const r = await fetch(`${VDL_BASE}/orders?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json" } });
      if (r.status === 401) { await alert("error", "🔴 VDL 401 during stock reconcile — refresh VDL_API_TOKEN."); return json(401, { ok: false, error: "401" }); }
      if (!r.ok) throw new Error(`VDL /orders ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const body = await r.json();
      const container = (body?.data ?? body) as Record<string, unknown>;
      const rows: Record<string, unknown>[] = Array.isArray(container) ? container : ((container?.data as Record<string, unknown>[]) ?? []);
      let oldestOnPage = Infinity;
      for (const o of rows) {
        scanned++;
        oldestOnPage = Math.min(oldestOnPage, Date.parse(String(o.created_at ?? "")) || 0);
        const label = String((o.model_state as Record<string, unknown>)?.label ?? "");
        if (!IN_FLIGHT.has(label)) continue;
        for (const p of (o.products as Record<string, unknown>[]) ?? []) {
          const code = String(p.code ?? "").trim();
          if (!code) continue;
          const pivot = (p.pivot ?? {}) as Record<string, unknown>;
          const out = Number(pivot.quantity ?? 0) - Number(pivot.quantity_returned ?? 0);
          if (out > 0) { inFlight[code] = (inFlight[code] || 0) + out; counted += out; }
        }
      }
      const next = (Array.isArray(container) ? body?.next_page_url : container?.next_page_url) ?? null;
      if (!next || rows.length === 0 || oldestOnPage < cutoff) break; // in-flight orders are recent
    }

    // Update in_flight for every catalogue product (0 where none). Use PATCH
    // (not upsert) so we only touch existing rows and never the NOT NULL name.
    const prods: { code: string }[] = await (await fetch(`${SUPABASE_URL}/rest/v1/gh_products?select=code`, { headers: svc })).json();
    const now = new Date().toISOString();
    const results = await Promise.all(prods.map(p =>
      fetch(`${SUPABASE_URL}/rest/v1/gh_products?code=eq.${encodeURIComponent(p.code)}`, {
        method: "PATCH", headers: { ...svc, Prefer: "return=minimal" },
        body: JSON.stringify({ in_flight_units: inFlight[p.code] || 0, stock_reconciled_at: now }),
      })
    ));
    const failed = results.find(r => !r.ok);
    if (failed) throw new Error(`gh_products update ${failed.status}: ${(await failed.text()).slice(0, 200)}`);

    return json(200, { ok: true, scanned, in_flight_units_total: counted, by_code: inFlight });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await alert("error", `vdl-stock-reconcile failed: ${msg}`);
    return json(502, { ok: false, error: msg });
  }
});
