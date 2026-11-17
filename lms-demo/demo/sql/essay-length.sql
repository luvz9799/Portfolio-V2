-- Word limits for descriptive answers (e.g. 100–150 words). Run once in Supabase → SQL Editor, after exam.sql.
-- The limit is checked in the browser before submit; the trainer sees the word count while reviewing.

alter table questions add column min_words int check (min_words between 1 and 2000);
alter table questions add column max_words int check (max_words between 1 and 2000);
alter table questions add constraint questions_words check (min_words is null or max_words is null or max_words >= min_words);

-- the paper now carries each question's word limit
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
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options,
                                                    'min_words', q.min_words, 'max_words', q.max_words)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;
