-- ============================================================
-- Phase 4 — Inventory: warehouse stock, waybills, purchases, faulty
-- Run in STAGING first; apply identical file to prod at cutover.
-- Additive only. RLS left OFF to match the rest of the schema (Phase 6).
-- Stock is keyed by product_name (text) to stay consistent with the
-- existing `inventory` table (agent stock).
-- ============================================================

-- central warehouse stock per product
alter table public.products add column if not exists warehouse_qty integer default 0;

-- buy / restock log (adds to warehouse)
create table if not exists public.stock_purchases (
  id           bigint generated always as identity primary key,
  product_name text not null,
  quantity     integer not null,
  unit_cost    numeric(12,2),
  note         text default ''::text,
  created_at   timestamptz default now()
);
alter table public.stock_purchases disable row level security;

-- dispatch records (warehouse -> agent on 'delivered')
create table if not exists public.waybills (
  id           bigint generated always as identity primary key,
  product_name text not null,
  agent_id     uuid references public.agents(id) on delete set null,
  quantity     integer not null,
  status       text not null default 'pending',   -- pending | in_transit | delivered
  created_at   timestamptz default now(),
  delivered_at timestamptz
);
alter table public.waybills disable row level security;

-- faulty / returned / written-off (removes from warehouse if agent_id is null,
-- otherwise from that agent's stock)
create table if not exists public.faulty_stock (
  id           bigint generated always as identity primary key,
  product_name text not null,
  agent_id     uuid references public.agents(id) on delete set null,
  quantity     integer not null,
  reason       text default ''::text,
  created_at   timestamptz default now()
);
alter table public.faulty_stock disable row level security;

-- agent-to-agent stock transfers (moves units between two agents)
create table if not exists public.stock_transfers (
  id            bigint generated always as identity primary key,
  product_name  text not null,
  from_agent_id uuid references public.agents(id) on delete set null,
  to_agent_id   uuid references public.agents(id) on delete set null,
  quantity      integer not null,
  created_at    timestamptz default now()
);
alter table public.stock_transfers disable row level security;
