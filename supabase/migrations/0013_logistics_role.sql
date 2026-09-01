alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('admin','caller','viewer','manager','accountant','logistics'));

create policy orders_logistics_select on public.orders for select using (
  public.current_staff_role() = 'logistics'
);

create policy inventory_logistics_write on public.inventory for all using (
  public.current_staff_role() = 'logistics'
) with check (
  public.current_staff_role() = 'logistics'
);

create policy waybills_logistics_write on public.waybills for all using (
  public.current_staff_role() = 'logistics'
) with check (
  public.current_staff_role() = 'logistics'
);

create policy purchases_logistics_write on public.stock_purchases for all using (
  public.current_staff_role() = 'logistics'
) with check (
  public.current_staff_role() = 'logistics'
);

create policy faulty_stock_logistics_write on public.faulty_stock for all using (
  public.current_staff_role() = 'logistics'
) with check (
  public.current_staff_role() = 'logistics'
);

create policy stock_transfers_logistics_write on public.stock_transfers for all using (
  public.current_staff_role() = 'logistics'
) with check (
  public.current_staff_role() = 'logistics'
);
