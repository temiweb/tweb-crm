-- Ghana Post GPS is not collected and is not part of VDL's documented
-- order-create contract. Remove the unused sidecar column from production.
alter table public.vdl_orders
  drop column if exists gh_gps_address;
