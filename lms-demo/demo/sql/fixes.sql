-- Review fixes (run after checkpoint-time.sql):
--  1. Camera events (face not visible, two faces, camera off) are recorded but no longer count toward
--     the "submit after N warnings" rule — dim light shouldn't end a test. Leaving the page, copy, paste
--     and leaving full screen still count.
--  2. At most 2 descriptive questions per test (more only if the pool has too few other questions).
--  3. A blank descriptive answer gets 0 automatically and never waits in Reviews.
--  4. Data: the Module 1 "3 bigha" question's keywords had been split at the commas in 17,424 / 27,225.

create or replace function warn_count(p_events jsonb) returns int
language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_events, '[]')) x
  where x ->> 'type' in ('left_page', 'copy', 'paste', 'exit_fullscreen')
$$;

create or replace function log_attempt_event(p_attempt uuid, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_events jsonb;
begin
  if p_type not in ('left_page', 'copy', 'paste', 'exit_fullscreen', 'no_face', 'multi_face', 'camera_off') then raise exception 'Unknown event'; end if;
  update attempts set events = events || jsonb_build_object('type', p_type, 'at', now())
  where id = p_attempt and user_id = auth.uid() and submitted_at is null and jsonb_array_length(events) < 200
  returning events into v_events;
  return coalesce(warn_count(v_events), 0);
end $$;

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
    -- fresh questions first (not in the last paper), random; descriptive ones beyond the first 2 go to the back
    select array_agg(x.id) into v_ids from (
      select id from (
        select q.id, q.kind, q.id = any(coalesce(v_prev, '{}')) as seen, random() as r,
               row_number() over (partition by q.kind = 'essay' order by q.id = any(coalesce(v_prev, '{}')), random()) as k
        from questions q where q.module_id = p_module and (not v_own or q.level = v_level)
      ) p
      order by (p.kind = 'essay' and p.k > 2), p.seen, p.r
      limit v_n
    ) x;
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
    'warnings', (select warn_count(events) from attempts where id = v_id),
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options,
                                                    'min_words', q.min_words, 'max_words', q.max_words)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;

create or replace function submit_attempt(p_attempt uuid, p_answers jsonb, p_reason text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  v_detail jsonb;
  v_score numeric;
  v_total int;
  v_pending boolean;
  v_pass int;
  v_pct numeric;
  v_late boolean;
begin
  select * into a from attempts
  where id = p_attempt and user_id = auth.uid() and submitted_at is null for update;
  if not found then raise exception 'Attempt not found or already submitted'; end if;
  if not module_unlocked(a.module_id) then raise exception 'Module locked'; end if;

  select jsonb_agg(jsonb_build_object('question', q.text, 'kind', q.kind, 'options', q.options, 'correct', q.correct,
                                      'accepted', q.accepted, 'model_answer', q.model_answer,
                                      'chosen', p_answers -> q.id::text, 'ok', r.mark >= 1, 'mark', r.mark,
                                      'auto_mark', case when q.kind = 'essay' then r.mark end,
                                      'matched', case when q.kind = 'essay' then e.matched end,
                                      -- a blank descriptive answer is final at 0: nothing for the trainer to read
                                      'review', case when q.kind = 'essay' then case when b.blank then 'done' else 'pending' end end,
                                      'feedback', case when q.kind = 'essay' and b.blank then 'Blank answer: 0 marks (automatic)' end)
                   order by array_position(a.question_ids, q.id)),
         sum(r.mark), count(*), bool_or(q.kind = 'essay' and not b.blank)
    into v_detail, v_score, v_total, v_pending
  from questions q
  cross join lateral (select norm_text(p_answers ->> q.id::text) = '' as blank) b
  -- essay: share of keywords found in the answer (a keyword "बजट / budget" counts if any alternative appears)
  cross join lateral (
    select round(count(*) filter (where k.hit)::numeric / greatest(count(*), 1), 2) as mark,
           coalesce(jsonb_agg(k.kw) filter (where k.hit), '[]') as matched
    from (select kw, exists (select 1 from regexp_split_to_table(kw, '\s*/\s*') alt
                             where norm_text(alt) <> '' and position(norm_text(alt) in norm_text(p_answers ->> q.id::text)) > 0) as hit
          from jsonb_array_elements_text(case when q.kind = 'essay' then q.accepted else '[]'::jsonb end) kw) k
  ) e
  cross join lateral (select case
      when q.kind = 'essay' then case when b.blank then 0 else e.mark end
      when (case q.kind
        when 'single' then (p_answers ->> q.id::text) = q.correct::text
        when 'multi' then case when jsonb_typeof(p_answers -> q.id::text) = 'array'
          then (select jsonb_agg(v order by v) from jsonb_array_elements(p_answers -> q.id::text) v)
             = (select jsonb_agg(v order by v) from jsonb_array_elements(q.accepted) v)
          else false end
        else norm_text(p_answers ->> q.id::text) <> ''
             and exists (select 1 from jsonb_array_elements_text(q.accepted) x where norm_text(x) = norm_text(p_answers ->> q.id::text))
      end) is true then 1 else 0 end::numeric as mark) r
  where q.id = any(a.question_ids);

  select pass_pct into v_pass from modules where id = a.module_id;
  v_pct := round(100.0 * v_score / greatest(v_total, 1), 2);
  -- the browser submits itself at 0:00; a minute of grace covers slow networks, anything later fails
  v_late := a.deadline is not null and now() > a.deadline + interval '60 seconds';

  update attempts set detail = v_detail, score = v_score, total = v_total, pct = v_pct,
                      passed = v_pct >= v_pass and not v_late, late = v_late, submitted_at = now(),
                      events = case when p_reason in ('time_up', 'warnings')
                                    then events || jsonb_build_object('type', 'auto_submit_' || p_reason, 'at', now())
                                    else events end
  where id = p_attempt;

  return json_build_object('score', v_score, 'total', v_total, 'pct', v_pct, 'late', v_late,
                           'passed', v_pct >= v_pass and not v_late, 'pass_pct', v_pass, 'review_pending', coalesce(v_pending, false));
end $$;

-- answers already waiting in Reviews that are blank: close them at 0 now
update attempts a set detail = (
  select jsonb_agg(case when d.v ->> 'kind' = 'essay' and d.v ->> 'review' = 'pending' and norm_text(d.v ->> 'chosen') = ''
                        then d.v || '{"review": "done", "mark": 0, "ok": false, "feedback": "Blank answer: 0 marks (automatic)"}'::jsonb
                        else d.v end order by d.n)
  from jsonb_array_elements(a.detail) with ordinality d(v, n))
where a.detail is not null and exists (
  select 1 from jsonb_array_elements(a.detail) x
  where x ->> 'kind' = 'essay' and x ->> 'review' = 'pending' and norm_text(x ->> 'chosen') = '');

-- the bigha question: one keyword per number again (both "17424" and "17,424" count)
update questions set accepted = '["17424 / 17,424", "27225 / 27,225", "52272 / 52,272", "81675 / 81,675", "20 बिस्वा / 20 biswa"]'::jsonb
where kind = 'essay' and accepted @> '["17", "27"]'::jsonb;
