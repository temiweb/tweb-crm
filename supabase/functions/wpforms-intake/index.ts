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

// Fallback parser for a prose package label (old forms without "Show Values").
// Handles both "Buy 2 ... = ₦28,000 (...)" and "Product (10 Net ...) = ₦12,000".
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

const toNum = (s: string) => Number(s.replace(/[₦,\s]/g, ""));

// Resolve a package field into { packName, qty, price }.
// Preferred form is a structured dropdown value "units|amount|name"
// (WPForms "Show Values") — reliable even for bundles like "Buy 2, Get 1 Free".
// Anything without the "|" delimiter falls back to best-effort label parsing,
// so existing forms and in-flight submissions keep working unchanged.
function resolvePackage(raw: string): { packName: string; qty: number; price: number } {
  if (raw.includes("|")) {
    const [u, a, ...rest] = raw.split("|").map((s) => s.trim());
    const uN = toNum(u), aN = toNum(a);
    const qty = Number.isFinite(uN) && uN > 0 ? Math.round(uN) : 1;
    const price = Number.isFinite(aN) && aN >= 0 ? aN : 0;
    const name = rest.join("|").trim();
    return { packName: name || `${qty} unit${qty > 1 ? "s" : ""}`, qty, price };
  }
  return parsePackage(raw);
}

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };
// Atomically rotates each new order through active callers.
// Returns null if there are no active callers (order stays unassigned → admin queue).
async function pickCaller(): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pick_next_caller`, {
      method: "POST",
      headers: { ...svc, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    const callerId = await r.json();
    return typeof callerId === "string" && callerId ? callerId : null;
  } catch { return null; }
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
  const pkg = resolvePackage(pkgStr);
  const phone = asString(body.phone);
  const name = asString(body.name).trim();

  // WPForms can't expose the entry ID at render time, so we dedup on a
  // date-scoped content key: this collapses a true double-fire of the same
  // submission, but a genuine re-order on a later day stays a separate order.
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const externalId = body.entry_id
    ? `wpforms:${asString(body.entry_id)}`
    : `wpforms:${cleanPhone(phone)}:${pkgStr}:${name}:${day}`.slice(0, 250);

  // Auto-assign to the lightest-loaded active caller (null = stays unassigned).
  const assignedTo = await pickCaller();

  const row = {
    name,
    phone,
    assigned_to: assignedTo,
    assigned_at: assignedTo ? new Date().toISOString() : null,
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

  const insertHeaders = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
  const insertUrl = `${SUPABASE_URL}/rest/v1/orders?on_conflict=external_id`;

  let r = await fetch(insertUrl, { method: "POST", headers: insertHeaders, body: JSON.stringify([row]) });

  // Safety net: if the caller-workflow columns aren't there yet (migration 0006
  // not applied), don't drop the order — retry without those fields.
  if (!r.ok) {
    const detail = await r.text();
    if (/assigned_to|assigned_at|column/.test(detail)) {
      const { assigned_to: _a, assigned_at: _b, ...base } = row;
      r = await fetch(insertUrl, { method: "POST", headers: insertHeaders, body: JSON.stringify([base]) });
    }
    if (!r.ok) {
      console.error("upsert failed", r.status, detail);
      return new Response(JSON.stringify({ ok: false, error: detail }), {
        status: 502, headers: { "content-type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
