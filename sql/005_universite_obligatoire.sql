-- ADG Ambassadeurs — migration 005 : université OBLIGATOIRE pour tout ambassadeur
-- Additive et rejouable. À coller dans Supabase (projet ADG) > SQL Editor > Run.
-- 1) Inscription refusée sans université valide.
-- 2) Un ambassadeur existant sans université est bloqué (côté serveur aussi) tant qu'il ne l'a pas indiquée.
-- 3) Dès que l'université est indiquée, les ventes déjà validées de l'ambassadeur comptent pour le manager de cette
--    université (même principe que pour les nouvelles ventes : points du manager par vente validée).

-- ---------- Aide : cet utilisateur est-il un ambassadeur sans université ? ----------
create or replace function public.needs_university() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'ambassador' and university_id is null);
$$;
revoke all on function public.needs_university() from public, anon;
grant execute on function public.needs_university() to authenticated;

-- ---------- 1) Inscription : université obligatoire ----------
-- (Tant qu'aucun administrateur n'existe, l'inscription reste libre pour permettre de créer le premier compte admin.)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uni uuid;
begin
  begin uni := nullif(new.raw_user_meta_data->>'university_id','')::uuid; exception when others then uni := null; end;
  if uni is not null and not exists (select 1 from universities where id = uni and active) then uni := null; end if;
  if uni is null and exists (select 1 from profiles where role = 'admin') then
    raise exception 'UNIVERSITE_REQUISE : choisissez votre université pour vous inscrire';
  end if;
  insert into profiles(id, full_name, phone, referral_code, university_id)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.raw_user_meta_data->>'phone',''),
          'AMB-' || upper(substr(md5(random()::text || new.id::text), 1, 5)), uni);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- 3) Points du manager sur les ventes déjà validées ----------
create or replace function public.apply_manager_points(p_amb uuid) returns int
language plpgsql security definer set search_path = public as $$
declare mgr uuid; n int; tot int; nm text;
begin
  select m.id, a.full_name into mgr, nm from profiles a
    join profiles m on m.university_id = a.university_id and m.role = 'manager' and m.active
   where a.id = p_amb and a.university_id is not null and a.role = 'ambassador';
  if mgr is null then return 0; end if;
  with ins as (
    insert into manager_ledger(manager_id, sale_id, ambassador_id, points, usd)
    select mgr, s.id, s.ambassador_id, ap.manager_points_per_sale, ap.manager_points_per_sale * coalesce(ap.usd_per_point, 0)
      from sales s join apps ap on ap.id = s.app_id
     where s.ambassador_id = p_amb and s.status = 'validated' and coalesce(ap.manager_points_per_sale, 0) > 0
    on conflict (sale_id) do nothing
    returning points)
  select count(*), coalesce(sum(points), 0) into n, tot from ins;
  if n > 0 then
    insert into notifications(ambassador_id, message)
    values (mgr, '+' || tot || ' points : ' || n || ' vente(s) déjà validée(s) de ' || coalesce(nm, 'un ambassadeur') || ' comptent maintenant pour votre équipe.');
  end if;
  return n;
end $$;
revoke all on function public.apply_manager_points(uuid) from public, anon, authenticated;

-- ---------- 2) L'ambassadeur indique son université (une seule fois ; ensuite seule l'administration peut la changer) ----------
create or replace function public.set_my_university(p_univ uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from profiles where id = auth.uid();
  if not found or r.role <> 'ambassador' then raise exception 'Interdit'; end if;
  if r.university_id is not null then raise exception 'Université déjà indiquée : seule l''administration peut la modifier'; end if;
  if p_univ is null or not exists (select 1 from universities where id = p_univ and active) then raise exception 'Université invalide'; end if;
  update profiles set university_id = p_univ where id = auth.uid();
  perform public.apply_manager_points(auth.uid());
end $$;
revoke all on function public.set_my_university(uuid) from public, anon;
grant execute on function public.set_my_university(uuid) to authenticated;

-- L'administration qui affecte une université applique aussi les points du manager (même règle).
create or replace function public.admin_set_university(p_user uuid, p_univ uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Interdit'; end if;
  update profiles set university_id = p_univ, is_chief = false where id = p_user and role = 'ambassador';
  if p_univ is not null then perform public.apply_manager_points(p_user); end if;
end $$;
revoke all on function public.admin_set_university(uuid, uuid) from public, anon;
grant execute on function public.admin_set_university(uuid, uuid) to authenticated;

-- ---------- Blocage côté serveur : sans université, un ambassadeur ne lit plus ses données ----------
-- (politiques RESTRICTIVES : s'ajoutent aux politiques existantes sans les modifier ; sans effet pour admin / manager / anonyme)
drop policy if exists need_univ_sales on public.sales;
create policy need_univ_sales on public.sales as restrictive for select using (not public.needs_university());
drop policy if exists need_univ_ledger on public.points_ledger;
create policy need_univ_ledger on public.points_ledger as restrictive for select using (not public.needs_university());
drop policy if exists need_univ_notif on public.notifications;
create policy need_univ_notif on public.notifications as restrictive for select using (not public.needs_university());
drop policy if exists need_univ_requests on public.client_requests;
create policy need_univ_requests on public.client_requests as restrictive for select using (not public.needs_university());
