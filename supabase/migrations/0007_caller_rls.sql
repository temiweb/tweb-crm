-- ============================================================
-- Phase 7 · Tighten orders RLS so a caller sees/edits ONLY their own
-- assigned orders. Admin/manager/viewer/accountant keep full read; writes
-- stay admin/manager except a caller may update their own rows.
-- Idempotent. Run on STAGING after assignment is tested, then at the
-- prod cutover (with the feature flag).  Unassigned orders (assigned_to null)
-- remain visible to admin/manager/viewer/accountant only.
-- ============================================================

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using (
  public.current_staff_role() in ('admin','manager','viewer','accountant')
  or (public.current_staff_role() = 'caller' and assigned_to = auth.uid())
);

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update using (
  public.current_staff_role() in ('admin','manager')
  or (public.current_staff_role() = 'caller' and assigned_to = auth.uid())
);
-- orders_insert (admin/manager) and orders_delete (admin/manager) unchanged.
