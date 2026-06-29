# WPForms → CRM Auto-Import (Webhook) — Plan

Replace the manual CSV step: a WPForms submission lands in the CRM automatically.

**Decisions locked:** WPForms **Pro + Webhooks addon** (no WP code needed) · **two separate forms** (Nigeria + Ghana) · receiver is a **Supabase Edge Function**.

```
Customer submits NG form ─┐                         ┌─ ?country=nigeria
                          ├─ WPForms Webhook (POST) ─┤
Customer submits GH form ─┘                         └─ ?country=ghana
                                   │
                                   ▼
                 Supabase Edge Function  "wpforms-intake"
                   1. verify shared secret header
                   2. map WPForms fields → orders columns (reuse parsePackage)
                   3. upsert into orders on external_id  (service-role key)
                                   │
                                   ▼
              order appears in CRM (30s auto-refresh already polls)
```

## Why this is partly a DB change → staging first
It adds columns + a unique index to `orders` and runs server-side infra. Per the split workflow, **all of this is built and tested against the staging Supabase project before prod.** It reuses the *same* staging project Phase 3 needs — so standing staging up unlocks both at once.

---

## Build steps

### 0. Prerequisite
Staging Supabase project exists (shared with Phase 3). Install Supabase CLI for Edge Functions.

### 1. Schema (additive, reversible — staging first)
```sql
alter table public.orders add column if not exists external_id text;
alter table public.orders add column if not exists source text default 'manual';
-- idempotency: same WPForms entry can't create duplicate orders
create unique index if not exists orders_external_id_uniq
  on public.orders (external_id) where external_id is not null;
```
Existing rows keep `external_id = null` / `source = null` (treated as manual/csv) — nothing breaks.

### 2. Get ONE sample payload per form (the real blocker)
WPForms webhooks send **field IDs**, not the CSV header names. Before mapping, capture a real sample from each form (WPForms' webhook test send, or point it at a temporary request-bin once). We map field IDs → `orders` columns and re-use the existing package/price parsing.

### 3. Edge Function `supabase/functions/wpforms-intake/index.ts`
- Reads `?country=nigeria|ghana` from the URL (one per form).
- **Verifies a shared secret** WPForms sends as a custom header (`x-webhook-secret`) against `WPFORMS_SECRET`; reject with 401 if missing/wrong.
- Ports `parsePackage` + the field mapping from `csvToDbRows` (status `pending`, agent unassigned, `source: 'wpforms'`, `external_id`: WPForms entry ID).
- **Upsert** on `external_id` (merge-duplicates) → safe against WPForms retries.
- Responds `200` fast (WPForms expects a prompt 2xx).
- Secrets via `supabase secrets set` (service-role key + `WPFORMS_SECRET`) — **never in the repo**.

### 4. Configure WPForms (WP admin)
On each form → Marketing/Webhooks: Request URL = function URL with `?country=...`, method `POST`, format JSON, add header `x-webhook-secret: <secret>`. Map the form fields if the addon requires explicit key names.

### 5. Test on staging
Point both forms' webhooks at the **staging** function. Submit test entries on NG and GH; verify correct parsing, country, prices, and **no duplicates on resubmit**. Verify a no-secret POST is rejected.

### 6. Frontend (tiny → main)
Optional: a small "Auto / WP" badge on webhook-sourced orders and a source filter. **Keep CSV import as the manual fallback.**

### 7. Cutover to prod
Apply schema to prod, deploy the function to the prod project, set prod secrets, switch the two WPForms webhook URLs to the prod function. Watch the first live submissions.

---

## Risks / notes
- **Payload format unknown until step 2** — field-ID mapping is the one thing we can't finalize without a sample.
- **Idempotency** handled by the `external_id` unique index + upsert.
- **Security**: shared-secret header is the minimum; if the Webhooks addon offers request signing, use it too.
- **Parsing drift**: the function duplicates `parsePackage` logic in Deno/TS; keep it in sync with `App.jsx` if the package format ever changes.
- **Fast ack**: do the insert and return; avoid slow work in the handler.
