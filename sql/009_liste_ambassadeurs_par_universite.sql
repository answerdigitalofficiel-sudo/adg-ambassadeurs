-- ADG Ambassadeurs — migration 009 : liste des ambassadeurs actifs groupés par université (pour le Cahier numérique)
-- Additive et rejouable. Déjà appliquée sur le projet ADG.
create or replace function public.list_ambassadors_by_univ()
returns table(code text, university_id uuid, university text)
language sql security definer stable set search_path = public as $$
  select p.referral_code, u.id, u.name
  from profiles p join universities u on u.id = p.university_id
  where p.role = 'ambassador' and p.active and p.stage = 'active'
    and p.referral_code is not null and u.active
  order by u.name, p.referral_code;
$$;
revoke all on function public.list_ambassadors_by_univ() from public, anon, authenticated;
grant execute on function public.list_ambassadors_by_univ() to anon, authenticated;
