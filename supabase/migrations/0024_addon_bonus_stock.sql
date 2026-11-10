-- ============================================================
-- 0024 — Track add-on + free-bonus stock on delivery (Nigeria)
-- IDEMPOTENT, ADDITIVE. Does NOT touch the existing strict main-product
-- deduction (sync_order_inventory, 0009).
--
-- When an order is delivered, the delivering agent also gives out:
--   • paid add-ons on the order (orders.add_ons, 0022), by name
--   • a free bonus configured on the product, e.g. each Solar Rotating Car
--     Freshener ships with 1 × Car perfume (products.bonus_product /
--     bonus_qty_per_unit — a setting, nothing hardcoded)
-- Both are deducted from that agent's stock, NON-BLOCKING: a shortage never
-- stops a delivery being marked; the agent's count goes negative and the CRM
-- shows it red so the count can be corrected.
--
-- Every deduction is written to order_stock_moves (a small ledger). Undoing a
-- delivery (status change, agent change, edit, delete) returns exactly what
-- the ledger says was taken — so orders delivered BEFORE this migration are
-- never deducted retroactively, and bonus-setting changes never distort
-- reversals. The ledger lives off the orders table to keep the hot orders
-- sync payload unchanged (egress).
-- ============================================================

-- 1) Bonus setting on products ("each unit ships with N × <product>").
alter table public.products
  add column if not exists bonus_product      text,
  add column if not exists bonus_qty_per_unit integer not null default 0;

-- 2) Ledger of add-on/bonus units each delivered order took from an agent.
create table if not exists public.order_stock_moves (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders(id) on delete cascade,
  agent_id     uuid not null,
  product_name text not null,
  qty          integer not null check (qty > 0),
  kind         text not null check (kind in ('addon', 'bonus')),
  created_at   timestamptz not null default now()
);
create index if not exists order_stock_moves_order_idx on public.order_stock_moves (order_id);

alter table public.order_stock_moves enable row level security;
drop policy if exists osm_select on public.order_stock_moves;
create policy osm_select on public.order_stock_moves for select using (public.current_staff_role() is not null);
-- No write policies: only the security-definer trigger below writes the ledger.

-- 3) Non-blocking agent stock adjustment (may go negative = visible shortage).
create or replace function public.adjust_agent_inventory_soft(
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
  if not exists (select 1 from public.agents where id = p_agent_id) then
    return; -- agent removed since: nothing to adjust
  end if;

  begin
    insert into public.inventory (agent_id, product_name, qty)
    values (p_agent_id, p_product_name, p_delta)
    on conflict (agent_id, product_name)
    do update set qty = public.inventory.qty + excluded.qty;
  exception when check_violation then
    -- If inventory enforces qty >= 0, floor at zero rather than block the delivery.
    update public.inventory set qty = greatest(qty + p_delta, 0)
    where agent_id = p_agent_id and product_name = p_product_name;
    if not found then
      insert into public.inventory (agent_id, product_name, qty)
      values (p_agent_id, p_product_name, greatest(p_delta, 0))
      on conflict (agent_id, product_name) do nothing;
    end if;
  end;
end;
$$;

-- 4) Return everything the ledger says this order took; true if it took anything.
create or replace function public.order_stock_moves_unwind(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_had boolean := false;
begin
  for m in
    delete from public.order_stock_moves where order_id = p_order_id
    returning agent_id, product_name, qty
  loop
    v_had := true;
    perform public.adjust_agent_inventory_soft(m.agent_id, m.product_name, m.qty);
  end loop;
  return v_had;
end;
$$;

-- 5) Deduct this delivered order's add-ons + product bonus, and record them.
create or replace function public.order_stock_moves_apply(o public.orders)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_units integer := public.order_inventory_qty(o);
  r record;
begin
  for r in
    with items as (
      select btrim(e ->> 'name') as product_name,
        case when coalesce(e ->> 'qty', '') ~ '^\s*\d+(\.\d+)?\s*$'
             then round((e ->> 'qty')::numeric)::integer else 0 end as qty,
        'addon'::text as kind
      from jsonb_array_elements(case when jsonb_typeof(o.add_ons) = 'array' then o.add_ons else '[]'::jsonb end) e
      union all
      select btrim(p.bonus_product), p.bonus_qty_per_unit * v_units, 'bonus'::text
      from public.products p
      where p.name = o.product
        and coalesce(btrim(p.bonus_product), '') <> ''
        and p.bonus_qty_per_unit > 0
    )
    select product_name, kind, sum(qty)::integer as qty
    from items
    where coalesce(product_name, '') <> '' and qty > 0
    group by product_name, kind
  loop
    insert into public.order_stock_moves (order_id, agent_id, product_name, qty, kind)
    values (o.id, o.agent_id, r.product_name, r.qty, r.kind);
    perform public.adjust_agent_inventory_soft(o.agent_id, r.product_name, -r.qty);
  end loop;
end;
$$;

-- 6) Keep the ledger in step with the order.
--    UPDATE: undo whatever was taken, then re-apply if the order is (still)
--    delivered — but never for an order that was already delivered before this
--    migration and took nothing (no retroactive deductions).
create or replace function public.sync_order_stock_moves()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_had boolean := false;
begin
  if tg_op = 'DELETE' then
    perform public.order_stock_moves_unwind(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    v_had := public.order_stock_moves_unwind(new.id);
  end if;

  if new.status = 'delivered'
     and new.agent_id is not null
     and coalesce(new.country, 'nigeria') = 'nigeria'
     and (tg_op = 'INSERT' or v_had or old.status is distinct from 'delivered') then
    perform public.order_stock_moves_apply(new);
  end if;
  return new;
end;
$$;

-- Unwind BEFORE delete (the ledger's cascade would otherwise drop the rows
-- before they could be returned to stock).
drop trigger if exists orders_stock_moves_unwind on public.orders;
create trigger orders_stock_moves_unwind
before delete on public.orders
for each row execute function public.sync_order_stock_moves();

drop trigger if exists orders_stock_moves_sync on public.orders;
create trigger orders_stock_moves_sync
after insert or update on public.orders
for each row execute function public.sync_order_stock_moves();

-- Internal helpers: not callable from the app.
revoke all on function public.adjust_agent_inventory_soft(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.order_stock_moves_unwind(uuid) from public, anon, authenticated;
revoke all on function public.order_stock_moves_apply(public.orders) from public, anon, authenticated;
revoke all on function public.sync_order_stock_moves() from public, anon, authenticated;
