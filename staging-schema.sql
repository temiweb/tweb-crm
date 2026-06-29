-- ============================================================
-- Infinistores CRM — schema (mirrors production)
-- Run this in the STAGING Supabase project's SQL Editor.
-- Reconstructed from production information_schema on 2026-06-29.
-- RLS is intentionally left OFF to match production (the app uses
-- the anon key with no row-level security until Phase 6).
-- ============================================================

-- ---- agents (referenced by inventory + orders) ----
create table if not exists public.agents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text default ''::text,
  states     text[] default '{}'::text[],
  country    text default 'nigeria'::text,
  created_at timestamptz default now()
);

-- ---- products ----
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

-- ---- inventory (one row per agent+product) ----
create table if not exists public.inventory (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid references public.agents(id) on delete set null,
  product_name text not null,
  qty          integer default 0,
  unique (agent_id, product_name)
);

-- ---- orders ----
create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null default ''::text,
  phone                  text not null default ''::text,
  whatsapp               text default ''::text,
  address                text default ''::text,
  state                  text default ''::text,
  product                text default ''::text,
  pack_name              text default ''::text,
  qty                    integer default 1,
  price                  integer default 0,
  delivery_pref          text default ''::text,
  delivery_date          text default ''::text,
  payment_option         text default ''::text,
  notes                  text default ''::text,
  status                 text default 'pending'::text,
  agent_id               uuid references public.agents(id) on delete set null,
  agent_name             text default ''::text,
  country                text default 'nigeria'::text,
  delivery_fee           integer default 0,
  actual_qty_delivered   integer default 0,
  actual_price_collected integer default 0,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ---- templates (WhatsApp message per status_key) ----
create table if not exists public.templates (
  id         uuid primary key default gen_random_uuid(),
  status_key text not null unique,
  message    text default ''::text
);

-- keep orders.updated_at fresh on edit (matches app expectation; harmless if prod has none)
create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ============================================================
-- SEED — dummy NG + GH data so staging screens aren't empty
-- ============================================================
insert into public.agents (id, name, phone, states, country) values
  ('11111111-1111-1111-1111-111111111111', 'Lagos — Tunde', '08030000001', '{Lagos,Ogun}', 'nigeria'),
  ('22222222-2222-2222-2222-222222222222', 'VDL Ghana',     '0240000002',  '{Greater Accra}', 'ghana')
on conflict (id) do nothing;

insert into public.products (name) values
  ('Net Repair Tape'), ('Hair Curler'), ('Car Scratch Remover')
on conflict do nothing;

insert into public.inventory (agent_id, product_name, qty) values
  ('11111111-1111-1111-1111-111111111111', 'Net Repair Tape', 40),
  ('11111111-1111-1111-1111-111111111111', 'Hair Curler', 12),
  ('22222222-2222-2222-2222-222222222222', 'Car Scratch Remover', 25)
on conflict (agent_id, product_name) do nothing;

insert into public.orders (name, phone, whatsapp, address, state, product, pack_name, qty, price, status, agent_id, agent_name, country, actual_qty_delivered, actual_price_collected) values
  ('Adaeze O.', '08031234412', '08031234412', '12 Allen Ave, Ikeja', 'Lagos', 'Hair Curler', 'Buy 1 Pack', 1, 18500, 'delivered', '11111111-1111-1111-1111-111111111111', 'Lagos — Tunde', 'nigeria', 1, 18500),
  ('Musa B.', '07019999023', '07019999023', '5 Zoo Rd', 'Kano', 'Net Repair Tape', 'Buy 2 Pack', 2, 9500, 'confirmed', '11111111-1111-1111-1111-111111111111', 'Lagos — Tunde', 'nigeria', 0, 0),
  ('Chidi N.', '08162222256', '08162222256', '8 Aba Rd', 'Rivers', 'Net Repair Tape', 'Buy 1 Pack', 1, 5500, 'pending', null, '', 'nigeria', 0, 0),
  ('Funke A.', '09051111188', '09051111188', '3 Ring Rd', 'Oyo', 'Hair Curler', 'Buy 1 Pack', 1, 18500, 'not_reachable', null, '', 'nigeria', 0, 0),
  ('Kwame A.', '0241237781', '0241237781', '20 Oxford St, Osu', 'Greater Accra', 'Car Scratch Remover', 'Buy 1 Pack', 1, 220, 'delivered', '22222222-2222-2222-2222-222222222222', 'VDL Ghana', 'ghana', 1, 220),
  ('Ama K.', '0205555590', '0205555590', '14 Asafo', 'Ashanti', 'Car Scratch Remover', 'Buy 2 Pack', 2, 145, 'pending', null, '', 'ghana', 0, 0)
on conflict do nothing;

insert into public.templates (status_key, message) values
  ('pending',   'Hi {name}, thanks for your order of {product} ({pack}) for {price}. We''ll confirm your delivery to {address} shortly.'),
  ('confirmed', 'Hi {name}, your order of {product} is confirmed. Our agent {agent} will deliver to {address}.'),
  ('delivered', 'Hi {name}, thank you for your purchase of {product}! We hope you love it.')
on conflict (status_key) do nothing;
