let me; // current profile
let justJoined = false; // show the welcome card once, right after registration / first employee login

const ytId = url => (url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/) || [])[1];
const firstName = () => (me.full_name || '').split(/\s+/)[0];
const hi = t => '';  // demo: English only // the key instructions in Hindi too
const HELP_PHONE = '910000000000'; // WhatsApp for learners who are stuck
function helpBtn(where, label = 'Help on WhatsApp') {
  const who = me ? `${me.full_name} (${me.phone})` : '';
  const text = `Hello, I am ${who} and I am stuck at "${where}" in the Akshardham Academy LMS. Please help.`;
  return `<a class="btn btn-sm btn-wa" href="https://wa.me/${HELP_PHONE}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon('whatsapp', 'sm')} ${label}</a>`;
}
// start_attempt's "no questions" message was Hinglish in early schema versions
const friendly = msg => /questions nahi|no questions/i.test(msg) ? 'This chapter has no test questions yet. Please contact the admin.' : msg;

async function render() {
  examStop();
  videoStop();
  camStop();
  try {
    const { user, profile } = await getSessionProfile();
    if (!user) return viewLogin();
    if (!profile) {
      const { data: claimed, error } = await sb.rpc('claim_invite'); // employee pre-added by admin?
      if (error) throw error;
      if (claimed) { justJoined = true; return render(); }
      return viewRegister(user.email);
    }
    me = profile;
    if (me.status === 'inactive') return show(`<div class="card narrow empty">${icon('lock')}<h2>Account inactive</h2><p>Please contact the admin.</p></div>`, me.full_name);
    const [, page, a, b] = location.hash.split('/'); // #/course/<id>  #/module/<courseId>/<moduleId>
    const uuid = /^[0-9a-f-]{36}$/;
    if (page === 'course' && uuid.test(a)) return await viewDashboard(a);
    if (page === 'module' && uuid.test(a) && uuid.test(b)) return await viewModule(a, b);
    if (page === 'certificate' && uuid.test(a)) return await viewCertificate(a, b === 'preview');
    return await viewDashboard();
  } catch (e) { fail(e); }
}

// ---------- registration ----------

async function viewRegister(email) {
  const { data: courses, error } = await sb.from('courses').select('id,title,category,audience').eq('published', true).order('category').order('title');
  if (error) return fail(error);
  window._courses = courses;
  show(`
    <form class="card narrow" onsubmit="register(event)" novalidate>
      <span class="eyebrow">${icon('cap', 'sm')} Registration</span>
      <h1>One last step</h1>
      <p class="muted">Tell us a little about yourself. You only need to do this once.${hi('अपने बारे में थोड़ी जानकारी दें। यह सिर्फ एक बार करना है।')}</p>
      <div class="field">
        <span class="label">I am a <span class="req">*</span></span>
        <div class="opt-grid" role="radiogroup">
          <label class="opt"><input type="radio" name="type" value="candidate" checked onchange="fillCourses()">
            <span class="opt-ico">${icon('briefcase')}</span><span><strong>Candidate</strong><span class="small">Applying for a job</span></span></label>
          <label class="opt"><input type="radio" name="type" value="agent" onchange="fillCourses()">
            <span class="opt-ico">${icon('handshake')}</span><span><strong>Agent</strong><span class="small">Want to partner with us</span></span></label>
        </div>
      </div>
      <div class="field" id="r-role-field">
        <span class="label">Applying for <span class="req">*</span></span>
        <div class="opt-grid" role="radiogroup">
          <label class="opt"><input type="radio" name="role" value="moderate" checked><span><strong>Sales Executive</strong><span class="small">Customer calls, site visits, sales</span></span></label>
          <label class="opt"><input type="radio" name="role" value="hard"><span><strong>Manager</strong><span class="small">Lead a team or a project</span></span></label>
        </div>
      </div>
      <div class="field">
        <label for="r-name">Full name<span class="req">*</span></label>
        <input id="r-name" type="text" required minlength="2" maxlength="80" autocomplete="name">
      </div>
      <div class="field">
        <label for="r-phone">Mobile number<span class="req">*</span></label>
        <input id="r-phone" type="tel" required pattern="[6-9][0-9]{9}" maxlength="10" inputmode="numeric" autocomplete="tel-national" placeholder="98XXXXXXXX">
        <p class="help">10 digits, without +91</p>
      </div>
      <div class="field">
        <label for="r-course">Position / Training<span class="req">*</span></label>
        <select id="r-course" required></select>
      </div>
      <p id="r-err" class="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Register ${icon('right')}</button>
      <div class="notice info" style="margin-top:16px">${icon('briefcase')}
        <span>Akshardham employee? You don't need to register. Ask the admin to add your Gmail
        (<strong>${esc(email)}</strong>) to the LMS, then sign in with this account.
        ${hi('अक्षरधाम के कर्मचारी हैं? रजिस्टर न करें — admin से अपना Gmail LMS में जुड़वाएँ, फिर इसी Gmail से login करें।')}</span></div>
    </form>`);
  fillCourses();
}

function fillCourses() {
  const type = document.querySelector('input[name=type]:checked').value;
  document.getElementById('r-role-field').hidden = type !== 'candidate'; // agents always take the Easy test
  const list = window._courses.filter(c => c.audience === 'all' || c.audience === type);
  document.getElementById('r-course').innerHTML = list.length
    ? list.map(c => `<option value="${c.id}">${esc(c.category)} — ${esc(c.title)}</option>`).join('')
    : `<option value="">No training available yet</option>`;
}

async function register(e) {
  e.preventDefault();
  const form = e.target, err = document.getElementById('r-err');
  const bad = [...form.querySelectorAll('input, select')].find(el => !el.checkValidity());
  if (bad) {
    err.textContent = bad.id === 'r-phone' ? 'Enter a valid 10-digit mobile number (starting with 6–9).'
      : bad.id === 'r-course' ? 'No training is open for registration yet. Please try again later.' : 'Please fill in all the details.';
    return bad.focus();
  }
  const btn = e.submitter; btn.disabled = true; err.textContent = '';
  const { error } = await sb.rpc('register', {
    p_name: document.getElementById('r-name').value,
    p_phone: document.getElementById('r-phone').value,
    p_type: document.querySelector('input[name=type]:checked').value,
    p_course: document.getElementById('r-course').value,
    p_level: document.querySelector('input[name=role]:checked').value,
  });
  if (error) {
    btn.disabled = false;
    err.textContent = /phone/.test(error.message) ? 'This mobile number is already registered.' : error.message;
    return;
  }
  justJoined = true;
  render();
}

// ---------- learner views ----------

function selectionSteps() {
  const last = me.user_type === 'candidate'
    ? ['Final interview', 'Clear every chapter and our team will call you']
    : ['Get onboarded', 'Clear every chapter and our team will reach out'];
  const steps = [['Watch the video', 'Each chapter, carefully'], ['Take the test', 'Score 80% to pass'], ['Retry if needed', 'With fresh questions each time'], last];
  return `<section class="hero">
    <span class="eyebrow">${icon('target', 'sm')} ${me.user_type === 'candidate' ? 'Selection process' : 'What happens next'}</span>
    <ol class="steps">${steps.map(([t, s], i) => `<li><span class="n">${i + 1}</span><div><strong>${t}</strong><span>${s}</span></div></li>`).join('')}</ol>
  </section>`;
}

const STATE = {
  passed: ['check', 'b-ok', 'Completed'],
  available: ['play', 'b-blue', 'Up next'],
  locked: ['lock', '', 'Locked'],
};
let dash = { filter: 'all' }; // dashboard data + the chapter filter the learner picked

// #/ and #/course/<id> both land here; <id> picks which training (topic) is open below
async function viewDashboard(courseId) {
  // own rows only: an admin's RLS can read every learner's enrollments
  const { data, error } = await sb.from('enrollments').select('level,courses(*)').eq('user_id', me.id);
  if (error) throw error;
  const courses = data.filter(r => r.courses).map(r => ({ ...r.courses, level: r.level }));
  if (!courses.length) return show(`
    <section class="hero"><span class="eyebrow">${icon('cap', 'sm')} Akshardham Academy</span>
      <h1>Welcome, ${esc(firstName())}</h1><p>Your dashboard will fill up as soon as a training is assigned to you.</p></section>
    <div class="card empty">${icon('book')}<h2>No training yet</h2><p>${me.role === 'admin'
      ? `You're an admin and not enrolled in any training. To see a training as a learner, open <a href="admin.html#/user/${me.id}">your own page in the admin panel</a> and assign it to yourself.`
      : `The admin will assign a training to you soon.${hi('Admin जल्द ही आपको ट्रेनिंग देंगे। ज़्यादा देर हो जाए तो हमें WhatsApp करें।')}</p><p>${helpBtn('No training yet')}`}</p></div>`, me.full_name);

  const [mods, hist] = await Promise.all([
    Promise.all(courses.map(c => sb.rpc('my_modules', { p_course: c.id }).then(r => { if (r.error) throw r.error; return r.data; }))),
    sb.rpc('my_attempts'), // older databases may not have it yet: the history card just hides
  ]);
  courses.forEach((c, i) => { c.mods = mods[i]; });
  const course = courses.find(c => c.id === courseId) || courses[0];
  if (dash.course?.id !== course.id) dash.filter = 'all';
  dash = { ...dash, courses, course, history: hist.error ? null : hist.data };
  const reviewed = newlyReviewed(dash.history || []);

  const all = courses.flatMap(c => c.mods);
  const done = all.filter(m => m.state === 'passed').length;
  const pct = all.length ? Math.round(100 * done / all.length) : 0;
  const tests = all.reduce((s, m) => s + Number(m.attempt_count || 0), 0);
  const tried = all.filter(m => m.attempt_count > 0);
  const avgBest = tried.length ? Math.round(tried.reduce((s, m) => s + Number(m.best_pct), 0) / tried.length) : null;
  // continue in the open training first, then any other
  const nextCourse = [course, ...courses].find(c => c.mods.some(m => m.state === 'available'));
  const next = nextCourse && nextCourse.mods.findIndex(m => m.state === 'available');
  const cDone = course.mods.filter(m => m.state === 'passed').length;
  const cPct = course.mods.length ? Math.round(100 * cDone / course.mods.length) : 0;
  const finished = all.length && done === all.length;
  const welcome = justJoined && course.mods.length;
  justJoined = false;
  const tile = (ic, cls, val, lbl, sub) => `<div class="stat"><span class="ico ${cls}">${icon(ic)}</span><div><div class="val">${val}</div><div class="lbl">${lbl}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`;

  show(`
    ${welcome ? `<section class="card welcome">
      <span class="welcome-ico">${icon('award', 'lg')}</span>
      <h1>Congratulations, ${esc(firstName())}!</h1>
      <p>You're registered for <strong>${esc(course.title)}</strong>. Here's how it works:</p>
      <ol>
        <li>Watch each chapter's video carefully.</li>
        <li>Take the short test. Score ${course.mods[0].pass_pct}% to pass.</li>
        <li>Didn't pass? Rewatch and retry with fresh questions.</li>
        <li>Clear all ${course.mods.length} chapters to finish.</li>
      </ol>
      <div class="row"><a class="btn btn-primary" href="#/module/${course.id}/${course.mods[0].id}">${icon('play', 'sm')} Start Chapter 1</a></div>
    </section>` : ''}
    ${reviewed.map(h => `<div class="notice ${h.passed ? 'ok' : ''}">${icon(h.passed ? 'award' : 'clipboard')}<span>
      <strong>Your trainer has checked your test: ${esc(h.chapter)}.</strong> Final result: <strong>${h.passed ? 'PASS' : 'FAIL'} (${Math.round(h.pct)}%)</strong>.${h.passed ? '' : ' Watch the video again and retake the test.'}
      ${hi(`Trainer ने आपका टेस्ट चेक कर लिया है: <strong>${h.passed ? 'पास' : 'फेल'} (${Math.round(h.pct)}%)</strong>।${h.passed ? '' : ' वीडियो दोबारा देखें और टेस्ट फिर से दें।'}`)}</span></div>`).join('')}
    ${me.status === 'shortlisted' && me.user_type !== 'employee' ? `<div class="notice ok">${icon('award')}<span><strong>You've been shortlisted!</strong> Our team will contact you for the next step.</span></div>` : ''}

    <section class="hero dash-hero">
      <div>
        <span class="eyebrow">${icon('cap', 'sm')} My dashboard</span>
        <h1>${finished ? 'Well done' : done ? 'Welcome back' : 'Welcome'}, ${esc(firstName())}</h1>
        <p>${finished ? `You've completed every chapter.${me.user_type !== 'employee' ? ' Our team will contact you soon.' : ''}`
          : `${done} of ${all.length} chapters complete across ${courses.length} training${courses.length > 1 ? 's' : ''}. Keep going!`}</p>
        ${nextCourse ? `<a class="btn btn-gold" href="#/module/${nextCourse.id}/${nextCourse.mods[next].id}">${icon('play', 'sm')} ${done ? 'Continue' : 'Start'}: Chapter ${next + 1}${courses.length > 1 ? ` · ${esc(nextCourse.title)}` : ''}</a>` : ''}
      </div>
      <div class="ring" role="img" aria-label="${pct}% complete" style="background:conic-gradient(var(--gold) ${pct}%, rgba(255,255,255,.16) 0)"><div class="num">${pct}%</div></div>
    </section>

    <div class="stats stagger">
      ${tile('check', 'ok', done, 'Chapters completed', `of ${all.length}`)}
      ${tile('clock', 'gold', all.length - done, 'Chapters remaining', finished ? 'All done!' : '')}
      ${tile('clipboard', '', tests, 'Tests taken', '')}
      ${tile('target', 'ok', avgBest == null ? '—' : avgBest + '%', 'Average best score', tried.length ? `across ${tried.length} chapter${tried.length > 1 ? 's' : ''}` : 'No tests yet')}
    </div>

    <section class="card">
      <div class="card-head"><h2>${icon('book')} My trainings</h2></div>
      ${courses.length > 1 ? `<div class="seg" role="group" aria-label="Choose training" style="margin-bottom:16px">${courses.map(c => {
        const d = c.mods.filter(m => m.state === 'passed').length;
        return `<a href="#/course/${c.id}" class="${c === course ? 'on' : ''}" ${c === course ? 'aria-current="page"' : ''}>${esc(c.title)} <span class="sub">${d}/${c.mods.length}</span></a>`;
      }).join('')}</div>` : ''}
      <span class="badge b-gold">${esc(course.category)}</span> ${course.level ? `<span class="badge">${icon('target')} ${({ easy: 'Agent', moderate: 'Executive', hard: 'Manager' })[course.level]} level test</span>` : ''}
      <h3 style="margin:8px 0 4px">${esc(course.title)}</h3>
      ${course.description ? `<p class="muted small">${esc(course.description)}</p>` : ''}
      <div class="row" style="justify-content:space-between;margin:12px 0 8px"><strong>${cDone} of ${course.mods.length} chapters complete</strong><span class="num">${cPct}%</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${cPct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(course.title)} progress"><i style="width:${cPct}%"></i></div>
      ${course.certificate && course.mods.length && cDone === course.mods.length ? `<div class="notice ok" style="margin-top:16px">${icon('award')}<span><strong>Training complete!</strong> Your certificate is ready.${hi('ट्रेनिंग पूरी! आपका प्रमाण पत्र तैयार है।')}</span>
        <a class="btn btn-sm btn-primary" style="margin-left:auto" href="#/certificate/${course.id}">${icon('award', 'sm')} Certificate</a></div>` : ''}
      ${course.mods.length ? `
      <div class="toolbar" style="margin:20px 0 16px">
        <div class="seg" role="group" aria-label="Filter chapters" id="ch-filter" style="flex:0 1 auto"></div>
        <select aria-label="Jump to a chapter" onchange="if (this.value) location.hash = this.value">
          <option value="">Jump to a chapter…</option>
          ${course.mods.map((m, i) => `<option value="#/module/${course.id}/${m.id}" ${m.state === 'locked' ? 'disabled' : ''}>Chapter ${i + 1}: ${esc(m.title)}${m.state === 'locked' ? ' (locked)' : m.state === 'passed' ? ' ✓' : ''}</option>`).join('')}
        </select>
      </div>
      <ol class="chapters" id="chapters"></ol>` : `<div class="empty">${icon('book')}<p>No chapters have been added to this training yet.</p></div>`}
    </section>

    ${course.mods.length ? `<div class="chart-grid">
      <section class="card">
        <div class="card-head"><h2>${icon('chart')} Scores by chapter</h2><span class="muted small">Your best score · line = pass mark</span></div>
        <div class="funnel">${course.mods.map((m, i) => {
          const best = m.attempt_count ? Math.round(m.best_pct) : null;
          return `<div class="f-row" tabindex="0" data-tip="Chapter ${i + 1}: ${m.has_test === false ? 'no test (task only)' : best == null ? 'not taken yet' : `best ${best}%, pass mark ${m.pass_pct}%`}">
            <span class="f-lbl" title="${esc(m.title)}">Ch ${i + 1}</span>
            <div class="f-track score-track"><i style="width:${best || 0}%"></i><b class="pass-mark" style="left:${m.pass_pct}%" aria-hidden="true"></b></div>
            <span class="f-val num">${best == null ? '<span class="sub">—</span>' : `${best}%`} ${m.state === 'passed' ? icon('check', 'sm') : ''}</span>
          </div>`;
        }).join('')}</div>
      </section>
      ${dash.history ? historyCard() : ''}
    </div>` : ''}

    ${me.user_type !== 'employee' ? selectionSteps() : ''}`, me.full_name);
  if (course.mods.length) drawChapters();
  if (welcome) confetti();
}

// remembers (on this device) which tests were still "under review"; once the trainer marks one, show its final result once.
// ponytail: per device — on a new phone the notice is skipped, the test history still shows the final result.
function newlyReviewed(history) {
  const key = `lms-pending-${me.id}`;
  let was = [];
  try { was = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
  try { localStorage.setItem(key, JSON.stringify(history.filter(h => h.review_pending).map(h => h.id))); } catch {}
  return history.filter(h => was.includes(h.id) && !h.review_pending);
}

function drawChapters() {
  const { course, filter } = dash;
  const keep = m => filter === 'all' || (filter === 'done') === (m.state === 'passed');
  const count = f => course.mods.filter(m => f === 'all' || (f === 'done') === (m.state === 'passed')).length;
  document.getElementById('ch-filter').innerHTML = [['all', 'All'], ['done', 'Completed'], ['pending', 'Pending']].map(([f, l]) =>
    `<button class="${f === filter ? 'on' : ''}" aria-pressed="${f === filter}" onclick="dash.filter='${f}';drawChapters()">${l} <span class="sub">${count(f)}</span></button>`).join('');
  const rows = course.mods.map((m, i) => [m, i]).filter(([m]) => keep(m));
  document.getElementById('chapters').innerHTML = rows.map(([m, i]) => {
    const [ic, cls, label] = STATE[m.state];
    return `<li class="chapter ${m.state}">
      <span class="node" aria-hidden="true">${m.state === 'locked' ? icon('lock', 'sm') : m.state === 'passed' ? icon('check') : `<b>${i + 1}</b>`}</span>
      <div class="chapter-body">
        <div style="min-width:0">
          <div class="small muted">Chapter ${i + 1}</div>
          <h3>${esc(m.title)}</h3>
          <div class="chapter-meta">
            ${m.attempt_count ? `<span>${icon('clipboard', 'sm')} ${m.attempt_count} attempt${m.attempt_count > 1 ? 's' : ''}</span><span>${icon('target', 'sm')} Best ${Math.round(m.best_pct)}%</span>` : ''}
            ${m.has_task ? `<span>${icon('briefcase', 'sm')} Task ${m.task_done ? 'submitted' : 'pending'}</span>` : ''}
            ${m.state === 'locked' ? `<span>Unlocks after you complete the previous chapter</span>` : ''}
          </div>
        </div>
        <div class="row">
          <span class="badge ${cls}">${icon(ic)} ${label}</span>
          ${m.state !== 'locked' ? `<a class="btn btn-sm ${m.state === 'available' ? 'btn-primary' : ''}" href="#/module/${course.id}/${m.id}">${m.state === 'passed' ? 'Review' : 'Start'} ${icon('right', 'sm')}</a>` : ''}
        </div>
      </div>
    </li>`;
  }).join('') || `<li class="empty">${icon(filter === 'done' ? 'clipboard' : 'award')}<p>${filter === 'done' ? 'No chapters completed yet. Your first one is waiting!' : 'Nothing pending. Great work!'}</p></li>`;
}

// printable certificate once every chapter of the training is complete (Print → Save as PDF for a file)
// preview (admins only, #/certificate/<course>/preview): the design with your own name, no completion needed
async function viewCertificate(courseId, preview = false) {
  let c, list, en, passedAt;
  if (preview && me.role === 'admin') {
    const [co, mo] = await Promise.all([
      sb.from('courses').select('*').eq('id', courseId).single(),
      sb.from('modules').select('id').eq('course_id', courseId).eq('published', true),
    ]);
    if (co.error || mo.error) throw co.error || mo.error;
    c = co.data; list = mo.data; en = { data: { level: 'moderate' } };
  } else {
    preview = false;
    const [e, mods, hist] = await Promise.all([
      sb.from('enrollments').select('level,courses(*)').eq('user_id', me.id).eq('course_id', courseId).maybeSingle(),
      sb.rpc('my_modules', { p_course: courseId }),
      sb.rpc('my_attempts'),
    ]);
    if (e.error || mods.error) throw e.error || mods.error;
    en = e; c = e.data?.courses; list = mods.data || [];
    if (!c || !c.certificate || !list.length || list.some(m => m.state !== 'passed')) return show(`<div class="card narrow empty">${icon('award')}<h2>Not yet</h2>
      <p>The certificate is given once for the whole training, after every module is complete.${hi('प्रमाण पत्र पूरी ट्रेनिंग के सारे modules पूरे होने पर एक ही बार मिलता है।')}</p>
      <a class="btn" href="#/course/${courseId}">${icon('left')} My training</a></div>`, me.full_name);
    passedAt = (hist.data || []).filter(h => h.course_id === courseId && h.passed).map(h => h.submitted_at).sort().at(-1);
  }
  const date = new Date(passedAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const no = `AA-${new Date(passedAt || Date.now()).getFullYear()}-${(me.id.slice(0, 4) + courseId.slice(0, 4)).toUpperCase()}`;
  const level = ({ easy: 'Agent', moderate: 'Sales Executive', hard: 'Manager' })[en.data.level];
  show(`
    ${preview ? `<a class="crumb no-print" href="admin.html#/course/${courseId}">${icon('left', 'sm')} Back to admin</a>
      <div class="notice info no-print">${icon('award')}<span><strong>Admin preview.</strong> This is how a learner's certificate looks, with your name and today's date.
        Learners get it automatically when they complete every module (dashboard → <em>Certificate</em>)${c.certificate ? '' : ', <strong>but only after you switch on "Certificate" in this training\'s settings</strong>. Do that once every module is uploaded'}.</span></div>`
    : `<a class="crumb no-print" href="#/course/${courseId}">${icon('left', 'sm')} My training</a>`}
    <div class="row no-print" style="justify-content:space-between;margin-bottom:12px">
      <p class="muted" style="margin:0">To save it as a file, press <strong>Print</strong> and choose <strong>Save as PDF</strong>.${hi('फ़ाइल सेव करने के लिए Print दबाएँ और "Save as PDF" चुनें।')}</p>
      <button class="btn btn-primary" onclick="print()">${icon('download', 'sm')} Print / Save PDF</button>
    </div>
    <article class="cert">
      <div class="cert-in">
        <img class="cert-logo" src="${CERT_LOGO}" alt="Akshardham Associates">
        <p class="cert-kicker">Certificate of Completion</p>
        <p class="cert-small">This is to certify that</p>
        <h1 class="cert-name">${esc(me.full_name)}</h1>
        <p class="cert-small">has successfully completed the training</p>
        <h2 class="cert-course">${esc(c.title)}</h2>
        <p class="cert-small">${level ? `${level} level · ` : ''}Akshardham Academy</p>
        <div class="cert-foot">
          <div><strong>${date}</strong><span>Date of completion</span></div>
          <div class="cert-seal" aria-hidden="true">${icon('award', 'lg')}</div>
          <div><strong>Training Head</strong><span>Director, Akshardham Associates</span></div>
        </div>
        <p class="cert-no">Certificate no. ${no}</p>
      </div>
    </article>`, me.full_name);
  confetti();
}

function historyCard() {
  const { course, history } = dash;
  const rows = history.filter(h => h.course_id === course.id);
  const no = id => course.mods.findIndex(m => m.id === id) + 1;
  return `<section class="card">
    <div class="card-head"><h2>${icon('activity')} My test history</h2><span class="muted small">${rows.length} test${rows.length === 1 ? '' : 's'}</span></div>
    ${rows.length ? `<ul class="feed">${rows.slice(0, 8).map(h => `<li>
      ${h.review_pending ? `<span class="badge b-warn">${icon('clock')} Under review</span>`
        : `<span class="badge ${h.passed ? 'b-ok' : 'b-err'}">${icon(h.passed ? 'check' : 'x')} ${h.passed ? 'Pass' : 'Fail'}</span>`}
      <div style="flex:1;min-width:0"><strong>${no(h.module_id) ? `Ch ${no(h.module_id)}: ` : ''}${esc(h.chapter)}</strong>
        <div class="sub">${new Date(h.submitted_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
      <span class="num"><strong>${Math.round(h.pct)}%</strong> <span class="sub">${Math.round(h.score * 100) / 100}/${h.total}</span></span>
    </li>`).join('')}</ul>` : `<div class="empty">${icon('clipboard')}<p>No tests yet. Watch Chapter 1 and take your first test.</p></div>`}
  </section>`;
}

async function viewModule(courseId, moduleId) {
  const { data: mods, error } = await sb.rpc('my_modules', { p_course: courseId });
  if (error) throw error;
  const idx = mods.findIndex(x => x.id === moduleId), m = mods[idx];
  if (!m || m.state === 'locked') return show(`<div class="card narrow empty">${icon('lock')}<h2>Chapter locked</h2><p>Complete the previous chapter first.${hi('पहले पिछला chapter पूरा करें, फिर यह खुलेगा।')}</p><a class="btn" href="#/course/${courseId}">${icon('left')} All chapters</a></div>`, me.full_name);
  // has_test / has_task arrive with assignments.sql; before that every chapter is test-only
  const hasTest = m.has_test !== false, hasTask = !!m.has_task;
  let task = null;
  if (hasTask) {
    const t = await sb.rpc('my_task', { p_module: moduleId });
    if (t.error) throw t.error;
    task = t.data;
  }
  const passedTest = m.attempt_count > 0 && Number(m.best_pct) >= m.pass_pct;
  const urls = (m.videos || '').split(/\s+/).filter(Boolean);
  const ytIds = urls.map(ytId).filter(Boolean);
  const vp = ytIds.length ? await sb.rpc('my_video_progress', { p_module: moduleId }) : { data: [] };
  const tracked = ytIds.length > 0 && !vp.error; // before video.sql: plain players and the honour-system checkbox
  const watched = id => (vp.data || []).some(r => r.video_id === id && r.completed);
  const allWatched = ytIds.every(watched);
  let slot = 0;
  const videos = urls.map(url => {
    const id = ytId(url);
    if (!id) return `<p><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('external')} Open video</a></p>`;
    if (!tracked) return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(m.title)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    const i = slot++;
    return `<div class="video"><div id="yt-${i}"></div></div><div class="watch" id="ws-${i}" aria-live="polite"></div>`;
  }).join('');
  show(`
    <a class="crumb" href="#/course/${courseId}">${icon('left', 'sm')} All chapters</a>
    <section class="card">
      <span class="eyebrow">${icon('video', 'sm')} Chapter ${idx + 1} of ${mods.length}</span>
      <h1>${esc(m.title)}</h1>
      ${m.description ? `<p class="muted">${esc(m.description)}</p>` : ''}
      ${videos || `<div class="empty">${icon('video')}<p>This chapter has no video.</p></div>`}
      <div class="row help-row"><p class="help" style="margin:0">Video not playing? Your progress is saved.</p>${helpBtn(`${m.title}: video`)}</div>
      ${m.state === 'passed' ? `<div class="notice ok">${icon('award')}<span><strong>Chapter complete.</strong> You can review it any time.</span></div>`
        : hasTest && hasTask ? `<div class="notice info">${icon('target')}<span>To complete this chapter: pass the test <strong>and</strong> submit the practical task.</span></div>` : ''}
    </section>
    ${hasTest ? `<section class="card" id="test">
      <div class="card-head"><h2>${icon('clipboard')} Chapter test</h2>${passedTest ? `<span class="badge b-ok">${icon('check')} Passed</span>` : ''}</div>
      <div class="chips">
        <span class="badge b-blue">${icon('target')} Pass mark: ${m.pass_pct}%</span>
        <span class="badge">${icon('retry')} New questions every attempt</span>
        ${m.time_limit_min ? `<span class="badge b-warn">${icon('clock')} Time limit: ${m.time_limit_min} min</span>` : ''}
        ${m.attempt_count ? `<span class="badge">${icon('award')} Best: ${Math.round(m.best_pct)}%</span>` : ''}
      </div>
      <div class="notice info" style="margin-top:0">${icon('shield')}<span><strong>Test rules.</strong>
        ${m.time_limit_min ? `You get <strong>${m.time_limit_min} minutes</strong> once you start, and the test submits itself when time is up. Reloading the page does not stop the clock. ` : ''}
        Stay on this page: switching to another tab or app, copying and pasting are recorded and shown to your trainer.
        ${camNeeded() ? 'Your camera stays on: if your face is not visible, or someone else appears, it is recorded for your trainer. Sit in a bright place, facing the screen. ' : ''}
        ${m.max_warnings ? `After <strong>${m.max_warnings} warnings</strong> the test is submitted automatically.` : ''}
        ${hi(`<strong>टेस्ट के नियम:</strong> ${m.time_limit_min ? `शुरू करने के बाद ${m.time_limit_min} मिनट मिलेंगे, समय खत्म होते ही टेस्ट अपने आप जमा हो जाएगा। ` : ''}
          टेस्ट के दौरान इसी पेज पर रहें — दूसरा tab/app खोलना, copy या paste करना रिकॉर्ड होता है।
          ${camNeeded() ? 'कैमरा चालू रहेगा; चेहरा न दिखे या कोई और दिखे तो रिकॉर्ड होगा। रोशनी वाली जगह पर, स्क्रीन की तरफ मुँह करके बैठें। ' : ''}
          ${m.max_warnings ? `${m.max_warnings} warning होने पर टेस्ट अपने आप जमा हो जाएगा।` : ''}`)}</span></div>
      ${tracked
        ? `<p class="help" id="watch-gate">${allWatched ? '' : `${icon('lock', 'sm')} Watch the full video to unlock the test.`}</p>`
        : `<label class="check" style="margin-bottom:16px"><input type="checkbox" onchange="document.getElementById('start').disabled = !this.checked"> I have watched the full video</label>`}
      <button class="btn btn-primary" id="start" ${tracked && allWatched ? '' : 'disabled'} onclick="goFullscreen(); startTest('${courseId}','${moduleId}')">${icon('play', 'sm')} Start test</button>
    </section>` : ''}
    ${task ? `<section class="card" id="task">${taskCard(courseId, moduleId, task, false)}</section>` : ''}`, me.full_name);
  if (task) window._task = task;
  if (!tracked) return;
  if (camNeeded()) { // every watch needs the camera, rewatching included
    const gate = Object.assign(document.createElement('div'), { id: 'cam-gate' });
    document.querySelector('.video').before(gate);
    hideVideos(true);
    await camGate(gate, 'to watch');
    if (!gate.isConnected) return camStop(); // left the page meanwhile
    gate.remove();
    hideVideos(false);
  }
  setupWatch(moduleId, ytIds, vp.data);
}

// ---------- video seek-lock: no skipping ahead (or speeding up) until a video has been watched once ----------

let watch = null; // the chapter page's players and how far each has been watched
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  return (window._ytApi ||= new Promise(resolve => {
    window.onYouTubeIframeAPIReady = resolve;
    document.head.append(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api' }));
  }));
}

async function setupWatch(moduleId, ids, saved) {
  const [, cpRes] = await Promise.all([loadYouTubeApi(), sb.rpc('my_checkpoints', { p_module: moduleId })]);
  const cps = cpRes.error ? [] : cpRes.data; // none until checkpoints.sql is run
  if (!document.getElementById('yt-0')) return; // left the page while the API loaded
  videoStop();
  watch = { moduleId, list: ids.map((id, i) => {
    const r = (saved || []).find(x => x.video_id === id) || {};
    return { id, i, max: Number(r.max_sec || 0), savedMax: Number(r.max_sec || 0), duration: Number(r.duration || 0), completed: !!r.completed,
             lastSave: Date.now(), warned: 0, asking: false, leftAt: 0, cps: cps.filter(c => c.video_id === id) };
  }) };
  for (const v of watch.list) {
    v.player = new YT.Player(`yt-${v.i}`, {
      videoId: v.id,
      host: 'https://www.youtube-nocookie.com',
      playerVars: { rel: 0, playsinline: 1, modestbranding: 1, start: v.completed ? 0 : Math.floor(v.max) },
      events: {
        onReady: () => { v.duration = v.player.getDuration() || v.duration; drawWatch(v); },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PAUSED) saveWatch(v);
          // the end counts only if it was reached by watching, not by a jump the lock hasn't caught yet
          if (e.data === YT.PlayerState.ENDED && !v.completed && v.max >= v.duration - 5) { v.max = v.duration; saveWatch(v); }
        },
        onPlaybackRateChange: () => {
          if (v.completed || v.player.getPlaybackRate() <= 1) return;
          v.player.setPlaybackRate(1);
          toast('Speed-up unlocks after you have watched this video once.', 'err');
        },
      },
    });
  }
  watch.tick = setInterval(watchTick, 500);
  document.addEventListener('visibilitychange', onWatchVisibility);
}

function watchTick() {
  for (const v of watch.list) {
    if (v.asking || !v.player?.getCurrentTime) continue;
    if (cam?.absent && v.player.getPlayerState() === YT.PlayerState.PLAYING) { // pressing play while away doesn't help
      v.player.pauseVideo();
      if (Date.now() - v.warned > 4000) { v.warned = Date.now(); toast('Sit facing the camera to continue the video.', 'err'); }
      continue;
    }
    const t = v.player.getCurrentTime();
    if (!v.completed && t > v.max + 2) { // jumped ahead: back to the furthest point watched
      v.player.seekTo(v.max, true);
      if (Date.now() - v.warned > 4000) { v.warned = Date.now(); toast('You can skip ahead after watching the full video once.', 'err'); }
      continue;
    }
    const cp = v.cps.find(c => !c.answered && t >= c.at_sec - 0.25);
    if (cp) { askCheckpoint(v, cp); continue; }
    if (v.completed) continue;
    if (v.player.getPlayerState() === YT.PlayerState.PLAYING) v.max = Math.max(v.max, t);
    drawWatch(v);
    if (Date.now() - v.lastSave > 10000 && v.max > v.savedMax) saveWatch(v);
  }
}

// ---- checkpoint: the video stops, a question appears, the answer lets it continue ----
function askCheckpoint(v, cp) {
  v.asking = true;
  v.player.pauseVideo();
  // the server starts the response-time clock (checkpoint-time.sql; before it, this just fails quietly)
  cp.shown = sb.rpc('mark_checkpoint_shown', { p_checkpoint: cp.id }).then(() => {}, () => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); // the question can't show over a full-screen video
  let dlg = document.getElementById('cp-dlg');
  if (!dlg) {
    dlg = Object.assign(document.createElement('dialog'), { id: 'cp-dlg', className: 'exam-warn cp-dlg' });
    dlg.addEventListener('cancel', e => e.preventDefault()); // Esc can't skip the question
    document.body.append(dlg);
  }
  dlg.innerHTML = `
    <span class="eyebrow">${icon('clock', 'sm')} Checkpoint · ${fmtTime(cp.at_sec)}</span>
    <h2>${esc(cp.text)}</h2>
    <form id="cp-form" onsubmit="submitCheckpoint(event, ${v.i}, '${cp.id}')">
      ${cp.options.map((o, j) => `<label class="opt"><input type="radio" name="cp" value="${j}"> ${esc(o)}</label>`).join('')}
      <p class="form-error" id="cp-err" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('check', 'sm')} Submit answer</button>
    </form>`;
  if (!dlg.open) dlg.showModal();
}

async function submitCheckpoint(e, i, cpId) {
  e.preventDefault();
  const chosen = new FormData(e.target).get('cp');
  if (chosen === null) return (document.getElementById('cp-err').textContent = 'Pick an answer to continue the video.');
  e.submitter.disabled = true;
  await watch?.list[i]?.cps.find(c => c.id === cpId)?.shown; // clock must have started before the answer arrives
  const { data: r, error } = await sb.rpc('answer_checkpoint', { p_checkpoint: cpId, p_chosen: Number(chosen) });
  if (error) { e.submitter.disabled = false; return (document.getElementById('cp-err').textContent = error.message); }
  const v = watch?.list[i], cp = v?.cps.find(c => c.id === cpId);
  if (cp) cp.answered = true;
  const right = cp?.options[r.correct_index];
  document.getElementById('cp-dlg').innerHTML = `
    <span class="welcome-ico" style="${r.correct ? 'background:var(--ok-50);color:var(--ok)' : 'background:var(--err-50);color:var(--err)'}">${icon(r.correct ? 'check' : 'x', 'lg')}</span>
    <h2>${r.correct ? 'Correct!' : 'Not quite'}</h2>
    ${r.correct ? '' : `<p>The right answer: <strong>${esc(right)}</strong></p>`}
    ${r.explanation ? `<div class="model-answer" style="text-align:left">${esc(r.explanation)}</div>` : ''}
    <button class="btn btn-primary" style="margin-top:16px" onclick="continueVideo(${i})" autofocus>${icon('play', 'sm')} Continue video</button>`;
}

function continueVideo(i) {
  document.getElementById('cp-dlg')?.close();
  const v = watch?.list[i];
  if (!v) return;
  v.asking = false;
  v.player.playVideo();
}

// leaving the page while a video plays pauses it and is recorded for the trainer
function onWatchVisibility() {
  if (!watch) return;
  if (document.hidden) {
    for (const v of watch.list) {
      if (v.player?.getPlayerState?.() !== YT.PlayerState.PLAYING) continue;
      v.player.pauseVideo();
      v.leftAt = Date.now();
      sb.rpc('log_video_event', { p_module: watch.moduleId, p_video: v.id, p_type: 'left_page' });
    }
    saveAllWatch();
  } else if (watch.list.some(v => v.leftAt)) {
    watch.list.forEach(v => { v.leftAt = 0; });
    toast('The video paused because you left the page. This is recorded.', 'err');
  }
}

// during a test the videos are paused and hidden, so answers can't be looked up in them
function hideVideos(hidden) {
  document.querySelectorAll('.video, .watch').forEach(el => { el.hidden = hidden; });
  if (hidden) watch?.list.forEach(v => v.player?.pauseVideo?.());
}

async function saveWatch(v) {
  if (!watch || v.completed && v.max <= v.savedMax) return;
  v.lastSave = Date.now();
  const moduleId = watch.moduleId;
  const { data: done, error } = await sb.rpc('save_video_progress', { p_module: moduleId, p_video: v.id, p_max: v.max, p_duration: v.duration });
  if (error) return;
  v.savedMax = v.max;
  if (done && !v.completed) {
    v.completed = true;
    drawWatch(v);
    toast('Video complete. You can now skip and change speed freely.');
    if (watch?.list.every(x => x.completed)) {
      document.getElementById('start')?.removeAttribute('disabled');
      const gate = document.getElementById('watch-gate');
      if (gate) gate.textContent = '';
    }
  }
}

function saveAllWatch() { if (document.hidden) watch?.list.forEach(v => v.max > v.savedMax && saveWatch(v)); }

function drawWatch(v) {
  const el = document.getElementById(`ws-${v.i}`);
  if (!el) return;
  el.innerHTML = v.completed
    ? `<span class="badge b-ok">${icon('check')} Watched</span> <span class="sub">You can skip and change speed freely now.</span>`
    : `<div class="row" style="justify-content:space-between"><span class="sub">${icon('lock', 'sm')} First watch: no skipping ahead</span>
         <span class="sub num">${fmtTime(v.max)}${v.duration ? ` / ${fmtTime(v.duration)}` : ''}</span></div>
       <div class="bar"><i style="width:${v.duration ? Math.min(100, 100 * v.max / v.duration) : 0}%"></i></div>`;
}

function videoStop() {
  if (!watch) return;
  clearInterval(watch.tick);
  document.removeEventListener('visibilitychange', onWatchVisibility);
  document.getElementById('cp-dlg')?.close();
  for (const v of watch.list) { if (v.max > v.savedMax) saveWatch(v); try { v.player?.destroy(); } catch {} }
  watch = null;
}

// ---------- camera check: is the learner in front of the screen? ----------
// Face detection runs on the learner's own device (MediaPipe); the picture is never uploaded or saved.
// Only events go to the server: "face not visible", "more than one face", "camera turned off".
// ponytail: checked in the browser only, like the other test guards — a determined learner with dev tools can skip it.

const MP = new URL('demo/mediapipe', location.href).href;
const FACE_MODEL = new URL('demo/mediapipe/blaze_face_short_range.tflite', location.href).href;
const ABSENT_SEC = { video: 3, test: 5 }; // grace before it counts: a glance away or dim light shouldn't trip it
const MIN_FACE = 0.12; // a face narrower than 12% of the picture is someone in the background, not the learner at the screen
const MULTI_SEC = 3;
let cam = null; // { stream, el, detector, tick, missingSince, multiSince, absent, multi, mode }

// camera.sql adds camera_exempt; before it is run, or for an approved learner, no camera is asked for
const camNeeded = () => me && 'camera_exempt' in me && !me.camera_exempt;

async function camStart() {
  if (cam) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false }); }
  catch (e) { // some webcams/drivers refuse the size or facing hint: retry with any camera
    if (!['NotReadableError', 'OverconstrainedError', 'AbortError'].includes(e.name)) throw e;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  const el = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true, srcObject: stream });
  const box = document.createElement('div');
  box.className = 'cam-preview';
  box.innerHTML = '<span class="cam-state" id="cam-state">Starting camera…</span>';
  box.prepend(el);
  document.body.append(box);
  cam = { stream, el, box, missingSince: 0, multiSince: 0, absent: false, multi: false, mode: 'video' };
  stream.getVideoTracks()[0].addEventListener('ended', () => camEvent('camera_off'));
  try {
    const { FilesetResolver, FaceDetector } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const detector = await FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'VIDEO', minDetectionConfidence: 0.6 });
    if (!cam) return detector.close();
    cam.detector = detector;
  } catch (e) { camStop(); throw new Error('The face check could not load. Check your internet and try again.'); }
  await el.play().catch(() => {});
  cam.tick = setInterval(camTick, 500);
}

function camTick() {
  if (!cam?.detector || cam.el.readyState < 2) return;
  let faces;
  try {
    const w = cam.el.videoWidth || 320;
    faces = cam.detector.detectForVideo(cam.el, performance.now()).detections.filter(d => d.boundingBox.width / w >= MIN_FACE).length;
  } catch { return; }
  const now = Date.now();
  cam.missingSince = faces ? 0 : cam.missingSince || now;
  cam.multiSince = faces > 1 ? cam.multiSince || now : 0;
  const absent = !!cam.missingSince && now - cam.missingSince >= ABSENT_SEC[cam.mode] * 1000;
  const multi = !!cam.multiSince && now - cam.multiSince >= MULTI_SEC * 1000;
  if (absent && !cam.absent) camEvent('no_face');
  if (multi && !cam.multi && cam.mode === 'test') camEvent('multi_face');
  if (!absent && cam.absent) toast('Face visible again. Press play to continue.');
  cam.absent = absent; cam.multi = multi;
  const st = document.getElementById('cam-state');
  if (st) {
    const left = cam.missingSince ? Math.ceil(ABSENT_SEC[cam.mode] - (now - cam.missingSince) / 1000) : 0;
    st.textContent = faces === 1 ? 'Face visible' : faces > 1 ? 'More than one face'
      : left > 0 && watch?.list.some(v => v.player?.getPlayerState?.() === YT.PlayerState.PLAYING) ? `Face not visible · pausing in ${left}` : 'Face not visible';
    st.className = `cam-state ${faces === 1 ? 'ok' : 'bad'}`;
  }
}

// what happens when the camera sees a problem depends on whether a video or a test is running
function camEvent(type) {
  if (type === 'camera_off' && cam) cam.absent = true;
  if (exam) return examWarn(type);
  if (!watch) return;
  for (const v of watch.list) {
    if (v.player?.getPlayerState?.() !== YT.PlayerState.PLAYING) continue;
    v.player.pauseVideo();
    sb.rpc('log_video_event', { p_module: watch.moduleId, p_video: v.id, p_type: type });
  }
  toast(type === 'camera_off' ? 'The camera turned off, so the video paused. Reload the page to turn it on again.'
    : 'Video paused: your face is not visible. Sit facing the camera in a bright place.', 'err');
}

function camStop() {
  if (!cam) return;
  clearInterval(cam.tick);
  cam.stream.getTracks().forEach(t => t.stop());
  try { cam.detector?.close(); } catch {}
  cam.box.remove();
  cam = null;
}

const CAM_NOTE = () => `${icon('video')}<span><strong>Camera check.</strong> Your camera stays on while you watch the video and take the test, and the video pauses if your face is not visible.
  <strong>Sit in a bright place, facing the screen</strong> (light in front of you, not behind), so your face is easy to see.
  The picture stays on your phone or computer: it is not recorded or uploaded.
  ${hi('<strong>कैमरा चेक:</strong> वीडियो देखते और टेस्ट देते समय कैमरा चालू रहेगा; चेहरा न दिखे तो वीडियो रुक जाएगा। <strong>रोशनी वाली जगह पर, स्क्रीन की तरफ मुँह करके बैठें</strong> (रोशनी आपके सामने हो, पीछे नहीं)। आपकी तस्वीर कहीं सेव या अपलोड नहीं होती।')}</span>`;

// the card shown instead of the videos until the camera is on; resolves once it is
function camGate(el, why) {
  return new Promise(resolve => {
    const draw = (err = '') => {
      const pending = me.camera_request && !me.camera_exempt;
      el.innerHTML = `<div class="notice info">${CAM_NOTE()}</div>
        ${err ? `<div class="notice">${icon('alert')}<span>${err}</span></div>` : ''}
        <button class="btn btn-primary" id="cam-on">${icon('video', 'sm')} Turn on camera ${why}</button>
        <details class="cam-help" ${err ? 'open' : ''}><summary>Camera not working?</summary>
          ${pending ? `<p class="notice ok">${icon('clock')}<span>Your request has been sent. You can continue after the admin approves it.${hi('आपकी request भेज दी गई है। Admin की मंज़ूरी के बाद आप आगे बढ़ पाएँगे।')}</span></p>`
          : `<p class="help">If you allowed the camera and it still doesn't work (or your device has none), ask the admin for approval to continue without it.${hi('कैमरा allow करने के बाद भी न चले (या डिवाइस में कैमरा न हो), तो नीचे समस्या लिखकर admin से मंज़ूरी माँगें।')}</p>
             <form id="cam-req"><textarea name="reason" rows="3" maxlength="500" placeholder="What is the problem? e.g. my laptop has no camera" aria-label="Problem with the camera"></textarea>
             <div class="row"><button class="btn btn-sm" type="submit">${icon('right', 'sm')} Ask for approval</button>${helpBtn('Camera')}</div></form>`}
        </details>`;
      el.querySelector('#cam-on').onclick = async e => {
        e.target.disabled = true; e.target.textContent = 'Starting camera…';
        try { await camStart(); resolve(); }
        catch (x) { draw(x.name === 'NotAllowedError' ? `Camera permission was blocked. Allow the camera for this site (lock icon in the address bar), then try again.${hi('कैमरा की permission बंद है। ऊपर address bar में ताले (🔒) वाले निशान पर दबाकर Camera को Allow करें, फिर दोबारा कोशिश करें।')}`
          : x.name === 'NotFoundError' ? `No camera was found on this device.${hi('इस डिवाइस में कैमरा नहीं मिला।')}`
          : x.name === 'NotReadableError' || x.name === 'AbortError' ? `The camera is busy in another app. Close Zoom, Google Meet, WhatsApp, the Camera app or any other browser tab using the camera, then press the button again. If it still fails, restart the browser.${hi('कैमरा किसी और app में चल रहा है। Zoom, Meet, WhatsApp, Camera app या दूसरा browser tab बंद करें, फिर बटन दोबारा दबाएँ। फिर भी न चले तो browser बंद करके दोबारा खोलें।')}`
          : esc(x.message || 'The camera could not start.')); }
      };
      el.querySelector('#cam-req')?.addEventListener('submit', async e => {
        e.preventDefault();
        const { error } = await sb.rpc('request_camera_exempt', { p_reason: e.target.reason.value });
        if (error) return toast(error.message, 'err');
        me.camera_request = e.target.reason.value;
        toast('Request sent to the admin');
        draw();
      });
    };
    draw();
  });
}

function taskCard(courseId, moduleId, t, editing) {
  const done = !!t.submitted_at && !editing;
  const link = t.submit_type === 'link';
  return `
    <div class="card-head"><h2>${icon('briefcase')} Practical task</h2>
      <span class="badge ${t.submitted_at ? 'b-ok' : 'b-warn'}">${icon(t.submitted_at ? 'check' : 'clock')} ${t.submitted_at ? 'Submitted' : 'Pending'}</span></div>
    <div class="task-box">${esc(t.instructions)}</div>
    ${done ? `
      <h3 style="margin-top:16px">Your answer</h3>
      <div class="task-answer">${/^https?:\/\//i.test(t.answer) ? `<a href="${esc(t.answer)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(t.answer)}</a>` : esc(t.answer)}</div>
      <p class="sub">Submitted ${new Date(t.submitted_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      ${t.model_answer ? `<div class="model-answer"><span class="eyebrow">${icon('award', 'sm')} Model answer</span><div>${esc(t.model_answer)}</div></div>` : ''}
      <button class="btn btn-sm" style="margin-top:12px" onclick="document.getElementById('task').innerHTML = taskCard('${courseId}','${moduleId}', window._task, true)">${icon('save', 'sm')} Edit my answer</button>`
    : `
      <form onsubmit="submitTask(event,'${courseId}','${moduleId}')" style="margin-top:16px">
        <div class="field">
          <label for="task-answer">${link ? 'Paste your link' : 'Your answer'} <span class="req">*</span></label>
          ${link
            ? `<input id="task-answer" name="answer" type="url" required placeholder="https://drive.google.com/…" value="${esc(t.answer)}">
               <p class="help">Upload your photo, PDF or video to Google Drive → Share → "Anyone with the link" → Copy link, and paste it here.</p>`
            : `<textarea id="task-answer" name="answer" required maxlength="5000" rows="6">${esc(t.answer)}</textarea>`}
        </div>
        <p id="task-err" class="form-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">${icon('check', 'sm')} Submit task</button>
      </form>`}`;
}

async function submitTask(e, courseId, moduleId) {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const { error } = await sb.rpc('submit_task', { p_module: moduleId, p_answer: new FormData(e.target).get('answer') });
  if (error) { btn.disabled = false; document.getElementById('task-err').textContent = error.message; return; }
  const { data: mods } = await sb.rpc('my_modules', { p_course: courseId });
  const done = mods?.find(x => x.id === moduleId)?.state === 'passed';
  toast(done ? 'Task submitted. Chapter complete!' : 'Task submitted');
  await viewModule(courseId, moduleId);
  document.getElementById('task')?.scrollIntoView({ behavior: 'smooth' });
  if (done) confetti();
}

async function startTest(courseId, moduleId) {
  const box = document.getElementById('test');
  if (camNeeded() && !cam) {
    await camGate(box, 'to start the test');
    if (!box.isConnected) return camStop();
  }
  box.innerHTML = `<div class="sk" style="height:56px;margin-bottom:12px"></div><div class="sk" style="height:220px"></div>`;
  const { data, error } = await sb.rpc('start_attempt', { p_module: moduleId });
  if (error) { box.innerHTML = `<div class="notice">${icon('alert')}<span>${esc(friendly(error.message))}</span></div><p>${helpBtn('Test start nahi ho raha')}</p>`; return; }
  window._quiz = data.questions;
  const n = data.questions.length;
  const input = q => q.kind === 'essay'
    ? `<p class="help" style="margin:-4px 0 8px">Write in your own words${q.min_words || q.max_words ? ` (${wordRange(q.min_words, q.max_words)})` : ''}. Your trainer will check this answer.</p>
       <textarea name="${q.id}" rows="${(q.max_words || q.min_words || 0) >= 80 ? 9 : 5}" maxlength="8000" aria-label="Your answer"></textarea>
       <p class="wc" id="wc-${q.id}" aria-live="polite">0 words</p>`
    : q.kind === 'text'
    ? `<input type="text" name="${q.id}" maxlength="300" autocomplete="off" placeholder="Type your answer" aria-label="Your answer">`
    : (q.kind === 'multi' ? '<p class="help" style="margin:-4px 0 8px">Select all that apply</p>' : '') +
      q.options.map((o, j) => `<label class="opt"><input type="${q.kind === 'multi' ? 'checkbox' : 'radio'}" name="${q.id}" value="${j}"> ${esc(o)}</label>`).join('');
  box.innerHTML = `
    <div class="quiz-head">
      <div class="row"><span>${icon('clipboard', 'sm')} Test</span>
        ${data.seconds_left != null ? `<span class="timer num" id="timer" role="timer" aria-label="Time left">--:--</span>` : ''}
        <span class="num"><span id="ans">0</span> / ${n} answered</span></div>
      <div class="bar"><i id="ans-bar" style="width:0"></i></div>
    </div>
    <form id="quiz" onsubmit="submitTest(event,'${data.attempt_id}','${courseId}','${moduleId}')" oninput="countAnswers(this, ${n})" novalidate>
      ${data.questions.map((q, i) => `
        <fieldset class="q">
          <legend><span class="qn">${i + 1}</span><span>${esc(q.text)}</span></legend>
          ${input(q)}
        </fieldset>`).join('')}
      <button class="btn btn-primary btn-block" type="submit">${icon('check', 'sm')} Submit</button>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth' });
  examStart(data, courseId, moduleId);
  if (data.warnings) toast(`This test already has ${data.warnings} warning${data.warnings > 1 ? 's' : ''}.`, 'err');
}

// answers in the shape submit_attempt expects: index | [indexes] | "text"
function collectAnswers(form) {
  const fd = new FormData(form), answers = {};
  for (const q of window._quiz) {
    if (q.kind === 'multi') answers[q.id] = fd.getAll(q.id).map(Number);
    else if (q.kind === 'text' || q.kind === 'essay') answers[q.id] = String(fd.get(q.id) || '').trim();
    else if (fd.has(q.id)) answers[q.id] = Number(fd.get(q.id));
  }
  const answered = q => (q.kind === 'multi' ? answers[q.id].length > 0 : q.kind === 'text' || q.kind === 'essay' ? answers[q.id] !== '' : q.id in answers);
  return { answers, missing: window._quiz.findIndex(q => !answered(q)), count: window._quiz.filter(answered).length };
}

const countWords = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const wordRange = (min, max) => (min && max ? `${min}–${max} words` : min ? `at least ${min} words` : `up to ${max} words`);
// null when the answer fits the question's word limit, else what to tell the learner
function wordProblem(q, text) {
  const n = countWords(text);
  if (q.min_words && n < q.min_words) return `write at least ${q.min_words} words (now ${n})`;
  if (q.max_words && n > q.max_words) return `keep it to ${q.max_words} words (now ${n})`;
  return null;
}

function countAnswers(form, n) {
  for (const q of window._quiz.filter(x => x.kind === 'essay')) {
    const el = document.getElementById(`wc-${q.id}`), text = form.elements[q.id].value, w = countWords(text);
    const limit = q.max_words ? ` / ${q.max_words}` : '';
    const need = q.min_words && w < q.min_words ? ` · ${q.min_words - w} more needed` : q.max_words && w > q.max_words ? ` · ${w - q.max_words} too many` : '';
    el.textContent = `${w}${limit} words${need}`;
    el.className = `wc ${need ? (q.max_words && w > q.max_words ? 'over' : '') : w ? 'ok' : ''}`;
  }
  const k = collectAnswers(form).count;
  document.getElementById('ans').textContent = k;
  document.getElementById('ans-bar').style.width = `${100 * k / n}%`;
}

async function submitTest(e, attemptId, courseId, moduleId) {
  e.preventDefault();
  const { answers, missing } = collectAnswers(e.target);
  if (missing >= 0) {
    toast(`Please answer question ${missing + 1}`, 'err');
    return e.target.querySelectorAll('fieldset')[missing].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const long = window._quiz.findIndex(q => q.kind === 'essay' && wordProblem(q, answers[q.id]));
  if (long >= 0) {
    toast(`Question ${long + 1}: ${wordProblem(window._quiz[long], answers[window._quiz[long].id])}`, 'err');
    return e.target.querySelectorAll('fieldset')[long].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await finishTest(attemptId, courseId, moduleId, null);
}

// reason: null (learner pressed Submit) | 'time_up' | 'warnings' — automatic submits send whatever is answered
async function finishTest(attemptId, courseId, moduleId, reason) {
  if (exam) exam.submitting = true;
  const form = document.getElementById('quiz');
  const btn = form?.querySelector('button[type=submit]');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const { answers } = collectAnswers(form);
  const { data: r, error } = await sb.rpc('submit_attempt', { p_attempt: attemptId, p_answers: answers, ...(reason ? { p_reason: reason } : {}) });
  examStop();
  const box = document.getElementById('test');
  if (error) { box.innerHTML = `<div class="notice">${icon('alert')}<span>${esc(error.message)}</span></div>`; return; }
  let finished = false, chapterDone = false, cert = false;
  if (r.passed) {
    const [{ data: mods }, { data: co }] = await Promise.all([sb.rpc('my_modules', { p_course: courseId }), sb.from('courses').select('*').eq('id', courseId).maybeSingle()]);
    cert = !!co?.certificate;
    chapterDone = mods?.find(x => x.id === moduleId)?.state === 'passed';
    finished = !!mods?.length && mods.every(m => m.state === 'passed');
  }
  const color = r.passed ? 'var(--ok)' : 'var(--err)';
  box.innerHTML = `
    <div class="result fade-in">
      <div class="ring" style="background:conic-gradient(${color} ${r.pct}%, #E7ECF3 0)"><div class="num">${Math.round(r.pct)}%</div></div>
      <h2>${finished ? 'Training complete!' : r.passed ? 'Well done, you passed!' : "You didn't pass this time"}</h2>
      <p class="muted"><span class="badge ${r.passed ? 'b-ok' : 'b-err'}">${icon(r.passed ? 'check' : 'x')} ${r.passed ? 'PASS' : 'FAIL'}</span>
        &nbsp;${Math.round(r.score * 100) / 100} / ${r.total} marks · Pass mark ${r.pass_pct}%</p>
      ${reason || r.late ? `<div class="notice" style="text-align:left">${icon('clock')}<span><strong>${reason === 'warnings' ? 'Submitted automatically after too many warnings.' : 'Time was up, so the test was submitted automatically.'}</strong>
        ${r.late ? ' It reached us after the time limit, so it counts as not passed.' : ' Questions you had not answered count as wrong.'}</span></div>` : ''}
      ${r.review_pending ? `<div class="notice info" style="text-align:left">${icon('clock')}<span><strong>Your trainer will check your written answer.</strong>
        This result is provisional: keywords gave it a first mark, and the final mark may change it. You'll see the update in your test history.</span></div>` : ''}
      ${finished
        ? `<p>Congratulations! You've cleared every chapter.${me.user_type !== 'employee' ? ' Our team will contact you soon for the next step.' : ''}</p><div class="row">${cert ? `<a class="btn btn-primary" href="#/certificate/${courseId}">${icon('award', 'sm')} Get my certificate</a><a class="btn" href="#/course/${courseId}">View my progress</a>` : `<a class="btn btn-primary" href="#/course/${courseId}">${icon('award', 'sm')} View my progress</a>`}</div>`
        : r.passed && !chapterDone
        ? `<p>One more step: submit the practical task below to complete this chapter.</p><div class="row"><button class="btn btn-primary" onclick="document.getElementById('task').scrollIntoView({behavior:'smooth'})">${icon('briefcase', 'sm')} Go to the task</button></div>`
        : r.passed
        ? `<p>The next chapter is now unlocked.</p><div class="row"><a class="btn btn-primary" href="#/course/${courseId}">Continue ${icon('right', 'sm')}</a></div>`
        : `<p>No worries. Watch the video again, then retake the test. You'll get new questions next time.</p>
           <div class="row">
             <button class="btn" onclick="scrollTo({top:0,behavior:'smooth'})">${icon('video', 'sm')} Rewatch video</button>
             <button class="btn btn-primary" onclick="startTest('${courseId}','${moduleId}')">${icon('retry', 'sm')} Retake test</button>
           </div>`}
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  if (r.passed) confetti();
}

// ---------- test guard: server-timed clock + integrity warnings ----------
// A browser can see the learner leave the page, copy, paste or leave full screen. It cannot see a second phone,
// so the warnings never claim to catch "cheating" — they record what happened for the trainer.

let exam = null; // the test in progress
const WARN_TEXT = {
  left_page: 'You left the test page (another tab or app).',
  copy: 'Copying is not allowed during the test.',
  paste: 'Pasting is not allowed during the test.',
  exit_fullscreen: 'You left full screen.',
  no_face: 'Your face was not visible to the camera. Sit facing the screen in a bright place.',
  multi_face: 'More than one person was seen on the camera.',
  camera_off: 'The camera turned off.',
};
const WARN_HI = {
  left_page: 'आपने टेस्ट का पेज छोड़ा (दूसरा tab या app खोला)।',
  copy: 'टेस्ट के दौरान copy करना मना है।',
  paste: 'टेस्ट के दौरान paste करना मना है।',
  exit_fullscreen: 'आप full screen से बाहर गए।',
  no_face: 'कैमरे में आपका चेहरा नहीं दिखा। रोशनी में स्क्रीन की तरफ मुँह करके बैठें।',
  multi_face: 'कैमरे में एक से ज़्यादा लोग दिखे।',
  camera_off: 'कैमरा बंद हो गया।',
};
const guard = {
  visibilitychange: () => document.hidden && examWarn('left_page'),
  copy: e => { e.preventDefault(); examWarn('copy'); },
  cut: e => { e.preventDefault(); examWarn('copy'); },
  paste: e => { e.preventDefault(); examWarn('paste'); },
  contextmenu: e => e.preventDefault(),
  fullscreenchange: () => { if (exam?.fullscreen && !document.fullscreenElement) { exam.fullscreen = false; examWarn('exit_fullscreen'); } },
};
const onBlur = () => !document.hidden && examWarn('left_page'); // switching to another window or app
const onLeave = e => { e.preventDefault(); e.returnValue = ''; };

// full screen on computers only: on phones it fights the keyboard
function goFullscreen() {
  if (!matchMedia('(pointer: fine)').matches || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen().then(() => { if (exam) exam.fullscreen = true; else window._fsPending = true; }).catch(() => {});
}

function examStart(d, courseId, moduleId) {
  examStop();
  exam = { attemptId: d.attempt_id, courseId, moduleId, max: d.max_warnings || 0, warnings: d.warnings || 0,
           deadline: d.seconds_left != null ? Date.now() + d.seconds_left * 1000 : null,
           fullscreen: !!document.fullscreenElement || !!window._fsPending, lastLeave: 0, submitting: false };
  window._fsPending = false;
  for (const [type, fn] of Object.entries(guard)) document.addEventListener(type, fn, true);
  addEventListener('blur', onBlur);
  addEventListener('beforeunload', onLeave);
  if (exam.deadline) { exam.tick = setInterval(examTick, 1000); examTick(); }
  hideVideos(true);
  if (cam) cam.mode = 'test';
}

function examStop() {
  if (!exam) return;
  clearInterval(exam.tick);
  for (const [type, fn] of Object.entries(guard)) document.removeEventListener(type, fn, true);
  removeEventListener('blur', onBlur);
  removeEventListener('beforeunload', onLeave);
  document.getElementById('exam-warn')?.close();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  exam = null;
  hideVideos(false);
  if (cam) cam.mode = 'video';
}

function examTick() {
  const left = Math.max(0, Math.round((exam.deadline - Date.now()) / 1000));
  const el = document.getElementById('timer');
  if (el) {
    el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 60);
  }
  if (left === 0 && !exam.submitting) finishTest(exam.attemptId, exam.courseId, exam.moduleId, 'time_up');
}

async function examWarn(type) {
  if (!exam || exam.submitting) return;
  if (type === 'left_page') { // blur + hidden fire together when switching tabs: count once
    if (Date.now() - exam.lastLeave < 2000) return;
    exam.lastLeave = Date.now();
  }
  // camera events are recorded for the trainer but never end the test (dim light isn't cheating)
  const camera = ['no_face', 'multi_face', 'camera_off'].includes(type);
  const { data } = await sb.rpc('log_attempt_event', { p_attempt: exam.attemptId, p_type: type });
  if (!exam) return;
  if (!camera) exam.warnings = data ?? exam.warnings + 1;
  if (!camera && exam.max && exam.warnings >= exam.max) {
    toast(`${WARN_TEXT[type]} That was warning ${exam.warnings} of ${exam.max}: the test is being submitted.`, 'err');
    return finishTest(exam.attemptId, exam.courseId, exam.moduleId, 'warnings');
  }
  let dlg = document.getElementById('exam-warn');
  if (!dlg) {
    dlg = Object.assign(document.createElement('dialog'), { id: 'exam-warn', className: 'exam-warn' });
    document.body.append(dlg);
  }
  dlg.innerHTML = `
    <span class="welcome-ico" style="background:var(--warn-50);color:var(--warn)">${icon('alert', 'lg')}</span>
    <h2>${camera ? 'Recorded' : `Warning ${exam.warnings}${exam.max ? ` of ${exam.max}` : ''}`}</h2>
    <p>${WARN_TEXT[type]} This is recorded and your trainer will see it.${hi(`${WARN_HI[type]} यह रिकॉर्ड हो गया है और trainer देखेंगे।`)}</p>
    ${exam.max && !camera ? `<p class="muted">After ${exam.max} warnings the test is submitted automatically.</p>` : ''}
    <form method="dialog" class="row" style="justify-content:center">
      ${type === 'exit_fullscreen' ? `<button class="btn" onclick="goFullscreen()">Back to full screen</button>` : ''}
      <button class="btn btn-primary" autofocus>Back to the test</button>
    </form>`;
  if (!dlg.open) dlg.showModal();
}

if (typeof module === 'object') module.exports = { ytId, wordProblem }; // node test.js
else { addEventListener('hashchange', render); initTips(); render(); }
