-- ============================================================
-- 0020 — Ghana in-flight units, broken down by state (IDEMPOTENT, ADDITIVE)
--
-- 0019 gave us in_flight_units (a single total per product). This adds the
-- per-state split so the CRM can show WHERE those units are, e.g.
--   { "Packaged": 30, "In Transit": 15, "Delivery Completed": 8, "Issue": 2 }
-- vdl-stock-reconcile fills it in the same pass/PATCH that writes the total —
-- no extra VDL calls, no extra egress. States with zero units are omitted.
-- ============================================================

alter table public.gh_products
  add column if not exists in_flight_by_state jsonb;
