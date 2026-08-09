-- ============================================================
-- Phase 8 — Batch costing, running average cost & COGS
-- Additive only. Idempotent. Safe to run on production directly.
-- Run AFTER 0009_inventory_integrity (this file extends its
-- bulk_set_order_status RPC at the bottom).
--
-- What this does:
--   1. Extends stock_purchases with landed-cost detail (keeps the
--      existing quantity/unit_cost/note columns untouched).
--   2. Adds products.average_cost (moving weighted average per product).
--   3. Seeds opening average cost for the two known products.
--   4. Adds orders.unit_cost (the cost snapshotted onto an order when
--      it is delivered — set by the app, backfilled here for history).
--   5. Installs a trigger that recalculates products.average_cost on
--      each new purchase. This runs ONLY on stock_purchases (a cold,
--      rarely-written table) — never on the hot orders table.
--
-- Nothing here changes any existing value or behaviour. The finance
-- dashboard ignores these new columns until its COGS feature flag is on.
-- ============================================================

-- ── 1. Landed-cost detail on the existing purchase log ──
-- (existing columns: quantity = units, unit_cost, note = notes)
alter table public.stock_purchases add column if not exists total_landed_cost   numeric(12,2);
alter table public.stock_purchases add column if not exists landed_cost_per_unit numeric(12,2);
alter table public.stock_purchases add column if not exists currency            text;
alter table public.stock_purchases add column if not exists fx_rate             numeric(12,4);
alter table public.stock_purchases add column if not exists product_cost        numeric(12,2);
alter table public.stock_purchases add column if not exists shipping_cost       numeric(12,2);
alter table public.stock_purchases add column if not exists duties              numeric(12,2);
alter table public.stock_purchases add column if not exists other_fees          numeric(12,2);

-- ── 2. Running average cost per product ──
alter table public.products add column if not exists average_cost numeric(12,2);

-- ── 3. Seed opening average cost (only if not already set) ──
update public.products set average_cost = 2138.18
  where name = 'Net Repair Tape' and average_cost is null;
update public.products set average_cost = 3831.00
  where name = 'Heavy Duty Mesh Tape' and average_cost is null;

-- ── 4. Per-order cost snapshot ──
alter table public.orders add column if not exists unit_cost numeric(12,2);

-- ── 5. Recalculate the moving average on each purchase ──
-- units_on_hand (before this batch is added) = warehouse stock + all agent stock
-- for the same product name. The app increments warehouse_qty AFTER inserting the
-- purchase row, so at trigger time warehouse_qty still reflects pre-batch stock.
create or replace function public.recalc_average_cost() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  on_hand    integer;
  cur_avg    numeric(12,2);
  batch_cpu  numeric(12,2);
begin
  -- cost per unit for this batch: prefer landed cost, fall back to unit_cost
  batch_cpu := coalesce(
    new.landed_cost_per_unit,
    new.total_landed_cost / nullif(new.quantity, 0),
    new.unit_cost,
    0
  );
  -- store the derived per-unit cost for transparency if it wasn't supplied
  if new.landed_cost_per_unit is null then
    new.landed_cost_per_unit := batch_cpu;
  end if;

  select coalesce(p.warehouse_qty, 0)
       + coalesce((select sum(i.qty) from public.inventory i
                    where i.product_name = new.product_name), 0),
         coalesce(p.average_cost, 0)
    into on_hand, cur_avg
    from public.products p
   where p.name = new.product_name;

  -- product not found by name → nothing to average against, leave as-is
  if not found then
    return new;
  end if;

  if (on_hand + new.quantity) > 0 then
    update public.products
       set average_cost = round(
             (on_hand * cur_avg + new.quantity * batch_cpu)
             / (on_hand + new.quantity), 2)
     where name = new.product_name;
  end if;

  return new;
end $$;

drop trigger if exists stock_purchases_recalc_avg on public.stock_purchases;
create trigger stock_purchases_recalc_avg
  before insert on public.stock_purchases
  for each row execute function public.recalc_average_cost();

-- ── 6. Backfill cost onto already-delivered orders (history) ──
-- Uses the product's current average cost (seeded above). Only fills blanks,
-- so re-running never disturbs a cost that's already been set.
--
-- This is a PURE cost backfill — it must not re-run 0009's inventory-sync
-- trigger, which raises on historical delivered orders that have no agent and
-- would otherwise churn agent stock. Disable that one trigger for just this
-- update; the DO block runs atomically, so any failure rolls the disable back
-- and leaves the trigger enabled.
do $$
begin
  alter table public.orders disable trigger orders_sync_inventory;

  update public.orders o
     set unit_cost = p.average_cost
    from public.products p
   where o.product = p.name
     and o.status = 'delivered'
     and o.unit_cost is null
     and p.average_cost is not null;

  alter table public.orders enable trigger orders_sync_inventory;
end $$;

-- ── 7. Also snapshot cost on the bulk-status path ──
-- 0009 added bulk_set_order_status, which the app uses to deliver many orders at
-- once — bypassing the app-side snapshot. Extend it (create-or-replace keeps the
-- existing grants) to stamp unit_cost when delivering, so every delivery path
-- captures cost. Only fills blanks; never disturbs a cost already set.
create or replace function public.bulk_set_order_status(
  p_order_ids uuid[],
  p_status text
) returns setof public.orders
language plpgsql
as $$
begin
  return query
  update public.orders o
  set status = p_status,
      confirmed_at  = case when p_status = 'confirmed'  then coalesce(o.confirmed_at, now())  else o.confirmed_at  end,
      dispatched_at = case when p_status = 'in_transit' then coalesce(o.dispatched_at, now()) else o.dispatched_at end,
      delivered_at  = case when p_status = 'delivered'  then now() else o.delivered_at end,
      unit_cost     = case when p_status = 'delivered' and o.unit_cost is null
                           then (select p.average_cost from public.products p where p.name = o.product)
                           else o.unit_cost end
  where o.id = any(p_order_ids)
  returning o.*;
end;
$$;

revoke all on function public.bulk_set_order_status(uuid[], text) from public, anon;
grant execute on function public.bulk_set_order_status(uuid[], text) to authenticated;
