-- Descriptive answers. Keywords give an instant, provisional mark; a trainer reviews every
-- descriptive answer and their mark is final (the attempt's score and pass/fail are recomputed).
-- Run once in Supabase → SQL Editor, after sheet-answers.sql.

alter table questions drop constraint questions_kind_check;
alter table questions add constraint questions_kind_check check (kind in ('single', 'multi', 'text', 'essay'));
alter table questions add column model_answer text;   -- essay: shown to the trainer while reviewing
-- (questions_shape already requires essay keywords: its "else" branch needs a non-empty accepted list)

alter table attempts alter column score type numeric(6, 2);   -- descriptive answers earn part marks

create function norm_text(t text) returns text
language sql immutable as $$ select lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

-- p_answers: {"<question_id>": 2 | [0, 2] | "written answer" | "descriptive answer"}
create or replace function submit_attempt(p_attempt uuid, p_answers jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  v_detail jsonb;
  v_score numeric;
  v_total int;
  v_pending boolean;
  v_pass int;
  v_pct numeric;
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

  update attempts set detail = v_detail, score = v_score, total = v_total, pct = v_pct,
                      passed = v_pct >= v_pass, submitted_at = now()
  where id = p_attempt;

  return json_build_object('score', v_score, 'total', v_total, 'pct', v_pct,
                           'passed', v_pct >= v_pass, 'pass_pct', v_pass, 'review_pending', coalesce(v_pending, false));
end $$;

-- Trainer's mark (0–1) for one descriptive answer; the attempt's score and pass/fail follow it.
create function review_answer(p_attempt uuid, p_index int, p_mark numeric, p_feedback text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  a attempts;
  v_detail jsonb;
  v_score numeric;
  v_pass int;
  v_pct numeric;
begin
  if not is_admin() then raise exception 'Only admins can review answers'; end if;
  if p_mark is null or p_mark < 0 or p_mark > 1 then raise exception 'Mark must be between 0 and 1'; end if;
  select * into a from attempts where id = p_attempt and submitted_at is not null for update;
  if not found then raise exception 'Attempt not found'; end if;
  if a.detail -> p_index ->> 'kind' is distinct from 'essay' then raise exception 'Not a descriptive answer'; end if;

  v_detail := jsonb_set(a.detail, array[p_index::text], (a.detail -> p_index) || jsonb_build_object(
    'mark', p_mark, 'ok', p_mark >= 1, 'review', 'done', 'feedback', nullif(trim(p_feedback), ''),
    'reviewed_by', auth.uid(), 'reviewed_at', now()));
  select sum(coalesce((x ->> 'mark')::numeric, case when (x ->> 'ok')::boolean then 1 else 0 end)) into v_score
  from jsonb_array_elements(v_detail) x;
  select pass_pct into v_pass from modules where id = a.module_id;
  v_pct := round(100.0 * v_score / greatest(a.total, 1), 2);

  update attempts set detail = v_detail, score = v_score, pct = v_pct, passed = v_pct >= v_pass where id = p_attempt;
  return json_build_object('score', v_score, 'total', a.total, 'pct', v_pct, 'passed', v_pct >= v_pass);
end $$;

-- Descriptive answers for the admin Reviews page (pending first by default)
create function admin_reviews(p_pending_only boolean default true)
returns table (attempt_id uuid, idx int, user_id uuid, learner text, training text, chapter_no int, chapter text,
               question text, answer text, keywords jsonb, matched jsonb, auto_mark numeric, mark numeric,
               model_answer text, review text, feedback text, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, (d.n - 1)::int, a.user_id, p.full_name, c.title, m.seq, m.title,
         d.v ->> 'question', d.v ->> 'chosen', d.v -> 'accepted', d.v -> 'matched',
         (d.v ->> 'auto_mark')::numeric, (d.v ->> 'mark')::numeric, d.v ->> 'model_answer',
         d.v ->> 'review', d.v ->> 'feedback', a.submitted_at
  from attempts a
  cross join lateral jsonb_array_elements(a.detail) with ordinality d(v, n)
  join profiles p on p.id = a.user_id
  join modules m on m.id = a.module_id
  join courses c on c.id = m.course_id
  where is_admin() and a.submitted_at is not null and d.v ->> 'kind' = 'essay'
    and (not p_pending_only or d.v ->> 'review' = 'pending')
  order by a.submitted_at
$$;

-- learner history now carries part marks and whether a trainer review is still pending
drop function my_attempts();
create function my_attempts()
returns table (id uuid, course_id uuid, module_id uuid, chapter text, score numeric, total int,
               pct numeric, passed boolean, submitted_at timestamptz, review_pending boolean)
language sql stable security definer set search_path = public as $$
  select a.id, m.course_id, a.module_id, m.title, a.score, a.total, a.pct, a.passed, a.submitted_at,
         exists (select 1 from jsonb_array_elements(a.detail) x where x ->> 'review' = 'pending')
  from attempts a
  join modules m on m.id = a.module_id
  where a.user_id = auth.uid() and a.submitted_at is not null
  order by a.submitted_at desc
$$;

-- Sheet: descriptive answers show the model answer, review status and trainer feedback
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
             a.submitted_at as submitted
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
