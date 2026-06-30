-- ============================================================
-- Phase 6 · Step 1 — Staff, roles, and RLS helper functions
-- Run in STAGING first. RLS stays OFF here; it's enabled later in a
-- single coordinated cutover (step 6) once auth + the admin login exist.
-- Additive only.
-- ============================================================

create table if not exists public.staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  full_name    text not null default ''::text,
  email        text,
  -- reserved roles included now so adding manager/accountant later needs no migration
  role         text not null default 'caller'
                 check (role in ('admin','caller','viewer','manager','accountant')),
  phone        text default ''::text,
  active       boolean not null default true,
  created_at   timestamptz default now()
);
alter table public.staff disable row level security;

-- Helpers used by RLS policies in the cutover step. SECURITY DEFINER so a
-- policy can look up the caller's own role without recursing through RLS.
create or replace function public.current_staff_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function public.current_staff_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and active limit 1;
$$;
