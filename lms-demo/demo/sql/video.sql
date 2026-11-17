-- Video seek-lock: the first time through, a learner can't skip ahead; after one full watch they can.
-- Run once in Supabase → SQL Editor, after essay-length.sql.

create table video_progress (
  user_id uuid not null references profiles on delete cascade,
  module_id uuid not null references modules on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  max_sec numeric not null default 0,      -- furthest point watched without skipping
  duration numeric,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id, video_id)
);
alter table video_progress enable row level security;
create policy admin_all on video_progress for all using (is_admin()) with check (is_admin());

-- The browser reports how far it got. Watch time can't grow faster than the clock, so a forged
-- "watched to the end" is cut back to what the time since the last report allows.
-- ponytail: a learner who edits the page's code can still fake the video length; this stops normal skipping, not a hacker
create function save_video_progress(p_module uuid, p_video text, p_max numeric, p_duration numeric) returns boolean
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
  values (auth.uid(), p_module, p_video, v_max, p_duration, coalesce(p_duration > 0 and v_max >= p_duration - 5, false), now())
  on conflict (user_id, module_id, video_id) do update
    set max_sec = excluded.max_sec, duration = coalesce(excluded.duration, video_progress.duration),
        completed = video_progress.completed or excluded.completed, updated_at = now()
  returning completed into v_done;
  return v_done;
end $$;

create function my_video_progress(p_module uuid)
returns table (video_id text, max_sec numeric, duration numeric, completed boolean)
language sql stable security definer set search_path = public as $$
  select video_id, max_sec, duration, completed from video_progress
  where user_id = auth.uid() and module_id = p_module
$$;

create or replace function start_attempt(p_module uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_prev uuid[];
  v_n int;
  v_level text;
  v_own boolean;
  v_limit int;
  v_max int;
  v_deadline timestamptz;
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;

  select time_limit_min, max_warnings into v_limit, v_max from modules where id = p_module;

  -- an attempt left open past its deadline (closed tab, dead phone) is closed as failed, so a reload can't buy time
  update attempts set submitted_at = deadline, score = 0, total = coalesce(array_length(question_ids, 1), 0),
                      pct = 0, passed = false, late = true,
                      events = events || jsonb_build_object('type', 'expired', 'at', now())
  where user_id = auth.uid() and module_id = p_module and submitted_at is null
    and deadline is not null and now() > deadline + interval '60 seconds';

  select id, question_ids, deadline into v_id, v_ids, v_deadline from attempts
  where user_id = auth.uid() and module_id = p_module and submitted_at is null
  order by started_at desc limit 1;

  if v_id is null then
    -- a new paper needs every YouTube video of the chapter watched to the end once (a started paper can always resume)
    if exists (select 1 from modules m
               cross join lateral regexp_matches(coalesce(m.videos, ''), '(?:youtu\.be/|v=|shorts/|embed/|live/)([A-Za-z0-9_-]{11})', 'g') v(id)
               where m.id = p_module
                 and not exists (select 1 from video_progress vp
                                 where vp.user_id = auth.uid() and vp.module_id = p_module and vp.video_id = v.id[1] and vp.completed)) then
      raise exception 'Watch the full video before starting the test';
    end if;
    select e.level into v_level from enrollments e join modules m on m.course_id = e.course_id
    where m.id = p_module and e.user_id = auth.uid();
    -- no questions written for this level yet → use the whole chapter pool so nobody gets stuck
    v_own := exists (select 1 from questions where module_id = p_module and level = v_level);
    select question_ids into v_prev from attempts
    where user_id = auth.uid() and module_id = p_module and submitted_at is not null
    order by submitted_at desc limit 1;
    select questions_per_test into v_n from modules where id = p_module;
    select array_agg(q.id) into v_ids from (
      select id from questions where module_id = p_module and (not v_own or level = v_level)
      order by (id = any(coalesce(v_prev, '{}'))), random() limit v_n
    ) q;
    if v_ids is null then raise exception 'This chapter has no questions yet'; end if;
    v_deadline := case when v_limit > 0 then now() + make_interval(mins => v_limit) end;
    insert into attempts (user_id, module_id, question_ids, deadline)
    values (auth.uid(), p_module, v_ids, v_deadline) returning id into v_id;
  end if;

  return json_build_object(
    'attempt_id', v_id,
    -- seconds left by the server's clock: the browser's own clock is never trusted
    'seconds_left', case when v_deadline is not null then greatest(0, floor(extract(epoch from v_deadline - now()))::int) end,
    'max_warnings', v_max,
    'warnings', (select jsonb_array_length(events) from attempts where id = v_id),
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options,
                                                    'min_words', q.min_words, 'max_words', q.max_words)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;
