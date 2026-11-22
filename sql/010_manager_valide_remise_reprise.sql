-- ADG Ambassadeurs — migration 010 : le manager valide ses ambassadeurs + remise et reprise entre managers
-- Additive et rejouable. À coller dans Supabase (projet ADG) > SQL Editor > Run (après la 009).
-- 1) Le manager de chaque université valide lui-même ses nouveaux ambassadeurs (étapes 1 et 2).
--    L'administration ne valide plus que dans une université SANS manager actif ; elle voit le nombre d'ambassadeurs et leur identité.
-- 2) L'administration peut nommer manager n'importe quel ambassadeur actif, même inscrit dans une autre université.
--    - S'il n'y a pas de manager : prise de relais directe.
--    - S'il y a déjà un manager : remise et reprise (le sortant fait la remise, le successeur fait la reprise).
-- 3) À la reprise : le sortant redevient ambassadeur ; le successeur devient manager et reçoit les données administratives
--    (équipe, ventes, objectifs, historique des consignes). Restent privés pour le sortant : ses gains, paiements, dettes,
--    numéro mobile money, notifications. Garde-fou : ses gains de manager non payés doivent d'abord être payés par l'administration.

create table if not exists public.manager_handovers (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  university_name text not null default '',
  outgoing_id uuid not null references public.profiles(id) on delete cascade,
  outgoing_name text not null default '',
  incoming_id uuid not null references public.profiles(id) on delete cascade,
  incoming_name text not null default '',
  status text not null default 'pending' check (status in ('pending','handed','done','cancelled')),  -- pending = remise attendue, handed = reprise attendue
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  handed_at timestamptz,
  done_at timestamptz
);
create unique index if not exists manager_handovers_one_open on public.manager_handovers(university_id) where status in ('pending','handed');
create index if not exists manager_handovers_people on public.manager_handovers(outgoing_id, incoming_id);
alter table public.manager_handovers enable row level security;
drop policy if exists handovers_select on public.manager_handovers;
create policy handovers_select on public.manager_handovers for select using (outgoing_id = auth.uid() or incoming_id = auth.uid() or public.is_admin());
revoke insert, update, delete, truncate on public.manager_handovers from anon, authenticated;

-- ---------- Administration : nommer un manager (direct s'il n'y en a pas, sinon remise et reprise) ----------
create or replace function public.admin_start_handover(p_univ uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cur record; nu record; un text;
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select name into un from universities where id = p_univ;
  if un is null then raise exception 'Université introuvable'; end if;
  select * into nu from profiles where id = p_user;
  if not found or nu.role <> 'ambassador' or nu.stage <> 'active' or not nu.active then
    raise exception 'Seul un ambassadeur actif peut devenir manager';
  end if;
  if exists (select 1 from manager_handovers where incoming_id = p_user and status in ('pending','handed')) then
    raise exception 'Cette personne est déjà désignée pour une autre remise et reprise';
  end if;
  select * into cur from profiles where role = 'manager' and university_id = p_univ;
  if found and cur.id = p_user then raise exception 'Cette personne est déjà le manager de cette université'; end if;
  if not found then
    update profiles set role = 'manager', university_id = p_univ, stage = 'active', is_chief = false, welcomed = true where id = p_user;
    insert into notifications(ambassador_id, message)
    values (p_user, '👔 Vous êtes maintenant manager de ' || un || ' : vous validez vous-même les nouveaux ambassadeurs de cette université.');
    return 'direct';
  end if;
  insert into manager_handovers(university_id, university_name, outgoing_id, outgoing_name, incoming_id, incoming_name, created_by)
  values (p_univ, un, cur.id, cur.full_name, nu.id, nu.full_name, auth.uid());
  insert into notifications(ambassador_id, message) values
    (cur.id, '🔁 Remise et reprise : ' || nu.full_name || ' va vous succéder comme manager de ' || un || '. Ouvrez votre accueil pour faire la remise.'),
    (nu.id,  '🔁 Vous avez été désigné(e) pour succéder à ' || cur.full_name || ' comme manager de ' || un || '. Vous serez prévenu(e) quand la remise sera faite.');
  return 'handover';
end $$;
revoke all on function public.admin_start_handover(uuid, uuid) from public, anon;
grant execute on function public.admin_start_handover(uuid, uuid) to authenticated;

create or replace function public.admin_cancel_handover(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h record;
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select * into h from manager_handovers where id = p_id and status in ('pending','handed') for update;
  if not found then raise exception 'Remise introuvable ou déjà terminée'; end if;
  update manager_handovers set status = 'cancelled' where id = p_id;
  insert into notifications(ambassador_id, message) values
    (h.outgoing_id, 'ℹ️ La remise et reprise de ' || h.university_name || ' a été annulée par l''administration. Vous restez manager.'),
    (h.incoming_id, 'ℹ️ La remise et reprise de ' || h.university_name || ' a été annulée par l''administration.');
end $$;
revoke all on function public.admin_cancel_handover(uuid) from public, anon;
grant execute on function public.admin_cancel_handover(uuid) to authenticated;

-- ---------- Remise (manager sortant) ----------
create or replace function public.handover_give(p_id uuid, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare h record;
begin
  select * into h from manager_handovers where id = p_id and outgoing_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'Remise introuvable ou déjà faite'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'manager' and university_id = h.university_id and active) then
    raise exception 'Vous n''êtes plus manager de cette université';
  end if;
  update manager_handovers set status = 'handed', handed_at = now(), note = left(coalesce(trim(p_note), ''), 1000) where id = p_id;
  insert into notifications(ambassador_id, message)
  values (h.incoming_id, '🔁 ' || h.outgoing_name || ' vous a fait la remise de ' || h.university_name || '. Ouvrez votre accueil pour reprendre la gestion.');
end $$;
revoke all on function public.handover_give(uuid, text) from public, anon;
grant execute on function public.handover_give(uuid, text) to authenticated;

-- ---------- Reprise (successeur) : échange des rôles + transfert des données administratives ----------
create or replace function public.handover_take(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h record; n_unpaid int;
begin
  select * into h from manager_handovers where id = p_id and incoming_id = auth.uid() and status = 'handed' for update;
  if not found then raise exception 'Reprise impossible : la remise n''est pas encore faite'; end if;
  if not exists (select 1 from profiles where id = h.outgoing_id and role = 'manager' and university_id = h.university_id) then
    raise exception 'Le manager sortant n''est plus en poste : demandez à l''administration d''annuler cette remise';
  end if;
  if not exists (select 1 from profiles where id = h.incoming_id and role = 'ambassador' and stage = 'active' and active) then
    raise exception 'Votre compte ne peut pas reprendre cette gestion';
  end if;
  select count(*) into n_unpaid from manager_ledger where manager_id = h.outgoing_id and payment_id is null;
  if n_unpaid > 0 then
    raise exception 'Le manager sortant a encore des gains non payés : l''administration doit d''abord le payer (onglet Paie)';
  end if;
  -- 1) le sortant redevient ambassadeur (même université) ; 2) le successeur devient manager de l'université
  update profiles set role = 'ambassador', is_chief = false where id = h.outgoing_id;
  update profiles set role = 'manager', university_id = h.university_id, stage = 'active', is_chief = false, welcomed = true where id = h.incoming_id;
  -- Données administratives : l'historique des consignes passe au nouveau manager (l'équipe, les ventes et les objectifs suivent l'université).
  -- Données privées du sortant (gains, paiements, dettes, mobile money, notifications) : jamais transférées.
  insert into manager_instructions(manager_id, day, title, body, created_at)
    select h.incoming_id, day, title, body, created_at from manager_instructions where manager_id = h.outgoing_id
    on conflict (manager_id, day) do nothing;
  delete from manager_instructions where manager_id = h.outgoing_id;
  update manager_handovers set status = 'done', done_at = now() where id = p_id;
  insert into notifications(ambassador_id, message) values
    (h.outgoing_id, '✅ Remise terminée : ' || h.incoming_name || ' est maintenant manager de ' || h.university_name || '. Vous redevenez ambassadeur ; vos données personnelles restent privées.'),
    (h.incoming_id, '🎉 Vous êtes maintenant manager de ' || h.university_name || '. Vous validez les nouveaux ambassadeurs et suivez l''équipe.');
  insert into notifications(ambassador_id, message)
    select id, '👔 ' || h.incoming_name || ' est le nouveau manager de ' || h.university_name || '.'
      from profiles where university_id = h.university_id and role = 'ambassador' and active and stage = 'active' and id <> h.outgoing_id;
end $$;
revoke all on function public.handover_take(uuid) from public, anon;
grant execute on function public.handover_take(uuid) to authenticated;

-- ---------- Validation des ambassadeurs : le manager de l'université valide ; l'administration seulement sans manager actif ----------
create or replace function public.mgr_set_stage(p_user uuid, p_stage text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text; uni uuid;
begin
  select stage, university_id into cur, uni from profiles where id = p_user and role = 'ambassador';
  if cur is null then raise exception 'Introuvable'; end if;
  if public.is_admin() then
    if p_stage not in ('pending','kyc','review','active') then raise exception 'Etape invalide'; end if;
    if uni is not null and ((cur = 'pending' and p_stage = 'kyc') or (cur = 'review' and p_stage in ('active','kyc')))
       and exists (select 1 from profiles where role = 'manager' and university_id = uni and active) then
      raise exception 'Le manager de cette université valide lui-même ses ambassadeurs';
    end if;
  elsif public.is_manager_of(p_user) then
    if not ((cur = 'pending' and p_stage = 'kyc') or (cur = 'review' and p_stage in ('active','kyc'))) then raise exception 'Etape invalide'; end if;
  else raise exception 'Interdit'; end if;
  update profiles set stage = p_stage where id = p_user;
end $$;
