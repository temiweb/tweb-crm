create index if not exists orders_country_created_at_idx
  on public.orders (country, created_at desc);

create index if not exists vdl_orders_status_created_at_idx
  on public.vdl_orders (vdl_sync_status, created_at desc);

create or replace function public.get_ghana_vdl_orders(
  p_scope text default 'synced',
  p_search text default null,
  p_vdl_status text default null,
  p_from date default null,
  p_to date default null,
  p_page integer default 0,
  p_page_size integer default 50
)
returns table (
  order_id uuid,
  name text,
  phone text,
  address text,
  notes text,
  state text,
  product text,
  qty integer,
  order_created_at timestamptz,
  gh_location text,
  gh_region_name text,
  gh_quantity integer,
  gh_expected_total numeric,
  gh_discount_amount numeric,
  gh_raw_address text,
  vdl_sync_status text,
  vdl_sync_error text,
  vdl_order_id integer,
  vdl_tracking_id text,
  vdl_state_label text,
  vdl_amount_due_customer numeric,
  vdl_vendor_amount_due numeric,
  vdl_commission_amount numeric,
  vdl_delivery_fee numeric,
  vdl_packaging_fee numeric,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_staff_role(), '');
  v_search text := nullif(trim(p_search), '');
  v_status text := nullif(trim(p_vdl_status), '');
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
begin
  if v_role not in ('admin', 'manager', 'accountant') then
    raise exception 'Only management staff can view Ghana fulfilment records';
  end if;

  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'End date must not be before start date';
  end if;

  return query
  select
    o.id,
    o.name,
    o.phone,
    o.address,
    o.notes,
    o.state,
    o.product,
    o.qty,
    o.created_at,
    v.gh_location,
    v.gh_region_name,
    v.gh_quantity,
    v.gh_expected_total,
    v.gh_discount_amount,
    v.gh_raw_address,
    v.vdl_sync_status,
    v.vdl_sync_error,
    v.vdl_order_id,
    v.vdl_tracking_id,
    v.vdl_state_label,
    v.vdl_amount_due_customer,
    v.vdl_vendor_amount_due,
    v.vdl_commission_amount,
    v.vdl_delivery_fee,
    v.vdl_packaging_fee,
    count(*) over ()
  from public.vdl_orders v
  join public.orders o on o.id = v.order_id
  where o.country = 'ghana'
    and (
      (p_scope = 'review' and v.vdl_sync_status = 'needs_review')
      or (p_scope = 'held' and v.vdl_sync_status in ('held', 'failed', 'auth_failed'))
      or (p_scope = 'synced' and v.vdl_sync_status in ('approved', 'pushing', 'synced'))
    )
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at < (p_to + 1)::timestamptz)
    and (
      v_status is null
      or (lower(v_status) = 'not pushed' and v.vdl_state_label is null)
      or lower(coalesce(v.vdl_state_label, '')) = lower(v_status)
    )
    and (
      v_search is null
      or o.name ilike '%' || v_search || '%'
      or o.phone ilike '%' || v_search || '%'
      or v.vdl_tracking_id ilike '%' || v_search || '%'
    )
  order by o.created_at desc
  limit v_page_size offset v_page * v_page_size;
end;
$$;

revoke all on function public.get_ghana_vdl_orders(text, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.get_ghana_vdl_orders(text, text, text, date, date, integer, integer) to authenticated;
