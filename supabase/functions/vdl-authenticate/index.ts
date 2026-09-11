// ============================================================
// vdl-authenticate — ONE-OFF manual token mint. THROWAWAY.
//
// The VDL API token expires/gets revoked; this exchanges your VDL login
// for a fresh JWT. Invoke ONCE with a JSON body {"email":"...","password":"..."},
// copy the returned token into the VDL_API_TOKEN secret, then DELETE this
// function. The password is used for the single /authenticate call and is
// NEVER stored or logged (this is a manual mint, not the automatic
// re-authentication the plan forbids).
//
// Invoke from the Supabase dashboard (Edge Functions → this function →
// Invoke, with the JSON body), or:
//   curl -X POST "$SUPABASE_URL/functions/v1/vdl-authenticate" \
//     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"you@example.com","password":"..."}'
// ============================================================

const VDL_BASE = (Deno.env.get("VDL_API_BASE_URL") ?? "https://api.vdlfulfilment.net").trim().replace(/\/+$/, "");

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST a JSON body { email, password }" });

  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Send a JSON body { email, password }" }); }
  const email = (body?.email ?? "").trim();
  const password = body?.password ?? "";
  if (!email || !password) return json(400, { ok: false, error: "email and password are required" });

  try {
    const form = new FormData();
    form.append("email", email);
    form.append("password", password);
    const r = await fetch(`${VDL_BASE}/authenticate`, { method: "POST", headers: { Accept: "application/json" }, body: form });
    const text = await r.text();
    if (!r.ok) return json(r.status, { ok: false, error: `VDL /authenticate ${r.status}: ${text.slice(0, 300)}` });

    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* leave empty */ }
    const d = (data?.data ?? {}) as Record<string, unknown>;
    const token = (d.token ?? data.token ?? d.access_token ?? data.access_token ?? null) as string | null;

    if (!token) {
      return json(200, { ok: false, note: "Authenticated, but couldn't find the token field. Here is the raw response — tell me the shape.", raw: data });
    }
    return json(200, { ok: true, token, next: "Copy `token` into the VDL_API_TOKEN secret, re-run vdl-product-sync, then DELETE this function." });
  } catch (e) {
    return json(502, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
