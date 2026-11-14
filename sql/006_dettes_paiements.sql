-- ADG Ambassadeurs — migration 006 : DETTES + PAIEMENTS (archive non modifiable)
-- Additive et rejouable. À coller dans Supabase (projet ADG) > SQL Editor > Run (après la 005).
-- 1) L'administration enregistre des dettes (ambassadeur ou manager). Visibles par la personne et par l'administration.
-- 2) « Marquer payé » : fige les gains non payés dans une ligne d'archive INCHANGEABLE (ni modification ni suppression),
--    déduit automatiquement les dettes ouvertes (dans la limite du montant dû), et remet le compteur à zéro
--    (les gains payés sont rattachés au paiement ; seuls les gains non payés restent « à payer »).

-- ---------- Dettes ----------
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.profiles(id) on delete cascade,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  repaid_usd numeric(12,2) not null default 0 check (repaid_usd >= 0),
  reason text not null default '',
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (repaid_usd <= amount_usd)
);
create index if not exists debts_person on public.debts(person_id, status);
alter table public.debts enable row level security;
drop policy if exists debts_select on public.debts;
create policy debts_select on public.debts for select using (person_id = auth.uid() or public.is_admin());
revoke insert, update, delete, truncate on public.debts from anon, authenticated;

-- ---------- Archive des paiements (immuable) ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.profiles(id) on delete set null,
  person_name text not null,
  person_role text not null,
  person_univ text,
  momo_network text,
  momo_number text,
  points int not null default 0,
  gross_usd numeric(12,2) not null default 0,
  debt_usd numeric(12,2) not null default 0,
  net_usd numeric(12,2) not null default 0,
  debt_detail jsonb not null default '[]'::jsonb,
  method text not null,
  reference text not null default '',
  paid_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_person on public.payments(person_id, created_at desc);
alter table public.payments enable row level security;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (person_id = auth.uid() or public.is_admin());
revoke insert, update, delete, truncate on public.payments from anon, authenticated;

create or replace function public.payments_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Seule exception : la suppression d'un compte met person_id à NULL (le nom reste archivé dans la ligne).
  if tg_op = 'UPDATE' and new.person_id is null
     and (to_jsonb(new) - 'person_id') = (to_jsonb(old) - 'person_id') then
    return new;
  end if;
  raise exception 'Archive de paiements : aucune modification ni suppression possible';
end $$;
drop trigger if exists payments_no_change on public.payments;
create trigger payments_no_change before update or delete on public.payments
  for each row execute function public.payments_immutable();
create or replace function public.payments_no_truncate() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Archive de paiements : aucune suppression possible'; end $$;
drop trigger if exists payments_no_trunc on public.payments;
create trigger payments_no_trunc before truncate on public.payments
  for each statement execute function public.payments_no_truncate();

-- ---------- Rattachement des gains payés (le compteur « à payer » = gains sans paiement) ----------
alter table public.points_ledger add column if not exists payment_id uuid;
alter table public.manager_ledger add column if not exists payment_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'points_ledger_payment_fk') then
    alter table public.points_ledger add constraint points_ledger_payment_fk
      foreign key (payment_id) references public.payments(id) deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manager_ledger_payment_fk') then
    alter table public.manager_ledger add constraint manager_ledger_payment_fk
      foreign key (payment_id) references public.payments(id) deferrable initially deferred;
  end if;
end $$;
create index if not exists points_ledger_unpaid on public.points_ledger(ambassador_id) where payment_id is null;
create index if not exists manager_ledger_unpaid on public.manager_ledger(manager_id) where payment_id is null;

-- ---------- Dettes : ajout / remboursement manuel / annulation (administration seulement) ----------
create or replace function public.admin_add_debt(p_user uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr record; amt numeric(12,2); did uuid;
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select * into pr from profiles where id = p_user and role in ('ambassador','manager');
  if not found then raise exception 'Personne introuvable'; end if;
  amt := round(coalesce(p_amount, 0), 2);
  if amt <= 0 then raise exception 'Le montant de la dette doit être supérieur à 0'; end if;
  insert into debts(person_id, amount_usd, reason, created_by)
  values (p_user, amt, left(coalesce(trim(p_reason), ''), 300), auth.uid()) returning id into did;
  insert into notifications(ambassador_id, message)
  values (p_user, '⚠️ Une dette de $' || amt || ' envers l''administration a été enregistrée'
          || case when coalesce(trim(p_reason), '') <> '' then ' (' || left(trim(p_reason), 120) || ')' else '' end
          || '. Elle sera déduite automatiquement de votre prochain paiement.');
  return did;
end $$;
revoke all on function public.admin_add_debt(uuid, numeric, text) from public, anon;
grant execute on function public.admin_add_debt(uuid, numeric, text) to authenticated;

create or replace function public.admin_repay_debt(p_id uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare d record; amt numeric(12,2);
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select * into d from debts where id = p_id for update;
  if not found or d.status <> 'open' then raise exception 'Dette introuvable ou déjà clôturée'; end if;
  amt := round(coalesce(p_amount, 0), 2);
  if amt <= 0 or amt > d.amount_usd - d.repaid_usd then raise exception 'Montant invalide (reste dû : $%)', d.amount_usd - d.repaid_usd; end if;
  update debts set repaid_usd = repaid_usd + amt,
         status = case when repaid_usd + amt >= amount_usd then 'settled' else 'open' end,
         closed_at = case when repaid_usd + amt >= amount_usd then now() else null end
   where id = p_id;
  insert into notifications(ambassador_id, message)
  values (d.person_id, '✅ Remboursement de $' || amt || ' enregistré sur votre dette.');
end $$;
revoke all on function public.admin_repay_debt(uuid, numeric) from public, anon;
grant execute on function public.admin_repay_debt(uuid, numeric) to authenticated;

create or replace function public.admin_cancel_debt(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select * into d from debts where id = p_id for update;
  if not found or d.status <> 'open' then raise exception 'Dette introuvable ou déjà clôturée'; end if;
  update debts set status = 'cancelled', closed_at = now() where id = p_id;
  insert into notifications(ambassador_id, message)
  values (d.person_id, 'ℹ️ Une dette de $' || d.amount_usd || ' a été annulée par l''administration.');
end $$;
revoke all on function public.admin_cancel_debt(uuid) from public, anon;
grant execute on function public.admin_cancel_debt(uuid) to authenticated;

-- ---------- PAIEMENT : fige les gains, déduit les dettes, remet le compteur à zéro ----------
-- p_expected = montant brut vu à l'écran : si de nouveaux gains sont arrivés entre-temps, le paiement est refusé
-- (rechargez la page et recommencez), pour ne jamais payer un montant différent de celui affiché.
create or replace function public.admin_pay(p_user uuid, p_method text, p_reference text, p_expected numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pr record; pid uuid := gen_random_uuid(); gpts int := 0; gusd numeric(12,2) := 0;
  avail numeric(12,2); d record; take numeric(12,2); ded numeric(12,2) := 0; detail jsonb := '[]'::jsonb;
  net numeric(12,2); un text; meth text;
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  select * into pr from profiles where id = p_user and role in ('ambassador','manager') for update;
  if not found then raise exception 'Personne introuvable'; end if;
  meth := left(coalesce(nullif(trim(p_method), ''), 'Autre'), 40);

  if pr.role = 'ambassador' then
    with u as (update points_ledger set payment_id = pid where ambassador_id = p_user and payment_id is null returning points, usd)
    select coalesce(sum(points), 0), round(coalesce(sum(usd), 0), 2) into gpts, gusd from u;
  else
    with u as (update manager_ledger set payment_id = pid where manager_id = p_user and payment_id is null returning points, usd)
    select coalesce(sum(points), 0), round(coalesce(sum(usd), 0), 2) into gpts, gusd from u;
  end if;
  if gpts <= 0 and gusd <= 0 then raise exception 'Rien à payer : le compteur est déjà à zéro'; end if;
  if p_expected is not null and round(p_expected, 2) <> gusd then
    raise exception 'Les montants ont changé depuis l''affichage ($% maintenant) : rechargez la page', gusd;
  end if;

  avail := gusd;
  for d in select * from debts where person_id = p_user and status = 'open' order by created_at for update loop
    exit when avail <= 0;
    take := least(avail, d.amount_usd - d.repaid_usd);
    if take <= 0 then continue; end if;
    update debts set repaid_usd = repaid_usd + take,
           status = case when repaid_usd + take >= amount_usd then 'settled' else 'open' end,
           closed_at = case when repaid_usd + take >= amount_usd then now() else null end
     where id = d.id;
    detail := detail || jsonb_build_object('debt_id', d.id, 'reason', d.reason, 'initial', d.amount_usd,
                                           'deducted', take, 'remaining', d.amount_usd - d.repaid_usd - take);
    ded := ded + take; avail := avail - take;
  end loop;
  net := gusd - ded;

  select name into un from universities where id = pr.university_id;
  insert into payments(id, person_id, person_name, person_role, person_univ, momo_network, momo_number,
                       points, gross_usd, debt_usd, net_usd, debt_detail, method, reference, paid_by)
  values (pid, p_user, pr.full_name, pr.role, un, pr.momo_network, pr.momo_number,
          gpts, gusd, ded, net, detail, meth, left(coalesce(trim(p_reference), ''), 120), auth.uid());

  insert into notifications(ambassador_id, message)
  values (p_user, '💰 Paiement effectué : $' || net || ' (gains $' || gusd
          || case when ded > 0 then ', dettes déduites $' || ded else '' end
          || ') via ' || meth || '. Votre compteur repart à zéro ; le détail est dans votre archive.');
  return pid;
end $$;
revoke all on function public.admin_pay(uuid, text, text, numeric) from public, anon;
grant execute on function public.admin_pay(uuid, text, text, numeric) to authenticated;
