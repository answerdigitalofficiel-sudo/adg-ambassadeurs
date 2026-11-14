-- ADG Ambassadeurs — migration 007 : OBJECTIFS (targets) quotidiens, 3 jours et semaine
-- Additive et rejouable. À coller dans Supabase (projet ADG) > SQL Editor > Run (après la 006).
-- Chaque ambassadeur fixe l'objectif du jour (nombre de personnes à atteindre), éventuellement aussi sur 3 jours / une semaine,
-- puis enregistre combien il en a atteint. Visible par lui, son manager, l'ambassadeur en chef de son université et l'administration.
-- Chaque jour repart à zéro ; l'historique est conservé (comparaison des jours dans l'application).
-- La « journée » suit l'heure de Kinshasa (Africa/Kinshasa).

create or replace function public.app_today() returns date language sql stable as $$
  select (now() at time zone 'Africa/Kinshasa')::date $$;
grant execute on function public.app_today() to authenticated;

create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('day','3days','week')),
  start_date date not null,
  end_date date not null,
  target int not null check (target > 0 and target <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ambassador_id, kind, start_date)
);
create index if not exists targets_amb on public.targets(ambassador_id, end_date);
alter table public.targets enable row level security;
drop policy if exists targets_select on public.targets;
create policy targets_select on public.targets for select using (ambassador_id = auth.uid() or public.is_admin());
revoke insert, update, delete, truncate on public.targets from anon, authenticated;

create table if not exists public.daily_progress (
  ambassador_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  reached int not null default 0 check (reached >= 0),
  updated_at timestamptz not null default now(),
  primary key (ambassador_id, day)
);
alter table public.daily_progress enable row level security;
drop policy if exists progress_select on public.daily_progress;
create policy progress_select on public.daily_progress for select using (ambassador_id = auth.uid() or public.is_admin());
revoke insert, update, delete, truncate on public.daily_progress from anon, authenticated;

-- Qui peut voir les objectifs de qui : l'administration, le manager de l'université, l'ambassadeur en chef de l'université.
create or replace function public.can_see_targets(p_target uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from profiles v join profiles t on t.id = p_target and t.university_id = v.university_id
     where v.id = auth.uid() and v.active and v.university_id is not null and t.role = 'ambassador'
       and (v.role = 'manager' or (v.role = 'ambassador' and v.is_chief and v.stage = 'active')));
$$;
revoke all on function public.can_see_targets(uuid) from public, anon;
grant execute on function public.can_see_targets(uuid) to authenticated;

-- L'ambassadeur fixe son objectif : jour (aujourd'hui), 3 jours ou semaine (à partir d'aujourd'hui).
-- S'il en a déjà un en cours du même type, il le modifie (pas de doublon).
create or replace function public.set_target(p_kind text, p_target int) returns void
language plpgsql security definer set search_path = public as $$
declare r record; today date := public.app_today(); len int; ex uuid;
begin
  select * into r from profiles where id = auth.uid();
  if not found or r.role <> 'ambassador' or r.stage <> 'active' or not r.active then raise exception 'Interdit'; end if;
  if p_kind not in ('day','3days','week') then raise exception 'Type d''objectif invalide'; end if;
  if p_target is null or p_target < 1 or p_target > 100000 then raise exception 'Objectif invalide (minimum 1)'; end if;
  len := case p_kind when 'day' then 0 when '3days' then 2 else 6 end;
  select id into ex from targets where ambassador_id = auth.uid() and kind = p_kind and start_date <= today and end_date >= today
   order by start_date desc limit 1;
  if ex is not null then
    update targets set target = p_target, updated_at = now() where id = ex;
  else
    insert into targets(ambassador_id, kind, start_date, end_date, target)
    values (auth.uid(), p_kind, today, today + len, p_target);
  end if;
end $$;
revoke all on function public.set_target(text, int) from public, anon;
grant execute on function public.set_target(text, int) to authenticated;

-- L'ambassadeur enregistre les personnes atteintes aujourd'hui (+/- ; jamais en dessous de 0).
create or replace function public.add_reached(p_delta int) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v int;
begin
  select * into r from profiles where id = auth.uid();
  if not found or r.role <> 'ambassador' or r.stage <> 'active' or not r.active then raise exception 'Interdit'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then raise exception 'Valeur invalide'; end if;
  insert into daily_progress(ambassador_id, day, reached) values (auth.uid(), public.app_today(), greatest(0, p_delta))
  on conflict (ambassador_id, day) do update set reached = greatest(0, daily_progress.reached + p_delta), updated_at = now()
  returning reached into v;
  return v;
end $$;
revoke all on function public.add_reached(int) from public, anon;
grant execute on function public.add_reached(int) to authenticated;

-- Vues « équipe » pour manager / ambassadeur en chef / administration.
create or replace function public.team_members() returns table(id uuid, full_name text, university_id uuid, is_chief boolean)
language sql security definer stable set search_path = public as $$
  select p.id, p.full_name, p.university_id, p.is_chief from profiles p
   where p.role = 'ambassador' and p.stage = 'active' and p.active and public.can_see_targets(p.id) order by p.full_name;
$$;
create or replace function public.team_targets(p_from date default null)
returns table(ambassador_id uuid, kind text, start_date date, end_date date, target int)
language sql security definer stable set search_path = public as $$
  select t.ambassador_id, t.kind, t.start_date, t.end_date, t.target from targets t
   where t.end_date >= coalesce(p_from, public.app_today() - 29) and public.can_see_targets(t.ambassador_id);
$$;
create or replace function public.team_progress(p_from date default null)
returns table(ambassador_id uuid, day date, reached int)
language sql security definer stable set search_path = public as $$
  select d.ambassador_id, d.day, d.reached from daily_progress d
   where d.day >= coalesce(p_from, public.app_today() - 29) and public.can_see_targets(d.ambassador_id);
$$;
revoke all on function public.team_members(), public.team_targets(date), public.team_progress(date) from public, anon;
grant execute on function public.team_members(), public.team_targets(date), public.team_progress(date) to authenticated;
