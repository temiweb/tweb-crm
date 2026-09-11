// ============================================================
// alert-test — THROWAWAY. Proves the Telegram alert path works
// end-to-end (Phase 0b exit criterion), then delete this function.
//
//   supabase functions deploy alert-test
//   curl -X POST "$SUPABASE_URL/functions/v1/alert-test" \
//        -H "Authorization: Bearer $SUPABASE_ANON_KEY"
//   -> expect a "🟠 alert-test: ..." message in your Telegram chat
//   supabase functions delete alert-test
// ============================================================

import { alert } from "../_shared/alert.ts";

Deno.serve(async () => {
  const delivered = await alert("warn", `alert-test: pipeline alarm wired at ${new Date().toISOString()}`);
  return new Response(JSON.stringify({ ok: true, delivered }), {
    headers: { "content-type": "application/json" },
  });
});
