// ============================================================
// invite-staff — admin-only. Invites a new staff member by email
// (Supabase sends the invite; they set their own password) and links
// a staff row with the chosen role.
//
// Deploy with "Verify JWT" DISABLED (the browser CORS preflight has no
// auth header). This function verifies the caller's JWT + admin role itself.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ROLES = ["admin", "caller", "viewer", "manager", "accountant"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 1. Identify caller from their JWT
  const authHeader = req.headers.get("Authorization") || "";
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } });
  if (!ures.ok) return json({ error: "unauthorized" }, 401);
  const user = await ures.json();

  // 2. Caller must be an active admin
  const sres = await fetch(`${SUPABASE_URL}/rest/v1/staff?auth_user_id=eq.${user.id}&select=role,active`, { headers: svc });
  const [caller] = await sres.json();
  if (!caller || !caller.active || caller.role !== "admin") return json({ error: "admins only" }, 403);

  // 3. Validate input
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const full_name = String(body.full_name || "").trim();
  const role = ROLES.includes(body.role) ? body.role : "caller";
  const phone = String(body.phone || "").trim();
  if (!email) return json({ error: "email required" }, 400);

  // 4. Invite (creates the auth user + emails them to set a password)
  const ires = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: "POST", headers: { ...svc, "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
  const invited = await ires.json();
  if (!ires.ok) return json({ error: invited.msg || invited.error_description || invited.error || "invite failed" }, 400);

  // 5. Link the staff row
  const cres = await fetch(`${SUPABASE_URL}/rest/v1/staff`, {
    method: "POST",
    headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify([{ auth_user_id: invited.id, full_name, email, role, phone }]),
  });
  const created = await cres.json();
  if (!cres.ok) return json({ error: "staff link failed: " + JSON.stringify(created) }, 400);

  return json({ ok: true, staff: created[0] });
});
