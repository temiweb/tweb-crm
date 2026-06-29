-- ============================================================
-- WPForms webhook intake — additive columns + idempotency index
-- Run in STAGING first; apply the identical file to prod at cutover.
-- Safe / reversible: only adds nullable columns + a unique index.
-- ============================================================

alter table public.orders add column if not exists external_id text;
alter table public.orders add column if not exists source text default 'manual';

-- Plain unique index: Postgres allows multiple NULLs, so all existing rows
-- (external_id = null) are fine; uniqueness is enforced only on real values.
-- Enables ON CONFLICT (external_id) upsert from the edge function.
create unique index if not exists orders_external_id_key
  on public.orders (external_id);
