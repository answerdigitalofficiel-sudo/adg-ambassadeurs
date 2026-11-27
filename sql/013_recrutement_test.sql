-- ============================================================
-- 013 : Test de recrutement chronométré (managers / ambassadeurs)
--  - accessible uniquement par le lien reçu (?test=JETON), sans compte
--  - questions affichées une à une, chacune avec son propre compte à rebours
--    contrôlé CÔTÉ SERVEUR (impossible de tricher en rechargeant la page)
--  - coordonnées du candidat enregistrées automatiquement
--  - l'admin décide en un clic : retenu / refusé, manager / ambassadeur
-- A coller dans Supabase > SQL Editor > Run (une seule fois).
-- ============================================================

create table if not exists public.rt_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  token text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rt_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.rt_tests(id) on delete cascade,
  position int not null,
  criterion text not null default '',
  prompt text not null,
  kind text not null default 'choice' check (kind in ('choice','text')),
  options jsonb not null default '[]'::jsonb,
  correct int,
  seconds int not null default 45 check (seconds between 10 and 900),
  points int not null default 10,
  unique (test_id, position)
);

create table if not exists public.rt_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.rt_tests(id) on delete cascade,
  secret text unique not null default md5(random()::text || clock_timestamp()::text || random()::text),
  full_name text not null,
  phone text not null,
  email text not null,
  university_id uuid,
  status text not null default 'in_progress' check (status in ('in_progress','finished')),
  score numeric,
  leaves int not null default 0,
  decision text check (decision in ('retained','rejected')),
  decision_role text check (decision_role in ('manager','ambassador')),
  applied boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  decided_at timestamptz
);
create unique index if not exists rt_attempts_email_uq on public.rt_attempts (test_id, lower(email));
create unique index if not exists rt_attempts_phone_uq on public.rt_attempts (test_id, phone);

create table if not exists public.rt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.rt_attempts(id) on delete cascade,
  question_id uuid not null references public.rt_questions(id) on delete cascade,
  served_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  answer text,
  answered_at timestamptz,
  late boolean not null default false,
  score numeric,
  unique (attempt_id, question_id)
);

-- ---------- Sécurité : seul l'admin lit/écrit directement ----------
alter table public.rt_tests     enable row level security;
alter table public.rt_questions enable row level security;
alter table public.rt_attempts  enable row level security;
alter table public.rt_answers   enable row level security;

drop policy if exists rt_tests_admin on public.rt_tests;
drop policy if exists rt_questions_admin on public.rt_questions;
drop policy if exists rt_attempts_admin on public.rt_attempts;
drop policy if exists rt_answers_admin on public.rt_answers;
create policy rt_tests_admin     on public.rt_tests     for all using (public.is_admin()) with check (public.is_admin());
create policy rt_questions_admin on public.rt_questions for all using (public.is_admin()) with check (public.is_admin());
create policy rt_attempts_admin  on public.rt_attempts  for all using (public.is_admin()) with check (public.is_admin());
create policy rt_answers_admin   on public.rt_answers   for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Fonctions publiques (candidat, sans compte) ----------
create or replace function public.rt_info(p_token text) returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'title', t.title,
    'count', (select count(*) from rt_questions q where q.test_id = t.id),
    'seconds', (select coalesce(sum(q.seconds), 0) from rt_questions q where q.test_id = t.id))
  from rt_tests t where t.token = p_token and t.active;
$$;

create or replace function public.rt_begin(p_token text, p_name text, p_phone text, p_email text, p_univ uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t uuid; a rt_attempts;
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  em text := lower(trim(coalesce(p_email, '')));
begin
  select id into t from rt_tests where token = p_token and active;
  if t is null then raise exception 'TEST_INTROUVABLE'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 or length(ph) < 8 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'COORDONNEES_INVALIDES';
  end if;
  select * into a from rt_attempts where test_id = t and (lower(email) = em or phone = ph) limit 1;
  if found then
    -- reprise possible seulement si le test n'est pas fini et que les deux coordonnées correspondent
    if a.status = 'in_progress' and lower(a.email) = em and a.phone = ph then return a.secret; end if;
    raise exception 'DEJA_PASSE';
  end if;
  insert into rt_attempts(test_id, full_name, phone, email, university_id)
  values (t, trim(p_name), ph, em, p_univ) returning * into a;
  return a.secret;
end $$;

-- Calcul du score (interne)
create or replace function public.rt_recompute(p_attempt uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare tot numeric; got numeric; s numeric;
begin
  select coalesce(sum(q.points), 0), coalesce(sum(coalesce(a.score, 0)), 0) into tot, got
    from rt_attempts t
    join rt_questions q on q.test_id = t.test_id
    left join rt_answers a on a.question_id = q.id and a.attempt_id = t.id
   where t.id = p_attempt;
  s := case when tot > 0 then round(got / tot * 100, 1) else 0 end;
  update rt_attempts set score = s where id = p_attempt;
  return s;
end $$;

-- Donne la question en cours (ou la suivante). Le chrono démarre ICI, côté serveur.
create or replace function public.rt_next(p_secret text) returns json
language plpgsql security definer set search_path = public as $$
declare a rt_attempts; r rt_answers; q rt_questions; n int; k int; pos int;
begin
  select * into a from rt_attempts where secret = p_secret;
  if not found then raise exception 'TENTATIVE_INTROUVABLE'; end if;
  if a.status = 'finished' then return json_build_object('done', true); end if;

  -- ferme les questions dont le temps est écoulé (3 s de tolérance réseau)
  update rt_answers set answered_at = now(), late = true, score = 0, answer = coalesce(answer, '')
   where attempt_id = a.id and answered_at is null and deadline_at + interval '3 seconds' < now();

  select count(*) into n from rt_questions where test_id = a.test_id;
  select * into r from rt_answers where attempt_id = a.id and answered_at is null order by served_at limit 1;
  if not found then
    select coalesce(max(qq.position), 0) into pos
      from rt_answers aa join rt_questions qq on qq.id = aa.question_id where aa.attempt_id = a.id;
    select * into q from rt_questions where test_id = a.test_id and position > pos order by position limit 1;
    if not found then
      update rt_attempts set status = 'finished', finished_at = now() where id = a.id;
      perform public.rt_recompute(a.id);
      return json_build_object('done', true);
    end if;
    insert into rt_answers(attempt_id, question_id, served_at, deadline_at)
    values (a.id, q.id, now(), now() + make_interval(secs => q.seconds)) returning * into r;
  else
    select * into q from rt_questions where id = r.question_id;
  end if;

  select count(*) into k from rt_answers where attempt_id = a.id;
  return json_build_object(
    'done', false, 'qid', q.id, 'index', k, 'total', n, 'kind', q.kind, 'prompt', q.prompt,
    'options', case when q.kind = 'choice' then q.options else '[]'::jsonb end,
    'seconds', greatest(0, ceil(extract(epoch from (r.deadline_at - now()))))::int,
    'total_seconds', q.seconds);
end $$;

-- Enregistre la réponse. Refusée (note 0) si le temps est dépassé.
create or replace function public.rt_answer(p_secret text, p_qid uuid, p_answer text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a rt_attempts; r rt_answers; q rt_questions; ok boolean; sc numeric := 0;
begin
  select * into a from rt_attempts where secret = p_secret and status = 'in_progress';
  if not found then return false; end if;
  select * into r from rt_answers where attempt_id = a.id and question_id = p_qid and answered_at is null;
  if not found then return false; end if;
  select * into q from rt_questions where id = p_qid;
  ok := now() <= r.deadline_at + interval '3 seconds';
  if ok and q.kind = 'choice' and q.correct is not null
     and length(coalesce(p_answer, '')) between 1 and 3 and p_answer ~ '^[0-9]+$' and p_answer::int = q.correct then
    sc := q.points;
  end if;
  update rt_answers
     set answer = left(coalesce(p_answer, ''), 4000), answered_at = now(), late = not ok,
         score = case when q.kind = 'choice' then (case when ok then sc else 0 end)
                      when ok then null   -- texte : à noter par l'admin
                      else 0 end
   where id = r.id;
  return ok;
end $$;

-- Compte les sorties de la page pendant le test
create or replace function public.rt_flag(p_secret text) returns void
language sql security definer set search_path = public as $$
  update rt_attempts set leaves = leaves + 1 where secret = p_secret and status = 'in_progress';
$$;

-- ---------- Fonctions admin ----------
create or replace function public.rt_grade(p_answer uuid, p_score numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare att uuid; pts int;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIS'; end if;
  select a.attempt_id, q.points into att, pts from rt_answers a join rt_questions q on q.id = a.question_id where a.id = p_answer;
  if att is null then raise exception 'INTROUVABLE'; end if;
  update rt_answers set score = greatest(0, least(coalesce(p_score, 0), pts)) where id = p_answer;
  return public.rt_recompute(att);
end $$;

-- Décision en un clic. Retourne : ok | applied | pending_signup | univ_has_manager | need_univ | is_admin
create or replace function public.rt_decide(p_attempt uuid, p_decision text, p_role text default null, p_univ uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare a rt_attempts; uid uuid; pr profiles; univ uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIS'; end if;
  if p_decision not in ('retained', 'rejected') then raise exception 'DECISION_INVALIDE'; end if;
  if p_role is not null and p_role not in ('manager', 'ambassador') then raise exception 'ROLE_INVALIDE'; end if;
  select * into a from rt_attempts where id = p_attempt;
  if not found then raise exception 'INTROUVABLE'; end if;

  update rt_attempts
     set decision = p_decision, decision_role = case when p_decision = 'retained' then p_role else null end,
         decided_at = now(), applied = false
   where id = a.id;

  if p_decision = 'retained' and p_role is not null then
    select u.id into uid from auth.users u where lower(u.email) = lower(a.email) limit 1;
    if uid is null then return 'pending_signup'; end if;   -- pas encore inscrit : refaire le clic après son inscription
    select * into pr from profiles where id = uid;
    if pr.role = 'admin' then return 'is_admin'; end if;
    if p_role = 'manager' and pr.role <> 'manager' then
      univ := coalesce(p_univ, pr.university_id, a.university_id);
      if univ is null then return 'need_univ'; end if;
      begin
        perform public.admin_set_role(p_user => uid, p_role => 'manager', p_univ => univ);
      exception when unique_violation then
        return 'univ_has_manager';
      end;
    end if;
    update rt_attempts set applied = true where id = a.id;
    return 'applied';
  end if;
  return 'ok';
end $$;

-- ---------- Droits ----------
revoke all on function public.rt_info(text) from public;
revoke all on function public.rt_begin(text, text, text, text, uuid) from public;
revoke all on function public.rt_next(text) from public;
revoke all on function public.rt_answer(text, uuid, text) from public;
revoke all on function public.rt_flag(text) from public;
revoke all on function public.rt_recompute(uuid) from public, anon, authenticated;
revoke all on function public.rt_grade(uuid, numeric) from public, anon;
revoke all on function public.rt_decide(uuid, text, text, uuid) from public, anon;
grant execute on function public.rt_info(text) to anon, authenticated;
grant execute on function public.rt_begin(text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.rt_next(text) to anon, authenticated;
grant execute on function public.rt_answer(text, uuid, text) to anon, authenticated;
grant execute on function public.rt_flag(text) to anon, authenticated;
grant execute on function public.rt_grade(uuid, numeric) to authenticated;
grant execute on function public.rt_decide(uuid, text, text, uuid) to authenticated;

-- ---------- Test de départ : « Test Manager ADG » (modifiable dans l'onglet 🧪 Test) ----------
do $$
declare t uuid;
begin
  if exists (select 1 from rt_tests) then return; end if;
  insert into rt_tests(title) values ('Test Manager ADG') returning id into t;
  insert into rt_questions(test_id, position, criterion, prompt, kind, options, correct, seconds, points) values
  (t, 1, 'Leadership', 'Un de vos ambassadeurs ne répond plus depuis 3 jours et son objectif de la semaine n''est pas atteint. Que faites-vous en premier ?', 'choice',
    '["Le remplacer tout de suite et l''annoncer au groupe","L''appeler directement pour comprendre la situation, puis décider avec lui d''un plan","Attendre la fin du mois pour voir s''il reprend","Faire son travail à sa place sans rien dire"]', 1, 45, 10),
  (t, 2, 'Intégrité', 'Un ambassadeur vous propose de gonfler ses chiffres d''installation « juste ce mois-ci » car il est proche d''une prime. Vous…', 'choice',
    '["Acceptez, c''est pour motiver l''équipe","Refusez, rappelez la règle et la sanction en cas de fraude","Acceptez s''il partage sa prime avec vous","Ignorez et le laissez faire"]', 1, 40, 10),
  (t, 3, 'Gestion du terrain', 'Un agent de sécurité vous demande de quitter l''entrée du campus pendant une démonstration. Que faites-vous ?', 'choice',
    '["Insistez et argumentez devant les étudiants","Partez calmement, déplacez l''équipe dans un espace public voisin et continuez la démo","Appelez des étudiants pour faire pression","Abandonnez la journée"]', 1, 40, 10),
  (t, 4, 'Communication', 'Un étudiant vous dit : « Je n''ai pas de forfait internet et je ne vois pas l''utilité de ton application. » Écrivez votre réponse en 4 à 6 phrases.', 'text',
    '[]', null, 120, 20),
  (t, 5, 'Organisation', 'Vous avez 12 ambassadeurs et 3 universités à couvrir. L''application doit être présentée au moins 4 fois dans chaque université cette semaine. Quelle répartition est la plus réaliste ?', 'choice',
    '["12 ambassadeurs dans une seule université","4 ambassadeurs par université, une présentation chacun dans la semaine","Chacun choisit où il va","6 dans la première, 6 dans la deuxième, aucun dans la troisième"]', 1, 50, 10),
  (t, 6, 'Analyse chiffrée', 'Un ambassadeur a présenté l''application à 80 étudiants : 30 l''ont installée, 12 l''utilisent encore après 7 jours. Quel est le taux d''utilisateurs encore actifs par rapport aux installations ?', 'choice',
    '["40 %","15 %","37,5 %","60 %"]', 0, 60, 10),
  (t, 7, 'Gestion de conflit', 'Deux ambassadeurs de votre université se disputent un même étudiant que chacun dit avoir convaincu. Que faites-vous ?', 'choice',
    '["Donnez raison au plus ancien","Vérifiez le lien ou le QR code utilisé à l''installation et appliquez la règle d''attribution","Ne créditez personne","Les laissez régler ça entre eux"]', 1, 45, 10),
  (t, 8, 'Recrutement', 'Vous devez recruter 5 ambassadeurs dans votre université en 10 jours, sans passer par l''administration ni par les délégués. Décrivez votre méthode : profil recherché, où les trouver, comment les filtrer.', 'text',
    '[]', null, 150, 20),
  (t, 9, 'Éthique', 'On vous propose 200 $ pour transmettre à une entreprise les numéros des étudiants inscrits via l''application. Vous…', 'choice',
    '["Acceptez","Refusez et informez l''administration","Acceptez pour 20 numéros seulement","Négociez pour 400 $"]', 1, 40, 10),
  (t, 10, 'Résilience', 'Après 2 semaines, vos ambassadeurs n''ont obtenu que 5 installations. Que changez-vous cette semaine ? Donnez 3 actions concrètes.', 'text',
    '[]', null, 90, 20);
end $$;

-- Lien du test : voir l''onglet 🧪 Test de l''admin (ou : select token from rt_tests;)
