-- Response time for video checkpoint questions (run after camera.sql).
-- The server notes when a checkpoint question was shown and when it was answered, so the browser can't
-- fake the time. Only the first showing and the first answer count, like the answer itself.

alter table checkpoint_answers add column if not exists response_ms int;

create table if not exists checkpoint_shown (
  checkpoint_id uuid not null references video_checkpoints on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  shown_at timestamptz not null default now(),
  primary key (checkpoint_id, user_id)
);
alter table checkpoint_shown enable row level security;
drop policy if exists admin_all on checkpoint_shown;
create policy admin_all on checkpoint_shown for all using (is_admin()) with check (is_admin());

create or replace function mark_checkpoint_shown(p_checkpoint uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from video_checkpoints c where c.id = p_checkpoint and module_unlocked(c.module_id)) then
    raise exception 'Unknown checkpoint';
  end if;
  insert into checkpoint_shown (checkpoint_id, user_id) values (p_checkpoint, auth.uid())
  on conflict (checkpoint_id, user_id) do nothing;
end $$;

create or replace function answer_checkpoint(p_checkpoint uuid, p_chosen int) returns json
language plpgsql security definer set search_path = public as $$
declare
  c video_checkpoints;
  v_ms int;
begin
  select * into c from video_checkpoints where id = p_checkpoint;
  if not found then raise exception 'Unknown checkpoint'; end if;
  if not module_unlocked(c.module_id) then raise exception 'Module locked'; end if;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(c.options) then raise exception 'Pick one of the options'; end if;
  select least(extract(epoch from now() - s.shown_at) * 1000, 3600000)::int into v_ms
  from checkpoint_shown s where s.checkpoint_id = p_checkpoint and s.user_id = auth.uid();
  insert into checkpoint_answers (checkpoint_id, user_id, chosen, correct, response_ms)
  values (p_checkpoint, auth.uid(), p_chosen, p_chosen = c.correct, v_ms)
  on conflict (checkpoint_id, user_id) do nothing;
  return json_build_object('correct', p_chosen = c.correct, 'correct_index', c.correct, 'explanation', c.explanation);
end $$;
