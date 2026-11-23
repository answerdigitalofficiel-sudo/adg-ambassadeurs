-- ADG Ambassadeurs — migration 011 : messagerie (texte, image, audio) — déjà appliquée
-- Règles : administration ↔ managers ; manager ↔ son équipe + autres managers ; ambassadeur ↔ son équipe, son manager et les autres managers ;
-- jamais ambassadeur ↔ administration. Aucun numéro de téléphone n'est exposé par chat_directory().

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,   -- message direct
  univ_id uuid references public.universities(id) on delete cascade,    -- discussion de groupe de l'équipe d'une université
  kind text not null check (kind in ('text','image','audio')),
  body text not null default '',
  media_path text,
  duration int,
  created_at timestamptz not null default now(),
  check ((recipient_id is null) <> (univ_id is null))
);
create index if not exists chat_messages_rcpt on public.chat_messages(recipient_id, created_at desc);
create index if not exists chat_messages_send on public.chat_messages(sender_id, created_at desc);
create index if not exists chat_messages_univ on public.chat_messages(univ_id, created_at desc);
create table if not exists public.chat_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conv_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conv_key)
);
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

create or replace function public.in_team_room(p_univ uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select p_univ is not null and exists (select 1 from profiles where id = auth.uid() and active and university_id = p_univ
    and (role = 'manager' or (role = 'ambassador' and stage = 'active')));
$$;
create or replace function public.chat_allowed(a uuid, b uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles x, profiles y
    where x.id = a and y.id = b and x.id <> y.id and x.active and y.active
      and case x.role
        when 'admin' then y.role = 'manager'
        when 'manager' then y.role in ('admin','manager') or (y.role = 'ambassador' and y.stage = 'active' and y.university_id is not null and y.university_id = x.university_id)
        when 'ambassador' then x.stage = 'active' and x.university_id is not null
             and (y.role = 'manager' or (y.role = 'ambassador' and y.stage = 'active' and y.university_id = x.university_id))
        else false end);
$$;
create or replace function public.chat_can_read_media(p_name text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from chat_messages m where m.media_path = p_name
    and (m.sender_id = auth.uid() or m.recipient_id = auth.uid() or (m.univ_id is not null and public.in_team_room(m.univ_id))));
$$;
revoke all on function public.in_team_room(uuid), public.chat_allowed(uuid, uuid), public.chat_can_read_media(text) from public, anon;
grant execute on function public.in_team_room(uuid), public.chat_allowed(uuid, uuid), public.chat_can_read_media(text) to authenticated;

drop policy if exists chat_msg_select on public.chat_messages;
create policy chat_msg_select on public.chat_messages for select using (sender_id = auth.uid() or recipient_id = auth.uid() or public.in_team_room(univ_id));
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads for select using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.chat_messages, public.chat_reads from anon, authenticated;

create or replace function public.chat_directory() returns table(id uuid, full_name text, role text, is_chief boolean, university_id uuid, university_name text, same_team boolean)
language sql security definer stable set search_path = public as $$
  select p.id, p.full_name, p.role, (p.is_chief and p.role = 'ambassador'), p.university_id, u.name,
         (p.university_id is not null and p.university_id = m.university_id)
    from profiles m, profiles p left join universities u on u.id = p.university_id
   where m.id = auth.uid() and m.active and p.id <> m.id and p.active and public.chat_allowed(m.id, p.id)
   order by p.full_name;
$$;
revoke all on function public.chat_directory() from public, anon;
grant execute on function public.chat_directory() to authenticated;

create or replace function public.chat_send(p_to uuid, p_univ uuid, p_kind text, p_body text, p_media text default null, p_duration int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; b text := left(coalesce(trim(p_body), ''), 2000);
begin
  if not exists (select 1 from profiles where id = auth.uid() and active) then raise exception 'Interdit'; end if;
  if p_kind not in ('text','image','audio') then raise exception 'Type de message invalide'; end if;
  if (p_to is null) = (p_univ is null) then raise exception 'Destinataire invalide'; end if;
  if p_kind = 'text' and length(b) = 0 then raise exception 'Message vide'; end if;
  if p_kind <> 'text' and (p_media is null or split_part(p_media, '/', 1) <> auth.uid()::text) then raise exception 'Fichier invalide'; end if;
  if p_to is not null then
    if not public.chat_allowed(auth.uid(), p_to) then raise exception 'Vous ne pouvez pas écrire à cette personne'; end if;
  elsif not public.in_team_room(p_univ) then
    raise exception 'Vous ne faites pas partie de cette équipe';
  end if;
  insert into chat_messages(sender_id, recipient_id, univ_id, kind, body, media_path, duration)
  values (auth.uid(), p_to, p_univ, p_kind, b, case when p_kind = 'text' then null else p_media end, case when p_kind = 'audio' then least(greatest(coalesce(p_duration, 0), 0), 600) else null end)
  returning id into mid;
  return mid;
end $$;
revoke all on function public.chat_send(uuid, uuid, text, text, text, int) from public, anon;
grant execute on function public.chat_send(uuid, uuid, text, text, text, int) to authenticated;

create or replace function public.chat_mark_read(p_key text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Interdit'; end if;
  insert into chat_reads(user_id, conv_key, last_read_at) values (auth.uid(), left(coalesce(p_key, ''), 80), t)
  on conflict (user_id, conv_key) do update set last_read_at = excluded.last_read_at;
  return t;
end $$;
revoke all on function public.chat_mark_read(text) from public, anon;
grant execute on function public.chat_mark_read(text) to authenticated;

-- Fichiers (images et audios) : dossier privé, lisibles seulement par les participants de la conversation
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 5242880, array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a','audio/wav'])
on conflict (id) do nothing;
drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects for insert to authenticated with check (bucket_id = 'chat' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects for select to authenticated using (bucket_id = 'chat' and public.chat_can_read_media(name));

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
