-- ============================================================
-- Phase 7 · Caller Order Workflow — additive columns + backfill
-- Run on STAGING first. Additive/reversible only. RLS tightening for
-- per-caller visibility is a SEPARATE step (0007) applied at cutover.
-- ============================================================

alter table public.orders
  add column if not exists assigned_to    uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at    timestamptz,
  add column if not exists confirmed_at   timestamptz,
  add column if not exists dispatched_at  timestamptz,
  add column if not exists delivered_at   timestamptz,
  add column if not exists call_attempts  integer not null default 0,
  add column if not exists landmark       text;

-- speeds up the caller queue + unassigned queue
create index if not exists orders_assigned_to_idx on public.orders (assigned_to);

-- Backfill the milestone timestamps for existing orders from the history log
-- (order_status_events). Only fills where currently null — safe to re-run.
update public.orders o set confirmed_at = e.t
from (select order_id, min(changed_at) t from public.order_status_events where to_status = 'confirmed' group by order_id) e
where e.order_id = o.id and o.confirmed_at is null;

update public.orders o set dispatched_at = e.t
from (select order_id, min(changed_at) t from public.order_status_events where to_status = 'in_transit' group by order_id) e
where e.order_id = o.id and o.dispatched_at is null;

update public.orders o set delivered_at = e.t
from (select order_id, min(changed_at) t from public.order_status_events where to_status = 'delivered' group by order_id) e
where e.order_id = o.id and o.delivered_at is null;

-- Orders already 'delivered' but with no history event (pre-history data):
-- fall back to updated_at so the effectiveness view + finance count line up.
update public.orders set delivered_at = updated_at
where status = 'delivered' and delivered_at is null;
