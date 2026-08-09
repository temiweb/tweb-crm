-- ============================================================
-- Inventory integrity — database-owned stock movements
--
-- Run in STAGING first, then production during a short maintenance
-- window. These triggers make stock changes atomic with their source
-- records, so bulk actions, edits, reassignment, deletion, and concurrent
-- users cannot leave agent or warehouse stock out of sync.
-- ============================================================

create or replace function public.adjust_agent_inventory(
  p_agent_id uuid,
  p_product_name text,
  p_delta integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_agent_id is null or coalesce(trim(p_product_name), '') = '' or coalesce(p_delta, 0) = 0 then
    return;
  end if;

  if p_delta > 0 then
    insert into public.inventory (agent_id, product_name, qty)
    values (p_agent_id, p_product_name, p_delta)
    on conflict (agent_id, product_name)
    do update set qty = public.inventory.qty + excluded.qty;
  else
    update public.inventory
    set qty = qty + p_delta
    where agent_id = p_agent_id
      and product_name = p_product_name
      and qty >= -p_delta;

    if not found then
      raise exception 'Insufficient recorded stock for this agent and product';
    end if;
  end if;
end;
$$;

create or replace function public.adjust_warehouse_inventory(
  p_product_name text,
  p_delta integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_count integer;
begin
  if coalesce(trim(p_product_name), '') = '' or coalesce(p_delta, 0) = 0 then
    return;
  end if;

  select count(*) into v_product_count
  from public.products
  where name = p_product_name;

  if v_product_count <> 1 then
    raise exception 'Expected exactly one product named "%"', p_product_name;
  end if;

  update public.products
  set warehouse_qty = coalesce(warehouse_qty, 0) + p_delta
  where name = p_product_name
    and (p_delta > 0 or coalesce(warehouse_qty, 0) >= -p_delta);

  if not found then
    raise exception 'Insufficient recorded warehouse stock for this product';
  end if;
end;
$$;

create or replace function public.order_inventory_qty(o public.orders)
returns integer
language sql
immutable
as $$
  select coalesce(nullif(o.actual_qty_delivered, 0), o.qty, 0)
$$;

create or replace function public.sync_order_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.status = 'delivered' and old.agent_id is not null then
    perform public.adjust_agent_inventory(old.agent_id, old.product, public.order_inventory_qty(old));
  end if;

  if tg_op <> 'DELETE' and new.status = 'delivered' then
    if new.agent_id is null then
      raise exception 'Assign a delivery agent before marking an order delivered';
    end if;
    perform public.adjust_agent_inventory(new.agent_id, new.product, -public.order_inventory_qty(new));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_inventory on public.orders;
create trigger orders_sync_inventory
after insert or update or delete on public.orders
for each row execute function public.sync_order_inventory();

create or replace function public.bulk_set_order_status(
  p_order_ids uuid[],
  p_status text
) returns setof public.orders
language plpgsql
as $$
begin
  return query
  update public.orders
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
      dispatched_at = case when p_status = 'in_transit' then coalesce(dispatched_at, now()) else dispatched_at end,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = any(p_order_ids)
  returning *;
end;
$$;

create or replace function public.sync_waybill_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.status = 'delivered' then
    perform public.adjust_warehouse_inventory(old.product_name, old.quantity);
    if old.agent_id is not null then
      perform public.adjust_agent_inventory(old.agent_id, old.product_name, -old.quantity);
    end if;
  end if;

  if tg_op <> 'DELETE' and new.status = 'delivered' then
    if new.agent_id is null then
      raise exception 'Assign an agent before marking a waybill delivered';
    end if;
    perform public.adjust_warehouse_inventory(new.product_name, -new.quantity);
    perform public.adjust_agent_inventory(new.agent_id, new.product_name, new.quantity);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists waybills_sync_inventory on public.waybills;
create trigger waybills_sync_inventory
after insert or update or delete on public.waybills
for each row execute function public.sync_waybill_inventory();

create or replace function public.sync_purchase_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.adjust_warehouse_inventory(old.product_name, -old.quantity);
  end if;
  if tg_op <> 'DELETE' then
    perform public.adjust_warehouse_inventory(new.product_name, new.quantity);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_purchases_sync_inventory on public.stock_purchases;
create trigger stock_purchases_sync_inventory
after insert or update or delete on public.stock_purchases
for each row execute function public.sync_purchase_inventory();

create or replace function public.sync_faulty_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    if old.agent_id is null then
      perform public.adjust_warehouse_inventory(old.product_name, old.quantity);
    else
      perform public.adjust_agent_inventory(old.agent_id, old.product_name, old.quantity);
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.agent_id is null then
      perform public.adjust_warehouse_inventory(new.product_name, -new.quantity);
    else
      perform public.adjust_agent_inventory(new.agent_id, new.product_name, -new.quantity);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists faulty_stock_sync_inventory on public.faulty_stock;
create trigger faulty_stock_sync_inventory
after insert or update or delete on public.faulty_stock
for each row execute function public.sync_faulty_inventory();

create or replace function public.sync_transfer_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.adjust_agent_inventory(old.from_agent_id, old.product_name, old.quantity);
    perform public.adjust_agent_inventory(old.to_agent_id, old.product_name, -old.quantity);
  end if;

  if tg_op <> 'DELETE' then
    if new.from_agent_id is null or new.to_agent_id is null or new.from_agent_id = new.to_agent_id then
      raise exception 'A stock transfer needs two different agents';
    end if;
    perform public.adjust_agent_inventory(new.from_agent_id, new.product_name, -new.quantity);
    perform public.adjust_agent_inventory(new.to_agent_id, new.product_name, new.quantity);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_transfers_sync_inventory on public.stock_transfers;
create trigger stock_transfers_sync_inventory
after insert or update or delete on public.stock_transfers
for each row execute function public.sync_transfer_inventory();

revoke all on function public.adjust_agent_inventory(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.adjust_warehouse_inventory(text, integer) from public, anon, authenticated;
revoke all on function public.order_inventory_qty(public.orders) from public, anon, authenticated;
revoke all on function public.sync_order_inventory() from public, anon, authenticated;
revoke all on function public.sync_waybill_inventory() from public, anon, authenticated;
revoke all on function public.sync_purchase_inventory() from public, anon, authenticated;
revoke all on function public.sync_faulty_inventory() from public, anon, authenticated;
revoke all on function public.sync_transfer_inventory() from public, anon, authenticated;
revoke all on function public.bulk_set_order_status(uuid[], text) from public, anon;
grant execute on function public.bulk_set_order_status(uuid[], text) to authenticated;
