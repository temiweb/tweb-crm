-- ============================================================
-- Integrity pass · Money-column guard on orders
-- Run on STAGING first, then prod. Idempotent.
--
-- RLS limits WHICH ROWS a caller can update, not which columns.
-- This trigger closes that: callers cannot alter the commercial
-- fields of an order (price, ordered qty, delivery fee) or its
-- identity/provenance fields. They can still work the order:
-- status, notes, delivery date, and the delivery outcome fields
-- (actual_qty_delivered / actual_price_collected) — recording
-- outcomes is their job; those are cross-checked against agent
-- cash remittance.
--
-- Note: the service_role (webhook upsert) bypasses RLS but NOT
-- triggers — however current_staff_role() is null for it, so the
-- guard doesn't apply. Admin/manager edits are unaffected.
-- ============================================================

create or replace function public.protect_order_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_staff_role() = 'caller' then
    if new.price        is distinct from old.price
    or new.qty          is distinct from old.qty
    or new.delivery_fee is distinct from old.delivery_fee
    or new.country      is distinct from old.country
    or new.source       is distinct from old.source
    or new.external_id  is distinct from old.external_id then
      raise exception 'Callers cannot change order price, quantity, or fees';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_protect_columns on public.orders;
create trigger orders_protect_columns before update on public.orders
  for each row execute function public.protect_order_columns();
