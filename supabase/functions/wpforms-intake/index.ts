// ============================================================
// wpforms-intake — receives a WPForms webhook (Nigeria orders)
// and upserts an order into Supabase.
//
// Auth: shared token in the URL query (?token=...), compared to the
//   WPFORMS_TOKEN secret. Deploy with "Verify JWT" DISABLED so WPForms
//   can call it without a Supabase auth header.
// Env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected):
//   WPFORMS_TOKEN  — shared secret, must match the ?token= in the URL.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("WPFORMS_TOKEN") ?? "";

function cleanPhone(p: string): string {
  if (!p) return "";
  let s = String(p).replace(/['\s+\-()]/g, "");
  if (s.startsWith("234") && s.length > 10) s = "0" + s.slice(3);
  if (s.startsWith("44234")) s = "0" + s.slice(5);
  if (s.startsWith("1") && s.length > 11) s = "0" + s.slice(1);
  return s;
}

// Handles both "Buy 2 ... = ₦28,000 (...)" and "Product (10 Net ...) = ₦12,000"
function parsePackage(pkg: string): { packName: string; qty: number; price: number } {
  if (!pkg) return { packName: "", qty: 1, price: 0 };
  const priceM = pkg.match(/₦\s*([\d,]+)/);
  const qtyM = pkg.match(/buy\s+(\d+)/i) || pkg.match(/\((\d+)\s+/);
  const nameM = pkg.match(/^([^=(]+)/);
  return {
    packName: (nameM ? nameM[1] : pkg).trim(),
    qty: qtyM ? parseInt(qtyM[1], 10) : 1,
    price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : 0,
  };
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    // WPForms date fields arrive as { value, unix }
    const o = v as Record<string, unknown>;
    return typeof o.value === "string" ? o.value : "";
  }
  return String(v);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  if (!TOKEN || url.searchParams.get("token") !== TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const pkgStr = asString(body.package);
  const pkg = parsePackage(pkgStr);
  const phone = asString(body.phone);
  const name = asString(body.name).trim();

  // entry_id when available; otherwise a stable content key so retries dedup
  const externalId = body.entry_id
    ? `wpforms:${asString(body.entry_id)}`
    : `wpforms:${cleanPhone(phone)}:${pkgStr}:${name}`.slice(0, 250);

  const row = {
    name,
    phone,
    whatsapp: asString(body.whatsapp),
    address: asString(body.address).replace(/[\r\n]+/g, ", "),
    state: asString(body.state),
    product: asString(body.product) || pkg.packName,
    pack_name: pkg.packName,
    qty: pkg.qty,
    price: pkg.price,
    delivery_pref: asString(body.delivery_pref),
    delivery_date: asString(body.delivery_date),
    payment_option: asString(body.payment_option),
    notes: asString(body.notes).replace(/[\r\n]+/g, " "),
    status: "pending",
    agent_id: null,
    agent_name: "",
    country: "nigeria",
    delivery_fee: 0,
    actual_qty_delivered: pkg.qty,
    actual_price_collected: pkg.price,
    source: "wpforms",
    external_id: externalId,
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?on_conflict=external_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([row]),
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error("upsert failed", r.status, detail);
    return new Response(JSON.stringify({ ok: false, error: detail }), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
