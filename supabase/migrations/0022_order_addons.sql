-- ============================================================
-- 0022 — Order add-ons (Nigeria): sell extra products at order time
--
-- Generic, product-agnostic. An order keeps its main product; any extra
-- items the customer adds (first case: a Car perfume at ₦5,000) are stored
-- as a small list. The order's price/collected amount already includes them
-- (the intake sums them in), so the money path is unchanged — this column is
-- the itemised breakdown for display and reporting.
--
-- add_ons shape: [{ "name": text, "qty": number, "total": number }]
-- addon_total is the summed money, denormalised for easy aggregation.
-- NG has no product codes — add-ons are identified by NAME (codes are Ghana).
-- ============================================================

alter table public.orders
  add column if not exists add_ons     jsonb,
  add column if not exists addon_total numeric;

-- ── Reporting: add-on units + revenue by name, same cohort as the decision
-- metrics (NG delivered orders created in the period). Optional product focus
-- mirrors get_nigeria_decision_metrics. Role-gated identically.
create or replace function public.get_nigeria_addon_sales(
  p_from date default null,
  p_to date default null,
  p_product text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $addon_sales$
declare
  v_product text := nullif(btrim(p_product), '');
  v_from date := coalesce(p_from, date '2000-01-01');
  v_to date := coalesce(p_to, current_date);
  v_result jsonb;
begin
  if coalesce(public.current_staff_role(), '') not in ('admin', 'manager', 'accountant') then
    raise exception 'Only analytics staff can view decision metrics';
  end if;
  if v_to < v_from then
    raise exception 'End date must not be before start date';
  end if;

  with scoped as (
    select o.add_ons
    from public.orders o
    where o.country = 'nigeria' and o.status = 'delivered'
      and o.created_at >= v_from and o.created_at < (v_to + 1)::timestamptz
      and (v_product is null or o.product = v_product)
      and o.add_ons is not null and jsonb_typeof(o.add_ons) = 'array'
  ), items as (
    select btrim(e ->> 'name') as name,
           coalesce((e ->> 'qty')::numeric, 0) as qty,
           coalesce((e ->> 'total')::numeric, 0) as total
    from scoped, lateral jsonb_array_elements(scoped.add_ons) e
    where btrim(coalesce(e ->> 'name', '')) <> ''
  ), by_name as (
    select name, sum(qty) as units, sum(total) as revenue, count(*) as orders
    from items group by name
  )
  select jsonb_build_object(
    'total_units', coalesce((select sum(units) from by_name), 0),
    'total_revenue', coalesce((select sum(revenue) from by_name), 0),
    'by_name', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'units', units, 'revenue', revenue, 'orders', orders)
                       order by revenue desc, name)
      from by_name
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$addon_sales$;

revoke all on function public.get_nigeria_addon_sales(date, date, text) from public, anon;
grant execute on function public.get_nigeria_addon_sales(date, date, text) to authenticated;
