-- ============================================================
-- 0011 — Auto-bump orders.updated_at on every write
-- Prerequisite for incremental sync (client polls only orders
-- changed since its last sync via updated_at). Today updated_at is
-- only set by the column default at INSERT and never touched on
-- UPDATE, so change-detection would miss edits.
--
-- DB-level (not app-level) so it also covers webhook inserts and any
-- manual SQL edits. Additive + idempotent. Run on PROD (staging paused).
-- ============================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- No backfill: a blanket UPDATE would fire the inventory-sync trigger, which
-- raises on historical delivered orders with no agent (see 0010). Existing rows
-- keep their current updated_at; incremental sync's periodic full reconcile
-- covers any rows the trigger hasn't touched yet.
