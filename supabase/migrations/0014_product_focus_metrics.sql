create or replace function public.get_nigeria_decision_metrics(
  p_from date,
  p_to date,
  p_maturity_days integer,
  p_product text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $product_focus$
declare
  v_product text := nullif(btrim(p_product), '');
  v_from date := coalesce(p_from, date '2000-01-01');
  v_to date := coalesce(p_to, current_date);
  v_mature_before timestamptz;
  v_result jsonb;
  v_overview jsonb;
  v_products jsonb;
  v_packages jsonb;
  v_tagged_spend numeric := 0;
begin
  if coalesce(public.current_staff_role(), '') not in ('admin', 'manager', 'accountant') then
    raise exception 'Only analytics staff can view decision metrics';
  end if;

  if v_to < v_from then
    raise exception 'End date must not be before start date';
  end if;

  v_result := public.get_nigeria_decision_metrics(p_from, p_to, p_maturity_days);
  if v_product is null then
    return v_result;
  end if;

  v_mature_before := date_trunc('day', now()) - make_interval(days => greatest(1, least(coalesce(p_maturity_days, 7), 60)));

  with scoped_orders as (
    select * from public.orders where country = 'nigeria' and product = v_product
      and created_at >= v_from and created_at < (v_to + 1)::timestamptz
  ), mature_orders as (
    select * from scoped_orders where created_at < v_mature_before
  ), delivery_period as (
    select * from scoped_orders where status = 'delivered'
  )
  select jsonb_build_object(
    'period_orders', (select count(*) from scoped_orders),
    'mature_orders', (select count(*) from mature_orders),
    'maturing_orders', (select count(*) from scoped_orders) - (select count(*) from mature_orders),
    'mature_delivered', (select count(*) from mature_orders where status = 'delivered'),
    'mature_eligible', (select count(*) from mature_orders where status <> 'out_of_stock'),
    'mature_resolved', (select count(*) from mature_orders where status in ('delivered', 'cancelled', 'rejected', 'failed_delivery')),
    'mature_failed', (select count(*) from mature_orders where status in ('cancelled', 'rejected', 'failed_delivery')),
    'mature_open', (select count(*) from mature_orders where status not in ('delivered', 'cancelled', 'rejected', 'failed_delivery', 'out_of_stock')),
    'mature_out_of_stock', (select count(*) from mature_orders where status = 'out_of_stock'),
    'delivered_orders', (select count(*) from delivery_period),
    'delivered_units', (select coalesce(sum(coalesce(nullif(actual_qty_delivered, 0), qty, 0)), 0) from delivery_period),
    'net_revenue', (select coalesce(sum(coalesce(nullif(actual_price_collected, 0), price, 0) - coalesce(delivery_fee, 0)), 0) from delivery_period),
    'known_cogs', (select coalesce(sum(coalesce(nullif(actual_qty_delivered, 0), qty, 0) * unit_cost), 0) from delivery_period where unit_cost is not null),
    'missing_cogs_orders', (select count(*) from delivery_period where unit_cost is null)
  ) into v_overview;

  select coalesce(jsonb_agg(item || jsonb_build_object('revenue_share', case when (item ->> 'net_revenue')::numeric > 0 then 100 else null end)), '[]'::jsonb)
  into v_products from jsonb_array_elements(v_result -> 'products') item where item ->> 'product' = v_product;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_packages from jsonb_array_elements(v_result -> 'packages') item where item ->> 'product' = v_product;

  if to_regclass('public.finance_expenses') is not null then
    select coalesce(sum(amount * case when market = 'both' then coalesce(nigeria_share, 50) / 100 else 1 end), 0)
    into v_tagged_spend from public.finance_expenses
    where category = 'ad_spend' and market in ('nigeria', 'both') and product = v_product and date >= v_from and date <= v_to;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_result, '{overview}', v_overview),
      '{products}', v_products
    ),
    '{packages}', v_packages
  ) || jsonb_build_object('finance', jsonb_build_object('tagged_ad_spend', v_tagged_spend, 'unallocated_ad_spend', 0, 'cash_received', null));
end;
$product_focus$;

revoke all on function public.get_nigeria_decision_metrics(date, date, integer, text) from public, anon;
grant execute on function public.get_nigeria_decision_metrics(date, date, integer, text) to authenticated;
