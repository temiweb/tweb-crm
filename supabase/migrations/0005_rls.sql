-- ============================================================
-- Phase 6 · Step 6 — Row-Level Security across all tables
-- Run on STAGING first. Test as a CALLER and as an ADMIN before prod.
-- The webhook + invite edge functions use the service_role key, which
-- bypasses RLS, so intake and staff invites keep working.
--
-- current_staff_role() is SECURITY DEFINER (defined in 0004) so policies
-- can read the caller's role without recursing through RLS. It returns
-- NULL for logged-out / inactive / non-staff users → no access.
-- ============================================================

-- ---------- ORDERS ----------
alter table public.orders enable row level security;
create policy orders_select on public.orders for select
  using (public.current_staff_role() is not null);
create policy orders_insert on public.orders for insert
  with check (public.current_staff_role() in ('admin','manager'));
create policy orders_update on public.orders for update
  using (public.current_staff_role() in ('admin','manager','caller'));
create policy orders_delete on public.orders for delete
  using (public.current_staff_role() in ('admin','manager'));

-- ---------- ORDER STATUS EVENTS (history) ----------
alter table public.order_status_events enable row level security;
create policy ose_select on public.order_status_events for select
  using (public.current_staff_role() is not null);
create policy ose_insert on public.order_status_events for insert
  with check (public.current_staff_role() in ('admin','manager','caller'));

-- ---------- INVENTORY (callers update via the delivery flow) ----------
alter table public.inventory enable row level security;
create policy inv_select on public.inventory for select
  using (public.current_staff_role() is not null);
create policy inv_update on public.inventory for update
  using (public.current_staff_role() in ('admin','manager','caller'));
create policy inv_insert on public.inventory for insert
  with check (public.current_staff_role() in ('admin','manager'));
create policy inv_delete on public.inventory for delete
  using (public.current_staff_role() in ('admin','manager'));

-- ---------- READ-ALL-STAFF / WRITE admin+manager tables ----------
do $$
declare t text;
begin
  foreach t in array array['agents','products','templates','waybills','stock_purchases','faulty_stock','stock_transfers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select using (public.current_staff_role() is not null)', t, t);
    execute format('create policy %I_write on public.%I for all using (public.current_staff_role() in (''admin'',''manager'')) with check (public.current_staff_role() in (''admin'',''manager''))', t, t);
  end loop;
end $$;

-- ---------- STAFF (read own row; admins manage everyone) ----------
alter table public.staff enable row level security;
create policy staff_self_select on public.staff for select
  using (auth_user_id = auth.uid() or public.current_staff_role() = 'admin');
create policy staff_admin_write on public.staff for all
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
