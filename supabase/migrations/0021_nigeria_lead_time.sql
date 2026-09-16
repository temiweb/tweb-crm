-- ============================================================
-- 0021 — Nigeria delivery lead time (created_at → delivered_at)
--
-- Average and median days an order takes from creation to being marked
-- delivered. Same cohort as the decision-metrics overview: Nigeria orders
-- CREATED in [from, to] that are now delivered — so the sample lines up with
-- the delivered_orders count already on the Analytics page. Optional product
-- focus mirrors get_nigeria_decision_metrics.
--
-- delivered_at is stamped server-side (bulk_set_order_status RPC) and was
-- backfilled in 0006, but single-order status flips made while the caller
-- feature was off may leave it null — so we compute only over rows with a
-- valid delivered_at (>= created_at) and also return how many delivered
-- orders lack one, so the number stays honest. Median resists outliers from
-- the updated_at backfill. Role-gated exactly like the decision metrics.
-- ============================================================

create or replace function public.get_nigeria_lead_time(
  p_from date default null,
  p_to date default null,
  p_product text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $lead_time$
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

  with delivered as (
    select created_at, delivered_at
    from public.orders
    where country = 'nigeria' and status = 'delivered'
      and created_at >= v_from and created_at < (v_to + 1)::timestamptz
      and (v_product is null or product = v_product)
  ), timed as (
    select extract(epoch from (delivered_at - created_at)) / 86400.0 as days
    from delivered
    where delivered_at is not null and delivered_at >= created_at
  )
  select jsonb_build_object(
    'delivered_orders', (select count(*) from delivered),
    'sample', (select count(*) from timed),
    'missing_timestamp', (select count(*) from delivered) - (select count(*) from timed),
    'avg_days', (select round(avg(days)::numeric, 1) from timed),
    'median_days', (select round((percentile_cont(0.5) within group (order by days))::numeric, 1) from timed),
    'p90_days', (select round((percentile_cont(0.9) within group (order by days))::numeric, 1) from timed)
  ) into v_result;

  return v_result;
end;
$lead_time$;

revoke all on function public.get_nigeria_lead_time(date, date, text) from public, anon;
grant execute on function public.get_nigeria_lead_time(date, date, text) to authenticated;
