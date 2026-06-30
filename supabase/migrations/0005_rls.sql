-- ============================================================
-- Phase 6 · Step 6 — Row-Level Security across all tables (IDEMPOTENT)
-- Safe to run repeatedly and over a mixed state (some tables already had
-- RLS toggled on manually). enable-rls is a no-op if already on; every
-- policy is dropped-if-exists before create. Run the WHOLE file at once.
--
-- service_role (webhook + invite edge fns) bypasses RLS, so intake + invites
-- keep working. current_staff_role() is SECURITY DEFINER (no recursion);
-- returns NULL for logged-out/inactive/non-staff → no access.
-- ============================================================

-- ---------- Drop legacy permissive "Allow all" policies (from initial project
-- setup) — these have qual=true and would OR with our restrictive policies,
-- keeping anon access open. ----------
drop policy if exists "Allow all on orders"    on public.orders;
drop policy if exists "Allow all on inventory" on public.inventory;
drop policy if exists "Allow all on agents"    on public.agents;
drop policy if exists "Allow all on products"  on public.products;
drop policy if exists "Allow all on templates" on public.templates;

-- ---------- ORDERS ----------
alter table public.orders enable row level security;
drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;
create policy orders_select on public.orders for select using (public.current_staff_role() is not null);
create policy orders_insert on public.orders for insert with check (public.current_staff_role() in ('admin','manager'));
create policy orders_update on public.orders for update using (public.current_staff_role() in ('admin','manager','caller'));
create policy orders_delete on public.orders for delete using (public.current_staff_role() in ('admin','manager'));

-- ---------- ORDER STATUS EVENTS ----------
alter table public.order_status_events enable row level security;
drop policy if exists ose_select on public.order_status_events;
drop policy if exists ose_insert on public.order_status_events;
create policy ose_select on public.order_status_events for select using (public.current_staff_role() is not null);
create policy ose_insert on public.order_status_events for insert with check (public.current_staff_role() in ('admin','manager','caller'));

-- ---------- INVENTORY (callers update via delivery flow) ----------
alter table public.inventory enable row level security;
drop policy if exists inv_select on public.inventory;
drop policy if exists inv_update on public.inventory;
drop policy if exists inv_insert on public.inventory;
drop policy if exists inv_delete on public.inventory;
create policy inv_select on public.inventory for select using (public.current_staff_role() is not null);
create policy inv_update on public.inventory for update using (public.current_staff_role() in ('admin','manager','caller'));
create policy inv_insert on public.inventory for insert with check (public.current_staff_role() in ('admin','manager'));
create policy inv_delete on public.inventory for delete using (public.current_staff_role() in ('admin','manager'));

-- ---------- AGENTS ----------
alter table public.agents enable row level security;
drop policy if exists agents_select on public.agents;
drop policy if exists agents_write on public.agents;
create policy agents_select on public.agents for select using (public.current_staff_role() is not null);
create policy agents_write on public.agents for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- PRODUCTS ----------
alter table public.products enable row level security;
drop policy if exists products_select on public.products;
drop policy if exists products_write on public.products;
create policy products_select on public.products for select using (public.current_staff_role() is not null);
create policy products_write on public.products for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- TEMPLATES ----------
alter table public.templates enable row level security;
drop policy if exists templates_select on public.templates;
drop policy if exists templates_write on public.templates;
create policy templates_select on public.templates for select using (public.current_staff_role() is not null);
create policy templates_write on public.templates for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- WAYBILLS ----------
alter table public.waybills enable row level security;
drop policy if exists waybills_select on public.waybills;
drop policy if exists waybills_write on public.waybills;
create policy waybills_select on public.waybills for select using (public.current_staff_role() is not null);
create policy waybills_write on public.waybills for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- STOCK PURCHASES ----------
alter table public.stock_purchases enable row level security;
drop policy if exists purchases_select on public.stock_purchases;
drop policy if exists purchases_write on public.stock_purchases;
create policy purchases_select on public.stock_purchases for select using (public.current_staff_role() is not null);
create policy purchases_write on public.stock_purchases for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- FAULTY STOCK ----------
alter table public.faulty_stock enable row level security;
drop policy if exists faulty_select on public.faulty_stock;
drop policy if exists faulty_write on public.faulty_stock;
create policy faulty_select on public.faulty_stock for select using (public.current_staff_role() is not null);
create policy faulty_write on public.faulty_stock for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- STOCK TRANSFERS ----------
alter table public.stock_transfers enable row level security;
drop policy if exists transfers_select on public.stock_transfers;
drop policy if exists transfers_write on public.stock_transfers;
create policy transfers_select on public.stock_transfers for select using (public.current_staff_role() is not null);
create policy transfers_write on public.stock_transfers for all using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));

-- ---------- STAFF (own row; admins manage all) ----------
alter table public.staff enable row level security;
drop policy if exists staff_self_select on public.staff;
drop policy if exists staff_admin_write on public.staff;
create policy staff_self_select on public.staff for select using (auth_user_id = auth.uid() or public.current_staff_role() = 'admin');
create policy staff_admin_write on public.staff for all using (public.current_staff_role() = 'admin') with check (public.current_staff_role() = 'admin');
