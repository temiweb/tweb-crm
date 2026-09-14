// ============================================================
// order-intake-gh — receives the Ghana WPForms webhook and inserts an
// order (+ vdl_orders sidecar row). Does NO VDL work. Deploy with
// --no-verify-jwt; auth is the x-intake-secret header.
//
// Never drops an order: a bad phone or missing structured field still
// inserts the row, marked `held` with a reason, so it surfaces in the
// Ghana → Held tab. Structured values only — the package LABEL is never
// parsed for numbers (see GHANA-INTEGRATION-PLAN.md decision #1).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//      GH_INTAKE_SECRET.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTAKE_SECRET = Deno.env.get("GH_INTAKE_SECRET") ?? "";

const svc = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

// Inline alert (kept in sync with _shared/alert.ts) — never throws.
async function alert(level: "info" | "warn" | "error", message: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  const text = `${{ info: "ℹ️", warn: "🟠", error: "🔴" }[level]} ${message}`;
  if (!token || !chatId) { console.error(`[alert:${level}] ${message}`); return; }
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  } catch (e) { console.error(`[alert:${level}] send failed: ${e instanceof Error ? e.message : String(e)}`); }
}

// Constant-time string compare.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") { const o = v as Record<string, unknown>; return typeof o.value === "string" ? o.value : ""; }
  return String(v);
}

// Ghana phone → +233XXXXXXXXX, or null if it can't be normalised.
function ghPhone(raw: string): string | null {
  let s = raw.replace(/[\s\-()]/g, "");
  if (s.startsWith("+233")) s = s.slice(1);          // +233… -> 233…
  if (s.startsWith("233")) s = s.slice(3);           // 233… -> national
  else if (s.startsWith("0")) s = s.slice(1);        // 0…  -> national
  s = s.replace(/\D/g, "");
  return /^\d{9}$/.test(s) ? `+233${s}` : null;
}

function num(v: unknown): number | null {
  const s = asStr(v).replace(/[₦GH₵,\s]/gi, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  // Auth — log-and-discard on mismatch (public endpoints attract noise).
  const provided = req.headers.get("x-intake-secret") ?? "";
  if (!INTAKE_SECRET || !safeEqual(provided, INTAKE_SECRET)) {
    console.warn("order-intake-gh: bad or missing x-intake-secret");
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }

  const entryId = asStr(body.entry_id).trim();
  if (!entryId) return json(400, { ok: false, error: "missing entry_id" });

  // Idempotency: has this WPForms entry already landed?
  const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?wpforms_entry_id=eq.${encodeURIComponent(entryId)}&select=order_id`, { headers: svc });
  if (dupRes.ok) { const rows = await dupRes.json(); if (Array.isArray(rows) && rows.length) return json(200, { ok: true, duplicate_ignored: true }); }

  const name = asStr(body.customer_name).trim();
  const rawAddress = asStr(body.address).replace(/[\r\n]+/g, ", ").trim();
  const region = asStr(body.region).trim();
  const productCode = asStr(body.product_code).trim();
  const altPhone = asStr(body.alt_phone).trim();
  const notes = asStr(body.notes).trim();

  // Phone → +233 (bad phone still inserts, but held).
  const phoneRaw = asStr(body.phone);
  const phone = ghPhone(phoneRaw);

  const pkgParts = asStr(body.package).split("|").map(s => s.trim());
  const quantity = num(body.quantity) ?? num(pkgParts[0]);
  const expectedTotal = num(body.expected_total) ?? num(pkgParts[1]);
  const discount = num(body.discount) ?? num(pkgParts[2]) ?? 0;
  const packageLabel = asStr(body.package_label).trim() || pkgParts.slice(3).join("|").trim();

  // Comment for VDL's delivery team — alt phone, notes, full raw address.
  const comment = [altPhone && `Alt: ${altPhone}`, notes, rawAddress].filter(Boolean).join("\n");

  // Resolve a display name from the catalogue mirror (falls back to the code).
  let productName = productCode;
  if (productCode) {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/gh_products?code=eq.${encodeURIComponent(productCode)}&select=name`, { headers: svc });
    if (pr.ok) { const pn = await pr.json(); if (Array.isArray(pn) && pn[0]?.name) productName = pn[0].name; }
  }

  // Decide hold state.
  let syncStatus = "needs_review";
  let syncError: string | null = null;
  if (!phone) { syncStatus = "held"; syncError = "bad_phone"; }
  else if (!productCode || quantity == null || quantity < 1 || expectedTotal == null) { syncStatus = "held"; syncError = "missing_structured_fields"; }

  // 1) Insert the order row (country=ghana, no caller).
  const orderRow = {
    name, phone: phone ?? phoneRaw, whatsapp: phone ?? "",
    address: rawAddress, state: region,
    product: productName, pack_name: packageLabel,
    qty: quantity ?? 1, price: expectedTotal ?? 0,
    notes: comment,                 // alt phone + notes + raw address → becomes VDL's comment at push
    status: "pending", country: "ghana", source: "wpforms-gh",
    assigned_to: null,
  };
  const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify([orderRow]),
  });
  if (!oRes.ok) {
    const detail = await oRes.text();
    await alert("error", `order-intake-gh: order insert failed (entry ${entryId}): ${detail.slice(0, 200)}`);
    return json(502, { ok: false, error: detail });
  }
  const orderId = (await oRes.json())[0]?.id;

  // 2) Insert the sidecar row. Unique entry_id catches a concurrent double-fire.
  const sidecar = {
    order_id: orderId, wpforms_entry_id: entryId,
    gh_product_code: productCode, gh_quantity: quantity, gh_expected_total: expectedTotal,
    gh_discount_amount: discount, gh_region_name: region, gh_package_label: packageLabel,
    gh_raw_address: rawAddress, gh_location: rawAddress,
    vdl_sync_status: syncStatus, vdl_sync_error: syncError,
  };
  const sRes = await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders`, { method: "POST", headers: svc, body: JSON.stringify([sidecar]) });
  if (!sRes.ok) {
    const detail = await sRes.text();
    // Duplicate entry_id (raced) — remove the orphan order we just made.
    if (/duplicate key|vdl_orders_wpforms_entry_id/i.test(detail)) {
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, { method: "DELETE", headers: svc });
      return json(200, { ok: true, duplicate_ignored: true });
    }
    await alert("error", `order-intake-gh: sidecar insert failed (entry ${entryId}): ${detail.slice(0, 200)}`);
    return json(502, { ok: false, error: detail });
  }

  if (syncError) await alert("warn", `Ghana order held (${syncError}): ${name || "?"} ${phoneRaw} — fix in Ghana → Held`);
  return json(200, { ok: true, order_id: orderId, status: syncStatus });
});
