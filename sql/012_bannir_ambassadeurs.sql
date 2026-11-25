-- ============================================================
-- 012 : Bannir les ambassadeurs inscrits avant le 25/11/2026
--       SAUF la liste blanche (noms ou emails). Les managers et l'admin ne sont pas touchés.
-- A coller dans Supabase > SQL Editor.
-- ORDRE : 1) lancer le bloc A (création de la fonction) puis le bloc B (APERCU),
--         2) vérifier la liste GARDÉ / BANNI, 3) lancer le bloc C (application).
-- ============================================================

-- ---------- A) FONCTIONS ----------
create or replace function public.adg_norm(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(
    translate(replace(lower(coalesce(t,'')), 'œ', 'oe'),
              'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.adg_is_allowed(p_name text, p_email text) returns boolean
language plpgsql immutable as $$
declare
  entries text[] := array['Teshuah-Yasha','Aurore','Gemy mutombo','Gedeon Phœnix tshilombo',
                          'omalokolo hioma francois','Havila mpubu mawulu','Aline','Tracy','Precilliah'];
  e text; toks text[]; t text; need int; hn int; hm int;
  name_t text[] := string_to_array(public.adg_norm(p_name), ' ');
  mail_n text := public.adg_norm(split_part(coalesce(p_email,''), '@', 1));
  mail_t text[] := string_to_array(public.adg_norm(split_part(coalesce(p_email,''), '@', 1)), ' ');
  mail_c text := replace(public.adg_norm(split_part(coalesce(p_email,''), '@', 1)), ' ', '');
begin
  foreach e in array entries loop
    toks := string_to_array(public.adg_norm(e), ' ');
    need := case when array_length(toks,1) = 2 and position('-' in e) > 0 then 1
                 else least(array_length(toks,1), 2) end;
    hn := 0; hm := 0;
    foreach t in array toks loop
      if t = any(name_t) then hn := hn + 1; end if;
      if t = any(mail_t)
         or (array_length(toks,1) = 1 and left(mail_c, length(t)) = t)
         or (array_length(toks,1) > 1 and position(t in mail_c) > 0) then hm := hm + 1; end if;
    end loop;
    if hn >= need or hm >= need then return true; end if;
  end loop;
  return false;
end $$;

revoke execute on function public.adg_is_allowed(text,text) from public, anon, authenticated;

-- ---------- B) APERCU (ne modifie rien) ----------
select p.full_name, u.email, p.active,
       case when public.adg_is_allowed(p.full_name, u.email) then 'GARDÉ' else 'BANNI' end as decision
from public.profiles p join auth.users u on u.id = p.id
where p.role = 'ambassador' and p.created_at < timestamptz '2026-11-25 15:30:00+00'
order by decision, p.full_name;

-- ---------- C) APPLICATION (après vérification de l'aperçu) ----------
-- 1) Suspendre dans l'application
update public.profiles p set active = false
from auth.users u
where u.id = p.id and p.role = 'ambassador'
  and p.created_at < timestamptz '2026-11-25 15:30:00+00'
  and not public.adg_is_allowed(p.full_name, u.email);

-- 2) Bannir au niveau de la connexion (plus de connexion possible) + couper les sessions ouvertes
update auth.users u set banned_until = 'infinity'
from public.profiles p
where u.id = p.id and p.role = 'ambassador'
  and p.created_at < timestamptz '2026-11-25 15:30:00+00'
  and not public.adg_is_allowed(p.full_name, u.email);

delete from auth.sessions where user_id in (
  select p.id from public.profiles p join auth.users u on u.id = p.id
  where p.role = 'ambassador' and p.created_at < timestamptz '2026-11-25 15:30:00+00'
    and not public.adg_is_allowed(p.full_name, u.email));

-- Pour annuler pour une personne : update public.profiles set active = true where id = '...';
--                                  update auth.users set banned_until = null where id = '...';
