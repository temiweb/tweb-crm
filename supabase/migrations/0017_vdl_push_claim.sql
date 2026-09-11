-- ============================================================
-- 0017 — Atomic claim for the VDL push worker (IDEMPOTENT)
--
-- An edge function selecting-then-updating can double-push under
-- concurrency. This RPC claims a batch of approved Ghana orders and flips
-- them to 'pushing' in one statement with FOR UPDATE SKIP LOCKED, so two
-- overlapping worker runs never grab the same order. The worker calls it
-- as service_role; execute is revoked from anon/authenticated so no
-- ordinary user can claim orders.
-- ============================================================

create or replace function public.claim_vdl_push_batch(p_limit integer default 5)
returns setof public.vdl_orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.vdl_orders v
     set vdl_sync_status = 'pushing'
   where v.order_id in (
     select order_id from public.vdl_orders
      where vdl_sync_status = 'approved'
        and (vdl_next_attempt_at is null or vdl_next_attempt_at <= now())
      order by created_at asc
      limit greatest(1, p_limit)
      for update skip locked
   )
  returning v.*;
end $$;

revoke all on function public.claim_vdl_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_vdl_push_batch(integer) to service_role;
