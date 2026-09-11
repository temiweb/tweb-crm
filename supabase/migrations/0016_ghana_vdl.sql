-- ============================================================
-- 0016 — Ghana / VDL integration, Phase 1 schema (IDEMPOTENT, ADDITIVE)
--
-- Adds two reference tables (gh_regions, gh_products) and a sidecar
-- table (vdl_orders, 1:1 with orders). Nothing existing is dropped or
-- renamed. Ghana/VDL columns live in the sidecar, NOT on orders, to keep
-- the client's select=* order fetch lean (protects the egress fix).
--
-- RLS matches the house pattern (0005): staff read; admin/manager write;
-- service_role (edge functions) bypasses RLS. Depends on
-- public.current_staff_role() (0005) and public.set_updated_at() (0011),
-- both already live on prod.
--
-- Run the WHOLE file at once in the Supabase SQL editor (prod; staging paused).
-- ============================================================

-- ---------- gh_regions — VDL's 17 Ghana regions, seeded once, static ----------
create table if not exists public.gh_regions (
  vdl_region_id integer primary key,
  name          text not null unique,
  code          text not null
);

insert into public.gh_regions (vdl_region_id, name, code) values
  (53,'Ahafo','AF'), (48,'Ashanti','AH'), (4959,'Bono','BO'),
  (4958,'Bono East','BE'), (52,'Central','CP'), (50,'Eastern','EP'),
  (54,'Greater Accra','AA'), (5069,'Greater Accra (Tema)','AT'),
  (4960,'North East','NE'), (51,'Northern','NP'), (4961,'Oti','OT'),
  (4962,'Savannah','SV'), (55,'Upper East','UE'), (57,'Upper West','UW'),
  (56,'Volta','TV'), (49,'Western','WP'), (4963,'Western North','WN')
on conflict (vdl_region_id) do nothing;

alter table public.gh_regions enable row level security;
drop policy if exists gh_regions_select on public.gh_regions;
drop policy if exists gh_regions_write  on public.gh_regions;
create policy gh_regions_select on public.gh_regions for select using (public.current_staff_role() is not null);
create policy gh_regions_write  on public.gh_regions for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- gh_products — VDL catalogue mirror, refreshed by vdl-product-sync ----------
create table if not exists public.gh_products (
  code               text primary key,
  vdl_product_id     integer,
  name               text not null,
  active             boolean not null default true,
  quantity_available integer not null default 0,
  synced_at          timestamptz not null default now()
);

alter table public.gh_products enable row level security;
drop policy if exists gh_products_select on public.gh_products;
drop policy if exists gh_products_write  on public.gh_products;
create policy gh_products_select on public.gh_products for select using (public.current_staff_role() is not null);
create policy gh_products_write  on public.gh_products for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- vdl_orders — sidecar (1:1 with orders); Ghana rows only ----------
create table if not exists public.vdl_orders (
  order_id            uuid primary key references public.orders(id) on delete cascade,
  wpforms_entry_id    text,
  -- structured intake values (from hidden form fields, never parsed from a label)
  gh_product_code     text,
  gh_quantity         integer,
  gh_expected_total   numeric(10,2),
  gh_discount_amount  numeric(10,2),
  gh_region_name      text,          -- must match gh_regions.name exactly
  gh_package_label    text,          -- display / audit only
  gh_gps_address      text,
  gh_raw_address      text,          -- verbatim from the form
  gh_location         text,          -- operator-corrected landmark; sent as customer_location
  -- sync state machine
  vdl_sync_status     text not null default 'needs_review'
    check (vdl_sync_status in ('needs_review','held','approved','pushing','synced','failed','auth_failed')),
  vdl_sync_error      text,
  vdl_sync_attempts   integer not null default 0,
  vdl_next_attempt_at timestamptz,
  vdl_synced_at       timestamptz,
  -- VDL identity + financials (as QUOTED by VDL — keep distinct from remitted cash)
  vdl_order_id            integer,
  vdl_tracking_id         text,
  vdl_state_label         text,
  vdl_amount_due_customer numeric(10,2),
  vdl_vendor_amount_due   numeric(10,2),
  vdl_commission_amount   numeric(10,2),
  vdl_delivery_fee        numeric(10,2),
  vdl_packaging_fee       numeric(10,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Idempotency: WPForms occasionally fires a webhook twice.
create unique index if not exists vdl_orders_wpforms_entry_id_key
  on public.vdl_orders (wpforms_entry_id) where wpforms_entry_id is not null;
-- Push-queue lookup.
create index if not exists vdl_orders_push_queue_idx
  on public.vdl_orders (vdl_sync_status, vdl_next_attempt_at);
-- Status-poller lookup.
create index if not exists vdl_orders_tracking_idx
  on public.vdl_orders (vdl_tracking_id) where vdl_tracking_id is not null;

-- Auto-bump updated_at (same helper as orders, from 0011).
drop trigger if exists vdl_orders_set_updated_at on public.vdl_orders;
create trigger vdl_orders_set_updated_at
  before update on public.vdl_orders
  for each row execute function public.set_updated_at();

alter table public.vdl_orders enable row level security;
drop policy if exists vdl_orders_select on public.vdl_orders;
drop policy if exists vdl_orders_insert on public.vdl_orders;
drop policy if exists vdl_orders_update on public.vdl_orders;
drop policy if exists vdl_orders_delete on public.vdl_orders;
-- Staff read (Phase 5 will scope reads by staff country). Intake/push/poller
-- functions write as service_role and bypass these; the operator's Approve /
-- location edit runs as an admin/manager and needs the update policy.
create policy vdl_orders_select on public.vdl_orders for select using (public.current_staff_role() is not null);
create policy vdl_orders_insert on public.vdl_orders for insert with check (public.current_staff_role() in ('admin','manager'));
create policy vdl_orders_update on public.vdl_orders for update using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));
create policy vdl_orders_delete on public.vdl_orders for delete using (public.current_staff_role() in ('admin','manager'));
