-- Checkpoint questions inside videos + "left the page while watching" log.
-- The video pauses at each checkpoint and continues only after an answer; a video counts as watched
-- only when all its checkpoints are answered. Run once in Supabase → SQL Editor, after video.sql.

create table video_checkpoints (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  at_sec int not null check (at_sec >= 0),
  text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct int not null,
  explanation text,
  created_at timestamptz not null default now(),
  check (correct >= 0 and correct < jsonb_array_length(options))
);
create index on video_checkpoints (module_id, video_id, at_sec);

-- first answer counts: a learner can't keep retrying a checkpoint for a better record
create table checkpoint_answers (
  checkpoint_id uuid not null references video_checkpoints on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  chosen int not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (checkpoint_id, user_id)
);

alter table video_progress add column events jsonb not null default '[]';

alter table video_checkpoints enable row level security;
alter table checkpoint_answers enable row level security;
create policy admin_all on video_checkpoints for all using (is_admin()) with check (is_admin());
create policy admin_all on checkpoint_answers for all using (is_admin()) with check (is_admin());

-- the chapter's checkpoints for the learner; the right answer stays hidden
create function my_checkpoints(p_module uuid)
returns table (id uuid, video_id text, at_sec int, text text, options jsonb, answered boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.video_id, c.at_sec, c.text, c.options,
         exists (select 1 from checkpoint_answers a where a.checkpoint_id = c.id and a.user_id = auth.uid())
  from video_checkpoints c
  where c.module_id = p_module and module_unlocked(p_module)
  order by c.video_id, c.at_sec
$$;

create function answer_checkpoint(p_checkpoint uuid, p_chosen int) returns json
language plpgsql security definer set search_path = public as $$
declare
  c video_checkpoints;
begin
  select * into c from video_checkpoints where id = p_checkpoint;
  if not found then raise exception 'Unknown checkpoint'; end if;
  if not module_unlocked(c.module_id) then raise exception 'Module locked'; end if;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(c.options) then raise exception 'Pick one of the options'; end if;
  insert into checkpoint_answers (checkpoint_id, user_id, chosen, correct)
  values (p_checkpoint, auth.uid(), p_chosen, p_chosen = c.correct)
  on conflict (checkpoint_id, user_id) do nothing;
  return json_build_object('correct', p_chosen = c.correct, 'correct_index', c.correct, 'explanation', c.explanation);
end $$;

-- the learner left the page while a video was playing (the video is paused by the page)
create function log_video_event(p_module uuid, p_video text, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_type not in ('left_page') then raise exception 'Unknown event'; end if;
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Unknown video'; end if;
  insert into video_progress (user_id, module_id, video_id, events)
  values (auth.uid(), p_module, p_video, jsonb_build_array(jsonb_build_object('type', p_type, 'at', now())))
  on conflict (user_id, module_id, video_id) do update
    set events = case when jsonb_array_length(video_progress.events) < 200
                      then video_progress.events || jsonb_build_object('type', p_type, 'at', now())
                      else video_progress.events end
  returning jsonb_array_length(events) into v_n;
  return v_n;
end $$;

create or replace function save_video_progress(p_module uuid, p_video text, p_max numeric, p_duration numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r video_progress;
  v_max numeric;
  v_done boolean;
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Unknown video'; end if;
  select * into r from video_progress where user_id = auth.uid() and module_id = p_module and video_id = p_video for update;
  v_max := least(greatest(coalesce(r.max_sec, 0), coalesce(p_max, 0)),
                 coalesce(r.max_sec, 0) + 30 + 1.1 * extract(epoch from now() - coalesce(r.updated_at, now())));
  insert into video_progress (user_id, module_id, video_id, max_sec, duration, completed, updated_at)
  values (auth.uid(), p_module, p_video, v_max, p_duration, coalesce(p_duration > 0 and v_max >= p_duration - 5, false)
          -- and every checkpoint question in this video answered
          and not exists (select 1 from video_checkpoints vc
                          where vc.module_id = p_module and vc.video_id = p_video
                            and not exists (select 1 from checkpoint_answers ca where ca.checkpoint_id = vc.id and ca.user_id = auth.uid())), now())
  on conflict (user_id, module_id, video_id) do update
    set max_sec = excluded.max_sec, duration = coalesce(excluded.duration, video_progress.duration),
        completed = video_progress.completed or excluded.completed, updated_at = now()
  returning completed into v_done;
  return v_done;
end $$;
