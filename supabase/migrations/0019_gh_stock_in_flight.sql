-- ============================================================
-- 0019 — Ghana true-in-country stock (IDEMPOTENT, ADDITIVE)
--
-- VDL's quantity_available is only free-to-sell stock; units committed to
-- in-flight orders (Packaged … Delivery Completed) are physically still
-- yours but invisible in that number. vdl-stock-reconcile pages VDL's
-- orders, sums those in-flight units per product, and writes them here.
-- The UI shows: available + in_flight_units = actual in country.
-- ============================================================

alter table public.gh_products
  add column if not exists in_flight_units    integer,
  add column if not exists stock_reconciled_at timestamptz;
