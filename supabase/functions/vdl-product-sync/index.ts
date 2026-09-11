// ============================================================
// vdl-product-sync — mirror VDL's catalogue into public.gh_products.
// READ-ONLY against VDL (GET /products) — never creates an order.
//
// Run manually first, then daily (not hourly) until VDL's rate/size
// limits are known. Alerts on failure, and when a product *crosses*
// below the low-stock threshold (not every run it's low).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//      VDL_API_BASE_URL, VDL_API_TOKEN, GH_LOW_STOCK_THRESHOLD (default 10).
// ============================================================

// Inline copy of _shared/alert.ts so this function can be pasted into the
// dashboard standalone. Keep in sync with the reference copy. Never throws.
async function alert(level: "info" | "warn" | "error", message: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  const text = `${{ info: "ℹ️", warn: "🟠", error: "🔴" }[level]} ${message}`;
  if (!token || !chatId) { console.error(`[alert:${level}] ${message} (telegram secrets unset)`); return; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) console.error(`[alert:${level}] Telegram ${res.status}`);
  } catch (e) { console.error(`[alert:${level}] send failed: ${e instanceof Error ? e.message : String(e)}`); }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
// Tolerate a pasted "Bearer " prefix or surrounding whitespace in the secret.
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const LOW_STOCK = parseInt(Deno.env.get("GH_LOW_STOCK_THRESHOLD") ?? "10", 10);

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

// VDL is a Laravel paginator; the exact envelope isn't documented. Handle both
// { data: [ ... ], next_page_url } and { data: { data: [ ... ], next_page_url } }.
// The first real run confirms which — if it returns 0 products, log the body.
async function fetchAllProducts(): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await fetch(`${VDL_BASE}/products?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`VDL /products ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const body = await r.json();
    const container = body?.data ?? body;
    const rows: Record<string, unknown>[] = Array.isArray(container) ? container : (container?.data ?? []);
    all.push(...rows);
    const next = (Array.isArray(container) ? body?.next_page_url : container?.next_page_url) ?? null;
    if (!next || rows.length === 0) break;
  }
  return all;
}

Deno.serve(async () => {
  if (!VDL_BASE || !VDL_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "VDL_API_BASE_URL / VDL_API_TOKEN not set" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  try {
    // Previous stock levels — to fire an alert only when a product *crosses* below.
    const prevRes = await fetch(`${SUPABASE_URL}/rest/v1/gh_products?select=code,quantity_available`, { headers: svc });
    const prev: { code: string; quantity_available: number }[] = prevRes.ok ? await prevRes.json() : [];
    const prevQty = new Map(prev.map((p) => [p.code, p.quantity_available]));

    const products = await fetchAllProducts();
    const rows = products.map((p) => ({
      code: String(p.code ?? "").trim(),
      vdl_product_id: (p.id as number) ?? null,
      name: String(p.name ?? p.code ?? "").trim(),
      active: (p.active ?? p.is_active ?? true) as boolean,
      quantity_available: Number(p.quantity_available ?? 0),
      synced_at: new Date().toISOString(),
    })).filter((p) => p.code);

    if (rows.length === 0) {
      throw new Error("VDL returned no products — check the response shape (see fetchAllProducts note)");
    }

    const up = await fetch(`${SUPABASE_URL}/rest/v1/gh_products?on_conflict=code`, {
      method: "POST",
      headers: { ...svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!up.ok) throw new Error(`gh_products upsert ${up.status}: ${(await up.text()).slice(0, 300)}`);

    // Newly low = active, below threshold now, and either new or previously at/above it.
    const newlyLow = rows.filter((p) =>
      p.active && p.quantity_available < LOW_STOCK && (prevQty.get(p.code) ?? Infinity) >= LOW_STOCK
    );
    if (newlyLow.length) {
      await alert("warn", `Ghana low stock (< ${LOW_STOCK}): ` +
        newlyLow.map((p) => `${p.name} [${p.code}] = ${p.quantity_available}`).join(", "));
    }

    return new Response(JSON.stringify({ ok: true, synced: rows.length, newly_low: newlyLow.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await alert("error", `vdl-product-sync failed: ${msg}`);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }
});
