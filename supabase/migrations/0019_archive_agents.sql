alter table public.agents
  add column if not exists active boolean not null default true;

create index if not exists agents_active_country_idx
  on public.agents (country, active);
