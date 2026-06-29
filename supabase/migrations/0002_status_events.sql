-- ============================================================
-- Status-change history log
-- Run in STAGING first; apply identical file to prod at cutover.
-- Additive only: one new table + index. No changes to existing data.
-- (changed_by is added in Phase 6 once staff auth exists.)
-- ============================================================

create table if not exists public.order_status_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_at  timestamptz default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, changed_at desc);

-- Keep consistent with the rest of the schema: RLS off until Phase 6 adds
-- real auth + policies across all tables. (New tables can come up with RLS
-- enabled, which would block the app's anon-key writes.)
alter table public.order_status_events disable row level security;
