-- Question levels. Videos are the same for everyone; each learner's test is drawn
-- from their level:  easy = agents,  moderate = executives,  hard = managers.
-- Run once in Supabase → SQL Editor, after assignments.sql.

alter table questions add column level text not null default 'moderate' check (level in ('easy', 'moderate', 'hard'));
alter table enrollments add column level text not null default 'moderate' check (level in ('easy', 'moderate', 'hard'));
alter table employee_invites add column level text not null default 'moderate' check (level in ('easy', 'moderate', 'hard'));
update enrollments e set level = 'easy' from profiles p where p.id = e.user_id and p.user_type = 'agent';

-- agents → easy; candidates pick executive (moderate) or manager (hard)
drop function register(text, text, text, uuid);
create function register(p_name text, p_phone text, p_type text, p_course uuid, p_level text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_type not in ('candidate', 'agent') then raise exception 'Employees are added by admin'; end if;
  if not exists (select 1 from courses where id = p_course and published and audience in (p_type, 'all')) then
    raise exception 'Invalid course';
  end if;
  insert into profiles (id, email, full_name, phone, user_type)
  values (auth.uid(), auth.jwt() ->> 'email', trim(p_name), p_phone, p_type);
  insert into enrollments (user_id, course_id, level)
  values (auth.uid(), p_course, case when p_type = 'agent' then 'easy' when p_level = 'hard' then 'hard' else 'moderate' end);
end $$;

create or replace function claim_invite() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  i employee_invites;
begin
  select * into i from employee_invites where email = lower(auth.jwt() ->> 'email');
  if not found or auth.uid() is null or exists (select 1 from profiles where id = auth.uid()) then
    return false;
  end if;
  insert into profiles (id, email, full_name, phone, user_type)
  values (auth.uid(), i.email, i.full_name, i.phone, 'employee');
  insert into enrollments (user_id, course_id, level)
  select auth.uid(), c, i.level from unnest(i.course_ids) c where exists (select 1 from courses where id = c);
  delete from employee_invites where email = i.email;
  return true;
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
begin
  if not module_unlocked(p_module) then raise exception 'Module locked'; end if;

  select id, question_ids into v_id, v_ids from attempts
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
    insert into attempts (user_id, module_id, question_ids)
    values (auth.uid(), p_module, v_ids) returning id into v_id;
  end if;

  return json_build_object(
    'attempt_id', v_id,
    'questions', (select json_agg(json_build_object('id', q.id, 'kind', q.kind, 'text', q.text, 'options', q.options)
                                  order by array_position(v_ids, q.id))
                  from questions q where q.id = any(v_ids)));
end $$;
