/* Sample data for the portfolio demo. Content is written as superuser; every learner's history
 * (attempts, scores, warnings, reviews) is produced by calling the app's real database functions
 * as that learner, so it has exactly the shape the live app produces. */
window.DEMO_SEED = async function ({ db, rpcAs, ID }) {
  const q = (sql, p) => db.query(sql, p);
  const u = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const C = { sales: u(101), agent: u(102), staff: u(103) };
  const M = { m1: u(201), m2: u(202), m3: u(203), m4: u(204), a1: u(211), a2: u(212), s1: u(221) };

  // ---------- people ----------
  const people = [
    [ID.admin, 'admin.demo@example.com', 'Demo Admin', '9876500100', 'employee', 'admin', 'active', 45],
    [ID.rahul, 'rahul.demo@example.com', 'Rahul Verma', '9876500101', 'candidate', 'learner', 'active', 6],
    [u(2), 'priya.demo@example.com', 'Priya Sharma', '9876500102', 'candidate', 'learner', 'shortlisted', 12],
    [u(3), 'mohit.demo@example.com', 'Mohit Jain', '9876500103', 'candidate', 'learner', 'active', 4],
    [u(4), 'kavita.demo@example.com', 'Kavita Meena', '9876500104', 'agent', 'learner', 'active', 9],
    [u(5), 'deepak.demo@example.com', 'Deepak Singh', '9876500105', 'employee', 'learner', 'active', 15],
    [u(6), 'anjali.demo@example.com', 'Anjali Gupta', '9876500106', 'candidate', 'learner', 'rejected', 20],
    [u(7), 'sanjay.demo@example.com', 'Sanjay Kumar', '9876500107', 'candidate', 'learner', 'active', 1],
  ];
  for (const [id, email, name, phone, type, role, st, days] of people) {
    await q(`insert into auth.users values ($1, $2)`, [id, email]);
    await q(`insert into profiles (id, email, full_name, phone, user_type, role, status, camera_exempt, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, true, now() - make_interval(days => $8))`, [id, email, name, phone, type, role, st, days]);
  }
  // Sanjay's laptop camera is broken: he asked for approval, which waits in the admin's queue
  await q(`update profiles set camera_exempt = false, camera_request = 'My laptop camera does not work. I can join from the office tomorrow.', camera_request_at = now() - interval '3 hours' where id = $1`, [u(7)]);
  await q(`update profiles set notes = 'Strong on need analysis. Interview booked for Monday.' where id = $1`, [u(2)]);

  // ---------- trainings ----------
  await q(`insert into courses (id, title, category, audience, description, published, certificate) values
    ($1, 'Sales Executive Foundation', 'Sales Executive', 'candidate', 'From the company and its colonies to closing a booking: the first training every new sales executive completes.', true, true),
    ($2, 'Agent Onboarding', 'Channel Partner', 'agent', 'How to work with Akshardham as a property agent.', true, false),
    ($3, 'Telecaller Playbook', 'Telecaller', 'employee', 'Call opening, rapport, need questions and the next step.', true, false)`, [C.sales, C.agent, C.staff]);
  const mod = (id, c, seq, title, desc, vid, perTest, limit, warn) => q(
    `insert into modules (id, course_id, seq, title, description, videos, pass_pct, questions_per_test, time_limit_min, max_warnings, published)
     values ($1, $2, $3, $4, $5, $6, 80, $7, $8, $9, true)`, [id, c, seq, title, desc, `https://youtu.be/${vid}`, perTest, limit, warn]);
  await mod(M.m1, C.sales, 1, 'Company and projects', 'Who we are, our colonies and what a buyer receives.', 'demoVideo01', 3, 5, 3);
  await mod(M.m2, C.sales, 2, 'Understanding customer needs', 'Budget, location and plot size: asking the right questions, then listening.', 'demoVideo02', 3, 10, 3);
  await mod(M.m3, C.sales, 3, 'Running a site visit', 'Before, during and after the visit.', 'demoVideo03', 3, 5, 3);
  await mod(M.m4, C.sales, 4, 'Closing and booking', 'Buying signals, token amount and the booking form.', 'demoVideo04', 3, 5, 3);
  await mod(M.a1, C.agent, 1, 'Working with us', 'Commission, site visits and how leads are shared.', 'agentVideo1', 3, 0, 0);
  await mod(M.a2, C.agent, 2, 'Our projects', 'What to tell a customer about each colony.', 'agentVideo2', 3, 0, 0);
  await mod(M.s1, C.staff, 1, 'Call opening', 'The first 30 seconds of a call.', 'staffVideo1', 3, 0, 0);

  // ---------- question bank (6 per level per chapter, so a retry gets a fresh paper) ----------
  let rot = 0; // move the right answer around, so it isn't always option A
  const single = (m, level, text, options, correct) => {
    const k = rot++ % options.length;
    const o = options.slice(k).concat(options.slice(0, k));
    return { m, level, kind: 'single', text, options: o, correct: (correct - k + options.length) % options.length };
  };
  const bank = [];
  const topics = {
    [M.m1]: ['our projects', 'plot documents', 'a colony\'s location'],
    [M.m2]: ['a customer\'s needs', 'the customer\'s budget', 'a first call'],
    [M.m3]: ['a site visit', 'the visit plan', 'a family visit'],
    [M.m4]: ['closing a sale', 'the token amount', 'the booking form'],
    [M.a1]: ['agent commission', 'shared leads', 'a joint site visit'],
    [M.a2]: ['our colonies', 'plot sizes', 'plot pricing'],
    [M.s1]: ['a call opening', 'building rapport', 'a follow-up call'],
  };
  for (const [m, [a, b, c]] of Object.entries(topics)) {
    for (const lvl of ['easy', 'moderate', 'hard']) {
      bank.push(
        single(m, lvl, `Which step should come first when talking about ${a}?`, ['Understand the customer\'s need', 'Quote the lowest price', 'Skip to the booking form', 'End the call quickly'], 0),
        single(m, lvl, `A customer is unsure about ${b}. What is the best response?`, ['Ask a question to understand why', 'Change the topic', 'Promise a discount', 'Ignore it'], 0),
        single(m, lvl, `What should you always confirm before moving on from ${c}?`, ['The next step and its date', 'Your own target', 'The weather', 'Nothing'], 0),
        single(m, lvl, `Which of these builds trust fastest during ${a}?`, ['Talking only about price', 'Accurate, honest answers', 'Pushing for a quick decision', 'Avoiding questions'], 1),
        single(m, lvl, `After a conversation about ${b}, where should the notes go?`, ['Nowhere', 'A personal diary', 'The CRM, the same day', 'A WhatsApp status'], 2),
        single(m, lvl, `What is the main goal when explaining ${c}?`, ['Sound impressive', 'Help the customer decide with clear facts', 'Finish quickly', 'Avoid follow-up'], 1),
      );
    }
  }
  // other question types in chapter 2
  bank.push(
    { m: M.m2, level: 'moderate', kind: 'multi', text: 'Which details should you capture on the first call? (Select all that apply)', options: ['Budget', 'Preferred location', 'Favourite cricket team', 'Plot size'], accepted: [0, 1, 3] },
    { m: M.m2, level: 'moderate', kind: 'text', text: 'One word: what should a salesperson do more of than talking?', options: [], accepted: ['listen', 'listening'] },
    { m: M.m2, level: 'moderate', kind: 'essay', text: 'A customer says "I will think about it." In 40–120 words, explain what you would ask next and why.', options: [], accepted: ['budget', 'family', 'visit', 'concern'], model_answer: 'Thank them, then ask what they would like to think over: budget, location or the family\'s view. Offer a site visit with the family so the decision is made together, and agree a date to follow up.', min_words: 40, max_words: 120 },
  );
  for (const x of bank) {
    await q(`insert into questions (module_id, level, kind, text, options, correct, accepted, model_answer, min_words, max_words)
             values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10)`,
      [x.m, x.level, x.kind, x.text, JSON.stringify(x.options), x.correct ?? null, x.accepted ? JSON.stringify(x.accepted) : null, x.model_answer ?? null, x.min_words ?? null, x.max_words ?? null]);
  }

  // ---------- checkpoints inside videos, and a practical task ----------
  await q(`insert into video_checkpoints (module_id, video_id, at_sec, text, options, correct, explanation) values
    ($1, 'demoVideo01', 20, 'Which cities are our colonies in?', '["Jaipur and Udaipur","Jhalawar and Kota","Delhi and Mumbai"]', 1, 'Our colonies are in Jhalawar and Kota.'),
    ($2, 'demoVideo02', 15, 'What should you understand before suggesting a plot?', '["The customer''s need","Your monthly target","Which plot is cheapest"]', 0, 'Needs first: budget, location and plot size decide what you suggest.'),
    ($2, 'demoVideo02', 40, 'The customer goes quiet after hearing the price. What do you do?', '["Lower the price at once","Ask what they had in mind","Change the subject"]', 1, 'Ask, then listen: silence usually hides a concern you need to hear.')`, [M.m1, M.m2]);
  await q(`insert into tasks (module_id, instructions, submit_type, model_answer) values ($1,
    'Write the three questions you would ask a new customer on the first call, and one line on why each matters.', 'text',
    '1. What budget are you planning for? (keeps suggestions realistic)  2. Which area do you prefer? (narrows the colonies)  3. Who else will decide? (plan the site visit with them)')`, [M.m2]);

  // ---------- enrolments ----------
  const enroll = [[ID.rahul, C.sales, 'moderate'], [u(2), C.sales, 'moderate'], [u(3), C.sales, 'moderate'], [u(6), C.sales, 'moderate'],
    [u(7), C.sales, 'moderate'], [u(4), C.agent, 'easy'], [u(5), C.staff, 'hard']];
  for (const [uid, c, lvl] of enroll) await q(`insert into enrollments (user_id, course_id, level) values ($1, $2, $3)`, [uid, c, lvl]);
  await q(`insert into employee_invites (email, full_name, phone, course_ids, level) values ('new.joiner@example.com', 'Neha Rathore', '9876500108', $1, 'moderate')`, [[C.staff]]);

  // ---------- learner history, made with the real functions ----------
  const email = uid => people.find(p => p[0] === uid)[1];
  const vids = { [M.m1]: 'demoVideo01', [M.m2]: 'demoVideo02', [M.m3]: 'demoVideo03', [M.m4]: 'demoVideo04', [M.a1]: 'agentVideo1', [M.a2]: 'agentVideo2', [M.s1]: 'staffVideo1' };
  async function watched(uid, m) {
    await q(`insert into video_progress (user_id, module_id, video_id, max_sec, duration, completed) values ($1, $2, $3, 60, 60, true)`, [uid, m, vids[m]]);
    const cps = (await q(`select id, correct from video_checkpoints where module_id = $1`, [m])).rows;
    for (const [i, cp] of cps.entries())
      await q(`insert into checkpoint_answers (checkpoint_id, user_id, chosen, correct, response_ms) values ($1, $2, $3, true, $4)`, [cp.id, uid, cp.correct, 4000 + i * 2500 + Math.round(Math.random() * 3000)]);
  }
  async function test(uid, m, { right = true, events = [], essay, needEssay = false } = {}) {
    let paper = await rpcAs(uid, email(uid), 'start_attempt', { p_module: m });
    // ponytail: papers are random; for the one sample that must show a descriptive answer, redraw until it has one
    for (let n = 0; needEssay && n < 40; n++) {
      const kinds = (await q(`select kind from questions where id = any($1::uuid[])`, [paper.questions.map(x => x.id)])).rows;
      if (kinds.some(k => k.kind === 'essay')) break;
      await q(`delete from attempts where id = $1`, [paper.attempt_id]);
      paper = await rpcAs(uid, email(uid), 'start_attempt', { p_module: m });
    }
    const ids = paper.questions.map(x => x.id);
    const rows = (await q(`select id, kind, correct, accepted from questions where id = any($1::uuid[])`, [ids])).rows;
    const answers = {};
    for (const r of rows) {
      if (r.kind === 'single') answers[r.id] = right ? r.correct : (r.correct + 1) % 3;
      else if (r.kind === 'multi') answers[r.id] = right ? r.accepted : [r.accepted[0]];
      else if (r.kind === 'text') answers[r.id] = right ? r.accepted[0] : 'talk';
      else answers[r.id] = essay || 'I would thank the customer and ask what they want to think over, whether it is the budget, the location or the family\'s view. Then I would invite the whole family for a site visit so the decision is made together, and agree a clear date to follow up by phone.';
    }
    for (const t of events) await rpcAs(uid, email(uid), 'log_attempt_event', { p_attempt: paper.attempt_id, p_type: t });
    await rpcAs(uid, email(uid), 'submit_attempt', { p_attempt: paper.attempt_id, p_answers: answers });
    return paper.attempt_id;
  }
  async function review(uid, mark, feedback) {
    const pending = await rpcAs(ID.admin, 'admin.demo@example.com', 'admin_reviews', { p_pending_only: true });
    for (const r of pending.filter(r => r.user_id === uid))
      await rpcAs(ID.admin, 'admin.demo@example.com', 'review_answer', { p_attempt: r.attempt_id, p_index: r.idx, p_mark: mark, p_feedback: feedback });
  }
  async function task(uid, m, text) { await rpcAs(uid, email(uid), 'submit_task', { p_module: m, p_answer: text }); }
  const backdate = (uid, days) => q(`update attempts set started_at = started_at - make_interval(days => $2), submitted_at = submitted_at - make_interval(days => $2)
    where user_id = $1 and started_at > now() - interval '1 minute'`, [uid, days]);

  // Rahul (this demo's learner): failed chapter 1 once, passed on a fresh paper. Chapter 2 is next.
  await watched(ID.rahul, M.m1);
  await test(ID.rahul, M.m1, { right: false }); await backdate(ID.rahul, 3);
  await test(ID.rahul, M.m1); await backdate(ID.rahul, 2);

  // Priya: every chapter done, her descriptive answer reviewed by the trainer → certificate
  for (const [i, m] of [M.m1, M.m2, M.m3, M.m4].entries()) {
    await watched(u(2), m);
    if (m === M.m2) await task(u(2), m, '1. What budget are you planning for? It keeps my suggestions realistic. 2. Which area do you prefer? 3. Who else is part of the decision, so I can invite them to the site visit.');
    await test(u(2), m, { needEssay: m === M.m2 }); await review(u(2), 1, 'Clear plan and a dated follow-up. Well done.'); await backdate(u(2), 10 - i * 2);
  }
  // Mohit: chapter 1 passed; chapter 2 left the page and tried to copy during the test, essay waits for review
  await watched(u(3), M.m1); await test(u(3), M.m1); await backdate(u(3), 3);
  await watched(u(3), M.m2); await task(u(3), M.m2, 'Budget, location and family.');
  await test(u(3), M.m2, { events: ['left_page', 'copy'], essay: 'I will ask about the budget and call again later.', needEssay: true }); await backdate(u(3), 1);
  // Kavita (agent, easy level) and Deepak (employee, hard level)
  await watched(u(4), M.a1); await test(u(4), M.a1); await backdate(u(4), 5);
  await watched(u(5), M.s1); await test(u(5), M.s1); await backdate(u(5), 7);
  // Anjali: two failed attempts
  await watched(u(6), M.m1); await test(u(6), M.m1, { right: false }); await backdate(u(6), 15);
  await test(u(6), M.m1, { right: false, events: ['exit_fullscreen'] }); await backdate(u(6), 14);

};
