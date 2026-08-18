-- ============================================================
-- Safe product management
--
-- Product names are used as inventory keys across historical records.
-- These RPCs permit correcting or deleting an unused product, while
-- preventing a rewrite that would corrupt stock history.
-- ============================================================

create or replace function public.rename_unused_product(
  p_product_id uuid,
  p_new_name text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text := trim(p_new_name);
begin
  if coalesce(public.current_staff_role(), '') not in ('admin', 'manager') then
    raise exception 'Only admins and managers can rename products';
  end if;

  if v_new_name = '' then
    raise exception 'Product name cannot be empty';
  end if;

  select name into v_old_name from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_old_name = v_new_name then
    return;
  end if;
  if exists (select 1 from public.products where name = v_new_name) then
    raise exception 'A product named "%" already exists', v_new_name;
  end if;

  if exists (select 1 from public.products where id = p_product_id and coalesce(warehouse_qty, 0) <> 0)
    or exists (select 1 from public.inventory where product_name = v_old_name)
    or exists (select 1 from public.orders where product = v_old_name)
    or exists (select 1 from public.waybills where product_name = v_old_name)
    or exists (select 1 from public.stock_purchases where product_name = v_old_name)
    or exists (select 1 from public.faulty_stock where product_name = v_old_name)
    or exists (select 1 from public.stock_transfers where product_name = v_old_name) then
    raise exception 'This product has stock or transaction history and cannot be renamed safely';
  end if;

  update public.products set name = v_new_name where id = p_product_id;
end;
$$;

create or replace function public.delete_unused_product(
  p_product_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if coalesce(public.current_staff_role(), '') not in ('admin', 'manager') then
    raise exception 'Only admins and managers can delete products';
  end if;

  select name into v_name from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;

  if exists (select 1 from public.products where id = p_product_id and coalesce(warehouse_qty, 0) <> 0)
    or exists (select 1 from public.inventory where product_name = v_name)
    or exists (select 1 from public.orders where product = v_name)
    or exists (select 1 from public.waybills where product_name = v_name)
    or exists (select 1 from public.stock_purchases where product_name = v_name)
    or exists (select 1 from public.faulty_stock where product_name = v_name)
    or exists (select 1 from public.stock_transfers where product_name = v_name) then
    raise exception 'This product has stock or transaction history and cannot be deleted safely';
  end if;

  delete from public.products where id = p_product_id;
end;
$$;

revoke all on function public.rename_unused_product(uuid, text) from public, anon;
revoke all on function public.delete_unused_product(uuid) from public, anon;
grant execute on function public.rename_unused_product(uuid, text) to authenticated;
grant execute on function public.delete_unused_product(uuid) to authenticated;
