-- ============================================================
-- ADG AMBASSADEURS (Answer Digital) - Schéma Supabase
-- À coller dans Supabase > SQL Editor > Run
-- ============================================================

-- 1) TABLES ---------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'ambassador' check (role in ('admin','ambassador')),
  full_name text not null default '',
  phone text not null default '',
  referral_code text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  price numeric not null default 0,
  points_per_sale int not null default 10,
  active boolean not null default true
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text not null,
  app_id uuid references public.apps(id),
  ambassador_id uuid references public.profiles(id),   -- null = client direct (sans ambassadeur)
  payment_method text not null default 'mobile_money' check (payment_method in ('mobile_money','cash')),
  amount numeric,
  proof_url text,
  note text,
  status text not null default 'pending' check (status in ('pending','validated','rejected')),
  created_at timestamptz not null default now(),
  validated_at timestamptz
);
create index on public.sales(ambassador_id);
create index on public.sales(status);
create index on public.sales(app_id);

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.profiles(id) on delete cascade,
  sale_id uuid unique references public.sales(id) on delete cascade,  -- unique = jamais de double points
  points int not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) FONCTIONS ------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

-- Création automatique du profil + code ambassadeur à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, phone, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'phone',''),
    'AMB-' || upper(substr(md5(random()::text || new.id::text), 1, 5))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quand une vente passe à "validated" : points + notification (automatique)
create or replace function public.on_sale_validated() returns trigger
language plpgsql security definer set search_path = public as $$
declare pts int; total int; app_name text;
begin
  if new.status = 'validated' and (tg_op = 'INSERT' or old.status is distinct from 'validated') then
    update sales set validated_at = now() where id = new.id;

    if new.ambassador_id is not null then
      select coalesce(points_per_sale,0), name into pts, app_name from apps where id = new.app_id;
      pts := coalesce(pts, 0);

      insert into points_ledger(ambassador_id, sale_id, points)
      values (new.ambassador_id, new.id, pts)
      on conflict (sale_id) do nothing;

      select coalesce(sum(points),0) into total from points_ledger where ambassador_id = new.ambassador_id;

      insert into notifications(ambassador_id, message)
      values (new.ambassador_id,
        'Client validé : ' || new.client_name || coalesce(' (' || app_name || ')','') ||
        ' — +' || pts || ' points. Total : ' || total || ' points.');
    end if;
  end if;
  return null;
end $$;

create trigger sale_validated
  after insert or update of status on public.sales
  for each row execute function public.on_sale_validated();

-- CONNEXION AVEC LES APPLICATIONS VENDUES ------------------------
-- L'application vendue appelle cette fonction quand le client envoie sa preuve de paiement.
create or replace function public.register_sale(
  p_ref_code text, p_app_name text, p_client_name text, p_client_phone text,
  p_method text default 'mobile_money', p_amount numeric default null, p_proof_url text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare amb uuid; app uuid; sid uuid;
begin
  if p_ref_code is not null and length(trim(p_ref_code)) > 0 then
    select id into amb from profiles
     where referral_code = upper(trim(p_ref_code)) and active and role = 'ambassador';
  end if;
  select id into app from apps where name = p_app_name;
  insert into sales(client_name, client_phone, app_id, ambassador_id, payment_method, amount, proof_url)
  values (trim(p_client_name), trim(p_client_phone), app, amb,
          case when p_method = 'cash' then 'cash' else 'mobile_money' end, p_amount, p_proof_url)
  returning id into sid;
  return sid;
end $$;

-- L'application vendue demande si le compte est activé (validé par vous)
create or replace function public.get_sale_status(p_sale_id uuid) returns text
language sql security definer stable set search_path = public as $$
  select status from sales where id = p_sale_id;
$$;

grant execute on function public.register_sale(text,text,text,text,text,numeric,text) to anon, authenticated;
grant execute on function public.get_sale_status(uuid) to anon, authenticated;

-- Fonctions internes : non appelables depuis l'API publique
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.on_sale_validated() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 3) SÉCURITÉ (RLS) -------------------------------------------
alter table public.profiles       enable row level security;
alter table public.apps           enable row level security;
alter table public.sales          enable row level security;
alter table public.points_ledger  enable row level security;
alter table public.notifications  enable row level security;

-- profiles : chacun voit le sien, l'admin voit/modifie tout
create policy "profiles_select" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_admin_update" on public.profiles for update using (public.is_admin());

-- apps : lisibles par tous les connectés, gérées par l'admin
create policy "apps_select" on public.apps for select using (auth.uid() is not null);
create policy "apps_admin_write" on public.apps for all using (public.is_admin()) with check (public.is_admin());

-- sales : l'ambassadeur voit ses clients, peut déclarer un client "cash" en attente ; l'admin gère tout
create policy "sales_select" on public.sales for select using (ambassador_id = auth.uid() or public.is_admin());
create policy "sales_insert_amb" on public.sales for insert
  with check (ambassador_id = auth.uid() and status = 'pending');
create policy "sales_admin_all" on public.sales for all using (public.is_admin()) with check (public.is_admin());

-- points : lecture seule (écrits uniquement par le trigger)
create policy "ledger_select" on public.points_ledger for select using (ambassador_id = auth.uid() or public.is_admin());

-- notifications
create policy "notif_select" on public.notifications for select using (ambassador_id = auth.uid() or public.is_admin());
create policy "notif_update_own" on public.notifications for update using (ambassador_id = auth.uid());

-- Temps réel pour les notifications et les ventes
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.sales;

-- 4) DONNÉES DE DÉPART ----------------------------------------
-- Modifiez/ajoutez vos applications ici (ou dans l'onglet "Apps" de l'admin)
insert into public.apps(name, price, points_per_sale) values
  ('Application exemple 1', 50, 10),
  ('Application exemple 2', 100, 25);

-- 5) VOUS RENDRE ADMIN ----------------------------------------
-- Créez d'abord votre compte dans l'application (inscription), puis exécutez :
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'VOTRE_EMAIL');
