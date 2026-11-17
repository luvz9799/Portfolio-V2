-- Timed tests + integrity warnings. Run once in Supabase → SQL Editor, after essay.sql.
-- The deadline lives on the server: refreshing, pausing the page or changing the phone's clock buys no time.
-- What a browser can see is logged (leaving the page, copy, paste, leaving fullscreen); a second phone it cannot.

alter table modules add column time_limit_min int not null default 0 check (time_limit_min between 0 and 600); -- 0 = no limit
alter table modules add column max_warnings int not null default 3 check (max_warnings between 0 and 50);    -- 0 = never auto-submit
alter table attempts add column deadline timestamptz;
alter table attempts add column late boolean not null default false;
alter table attempts add column events jsonb not null default '[]';

-- One integrity event from the open test; returns how many warnings the attempt has now.
create function log_attempt_event(p_attempt uuid, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_type not in ('left_page', 'copy', 'paste', 'exit_fullscreen') then raise exception 'Unknown event'; end if;
  update attempts set events = events || jsonb_build_object('type', p_type, 'at', now())
  where id = p_attempt and user_id = auth.uid() and submitted_at is null and jsonb_array_length(events) < 200
  returning jsonb_array_length(events) into v_n;
  return coalesce(v_n, 0);
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
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;

drop function submit_attempt(uuid, jsonb);
create function submit_attempt(p_attempt uuid, p_answers jsonb, p_reason text default null) returns json
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
                                      'review', case when q.kind = 'essay' then 'pending' end)
                   order by array_position(a.question_ids, q.id)),
         sum(r.mark), count(*), bool_or(q.kind = 'essay')
    into v_detail, v_score, v_total, v_pending
  from questions q
  -- essay: share of keywords found in the answer (a keyword "बजट / budget" counts if any alternative appears)
  cross join lateral (
    select round(count(*) filter (where k.hit)::numeric / greatest(count(*), 1), 2) as mark,
           coalesce(jsonb_agg(k.kw) filter (where k.hit), '[]') as matched
    from (select kw, exists (select 1 from regexp_split_to_table(kw, '\s*/\s*') alt
                             where norm_text(alt) <> '' and position(norm_text(alt) in norm_text(p_answers ->> q.id::text)) > 0) as hit
          from jsonb_array_elements_text(case when q.kind = 'essay' then q.accepted else '[]'::jsonb end) kw) k
  ) e
  cross join lateral (select case
      when q.kind = 'essay' then e.mark
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

create or replace function sheet_export(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from sheet_tokens where token = p_token) then
    raise exception 'Invalid token';
  end if;
  return json_build_object(
    'learners', (select coalesce(json_agg(r order by r.registered desc), '[]') from (
      select p.full_name as name, p.phone, p.email, p.user_type as type, p.status,
             (select string_agg(c.title, ', ') from enrollments e join courses c on c.id = e.course_id where e.user_id = p.id) as training,
             (select string_agg(distinct e.level, ', ') from enrollments e where e.user_id = p.id) as level,
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published
              where e.user_id = p.id and module_done(m.id, p.id)) as chapters_passed,
             (select count(*) from enrollments e join modules m on m.course_id = e.course_id and m.published where e.user_id = p.id) as chapters_total,
             (select count(*) from attempts a where a.user_id = p.id and a.submitted_at is not null) as tests_taken,
             (select max(a.submitted_at) from attempts a where a.user_id = p.id) as last_test,
             p.notes, p.created_at as registered
      from profiles p) r),
    'attempts', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, e.level, m.seq as chapter_no, m.title as chapter,
             a.score, a.total, a.pct as percent, case when a.passed then 'PASS' else 'FAIL' end as result,
             round(extract(epoch from a.submitted_at - a.started_at) / 60, 1) as minutes_taken,
             (select count(*) from jsonb_array_elements(a.events) x where x ->> 'type' in ('left_page', 'copy', 'paste', 'exit_fullscreen')) as warnings,
             (select string_agg(distinct x ->> 'type', ', ') from jsonb_array_elements(a.events) x) as flags,
             a.late, a.submitted_at as submitted
      from attempts a
      join profiles p on p.id = a.user_id
      join modules m on m.id = a.module_id
      join courses c on c.id = m.course_id
      left join enrollments e on e.user_id = a.user_id and e.course_id = m.course_id
      where a.submitted_at is not null) r),
    -- one row per question, from the snapshot each attempt keeps (so later edits to a question don't rewrite history)
    'answers', (select coalesce(json_agg(r order by r.submitted desc, r.question_no), '[]') from (
      select p.full_name as name, p.phone, c.title as training, e.level, m.seq as chapter_no, m.title as chapter,
             d.n as question_no, d.v ->> 'question' as question,
             case coalesce(d.v ->> 'kind', 'single')
               when 'text' then d.v ->> 'chosen'
               when 'essay' then d.v ->> 'chosen'
               when 'multi' then (select string_agg(d.v -> 'options' ->> x::int, ', ')
                                  from jsonb_array_elements_text(case when jsonb_typeof(d.v -> 'chosen') = 'array'
                                                                      then d.v -> 'chosen' else '[]'::jsonb end) x)
               else d.v -> 'options' ->> (d.v ->> 'chosen')::int
             end as their_answer,
             case coalesce(d.v ->> 'kind', 'single')
               when 'text' then (select string_agg(x, ' / ') from jsonb_array_elements_text(d.v -> 'accepted') x)
               when 'essay' then d.v ->> 'model_answer'
               when 'multi' then (select string_agg(d.v -> 'options' ->> x::int, ', ') from jsonb_array_elements_text(d.v -> 'accepted') x)
               else d.v -> 'options' ->> (d.v ->> 'correct')::int
             end as correct_answer,
             -- snapshots from before question types have no "ok": compare the picked option instead
             case when d.v ->> 'kind' = 'essay' then
                    case when d.v ->> 'review' = 'pending' then 'Pending review (keywords ' || (d.v ->> 'auto_mark') || ')'
                         else 'Reviewed: ' || (d.v ->> 'mark') || ' mark' end
                  when coalesce((d.v ->> 'ok')::boolean, d.v ->> 'chosen' = d.v ->> 'correct') then 'Correct' else 'Wrong' end as result,
             d.v ->> 'feedback' as trainer_feedback,
             a.submitted_at as submitted
      from attempts a
      cross join lateral jsonb_array_elements(a.detail) with ordinality d(v, n)
      join profiles p on p.id = a.user_id
      join modules m on m.id = a.module_id
      join courses c on c.id = m.course_id
      left join enrollments e on e.user_id = a.user_id and e.course_id = m.course_id
      where a.submitted_at is not null) r),
    'tasks', (select coalesce(json_agg(r order by r.submitted desc), '[]') from (
      select p.full_name as name, p.phone, c.title as training, m.seq as chapter_no, m.title as chapter,
             s.answer, s.submitted_at as submitted
      from task_submissions s
      join profiles p on p.id = s.user_id
      join modules m on m.id = s.module_id
      join courses c on c.id = m.course_id) r));
end $$;

-- chapter list tells the learner the time limit and warning rule before they start
drop function my_modules(uuid);
create function my_modules(p_course uuid)
returns table (id uuid, seq int, title text, description text, videos text, pass_pct int,
               state text, best_pct numeric, attempt_count bigint,
               has_test boolean, has_task boolean, task_done boolean,
               time_limit_min int, max_warnings int)
language sql stable security definer set search_path = public as $$
  select m.id, m.seq, m.title, m.description,
         case when u.ok then m.videos end,
         m.pass_pct,
         case when module_done(m.id, auth.uid()) then 'passed' when u.ok then 'available' else 'locked' end,
         s.best, s.n,
         exists (select 1 from questions q where q.module_id = m.id),
         exists (select 1 from tasks t where t.module_id = m.id),
         exists (select 1 from task_submissions ts where ts.module_id = m.id and ts.user_id = auth.uid()),
         m.time_limit_min, m.max_warnings
  from modules m
  join enrollments e on e.course_id = m.course_id and e.user_id = auth.uid()
  cross join lateral (select module_unlocked(m.id) as ok) u
  cross join lateral (
    select max(a.pct) as best, count(*) filter (where a.submitted_at is not null) as n
    from attempts a where a.module_id = m.id and a.user_id = auth.uid()
  ) s
  where m.course_id = p_course and m.published
  order by m.seq, m.id
$$;
