// ============================================================
// vdl-status-poller — Phase 5. Reads each synced Ghana order's current
// state + financials back from VDL. READ-ONLY (GET /orders/{tracking_id})
// — never creates or changes anything at VDL.
//
// Selects synced orders with a tracking id, synced within the last 30 days,
// whose state isn't terminal; refreshes vdl_state_label + the financial
// fields (they change as the order settles). Unknown states are stored as-is
// and surface in the Synced tab — never guessed.
//
// Invoke manually to test; schedule ~every 20 min alongside the push worker.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), VDL_API_BASE_URL,
//      VDL_API_TOKEN, VDL_TERMINAL_STATES (comma list; default below),
//      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
const VDL_TOKEN = (Deno.env.get("VDL_API_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const TERMINAL = (Deno.env.get("VDL_TERMINAL_STATES") ?? "Delivered,Returned,Cancelled,Refunded,Failed")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
const vdlHeaders = { Authorization: `Bearer ${VDL_TOKEN}`, Accept: "application/json" };
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

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows: Record<string, unknown>[] = await (await fetch(
    `${SUPABASE_URL}/rest/v1/vdl_orders?vdl_sync_status=eq.synced&vdl_tracking_id=not.is.null&vdl_synced_at=gt.${since}&select=order_id,vdl_tracking_id,vdl_state_label&limit=100`,
    { headers: svc },
  )).json();

  const todo = rows.filter((r) => !TERMINAL.includes(String(r.vdl_state_label ?? "").toLowerCase()));
  const updates: unknown[] = [];
  let errors = 0;

  for (const r of todo) {
    try {
      const res = await fetch(`${VDL_BASE}/orders/${r.vdl_tracking_id}`, { headers: vdlHeaders });
      if (res.status === 401) { await alert("error", "🔴 VDL 401 during status poll — refresh VDL_API_TOKEN."); break; }
      if (!res.ok) { errors++; updates.push({ tracking: r.vdl_tracking_id, error: res.status }); continue; }
      const body = await res.json();
      const d = (body?.data as Record<string, unknown>) ?? body;
      const label = (d.model_state as Record<string, unknown>)?.label ?? null;
      await fetch(`${SUPABASE_URL}/rest/v1/vdl_orders?order_id=eq.${r.order_id}`, {
        method: "PATCH", headers: svc,
        body: JSON.stringify({
          vdl_state_label: label,
          vdl_amount_due_customer: d.amount_due_customer ?? null, vdl_vendor_amount_due: d.vendor_amount_due ?? null,
          vdl_commission_amount: d.commission_amount ?? null, vdl_delivery_fee: d.delivery_fee ?? null,
          vdl_packaging_fee: d.packaging_fee ?? null,
        }),
      });
      if (label && label !== r.vdl_state_label) updates.push({ tracking: r.vdl_tracking_id, from: r.vdl_state_label, to: label });
      await new Promise((res2) => setTimeout(res2, 400)); // gentle pacing
    } catch (e) { errors++; updates.push({ tracking: r.vdl_tracking_id, error: e instanceof Error ? e.message : String(e) }); }
  }

  if (errors >= 3) await alert("warn", `vdl-status-poller: ${errors} errors this run — VDL may be flaky.`);
  return json(200, { ok: true, polled: todo.length, changed: updates.filter((u) => (u as Record<string, unknown>).to).length, updates });
});
