create or replace function public.get_nigeria_decision_metrics(
  p_from date default null,
  p_to date default null,
  p_maturity_days integer default 7
) returns jsonb
language plpgsql
security definer
set search_path = public
as $decision_metrics$
declare
  v_from date := coalesce(p_from, date '2000-01-01');
  v_to date := coalesce(p_to, current_date);
  v_maturity_days integer := greatest(1, least(coalesce(p_maturity_days, 7), 60));
  v_mature_before timestamptz;
  v_overview jsonb;
  v_products jsonb;
  v_packages jsonb;
  v_finance jsonb := '{}'::jsonb;
begin
  if coalesce(public.current_staff_role(), '') not in ('admin', 'manager', 'accountant') then
    raise exception 'Only analytics staff can view decision metrics';
  end if;

  if v_to < v_from then
    raise exception 'End date must not be before start date';
  end if;

  v_mature_before := date_trunc('day', now()) - make_interval(days => v_maturity_days);

  with scoped_orders as (
    select * from public.orders
    where country = 'nigeria' and created_at >= v_from and created_at < (v_to + 1)::timestamptz
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

  with scoped_orders as (
    select * from public.orders
    where country = 'nigeria' and created_at >= v_from and created_at < (v_to + 1)::timestamptz
  ), delivery_period as (
    select * from scoped_orders where status = 'delivered'
  ), product_names as (
    select name as product from public.products
    union select distinct product from public.orders where country = 'nigeria' and product is not null
  ), agent_stock as (
    select product_name as product, coalesce(sum(qty), 0)::integer as quantity from public.inventory group by product_name
  ), recent_velocity as (
    select product, coalesce(sum(coalesce(nullif(actual_qty_delivered, 0), qty, 0)), 0)::integer as units_28d
    from public.orders
    where country = 'nigeria' and status = 'delivered' and coalesce(delivered_at, created_at) >= current_date - 27
    group by product
  ), product_cohort as (
    select product, count(*) as orders,
      count(*) filter (where created_at < v_mature_before) as mature_orders,
      count(*) filter (where created_at < v_mature_before and status = 'delivered') as mature_delivered,
      count(*) filter (where created_at < v_mature_before and status in ('delivered', 'cancelled', 'rejected', 'failed_delivery')) as mature_resolved,
      count(*) filter (where created_at < v_mature_before and status = 'out_of_stock') as mature_out_of_stock
    from scoped_orders group by product
  ), product_delivery as (
    select product, count(*) as delivered_orders,
      coalesce(sum(coalesce(nullif(actual_qty_delivered, 0), qty, 0)), 0) as delivered_units,
      coalesce(sum(coalesce(nullif(actual_price_collected, 0), price, 0) - coalesce(delivery_fee, 0)), 0) as net_revenue
    from delivery_period group by product
  ), product_rows as (
    select pn.product, coalesce(p.warehouse_qty, 0) as warehouse_qty, coalesce(ast.quantity, 0) as agent_qty,
      coalesce(rv.units_28d, 0) as delivered_units_28d, coalesce(pc.orders, 0) as orders,
      coalesce(pc.mature_orders, 0) as mature_orders, coalesce(pc.mature_delivered, 0) as mature_delivered,
      coalesce(pc.mature_resolved, 0) as mature_resolved, coalesce(pc.mature_out_of_stock, 0) as mature_out_of_stock,
      coalesce(pd.delivered_orders, 0) as delivered_orders, coalesce(pd.delivered_units, 0) as delivered_units,
      coalesce(pd.net_revenue, 0) as net_revenue
    from product_names pn
    left join public.products p on p.name = pn.product
    left join agent_stock ast on ast.product = pn.product
    left join recent_velocity rv on rv.product = pn.product
    left join product_cohort pc on pc.product = pn.product
    left join product_delivery pd on pd.product = pn.product
  ), product_with_total as (
    select product_rows.*, sum(net_revenue) over () as total_net_revenue
    from product_rows
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product', product, 'orders', orders, 'mature_orders', mature_orders, 'mature_delivered', mature_delivered, 'mature_resolved', mature_resolved, 'mature_out_of_stock', mature_out_of_stock,
    'delivery_rate', case when mature_orders - mature_out_of_stock > 0 then round(mature_delivered::numeric / (mature_orders - mature_out_of_stock) * 100, 1) else null end,
    'delivered_orders', delivered_orders, 'delivered_units', delivered_units,
    'average_units_per_order', case when delivered_orders > 0 then round(delivered_units::numeric / delivered_orders, 2) else null end,
    'net_revenue', net_revenue,
    'revenue_share', case when total_net_revenue > 0 then round(net_revenue / total_net_revenue * 100, 1) else null end,
    'warehouse_qty', warehouse_qty, 'agent_qty', agent_qty, 'total_qty', warehouse_qty + agent_qty,
    'delivered_units_28d', delivered_units_28d,
    'weeks_cover', case when delivered_units_28d > 0 then round(((warehouse_qty + agent_qty)::numeric / delivered_units_28d) * 4, 1) else null end
  ) order by net_revenue desc, product), '[]'::jsonb)
  into v_products from product_with_total;

  with scoped_orders as (
    select product, greatest(coalesce(nullif(qty, 0), 1), 1) as unit_tier, status, created_at,
      actual_price_collected, price, delivery_fee
    from public.orders
    where country = 'nigeria' and created_at >= v_from and created_at < (v_to + 1)::timestamptz
  ), delivery_period as (
    select product, unit_tier,
      coalesce(nullif(actual_price_collected, 0), price, 0) - coalesce(delivery_fee, 0) as net_revenue
    from scoped_orders where status = 'delivered'
  ), package_cohort as (
    select product, unit_tier, count(*) as orders,
      count(*) filter (where created_at < v_mature_before) as mature_orders,
      count(*) filter (where created_at < v_mature_before and status = 'delivered') as mature_delivered,
      count(*) filter (where created_at < v_mature_before and status in ('delivered', 'cancelled', 'rejected', 'failed_delivery')) as mature_resolved,
      count(*) filter (where created_at < v_mature_before and status = 'out_of_stock') as mature_out_of_stock
    from scoped_orders group by product, unit_tier
  ), package_delivery as (
    select product, unit_tier, count(*) as delivered_orders, coalesce(sum(net_revenue), 0) as net_revenue
    from delivery_period group by product, unit_tier
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product', coalesce(pc.product, pd.product), 'unit_tier', coalesce(pc.unit_tier, pd.unit_tier),
    'orders', coalesce(pc.orders, 0), 'mature_orders', coalesce(pc.mature_orders, 0), 'mature_delivered', coalesce(pc.mature_delivered, 0), 'mature_resolved', coalesce(pc.mature_resolved, 0), 'mature_out_of_stock', coalesce(pc.mature_out_of_stock, 0),
    'delivery_rate', case when coalesce(pc.mature_orders, 0) - coalesce(pc.mature_out_of_stock, 0) > 0 then round(pc.mature_delivered::numeric / (pc.mature_orders - pc.mature_out_of_stock) * 100, 1) else null end,
    'delivered_orders', coalesce(pd.delivered_orders, 0), 'net_revenue', coalesce(pd.net_revenue, 0)
  ) order by coalesce(pc.product, pd.product), coalesce(pc.unit_tier, pd.unit_tier)), '[]'::jsonb)
  into v_packages
  from package_cohort pc
  full join package_delivery pd on pd.product = pc.product and pd.unit_tier = pc.unit_tier;

  if to_regclass('public.finance_expenses') is not null then
    with spend as (
      select product, amount * case when market = 'both' then coalesce(nigeria_share, 50) / 100 else 1 end as amount
      from public.finance_expenses
      where category = 'ad_spend' and market in ('nigeria', 'both') and date >= v_from and date <= v_to
    )
    select jsonb_build_object(
      'tagged_ad_spend', coalesce(sum(amount) filter (where product is not null and btrim(product) <> ''), 0),
      'unallocated_ad_spend', coalesce(sum(amount) filter (where product is null or btrim(product) = ''), 0)
    ) into v_finance from spend;

    with tagged_spend as (
      select product, coalesce(sum(amount * case when market = 'both' then coalesce(nigeria_share, 50) / 100 else 1 end), 0) as amount
      from public.finance_expenses
      where category = 'ad_spend' and market in ('nigeria', 'both') and product is not null and btrim(product) <> ''
        and date >= v_from and date <= v_to
      group by product
    )
    select coalesce(jsonb_agg(item || jsonb_build_object(
      'tagged_ad_spend', coalesce(ts.amount, 0),
      'ad_spend_per_delivered_order', case when coalesce((item ->> 'delivered_orders')::numeric, 0) > 0
        then round(ts.amount / (item ->> 'delivered_orders')::numeric, 2) else null end
    ) order by (item ->> 'net_revenue')::numeric desc, item ->> 'product'), '[]'::jsonb)
    into v_products
    from jsonb_array_elements(v_products) item
    left join tagged_spend ts on ts.product = item ->> 'product';
  end if;

  if to_regclass('public.finance_cash_flow') is not null then
    v_finance := v_finance || jsonb_build_object(
      'cash_received', (
        select coalesce(sum(amount), 0) from public.finance_cash_flow
        where market = 'nigeria' and (status is null or status = 'received') and date >= v_from and date <= v_to
      )
    );
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'maturity_days', v_maturity_days,
    'overview', v_overview, 'finance', v_finance, 'products', v_products, 'packages', v_packages
  );
end;
$decision_metrics$;

revoke all on function public.get_nigeria_decision_metrics(date, date, integer) from public, anon;
grant execute on function public.get_nigeria_decision_metrics(date, date, integer) to authenticated;
