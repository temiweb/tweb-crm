create table if not exists public.caller_assignment_cursor (
  id boolean primary key default true check (id),
  last_caller_id uuid references auth.users(id) on delete set null
);

insert into public.caller_assignment_cursor (id)
values (true)
on conflict (id) do nothing;

alter table public.caller_assignment_cursor enable row level security;

create or replace function public.pick_next_caller()
returns uuid
language plpgsql
security definer
set search_path = public
as $round_robin$
declare
  v_callers uuid[];
  v_last_caller_id uuid;
  v_position integer;
  v_next_caller_id uuid;
begin
  select array_agg(auth_user_id order by created_at, id)
    into v_callers
  from public.staff
  where role = 'caller' and active and auth_user_id is not null;

  if coalesce(array_length(v_callers, 1), 0) = 0 then
    return null;
  end if;

  select last_caller_id into v_last_caller_id
  from public.caller_assignment_cursor
  where id = true
  for update;

  v_position := array_position(v_callers, v_last_caller_id);
  v_next_caller_id := v_callers[case when v_position is null or v_position = array_length(v_callers, 1) then 1 else v_position + 1 end];

  update public.caller_assignment_cursor
  set last_caller_id = v_next_caller_id
  where id = true;

  return v_next_caller_id;
end;
$round_robin$;

revoke all on function public.pick_next_caller() from public, anon, authenticated;
grant execute on function public.pick_next_caller() to service_role;
