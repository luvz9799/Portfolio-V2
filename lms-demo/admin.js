let me, users = [];
const STATUSES = ['active', 'shortlisted', 'rejected', 'inactive'];
const STATUS_CLS = { active: 'b-blue', shortlisted: 'b-ok', rejected: 'b-err', inactive: '' };
const TYPE_LABEL = { candidate: 'Candidate', agent: 'Agent', employee: 'Employee' };
const uuid = /^[0-9a-f-]{36}$/;
const portal = () => new URL('./', location.href).href;
const inviteMsg = () => `Namaste! Akshardham Associates mein apply karne ke liye dhanyavaad. 🙏

Selection ka agla step online training hai:
1️⃣ Yeh link kholein: ${portal()}
2️⃣ Apne Gmail se login karke registration bharein
3️⃣ Har chapter ka video dekhein aur chhota test dein (80% par pass)
4️⃣ Saare chapter clear hone par hum aapko interview ke liye call karenge

Koi dikkat ho to isi number par message karein.
— Team Akshardham`;
const waLink = (phone, text = '') => `https://wa.me/${phone ? '91' + phone : ''}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

async function copyLink() {
  try { await navigator.clipboard.writeText(portal()); toast('Portal link copied'); }
  catch { prompt('Copy this link:', portal()); }
}
const when = t => t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const FIELDS = {
  courses: [
    ['title', 'Title'],
    ['category', 'Category / Position (e.g. Sales Executive)'],
    ['audience', 'Audience (candidate/agent trainings appear on the registration form)', ['all', 'candidate', 'agent', 'employee']],
    ['description', 'Description', 'textarea'],
    ['published', 'Published (visible to learners)', 'checkbox'],
    ['certificate', 'Certificate on: learners who finish every published module get the certificate. Switch on only once ALL modules are uploaded', 'checkbox'],
  ],
  modules: [
    ['seq', 'Chapter number (1, 2, 3…)', 'number'],
    ['title', 'Title'],
    ['videos', 'YouTube links (one per line)', 'textarea'],
    ['description', 'Description / instructions', 'textarea'],
    ['pass_pct', 'Pass mark %', 'number'],
    ['questions_per_test', 'Questions per test', 'number'],
    ['time_limit_min', 'Time limit in minutes (0 = no limit)', 'number', 0],
    ['max_warnings', 'Submit the test automatically after this many warnings (0 = never)', 'number', 0],
    ['published', 'Published (visible to learners)', 'checkbox'],
  ],
};

// One question per line, typed:
//   one answer:       Question | A | B | C | 2
//   multiple answers: Question | A | B | C | 1,3
//   written answer:   Question | = answer ; another accepted answer
// or rows copied straight from Excel / Google Sheets (cells arrive tab-separated):
//   [Level] | Question | Option 1 … Option 6 | Answer   — empty cells are skipped, a header row is ignored,
//   a row with only an answer (not a number) is a written answer.
//   Descriptive | [Level] | Question | Keywords | Model answer | Min words | Max words   — by position
const LEVEL_WORDS = { easy: 'easy', agent: 'easy', agents: 'easy', moderate: 'moderate', executive: 'moderate',
  executives: 'moderate', hard: 'hard', manager: 'hard', managers: 'hard' };
const ANSWER_NUMS = /^\d+([\s,;+/]+\d+)*$/; // "2", "1,3", "1+3" (Excel turns "1,3" into a number, "1+3" stays text)
const DESCRIPTIVE = /^(descriptive|long|essay|लंबा|विस्तृत)$/i;

// Excel/Sheets copy: cells split by tabs, rows by line breaks; a cell holding a line break, tab or quote
// arrives wrapped in "…" with inner quotes doubled — so a long answer typed with Alt+Enter stays one cell
function parseTSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
}

// keywords are separated by ; or new lines, or a comma — but not the comma inside a number like 17,424
const KW_SPLIT = /[;\n]+|,(?!\d)/;

function descriptiveRow(cells, moduleId, level) {
  const [, lv = '', text = '', keywords = '', model = '', min = '', max = ''] = cells;
  const accepted = keywords.split(KW_SPLIT).map(k => k.trim()).filter(Boolean);
  const num = v => (v === '' ? null : Number(v));
  const [minW, maxW] = [num(min), num(max)];
  const okNum = n => n === null || (Number.isInteger(n) && n >= 1 && n <= 2000);
  if (!text || !accepted.length || !okNum(minW) || !okNum(maxW) || (minW && maxW && maxW < minW)) return null;
  return { module_id: moduleId, level: LEVEL_WORDS[lv.toLowerCase()] || level, kind: 'essay', text, options: [], correct: null,
           accepted, model_answer: model || null, min_words: minW, max_words: maxW };
}

function parseQuestions(text, moduleId, level = 'moderate') {
  const rows = [], bad = [];
  const lines = text.includes('\t') ? parseTSV(text) : text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    let parts, rowLevel = level;
    if (Array.isArray(line)) {
      if (/^(type|level|question|sawal|सवाल)$/i.test(line.find(Boolean) || '')) return; // a template's header row
      if (DESCRIPTIVE.test(line[0])) {
        const row = descriptiveRow(line, moduleId, level);
        return row ? rows.push(row) : bad.push(i + 1);
      }
      parts = line.filter(Boolean);
      if (LEVEL_WORDS[parts[0]?.toLowerCase()]) rowLevel = LEVEL_WORDS[parts.shift().toLowerCase()];
      if (parts.length === 2 && !ANSWER_NUMS.test(parts[1])) parts[1] = '=' + parts[1].replace(/^=/, '');
    } else parts = line.split('|').map(s => s.trim());
    if (parts.length === 2 && parts[1].startsWith('=')) {
      const accepted = parts[1].slice(1).split(';').map(s => s.trim()).filter(Boolean);
      if (parts[0] && accepted.length) rows.push({ module_id: moduleId, level: rowLevel, kind: 'text', text: parts[0], options: [], correct: null, accepted });
      else bad.push(i + 1);
      return;
    }
    const last = parts.pop();
    const nums = ANSWER_NUMS.test(last) ? last.split(/[\s,;+/]+/).map(n => Number(n) - 1) : [NaN];
    const [qtext, ...options] = parts;
    const okOptions = qtext && options.length >= 2 && options.length <= 6 && options.every(Boolean);
    const okNums = nums.every(n => Number.isInteger(n) && n >= 0 && n < options.length) && new Set(nums).size === nums.length;
    if (!okOptions || !okNums) bad.push(i + 1);
    else if (nums.length === 1) rows.push({ module_id: moduleId, level: rowLevel, kind: 'single', text: qtext, options, correct: nums[0], accepted: null });
    else rows.push({ module_id: moduleId, level: rowLevel, kind: 'multi', text: qtext, options, correct: null, accepted: nums.sort((x, y) => x - y) });
  });
  return { rows, bad };
}

// ---- "Paste from AI": question blocks the way ChatGPT/Claude write them when given AI_PROMPT ----
//   Q: question            A) option … F) option        Answer: B   (or "A, C", or the written answer if no options)
//   Level: Easy            Type: Descriptive + Keywords: a; b + Model answer: … + Words: 100-150
//   Time: 2:30 (+ Explanation: …) → a video checkpoint instead of a test question
// Tolerates what AI adds: **bold**, numbering ("1.", "Q1:"), bullets, blank lines, Hindi labels.
const AI_FIELD = /^(answer|ans|correct answer|correct|उत्तर|सही उत्तर|level|स्तर|type|keywords?|model answer|words|explanation|व्याख्या|time|समय)\s*[:：\-–]\s*(.*)$/i;
const AI_FIELD_KEY = { ans: 'answer', 'correct answer': 'answer', correct: 'answer', उत्तर: 'answer', 'सही उत्तर': 'answer', स्तर: 'level',
  keyword: 'keywords', व्याख्या: 'explanation', समय: 'time' };
const AI_QSTART = /^(?:(?:q|question|प्रश्न|सवाल)\s*\.?\s*\d*\s*[:.)\-–]|\d+\s*[.)]|\(\d+\))\s*(.*)$/i;
const AI_OPTION = /^\(?([A-Fa-f])\s*[).:\-–]\s+(.+)$/;

function parseAiText(text, moduleId, level = 'moderate', videoId = null) {
  const blocks = [];
  let cur = null, field = null;
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__|`/g, '').replace(/^\s*(?:#+|[-•*]\s)\s*/, '').trim();
    if (!line) { field = field === 'model answer' ? field : null; continue; }
    const q = line.match(AI_QSTART), f = line.match(AI_FIELD), o = line.match(AI_OPTION);
    if (q && !f && (!cur || cur.f.answer !== undefined || cur.f.type || cur.opts.length)) { // a new question starts
      cur = { q: q[1].trim(), opts: [], f: {} }; blocks.push(cur); field = null; continue;
    }
    if (!cur) { cur = { q: line, opts: [], f: {} }; blocks.push(cur); continue; } // first line without "Q:"
    if (f) { field = AI_FIELD_KEY[f[1].toLowerCase()] || f[1].toLowerCase(); cur.f[field] = f[2].trim(); continue; }
    if (o && !field) { cur.opts.push(o[2].trim()); continue; }
    if (field) cur.f[field] += (cur.f[field] ? '\n' : '') + line; // e.g. a model answer over several lines
    else if (!cur.opts.length) cur.q += (cur.q ? ' ' : '') + line;
    else if (cur.f.answer === undefined && !cur.f.type) { cur = { q: line, opts: [], f: {} }; blocks.push(cur); } // next question without a "Q:" label
  }

  const rows = [], cps = [], bad = [];
  blocks.forEach((b, i) => {
    const fail = why => bad.push({ n: i + 1, text: b.q || '(no question text)', why });
    const lv = (b.f.level || '').toLowerCase().match(/[a-z]+/)?.[0];
    const rowLevel = LEVEL_WORDS[lv] || ({ आसान: 'easy', मध्यम: 'moderate', कठिन: 'hard' })[(b.f.level || '').trim().split(/\s/)[0]] || level;
    if (!b.q) return fail('The question text is missing.');
    if (/descriptive|essay|long|लंबा|विस्तृत/i.test(b.f.type || '')) {
      const accepted = (b.f.keywords || '').split(KW_SPLIT).map(k => k.trim()).filter(Boolean);
      if (!accepted.length) return fail('A descriptive question needs "Keywords:" (separated by ;).');
      const [minW = null, maxW = null] = ((b.f.words || '').match(/\d+/g) || []).map(Number);
      if (minW && maxW && maxW < minW) return fail('"Words:" should be like 100-150.');
      return rows.push({ module_id: moduleId, level: rowLevel, kind: 'essay', text: b.q, options: [], correct: null, accepted,
        model_answer: (b.f['model answer'] || '').trim() || null, min_words: minW, max_words: maxW });
    }
    const ans = (b.f.answer || '').trim();
    if (!ans) return fail('The "Answer:" line is missing.');
    if (!b.opts.length) {
      const accepted = ans.split(/\s*[;/]\s*/).filter(Boolean);
      return rows.push({ module_id: moduleId, level: rowLevel, kind: 'text', text: b.q, options: [], correct: null, accepted });
    }
    if (b.opts.length < 2 || b.opts.length > 6) return fail('Give 2 to 6 options (A to F).');
    // "B", "B) text", "A, C", "A and C" → letters; otherwise the answer may repeat an option's text
    let picks = [];
    for (const tok of ans.split(/[\s,&+/()]+|\band\b|और/i).filter(Boolean)) {
      if (!/^[A-F]$/i.test(tok)) break;
      picks.push(tok.toUpperCase().charCodeAt(0) - 65);
    }
    if (!picks.length) picks = [b.opts.findIndex(o => o.toLowerCase() === ans.toLowerCase())];
    picks = [...new Set(picks)].sort((x, y) => x - y);
    if (picks.some(p => p < 0 || p >= b.opts.length)) return fail(`"Answer: ${ans}" doesn't match an option.`);
    if (b.f.time !== undefined) {
      const at = parseClock(b.f.time);
      if (at === null) return fail('"Time:" should be like 2:30.');
      if (!videoId) return fail('This chapter has no YouTube video, so checkpoints (Time:) can\'t be added.');
      if (picks.length > 1) return fail('A checkpoint can have only one right answer.');
      return cps.push({ module_id: moduleId, video_id: videoId, at_sec: at, text: b.q, options: b.opts, correct: picks[0], explanation: (b.f.explanation || '').trim() || null });
    }
    rows.push(picks.length === 1
      ? { module_id: moduleId, level: rowLevel, kind: 'single', text: b.q, options: b.opts, correct: picks[0], accepted: null }
      : { module_id: moduleId, level: rowLevel, kind: 'multi', text: b.q, options: b.opts, correct: null, accepted: picks });
  });
  return { rows, cps, bad };
}

const LEVELS = { easy: ['Easy', 'Agents'], moderate: ['Moderate', 'Executives'], hard: ['Hard', 'Managers'] };
const LEVEL_CLS = { easy: 'b-ok', moderate: 'b-blue', hard: 'b-gold' };
const levelLabel = l => `${LEVELS[l][0]} · ${LEVELS[l][1]}`;
const levelBadge = l => `<span class="badge ${LEVEL_CLS[l || 'moderate']}">${levelLabel(l || 'moderate')}</span>`;
const levelSelect = (attrs, value = 'moderate') =>
  `<select ${attrs}>${Object.keys(LEVELS).map(l => `<option value="${l}" ${l === value ? 'selected' : ''}>${levelLabel(l)}</option>`).join('')}</select>`;

const KIND_LABEL = { single: 'One answer', multi: 'Multiple answers', text: 'Written answer', essay: 'Descriptive (trainer checks)' };
const wordRange = (min, max) => (min && max ? `${min}–${max} words` : min ? `at least ${min} words` : `up to ${max} words`);
const countWords = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const fmtMark = n => String(Math.round(Number(n) * 100) / 100);
const isRight = (q, j) => (q.kind === 'multi' ? (q.accepted || []).includes(j) : j === q.correct);
const showAnswer = a => /^https?:\/\//i.test(a)
  ? `<a href="${esc(a)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(a)}</a>`
  : `<span style="white-space:pre-wrap">${esc(a)}</span>`;

// one submitted question inside an attempt (old snapshots have no kind = single)
function detailView(d, i) {
  const kind = d.kind || 'single';
  if (kind === 'essay') {
    return `<div style="margin-top:12px"><strong>${i + 1}. ${esc(d.question)}</strong> <span class="badge">Descriptive</span>
      ${d.review === 'pending' ? `<span class="badge b-warn">${icon('clock')} Review pending</span>` : `<span class="badge b-ok">${icon('check')} Reviewed</span>`}
      <div class="task-answer">${esc(d.chosen || '—')}</div>
      <span class="sub">Keywords found: ${(d.matched || []).map(esc).join(', ') || 'none'} · keyword mark ${fmtMark(d.auto_mark)}
        · final mark <strong>${fmtMark(d.mark)}</strong>${d.feedback ? ` · feedback: ${esc(d.feedback)}` : ''}</span>
      ${d.review === 'pending' ? `<div><a class="btn btn-sm" href="#/reviews" style="margin-top:6px">${icon('clipboard', 'sm')} Review it</a></div>` : ''}</div>`;
  }
  if (kind === 'text') {
    const ok = d.ok ?? false;
    return `<p style="margin-top:12px"><strong>${i + 1}. ${esc(d.question)}</strong><br>
      Answer: <span class="${ok ? 'ok-t' : 'err-t'}">${esc(d.chosen ?? '—')} ${ok ? '✓' : '✗'}</span><br>
      <span class="sub">Accepted: ${(d.accepted || []).map(esc).join(' / ')}</span></p>`;
  }
  const q = { ...d, kind };
  const chosen = j => (Array.isArray(d.chosen) ? d.chosen.includes(j) : d.chosen === j);
  return `<p style="margin-top:12px"><strong>${i + 1}. ${esc(d.question)}</strong>${kind === 'multi' ? ' <span class="badge">Multiple answers</span>' : ''}<br>
    ${d.options.map((o, j) => `<span class="${isRight(q, j) ? 'ok-t' : chosen(j) ? 'err-t' : ''}">${chosen(j) ? '● ' : '○ '}${esc(o)}${isRight(q, j) ? ' ✓' : ''}</span>`).join('<br>')}</p>`;
}

async function boot() {
  try {
    let { user, profile } = await getSessionProfile();
    if (!user) return viewLogin(true);
    if (!profile) { // employee pre-added by an admin, signing in here first
      const { data: claimed } = await sb.rpc('claim_invite');
      if (claimed) ({ profile } = await getSessionProfile());
    }
    if (profile?.role !== 'admin') return show(`<div class="card narrow empty">${icon('shield')}<h2>No access</h2><p>${esc(user.email)} is not an admin account.</p><p class="small">See the "Create the first admin" step in the README.</p></div>`, user.email);
    me = profile;
    await route();
  } catch (e) { fail(e); }
}

async function route() {
  try {
    const [, page, id] = location.hash.split('/');
    if (page === 'users') return await viewUsers();
    if (page === 'user' && uuid.test(id)) return await viewUser(id);
    if (page === 'courses') return await viewCourses();
    if (page === 'guide') return viewGuide();
    if (page === 'reviews') return await viewReviews();
    if (page === 'course' && uuid.test(id)) return await viewCourse(id);
    if (page === 'module' && uuid.test(id)) return await viewModule(id);
    return await viewOverview();
  } catch (e) { fail(e); }
}

function adminShow(html) {
  const section = /^#\/(courses|course|module)/.test(location.hash) ? 'courses'
    : /^#\/(users|user)/.test(location.hash) ? 'users' : /^#\/guide/.test(location.hash) ? 'guide'
    : /^#\/reviews/.test(location.hash) ? 'reviews' : 'overview';
  const item = (href, ic, label, on, ext) =>
    `<a class="nav-item ${on ? 'on' : ''}" href="${href}" ${on ? 'aria-current="page"' : ''} ${ext ? 'target="_blank" rel="noopener"' : ''}>${icon(ic)} ${label}</a>`;
  show(`<div class="admin">
    <aside class="side"><p class="label">Admin</p><nav aria-label="Admin">
      ${item('#/', 'chart', 'Overview', section === 'overview')}
      ${item('#/users', 'users', 'Learners', section === 'users')}
      ${item('#/reviews', 'clipboard', 'Reviews', section === 'reviews')}
      ${item('#/courses', 'layers', 'Trainings & Tests', section === 'courses')}
      ${item('#/guide', 'book', 'Question guide', section === 'guide')}
      ${item('index.html', 'external', 'Learner view', false, true)}
    </nav></aside>
    <main id="main" class="fade-in">${html}</main>
  </div>`, me.full_name, true);
}

// ---------- overview dashboard ----------

// learner-type hues, checked with the dataviz validate_palette script (light surface: all checks pass)
const MIX = { candidate: '#2457C5', agent: '#C27C0E', employee: '#0E9384' };
const pctOf = (n, d) => d ? Math.round(100 * n / d) : 0;
const ago = t => {
  const s = (Date.now() - new Date(t)) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
let ov = { type: '' };

async function viewOverview() {
  const [u, a, m, rv, cr] = await Promise.all([
    sb.rpc('admin_users'),
    sb.from('attempts').select('user_id,module_id,passed,pct,submitted_at,events,late,profiles(full_name)').not('submitted_at', 'is', null).order('submitted_at', { ascending: false }),
    sb.from('modules').select('id,seq,title,courses(title)').eq('published', true).order('seq'),
    sb.rpc('admin_reviews'), // missing until essay.sql is run: the nudge just hides
    sb.from('profiles').select('id,full_name,camera_request').not('camera_request', 'is', null).eq('camera_exempt', false), // camera.sql
  ]);
  const err = u.error || a.error || m.error;
  if (err) throw err;
  ov = { ...ov, users: u.data, attempts: a.data, modules: m.data, pendingReviews: rv.error ? 0 : rv.data.length, camRequests: cr.error ? [] : cr.data };
  adminShow('<div id="ov"></div>');
  drawOverview();
}

function drawOverview() {
  const t = ov.type;
  const users = ov.users.filter(u => !t || u.user_type === t);
  const ids = new Set(users.map(u => u.id));
  const atts = ov.attempts.filter(a => ids.has(a.user_id));
  const enrolled = users.filter(u => u.modules_total > 0);
  const done = enrolled.filter(u => u.modules_passed >= u.modules_total);
  const newWeek = users.filter(u => Date.now() - new Date(u.created_at) < 7 * 864e5).length;
  const passRate = pctOf(atts.filter(a => a.passed).length, atts.length);

  const funnel = [
    ['Registered', users.length],
    ['Took a test', users.filter(u => u.attempts > 0).length],
    ['Passed a chapter', users.filter(u => u.modules_passed > 0).length],
    ['Completed all chapters', done.length],
    ['Shortlisted', users.filter(u => u.status === 'shortlisted').length],
  ];

  const days = [...Array(30)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 29 + i); return d; });
  const reg = days.map(d => users.filter(u => { const c = new Date(u.created_at); return c >= d && c - d < 864e5; }).length);
  const maxReg = Math.max(1, ...reg);
  const fmtDay = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  const chapters = ov.modules.map(m => {
    const ma = atts.filter(a => a.module_id === m.id);
    const learners = new Set(ma.map(a => a.user_id)).size;
    const passed = new Set(ma.filter(a => a.passed).map(a => a.user_id)).size;
    return { m, learners, passed, rate: pctOf(passed, learners),
      avg: ma.length ? Math.round(ma.reduce((s, a) => s + Number(a.pct), 0) / ma.length) : null,
      tries: learners ? (ma.length / learners).toFixed(1) : '—' };
  });
  // ponytail: "hardest" needs 3+ learners so one bad attempt doesn't flag a chapter
  const rated = chapters.filter(c => c.learners >= 3);
  const hardest = rated.length > 1 ? rated.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;

  const mix = Object.keys(MIX).map(k => [k, ov.users.filter(u => u.user_type === k).length]);
  const mixTotal = ov.users.length;

  const tile = (ic, cls, val, lbl, sub) => `<div class="stat"><span class="ico ${cls}">${icon(ic)}</span><div><div class="val">${val}</div><div class="lbl">${lbl}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`;
  const filters = [['', 'Everyone'], ['candidate', 'Candidates'], ['agent', 'Agents'], ['employee', 'Employees']];

  document.getElementById('ov').innerHTML = `
    ${(() => {
      const none = ov.users.filter(u => !u.courses && u.id !== me.id);
      return none.length ? `<div class="notice">${icon('alert')}<span><strong>${none.length} learner${none.length > 1 ? 's have' : ' has'} no training</strong> and see "No training yet":
        ${none.map(u => `<a href="#/user/${u.id}">${esc(u.full_name)}</a>`).join(', ')}. Open each one and assign a training in the Trainings card.</span></div>` : '';
    })()}
    ${ov.camRequests.map(r => `<a class="notice" href="#/user/${r.id}" style="text-decoration:none">${icon('video')}<span><strong>${esc(r.full_name)} asks to continue without the camera:</strong> “${esc(r.camera_request)}”. Their videos and tests are locked until you decide. Open →</span></a>`).join('')}
    ${ov.pendingReviews ? `<a class="notice" href="#/reviews" style="text-decoration:none">${icon('clipboard')}<span><strong>${ov.pendingReviews} descriptive answer${ov.pendingReviews > 1 ? 's' : ''} waiting for review.</strong> Their test results are provisional until you mark them. Review now →</span></a>` : ''}
    <div class="page-head">
      <div><h1>Overview</h1><p class="muted">How training and selection are going</p></div>
      <div class="seg" role="group" aria-label="Show learners">${filters.map(([v, l]) =>
        `<button class="${v === t ? 'on' : ''}" aria-pressed="${v === t}" onclick="ov.type='${v}';drawOverview()">${l}</button>`).join('')}</div>
    </div>
    <div class="stats stagger">
      ${tile('users', '', users.length, 'Learners', `+${newWeek} this week`)}
      ${tile('award', 'ok', done.length, 'Completed all chapters', `${pctOf(done.length, enrolled.length)}% of enrolled`)}
      ${tile('clipboard', 'gold', atts.length, 'Tests taken', `${passRate}% of attempts passed`)}
      ${tile('check', 'ok', funnel[4][1], 'Shortlisted', `${pctOf(funnel[4][1], users.length)}% of learners`)}
    </div>

    <div class="chart-grid">
      <section class="card">
        <div class="card-head"><h2>${icon('funnel')} Selection funnel</h2><span class="muted small">% of registered</span></div>
        <div class="funnel">${funnel.map(([l, n]) => {
          const p = pctOf(n, funnel[0][1]);
          return `<div class="f-row" tabindex="0" data-tip="${l}: ${n} (${p}% of registered)">
            <span class="f-lbl">${l}</span>
            <div class="f-track"><i style="width:${p}%"></i></div>
            <span class="f-val num">${n} <span class="sub">${p}%</span></span>
          </div>`;
        }).join('')}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('chart')} New registrations</h2><span class="muted small">Last 30 days · ${reg.reduce((s, n) => s + n, 0)} total</span></div>
        <div class="cols">
          <div class="cols-y" aria-hidden="true"><span class="num">${maxReg}</span><span class="num">0</span></div>
          <div class="cols-plot">${reg.map((n, i) =>
            `<div class="col" tabindex="0" data-tip="${fmtDay(days[i])}: ${n} registration${n === 1 ? '' : 's'}" aria-label="${fmtDay(days[i])}: ${n}"><i style="height:${100 * n / maxReg}%"></i></div>`).join('')}</div>
        </div>
        <div class="cols-x" aria-hidden="true"><span>${fmtDay(days[0])}</span><span>${fmtDay(days[15])}</span><span>Today</span></div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>${icon('book')} Chapter performance</h2><span class="muted small">Pass rate = learners who passed ÷ learners who attempted</span></div>
      ${chapters.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Chapter</th><th>Attempted</th><th style="min-width:180px">Pass rate</th><th>Avg score</th><th>Avg tries</th></tr></thead>
        <tbody>${chapters.map(c => `<tr>
          <td><a href="#/module/${c.m.id}" style="font-weight:600">Ch ${c.m.seq}: ${esc(c.m.title)}</a>
            <div class="sub">${esc(c.m.courses?.title)}</div>
            ${c === hardest ? `<span class="badge b-warn" style="margin-top:4px">${icon('alert')} Lowest pass rate</span>` : ''}</td>
          <td class="num">${c.learners}</td>
          <td><div class="mini-bar" data-tip="${c.passed} of ${c.learners} passed" tabindex="0"><div class="bar"><i style="width:${c.rate}%"></i></div><span class="num small">${c.learners ? c.rate + '%' : '—'}</span></div></td>
          <td class="num">${c.avg ?? '—'}${c.avg != null ? '%' : ''}</td>
          <td class="num">${c.tries}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty">${icon('book')}<p>Publish a chapter to see its results here.</p></div>`}
    </section>

    <div class="chart-grid">
      <section class="card">
        <div class="card-head"><h2>${icon('pie')} Learner mix</h2><span class="muted small">All ${mixTotal} learners</span></div>
        <div class="stack" role="img" aria-label="${mix.map(([k, n]) => `${TYPE_LABEL[k]} ${n}`).join(', ')}">${mix.filter(([, n]) => n).map(([k, n]) =>
          `<i style="flex:${n};background:${MIX[k]}" tabindex="0" data-tip="${TYPE_LABEL[k]}: ${n} (${pctOf(n, mixTotal)}%)"></i>`).join('') || '<i style="flex:1;background:#E7ECF3"></i>'}</div>
        <ul class="legend">${mix.map(([k, n]) => `<li><span class="sw" style="background:${MIX[k]}"></span>${TYPE_LABEL[k]}s<b class="num">${n}</b><span class="sub">${pctOf(n, mixTotal)}%</span></li>`).join('')}</ul>
        <h3 style="margin-top:20px">By status${t ? ` · ${TYPE_LABEL[t]}s` : ''}</h3>
        <div class="row">${STATUSES.map(s => `<a class="badge ${STATUS_CLS[s]}" href="#/users" style="text-decoration:none">${s} <b class="num">${users.filter(u => u.status === s).length}</b></a>`).join('')}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('activity')} Recent tests</h2><a class="small" href="#/users">All learners →</a></div>
        ${atts.length ? `<ul class="feed">${atts.slice(0, 8).map(a => {
          const m = ov.modules.find(x => x.id === a.module_id);
          return `<li>
            <span class="avatar" aria-hidden="true">${esc(initials(a.profiles?.full_name))}</span>
            <div style="flex:1;min-width:0"><a href="#/user/${a.user_id}" style="font-weight:600">${esc(a.profiles?.full_name)}</a>
              <div class="sub">${m ? `Ch ${m.seq}: ${esc(m.title)}` : 'Chapter'} · ${ago(a.submitted_at)}</div></div>
            ${(a.events || []).some(e => EVENT_LABEL[e.type]) || a.late ? `<span class="badge b-warn" title="Warnings recorded: open the learner to see them">${icon('alert')}</span>` : ''}
            <span class="badge ${a.passed ? 'b-ok' : 'b-err'}">${icon(a.passed ? 'check' : 'x')} ${Math.round(a.pct)}%</span>
          </li>`;
        }).join('')}</ul>` : `<div class="empty">${icon('activity')}<p>No tests taken yet.</p></div>`}
      </section>
    </div>`;
}

// ---------- users ----------

async function viewUsers() {
  const [u, inv, courses] = await Promise.all([
    sb.rpc('admin_users'),
    sb.from('employee_invites').select('*').order('created_at', { ascending: false }),
    sb.from('courses').select('id,title,category').order('title'),
  ]);
  const err = u.error || inv.error || courses.error;
  if (err) throw err;
  users = u.data;
  const titles = Object.fromEntries(courses.data.map(c => [c.id, c.title]));
  adminShow(`
    <div class="page-head">
      <div><h1>Learners</h1><p class="muted">Progress of candidates, agents and employees</p></div>
      <div class="row">
        <a class="btn btn-primary" href="${waLink('', inviteMsg())}" target="_blank" rel="noopener">${icon('whatsapp', 'sm')} Invite on WhatsApp</a>
        <button class="btn" onclick="copyLink()">${icon('link', 'sm')} Copy portal link</button>
        <button class="btn" onclick="exportCsv()">${icon('download', 'sm')} Export CSV</button>
      </div>
    </div>
    <details class="card" ${inv.data.length ? 'open' : ''}>
      <summary>${icon('userPlus')} Add employee <span class="badge">${inv.data.length} pending sign-in</span></summary>
      <p class="muted small">Employees don't register themselves. Add their Gmail here, and their account is created automatically the first time they sign in with it.</p>
      <form onsubmit="addEmployee(event)">
        <div class="grid-2">
          <div class="field"><label for="e-name">Name</label><input id="e-name" name="full_name" type="text" required></div>
          <div class="field"><label for="e-email">Gmail</label><input id="e-email" name="email" type="email" required placeholder="name@gmail.com"></div>
          <div class="field"><label for="e-phone">Mobile</label><input id="e-phone" name="phone" type="tel" required pattern="[6-9][0-9]{9}" maxlength="10" inputmode="numeric"></div>
          <div class="field"><label for="e-course">Training</label><select id="e-course" name="course"><option value="">Assign later</option>${courses.data.map(c => `<option value="${c.id}">${esc(c.category)} — ${esc(c.title)}</option>`).join('')}</select></div>
          <div class="field"><label for="e-level">Test level</label>${levelSelect('id="e-level" name="level"')}</div>
        </div>
        <button class="btn btn-primary" type="submit">${icon('plus', 'sm')} Add employee</button>
      </form>
      ${inv.data.length ? `<div class="table-wrap" style="margin-top:16px"><table>
        <thead><tr><th>Name</th><th>Gmail</th><th>Mobile</th><th>Training</th><th><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${inv.data.map(i => `<tr><td>${esc(i.full_name)}</td><td>${esc(i.email)}</td><td class="num">${esc(i.phone)}</td>
          <td>${i.course_ids.map(id => esc(titles[id] || '—')).join(', ') || '—'}</td>
          <td><button class="btn btn-sm btn-danger" onclick="delInvite(${esc(JSON.stringify(i.email))})" aria-label="Remove">${icon('trash', 'sm')}</button></td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    </details>
    <section class="card">
      <div class="toolbar">
        <div class="search">${icon('search', 'sm')}<input id="f-q" type="search" placeholder="Search name, mobile or email" oninput="drawUsers()" aria-label="Search"></div>
        <select id="f-type" onchange="drawUsers()" aria-label="Type">
          <option value="">Everyone</option><option value="candidate">Candidates</option><option value="agent">Agents</option><option value="employee">Employees</option>
        </select>
        <select id="f-status" onchange="drawUsers()" aria-label="Status">
          <option value="">Any status</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}
        </select>
        <label class="check" style="flex:0 1 auto"><input type="checkbox" id="f-done" onchange="drawUsers()"> Only those who completed all chapters</label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Learner</th><th>Type</th><th style="min-width:180px">Training</th><th>Progress</th><th>Attempts</th><th>Last activity</th><th>Status</th></tr></thead>
        <tbody id="u-body"></tbody>
      </table></div>
    </section>`);
  drawUsers();
}

function filtered() {
  const q = document.getElementById('f-q').value.toLowerCase();
  const type = document.getElementById('f-type').value;
  const status = document.getElementById('f-status').value;
  const done = document.getElementById('f-done').checked;
  return users.filter(u =>
    (!q || [u.full_name, u.phone, u.email].some(v => (v || '').toLowerCase().includes(q))) &&
    (!type || u.user_type === type) && (!status || u.status === status) &&
    (!done || (u.modules_total > 0 && u.modules_passed >= u.modules_total)));
}

function drawUsers() {
  const rows = filtered();
  document.getElementById('u-body').innerHTML = rows.map(u => {
    const pct = u.modules_total ? Math.round(100 * u.modules_passed / u.modules_total) : 0;
    return `<tr>
      <td><div class="person"><span class="avatar" aria-hidden="true">${esc(initials(u.full_name))}</span>
        <div><a href="#/user/${u.id}">${esc(u.full_name)}</a><div class="sub">${esc(u.email)}</div><div class="sub num">${esc(u.phone)}</div></div></div></td>
      <td>${TYPE_LABEL[u.user_type] || esc(u.user_type)}</td>
      <td>${u.courses ? esc(u.courses) : `<a class="badge b-err" href="#/user/${u.id}" title="This learner sees 'No training yet'">${icon('alert')} No training · Assign</a>`}</td>
      <td><div class="mini-bar"><div class="bar"><i style="width:${pct}%"></i></div><span class="num small">${u.modules_passed}/${u.modules_total}</span>${pct === 100 ? icon('award', 'sm') : ''}</div></td>
      <td class="num">${u.attempts}</td>
      <td class="small">${when(u.last_activity)}</td>
      <td><select class="status" onchange="setStatus('${u.id}', this.value)" aria-label="Status for ${esc(u.full_name)}">${STATUSES.map(s => `<option ${s === u.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7"><div class="empty">${icon('users')}<p>No records found. Share the learner portal link with your candidates.</p></div></td></tr>`;
}

async function addEmployee(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim().toLowerCase();
  const dup = users.find(u => (u.email || '').toLowerCase() === email || u.phone === fd.get('phone'));
  if (dup) return toast(`${dup.full_name} already has an account with this ${dup.phone === fd.get('phone') ? 'mobile number' : 'email'}. Open their profile and change Type to Employee instead.`, 'err');
  const { error } = await sb.from('employee_invites').insert({
    email, full_name: fd.get('full_name').trim(), phone: fd.get('phone'),
    course_ids: fd.get('course') ? [fd.get('course')] : [], level: fd.get('level'),
  });
  if (error) return toast(error.code === '23505' ? 'This email has already been added.' : error.message, 'err');
  toast('Employee added');
  route();
}

async function delInvite(email) {
  if (!confirm(`Remove ${email} from the list?`)) return;
  const { error } = await sb.from('employee_invites').delete().eq('email', email);
  if (error) return toast(error.message, 'err');
  route();
}

async function setStatus(id, status) {
  const { error } = await sb.from('profiles').update({ status }).eq('id', id);
  if (error) return toast(error.message, 'err');
  const u = users.find(x => x.id === id);
  if (u) u.status = status;
  toast(`Status set to ${status}`);
}

function exportCsv() {
  const cols = ['full_name', 'phone', 'email', 'user_type', 'courses', 'modules_passed', 'modules_total', 'attempts', 'status', 'last_activity', 'created_at'];
  // leading = + - @ would run as a formula in Excel
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = [cols.join(','), ...filtered().map(u => cols.map(c => cell(u[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `lms-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function viewUser(id) {
  const [p, att, enr, courses, taskSubs, vids, cpa] = await Promise.all([
    sb.from('profiles').select('*').eq('id', id).single(),
    sb.from('attempts').select('id,score,total,pct,passed,started_at,submitted_at,detail,events,late,modules(title,seq,courses(title))').eq('user_id', id).order('started_at', { ascending: false }),
    sb.from('enrollments').select('course_id,level,courses(title)').eq('user_id', id),
    sb.from('courses').select('id,title,category').order('title'),
    sb.from('task_submissions').select('answer,submitted_at,modules(title,seq,courses(title))').eq('user_id', id).order('submitted_at', { ascending: false }),
    sb.from('video_progress').select('module_id,video_id,max_sec,duration,completed,updated_at,events,modules(title,seq)').eq('user_id', id).order('updated_at', { ascending: false }),
    sb.from('checkpoint_answers').select('*, video_checkpoints(module_id,video_id,at_sec,text,options,correct)').eq('user_id', id),
  ]);
  const err = p.error || att.error || enr.error || courses.error;
  if (err) throw err;
  const subs = taskSubs.error ? [] : taskSubs.data; // empty until assignments.sql is run
  const watched = vids.error ? [] : vids.data;     // empty until video.sql is run
  const cpAns = cpa.error ? [] : cpa.data;         // empty until checkpoints.sql is run
  // everyone's response times on the same checkpoints → the average this learner is compared with
  const timed = cpAns.filter(a => a.response_ms != null);
  const all = timed.length ? (await sb.from('checkpoint_answers').select('checkpoint_id,response_ms').in('checkpoint_id', timed.map(a => a.checkpoint_id)).not('response_ms', 'is', null)).data || [] : [];
  const avgOf = cpId => { const t = all.filter(a => a.checkpoint_id === cpId); return t.length ? { ms: t.reduce((x, a) => x + a.response_ms, 0) / t.length, n: t.length } : null; };
  const cpRows = v => cpAns.filter(a => a.video_checkpoints?.module_id === v.module_id && a.video_checkpoints?.video_id === v.video_id)
    .sort((a, b) => a.video_checkpoints.at_sec - b.video_checkpoints.at_sec)
    .map(a => ({ ...a, avg: avgOf(a.checkpoint_id), flag: cpFlag(a.response_ms, avgOf(a.checkpoint_id)) }));
  const cpScore = v => {
    const mine = cpAns.filter(a => a.video_checkpoints?.module_id === v.module_id && a.video_checkpoints?.video_id === v.video_id);
    return mine.length ? `${mine.filter(a => a.correct).length}/${mine.length}` : null;
  };
  const evCount = (v, type) => (v.events || []).filter(e => e.type === type).length;
  const mmss = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const u = p.data, enrolled = new Set(enr.data.map(e => e.course_id));
  const available = courses.data.filter(c => !enrolled.has(c.id));
  adminShow(`
    <a class="crumb" href="#/users">${icon('left', 'sm')} All learners</a>
    <section class="card">
      <div class="row" style="align-items:flex-start;gap:16px">
        <span class="avatar lg" aria-hidden="true">${esc(initials(u.full_name))}</span>
        <div style="flex:1;min-width:200px">
          <h1 style="margin-bottom:4px">${esc(u.full_name)} ${u.role === 'admin' ? `<span class="badge b-gold">${icon('shield')} Admin</span>` : ''}</h1>
          <div class="row small muted"><span>${esc(u.phone)}</span>·<span>${esc(u.email)}</span>·<span>Registered ${when(u.created_at)}</span>
            <label class="row" style="margin:0;gap:6px;font-weight:600">Type
              <select class="status" onchange="setType('${u.id}', this.value)" ${u.id === me.id ? 'disabled' : ''}>${Object.entries(TYPE_LABEL).map(([v, l]) => `<option value="${v}" ${v === u.user_type ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </label></div>
          <div class="row" style="margin-top:12px">
            <a class="btn btn-sm" href="${waLink(u.phone)}" target="_blank" rel="noopener">${icon('whatsapp', 'sm')} WhatsApp</a>
            <a class="btn btn-sm" href="tel:+91${esc(u.phone)}">${icon('phone', 'sm')} Call</a>
            ${u.id === me.id ? '' : u.role === 'admin'
              ? `<button class="btn btn-sm btn-danger" onclick="setRole('${u.id}','learner')">${icon('shield', 'sm')} Remove admin</button>`
              : u.user_type === 'employee' ? `<button class="btn btn-sm" onclick="setRole('${u.id}','admin')">${icon('shield', 'sm')} Make admin</button>` : ''}
            ${u.id === me.id || u.role === 'admin' ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteLearner('${u.id}', ${esc(JSON.stringify(u.full_name))})">${icon('trash', 'sm')} Delete learner</button>`}
          </div>
          <div class="row" style="margin-top:12px">${STATUSES.map(s => `<button class="btn btn-sm ${s === u.status ? 'btn-primary' : ''}" ${s === u.status ? 'aria-pressed="true"' : ''} onclick="setStatus('${u.id}','${s}').then(route)">${s}</button>`).join('')}</div>
        </div>
      </div>
      ${'camera_exempt' in u ? `<div class="row small" style="margin-top:16px;gap:8px">
        ${u.camera_exempt ? `<span class="badge b-warn">${icon('video')} Camera not required (approved)</span>
            <button class="btn btn-sm" onclick="setCamera('${u.id}', false)">Require camera again</button>`
          : u.camera_request ? `<div class="notice" style="margin:0;flex-basis:100%">${icon('video')}<span><strong>Asks to continue without the camera</strong> (${when(u.camera_request_at)}): “${esc(u.camera_request)}”</span></div>
            <button class="btn btn-sm btn-primary" onclick="setCamera('${u.id}', true)">${icon('check', 'sm')} Approve: no camera</button>
            <button class="btn btn-sm" onclick="setCamera('${u.id}', false)">${icon('x', 'sm')} Reject</button>`
          : `<span class="badge">${icon('video')} Camera required</span>
            <button class="btn btn-sm" onclick="setCamera('${u.id}', true)">Excuse from camera</button>`}
      </div>` : ''}
      <div class="field" style="margin:20px 0 0">
        <label for="notes">Notes (interview / call remarks)</label>
        <textarea id="notes">${esc(u.notes)}</textarea>
        <button class="btn btn-sm" style="margin-top:8px" onclick="saveNotes('${u.id}')">${icon('save', 'sm')} Save notes</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('layers')} Trainings</h2></div>
      ${enr.data.map(e => `<div class="qb-item"><strong style="flex:1;min-width:140px">${esc(e.courses?.title)}</strong>
        <div class="row"><label class="row small" style="margin:0;gap:6px">Test level ${levelSelect(`class="status" onchange="setLevel('${u.id}','${e.course_id}',this.value)"`, e.level)}</label>
        <button class="btn btn-sm btn-danger" onclick="unenroll('${u.id}','${e.course_id}')">${icon('trash', 'sm')} Remove</button></div></div>`).join('') || '<p class="muted">No training assigned.</p>'}
      ${available.length ? `<div class="row" style="margin-top:12px">
        <select id="enroll-course" style="flex:1;min-width:200px" aria-label="Training">${available.map(c => `<option value="${c.id}">${esc(c.category)} — ${esc(c.title)}</option>`).join('')}</select>
        ${levelSelect('id="enroll-level" style="flex:1;min-width:160px" aria-label="Test level"', u.user_type === 'agent' ? 'easy' : 'moderate')}
        <button class="btn btn-primary" onclick="enroll('${u.id}')">${icon('plus', 'sm')} Assign</button>
      </div>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('clipboard')} Test attempts</h2><span class="muted small">${att.data.length} total</span></div>
      ${att.data.map(a => `
        <details class="attempt">
          <summary>
            ${a.submitted_at ? `<span class="badge ${a.passed ? 'b-ok' : 'b-err'}">${icon(a.passed ? 'check' : 'x')} ${a.passed ? 'PASS' : 'FAIL'}</span>` : '<span class="badge b-warn">In progress</span>'}
            <strong>Ch ${a.modules?.seq}: ${esc(a.modules?.title)}</strong>
            ${a.submitted_at ? `<span class="num">${fmtMark(a.score)}/${a.total} (${Math.round(a.pct)}%)</span>
              <span class="sub">${Math.max(1, Math.round((new Date(a.submitted_at) - new Date(a.started_at)) / 60000))} min</span>` : ''}
            ${integrityBadges(a)}
            <span class="sub" style="margin-left:auto">${esc(a.modules?.courses?.title)} · ${when(a.submitted_at || a.started_at)}</span>
          </summary>
          <div class="attempt-body">${(a.detail || []).map(detailView).join('') || '<p class="muted" style="margin-top:12px">Not submitted yet.</p>'}</div>
        </details>`).join('') || `<div class="empty">${icon('clipboard')}<p>No tests taken yet.</p></div>`}
    </section>
    ${watched.length ? `<section class="card">
      <div class="card-head"><h2>${icon('video')} Videos</h2><span class="muted small">${watched.filter(v => v.completed).length} of ${watched.length} watched fully</span></div>
      ${watched.map(v => `<div class="qb-item"><div style="flex:1;min-width:0">
        <strong>Ch ${v.modules?.seq}: ${esc(v.modules?.title)}</strong> <span class="sub">${when(v.updated_at)}</span>
        <div class="mini-bar" style="margin-top:6px"><div class="bar"><i style="width:${v.duration ? Math.min(100, 100 * v.max_sec / v.duration) : 0}%"></i></div>
          <span class="num small">${mmss(Number(v.max_sec))}${v.duration ? ` / ${mmss(Number(v.duration))}` : ''}</span></div>
        <div class="row" style="margin-top:6px;gap:6px">
          ${cpScore(v) ? `<span class="badge b-blue">${icon('clipboard')} Checkpoints ${cpScore(v)} right first time</span>` : ''}
          ${cpTimeBadges(cpRows(v))}
          ${evCount(v, 'left_page') ? `<span class="badge b-err">${icon('alert')} Left the page ×${evCount(v, 'left_page')} while watching</span>` : ''}
          ${evCount(v, 'no_face') ? `<span class="badge b-err">${icon('video')} Face not visible ×${evCount(v, 'no_face')} (video paused)</span>` : ''}
          ${evCount(v, 'camera_off') ? `<span class="badge b-err">${icon('video')} Camera turned off ×${evCount(v, 'camera_off')}</span>` : ''}
        </div></div>
        ${cpReport(cpRows(v))}</div>
        ${v.completed ? `<span class="badge b-ok">${icon('check')} Watched</span>` : `<span class="badge b-warn">${icon('clock')} In progress</span>`}</div>`).join('')}
    </section>` : ''}
    ${subs.length ? `<section class="card">
      <div class="card-head"><h2>${icon('briefcase')} Practical tasks</h2><span class="muted small">${subs.length} submitted</span></div>
      ${subs.map(t => `<div class="qb-item"><div style="min-width:0">
        <strong>Ch ${t.modules?.seq}: ${esc(t.modules?.title)}</strong> <span class="sub">${esc(t.modules?.courses?.title)} · ${when(t.submitted_at)}</span>
        <div style="margin-top:6px">${showAnswer(t.answer)}</div></div></div>`).join('')}
    </section>` : ''}`);
}

// e.g. a selected candidate joins the team → Employee (also unlocks "Make admin")
async function setType(id, type) {
  const { error } = await sb.from('profiles').update({ user_type: type }).eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(`Type changed to ${TYPE_LABEL[type]}`);
  route();
}

// only employees can be promoted, and never yourself (so you can't lock yourself out)
async function setRole(id, role) {
  if (!confirm(role === 'admin'
    ? 'Give this person full admin access? They will see every learner, all results, and can edit trainings.'
    : 'Remove admin access from this person?')) return;
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(role === 'admin' ? 'Admin access given' : 'Admin access removed');
  route();
}

// approve = videos and tests open without the camera; reject = clears the request (camera still needed)
async function setCamera(id, exempt) {
  const { error } = await sb.from('profiles').update({ camera_exempt: exempt, camera_request: null, camera_request_at: null }).eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(exempt ? 'Approved: this learner can continue without the camera' : 'Camera is required for this learner');
  route();
}

// permanent: the profile and everything under it (trainings, tests, videos, checkpoints, tasks) cascade away.
// Their Google login stays, so if they sign in again they see the registration form like a new person.
async function deleteLearner(id, name) {
  if (!confirm(`Delete ${name} permanently?\n\nTheir trainings, test attempts, video progress, checkpoint answers and tasks will be deleted and cannot be recovered.\n\nTo only hide them from your lists, cancel and set their status to "inactive" or "rejected" instead.`)) return;
  if (prompt(`Type DELETE to confirm deleting ${name}:`) !== 'DELETE') return toast('Not deleted');
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  toast(`${name} deleted`);
  location.hash = '#/users';
}

async function saveNotes(id) {
  const { error } = await sb.from('profiles').update({ notes: document.getElementById('notes').value }).eq('id', id);
  error ? toast(error.message, 'err') : toast('Notes saved');
}

async function setLevel(userId, courseId, level) {
  const { error } = await sb.from('enrollments').update({ level }).eq('user_id', userId).eq('course_id', courseId);
  error ? toast(error.message, 'err') : toast(`Test level: ${levelLabel(level)}`);
}

async function enroll(userId) {
  const course_id = document.getElementById('enroll-course').value;
  const { error } = await sb.from('enrollments').insert({ user_id: userId, course_id, level: document.getElementById('enroll-level').value });
  if (error) return toast(error.message, 'err');
  toast('Training assigned');
  route();
}

async function unenroll(userId, courseId) {
  if (!confirm('Remove this training? Test history will be kept.')) return;
  const { error } = await sb.from('enrollments').delete().eq('user_id', userId).eq('course_id', courseId);
  if (error) return toast(error.message, 'err');
  route();
}

// ---- checkpoint response time: how long the learner took to answer, against everyone's average ----
const secs = ms => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`);
// slow: well over the usual time (looked it up? left the screen?) · quick: answered before reading the question
// ponytail: fixed rules; with 3+ answers the average sets "usual", before that 20s does
function cpFlag(ms, avg) {
  if (ms == null) return null;
  if (ms < 2000) return 'quick';
  const usual = avg && avg.n >= 3 ? avg.ms : 10000;
  return ms > Math.max(2 * usual, 20000) ? 'slow' : null;
}
const CP_FLAG = { slow: ['b-err', 'Slow'], quick: ['b-warn', 'Too quick'] };

function cpTimeBadges(rows) {
  const t = rows.filter(r => r.response_ms != null);
  if (!t.length) return '';
  const mine = t.reduce((x, r) => x + r.response_ms, 0) / t.length;
  const avgs = t.filter(r => r.avg);
  const usual = avgs.length ? avgs.reduce((x, r) => x + r.avg.ms, 0) / avgs.length : null;
  const slow = t.filter(r => r.flag === 'slow').length, quick = t.filter(r => r.flag === 'quick').length;
  return `<span class="badge ${usual && mine > 2 * usual ? 'b-err' : ''}">${icon('clock')} Avg answer time ${secs(mine)}${usual ? ` · everyone ${secs(usual)}` : ''}</span>
    ${slow ? `<span class="badge b-err">${icon('alert')} ${slow} slow answer${slow > 1 ? 's' : ''}</span>` : ''}
    ${quick ? `<span class="badge b-warn">${icon('alert')} ${quick} too quick</span>` : ''}`;
}

function cpReport(rows) {
  if (!rows.length) return '';
  return `<details class="cp-report"><summary>Checkpoint answers (${rows.length})</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>At</th><th>Question</th><th>Answer</th><th>Took</th><th>Everyone's avg</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const c = r.video_checkpoints;
        return `<tr><td class="num">${fmtClock(c.at_sec)}</td>
          <td>${esc(c.text)}</td>
          <td>${r.correct ? `<span class="ok-t">✓ ${esc(c.options[r.chosen] ?? '')}</span>` : `<span style="color:var(--err)">✗ ${esc(c.options[r.chosen] ?? '')}</span>`}</td>
          <td class="num">${r.response_ms != null ? secs(r.response_ms) : '—'}</td>
          <td class="num">${r.avg ? `${secs(r.avg.ms)} <span class="sub">(${r.avg.n})</span>` : '—'}</td>
          <td>${r.flag ? `<span class="badge ${CP_FLAG[r.flag][0]}">${CP_FLAG[r.flag][1]}</span>` : ''}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="help" style="margin:6px 0 0"><strong>Slow</strong> = more than twice everyone's average (at least 20s): the learner may have looked the answer up or left the screen.
      <strong>Too quick</strong> = under 2 seconds: answered without reading.</p></details>`;
}

// what the browser recorded during an attempt (events arrive with exam.sql)
const EVENT_LABEL = { left_page: 'left the page', copy: 'tried to copy', paste: 'tried to paste', exit_fullscreen: 'left full screen',
  no_face: 'face not visible', multi_face: 'more than one face', camera_off: 'camera turned off' };
function integrityBadges(a) {
  const ev = a.events || [], counts = {};
  for (const e of ev) if (EVENT_LABEL[e.type]) counts[e.type] = (counts[e.type] || 0) + 1;
  const n = Object.values(counts).reduce((x, y) => x + y, 0);
  const auto = ev.find(e => e.type.startsWith('auto_submit_'))?.type.slice(12);
  return [
    n ? `<span class="badge b-err" title="${Object.entries(counts).map(([t, c]) => `${EVENT_LABEL[t]} ×${c}`).join(', ')}">${icon('alert')} ${n} warning${n > 1 ? 's' : ''}: ${Object.entries(counts).map(([t, c]) => `${EVENT_LABEL[t]} ×${c}`).join(', ')}</span>` : '',
    a.late ? `<span class="badge b-warn">${icon('clock')} ${ev.some(e => e.type === 'expired') ? 'Abandoned, timed out' : 'Late'}</span>` : '',
    auto ? `<span class="badge">${icon('clock')} Auto-submitted: ${auto === 'time_up' ? 'time up' : 'too many warnings'}</span>` : '',
  ].join(' ');
}

// ---------- reviews: trainer marks descriptive answers ----------

let rvAll = false;
const MARKS = [0, 0.25, 0.5, 0.75, 1];

async function viewReviews() {
  const { data, error } = await sb.rpc('admin_reviews', { p_pending_only: !rvAll });
  if (error) throw error;
  const ids = [...new Set(data.map(x => x.user_id))];
  const { data: people } = ids.length ? await sb.from('profiles').select('id,user_type,phone').in('id', ids) : { data: [] };
  const person = Object.fromEntries((people || []).map(p => [p.id, p]));
  // one group per test attempt, newest first (the RPC's order)
  const groups = [];
  data.forEach((x, n) => {
    let g = groups.find(g => g.attempt_id === x.attempt_id);
    if (!g) groups.push(g = { attempt_id: x.attempt_id, first: x, items: [] });
    g.items.push({ ...x, n });
  });
  adminShow(`
    <div class="page-head">
      <div><h1>Reviews</h1><p class="muted">Descriptive answers. Keywords gave a provisional mark; yours is final and updates the test result. Click a test to mark its answers.</p></div>
      <div class="seg" role="group" aria-label="Show">
        <button class="${rvAll ? '' : 'on'}" aria-pressed="${!rvAll}" onclick="rvAll=false;route()">Pending</button>
        <button class="${rvAll ? 'on' : ''}" aria-pressed="${rvAll}" onclick="rvAll=true;route()">All</button>
      </div>
    </div>
    ${groups.length ? `<div class="rv-list">${groups.map(g => {
      const x = g.first, p = person[x.user_id] || {}, pending = g.items.filter(i => i.review === 'pending').length;
      const empty = g.items.filter(i => !countWords(i.answer)).length;
      return `<details class="card rv-group" id="rvg-${g.attempt_id}">
        <summary>
          <span class="avatar" aria-hidden="true">${esc(initials(x.learner))}</span>
          <span class="rv-who"><strong>${esc(x.learner)}</strong>
            <span class="sub">${esc(x.training)} · Ch ${x.chapter_no}: ${esc(x.chapter)}</span></span>
          <span class="rv-meta">
            ${p.user_type ? `<span class="badge">${TYPE_LABEL[p.user_type] || esc(p.user_type)}</span>` : ''}
            ${pending ? `<span class="badge b-warn" data-pending>${icon('clock')} <span>${pending}</span> to review</span>` : `<span class="badge b-ok">${icon('check')} Reviewed</span>`}
            ${empty ? `<span class="badge b-err">${icon('alert')} ${empty} blank</span>` : ''}
            <span class="sub">${when(x.submitted_at)}</span>
          </span>
        </summary>
        <div class="rv-body">
          <p class="small" style="margin:0 0 8px"><a href="#/user/${x.user_id}">Open ${esc(x.learner)}'s full profile →</a>${p.phone ? ` · ${esc(p.phone)}` : ''}</p>
          ${g.items.map(reviewItem).join('')}
        </div>
      </details>`;
    }).join('')}</div>`
      : `<div class="card empty">${icon('check')}<h2>${rvAll ? 'No descriptive answers yet' : 'All caught up'}</h2><p>${rvAll ? 'Answers appear here once learners take a test with a descriptive question.' : 'No answers are waiting for review.'}</p></div>`}`);
}

function reviewItem(x) {
  const nearest = m => MARKS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
  const n = x.n;
  return `<div class="rv-item" id="rv-${n}">
    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
      <p style="margin:0;flex:1"><strong>${esc(x.question)}</strong></p>
      ${x.review === 'pending' ? `<span class="badge b-warn">${icon('clock')} Pending</span>` : `<span class="badge b-ok">${icon('check')} ${fmtMark(x.mark)}</span>`}
    </div>
    <div class="task-answer">${esc(x.answer || '—')}</div>
    <p class="sub" style="margin:4px 0 0">${countWords(x.answer)} words</p>
    <div class="chips" style="margin-top:10px">${(x.keywords || []).map(k => {
      const hit = (x.matched || []).includes(k);
      return `<span class="badge ${hit ? 'b-ok' : ''}">${icon(hit ? 'check' : 'x')} ${esc(k)}</span>`;
    }).join('')}</div>
    <p class="small muted">Keyword mark: ${fmtMark(x.auto_mark)} (${(x.matched || []).length} of ${(x.keywords || []).length} found)</p>
    ${x.model_answer ? `<details><summary class="small" style="cursor:pointer">Show model answer</summary><div class="model-answer">${esc(x.model_answer)}</div></details>` : ''}
    <form class="row" style="margin-top:14px;align-items:flex-end" onsubmit="saveReview(event,'${x.attempt_id}',${x.idx},${n})">
      <div style="flex:0 0 auto"><span class="label">Mark</span><div class="seg" role="radiogroup" aria-label="Mark">${MARKS.map(v =>
        `<label class="rv-mark"><input type="radio" name="mark" value="${v}" ${v === nearest(Number(x.mark)) ? 'checked' : ''}><span>${v === 0.5 ? '½' : v === 0.25 ? '¼' : v === 0.75 ? '¾' : v}</span></label>`).join('')}</div></div>
      <div style="flex:1 1 220px"><label for="fb-${n}">Feedback <span class="muted">(optional)</span></label>
        <input id="fb-${n}" name="feedback" type="text" value="${esc(x.feedback)}" placeholder="e.g. Missed asking about the family's needs"></div>
      <button class="btn btn-primary" type="submit">${icon('check', 'sm')} ${x.review === 'pending' ? 'Save review' : 'Update'}</button>
    </form>
  </div>`;
}

async function saveReview(e, attemptId, idx, n) {
  e.preventDefault();
  const fd = new FormData(e.target);
  e.submitter.disabled = true;
  const { data, error } = await sb.rpc('review_answer', { p_attempt: attemptId, p_index: idx, p_mark: Number(fd.get('mark')), p_feedback: fd.get('feedback') });
  if (error) { e.submitter.disabled = false; return toast(error.message, 'err'); }
  toast(`Saved. The test is now ${data.passed ? 'PASS' : 'FAIL'} (${Math.round(data.pct)}%).`);
  if (rvAll) return route();
  const item = document.getElementById(`rv-${n}`), group = item.closest('.rv-group');
  item.remove();
  const left = group.querySelectorAll('.rv-item').length;
  if (!left) { group.remove(); if (!document.querySelector('.rv-group')) route(); }
  else group.querySelector('[data-pending] span').textContent = left;
}

// ---------- question guide (for whoever writes the tests) ----------


function viewGuide() {
  const step = (n, title, body) => `<div class="ai-step"><h3><span class="n">${n}</span> ${title}</h3>${body}</div>`;
  adminShow(`
    <div class="page-head"><div><h1>Question guide</h1><p class="muted">How to put a new training online. Takes 2 minutes to read.</p></div></div>

    <section class="card">
      <div class="card-head"><h2>${icon('book')} Add a chapter in 4 steps</h2></div>
      <div class="ai-steps" style="margin-top:0">
        ${step(1, 'Create the chapter', `<p class="help" style="margin:0"><strong>Trainings & Tests</strong> → open the training → <strong>Add chapter</strong>: type the chapter name and paste the YouTube link → <strong>Create chapter</strong>.
          One training = one position (e.g. Sales Executive). Each video module is a <strong>chapter</strong> inside it, so learners go Chapter 1 → 2 → 3 in order.</p>`)}
        ${step(2, 'Copy the AI prompt', `<p class="help" style="margin:0">On the chapter page, the <strong>Paste from AI</strong> tab → <strong>Copy AI prompt</strong>. It already asks for Easy, Moderate and Hard questions, 2 descriptive ones and video checkpoints, in the exact format the LMS reads.</p>`)}
        ${step(3, 'Ask the AI', `<p class="help" style="margin:0">Open ChatGPT / Claude / Gemini, paste the prompt, then paste the video's script or transcript where it says, and send.
          (YouTube transcript: under the video → <em>…more</em> → <em>Show transcript</em> → select all and copy.)</p>`)}
        ${step(4, 'Paste, check, save, publish', `<p class="help" style="margin:0">Paste the AI's answer in the box. Every question appears as a card with its ✓ answer; anything wrong shows in <span style="color:var(--err)">red</span> with the reason.
          Click <strong>Save</strong>. Then tick <strong>Published</strong> in the chapter settings (and on the training, once).</p>`)}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('layers')} The three levels</h2></div>
      <p>Everyone watches the <strong>same video</strong>; only the <strong>test</strong> changes with the learner's level.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Who</th><th>What to ask</th></tr></thead>
        <tbody>
          <tr><td>${levelBadge('easy')}</td><td>Agents</td><td>Straight facts from the video</td></tr>
          <tr><td>${levelBadge('moderate')}</td><td>Sales executives</td><td>Understanding and using it with a customer</td></tr>
          <tr><td>${levelBadge('hard')}</td><td>Managers</td><td>Situations, calculations, team decisions</td></tr>
        </tbody>
      </table></div>
      <p class="help">Keep at least <strong>2× "questions per test"</strong> for each level (20 for a 10-question test), so a retry gets fresh questions. A test has at most 2 descriptive questions.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('clipboard')} What else is on the chapter page</h2></div>
      <ul class="guide-list">
        <li><strong>Video checkpoints</strong>: the video stops and asks a question (the AI prompt makes these too, with "Time: 2:30"). The video counts as watched only when all are answered; you see each learner's answer time.</li>
        <li><strong>Practical task</strong> (optional): instructions + a model answer. Learners reply in text or with a Google Drive link; it's approved automatically.</li>
        <li><strong>Descriptive answers</strong> get a first mark from keywords; you give the final mark in <a href="#/reviews">Reviews</a>. Blank answers get 0 automatically.</li>
        <li>To fix one question: <strong>Edit</strong> next to it in the question bank. <strong>Add one question</strong> and <strong>Excel</strong> tabs are there if you ever need them.</li>
      </ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('check')} Before you publish</h2></div>
      <ul class="guide-list">
        <li>The level table on the chapter page says <span class="badge b-ok">${icon('check')} Ready</span> for every level.</li>
        <li>Open <a href="#/user/${me.id}">your own page</a>, assign the training to yourself, and try it in <strong>Learner view</strong>: camera, video, checkpoints, test.</li>
        <li>Tick <strong>Published</strong> on the chapter and on the training. Drafts are invisible to learners.</li>
      </ul>
    </section>`);
}

function form(table, row, extra = {}) {
  const fields = FIELDS[table].map(([k, label, type, min = 1]) => {
    const v = row[k] ?? '', id = `f-${table}-${k}`;
    if (Array.isArray(type)) return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${k}">${type.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    if (type === 'textarea') return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" name="${k}">${esc(v)}</textarea></div>`;
    if (type === 'checkbox') return `<div class="field"><label class="check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${label}</label></div>`;
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${k}" type="${type || 'text'}" value="${esc(v)}" ${k === 'title' || type === 'number' ? 'required' : ''} ${type === 'number' ? `min="${min}"` : ''}></div>`;
  }).join('');
  const noun = table === 'courses' ? 'training' : 'chapter';
  const body = `${fields}
    <div class="row"><button class="btn btn-primary" type="submit">${icon('save', 'sm')} Save</button>
    ${row.id ? `<button type="button" class="btn btn-danger" onclick="del('${table}','${row.id}','${table === 'courses' ? '#/courses' : `#/course/${row.course_id}`}')">${icon('trash', 'sm')} Delete</button>` : ''}</div>`;
  const title = row.id ? `${noun[0].toUpperCase() + noun.slice(1)} settings` : `New ${noun}`;
  return `<form class="card" onsubmit="save(event,'${table}','${row.id || ''}',${esc(JSON.stringify(extra))})">
    ${row.id ? `<details class="fold"><summary><h2>${icon('save')} ${title}</h2><span class="sub">${table === 'courses' ? 'Title, category, audience, publish' : 'Video links, pass mark, time limit, publish'}</span></summary>${body}</details>`
      : `<div class="card-head"><h2>${icon('plus')} ${title}</h2></div>${body}`}
  </form>`;
}

async function save(e, table, id, extra) {
  e.preventDefault();
  const fd = new FormData(e.target), row = { ...extra };
  for (const [k, , type] of FIELDS[table]) row[k] = type === 'checkbox' ? fd.has(k) : type === 'number' ? Number(fd.get(k)) : fd.get(k).trim();
  const { data, error } = id
    ? await sb.from(table).update(row).eq('id', id).select().single()
    : await sb.from(table).insert(row).select().single();
  if (error) return toast(error.message, 'err');
  toast('Saved');
  if (!id && table === 'courses') location.hash = `#/course/${data.id}`;
  else if (!id) location.hash = `#/module/${data.id}`;
  else route();
}

// the common case in two fields; the rest (pass mark, time limit…) keeps sensible defaults
async function quickChapter(e, courseId, seq) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { data, error } = await sb.from('modules').insert({ course_id: courseId, seq, title: fd.get('title').trim(), videos: fd.get('videos').trim(),
    pass_pct: 80, questions_per_test: 10, published: false }).select().single();
  if (error) return toast(error.message, 'err');
  toast('Chapter created. Now add its questions.');
  location.hash = `#/module/${data.id}`;
}

async function del(table, id, back) {
  if (!confirm('Delete this permanently? Everything inside it will be deleted too.')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) return toast(error.code === '23503'
    ? 'Learners have test attempts on this, so it can\'t be deleted. Untick "Published" to hide it instead.' : error.message, 'err');
  toast('Deleted');
  location.hash = back; // not history.back(): a deep-linked page has no in-app history
}

const pubBadge = p => `<span class="badge ${p ? 'b-ok' : ''}">${p ? icon('check') + ' Published' : 'Draft'}</span>`;

async function viewCourses() {
  const { data, error } = await sb.from('courses').select('*, modules(count)').order('category').order('title');
  if (error) throw error;
  adminShow(`
    <div class="page-head"><div><h1>Trainings & Tests</h1><p class="muted">Training, chapters and question bank for each position</p></div></div>
    <section class="card">
      ${data.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Training</th><th>Category</th><th>Audience</th><th>Chapters</th><th>Status</th></tr></thead>
        <tbody>${data.map(c => `<tr>
          <td><a href="#/course/${c.id}" style="font-weight:600">${esc(c.title)}</a></td><td><span class="badge b-gold">${esc(c.category)}</span></td>
          <td>${c.audience}</td><td class="num">${c.modules[0]?.count ?? 0}</td><td>${pubBadge(c.published)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty">${icon('layers')}<p>No trainings yet. Create your first one using the form below.</p></div>`}
    </section>
    ${form('courses', { audience: 'all' })}`);
}

async function viewCourse(id) {
  const [c, m] = await Promise.all([
    sb.from('courses').select('*').eq('id', id).single(),
    sb.from('modules').select('*, questions(count), tasks(count)').eq('course_id', id).order('seq').order('id'),
  ]);
  if (c.error || m.error) throw c.error || m.error;
  const next = (m.data.at(-1)?.seq ?? 0) + 1;
  adminShow(`
    <a class="crumb" href="#/courses">${icon('left', 'sm')} All trainings</a>
    <div class="page-head"><div><span class="badge b-gold">${esc(c.data.category)}</span><h1 style="margin-top:8px">${esc(c.data.title)}</h1></div>
      <div class="row">${pubBadge(c.data.published)}<span class="badge ${c.data.certificate ? 'b-ok' : ''}">${icon('award', 'sm')} Certificate ${c.data.certificate ? 'on' : 'off'}</span><a class="btn btn-sm" href="index.html#/certificate/${id}/preview">${icon('award', 'sm')} Certificate preview</a></div></div>
    <section class="card">
      <div class="card-head"><h2>${icon('book')} Chapters</h2></div>
      ${m.data.length ? `<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Chapter</th><th>Videos</th><th>Questions (pool / per test)</th><th>Task</th><th>Pass mark</th><th>Status</th></tr></thead>
        <tbody>${m.data.map(x => {
          const pool = x.questions[0]?.count ?? 0, task = (x.tasks?.[0]?.count ?? 0) > 0;
          return `<tr>
            <td class="num">${x.seq}</td><td><a href="#/module/${x.id}" style="font-weight:600">${esc(x.title)}</a></td>
            <td class="num">${(x.videos || '').split(/\s+/).filter(Boolean).length}</td>
            <td class="num">${pool ? `${pool} / ${x.questions_per_test}` : '—'} ${(pool && pool < x.questions_per_test) || (!pool && !task) ? `<span class="badge b-warn">${icon('alert')} ${pool ? 'Too few' : 'No test or task'}</span>` : ''}</td>
            <td>${task ? `<span class="badge b-ok">${icon('check')} Yes</span>` : '—'}</td>
            <td class="num">${x.pass_pct}%</td><td>${pubBadge(x.published)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="empty">${icon('book')}<p>No chapters yet. Create the first one below.</p></div>`}
    </section>
    <form class="card" onsubmit="quickChapter(event,'${id}',${next})">
      <div class="card-head"><h2>${icon('plus')} Add chapter ${next}</h2></div>
      <div class="grid-2">
        <div class="field"><label for="qc-title">Chapter name</label><input id="qc-title" name="title" required placeholder="e.g. Real Estate Sales Module ${next}"></div>
        <div class="field"><label for="qc-video">YouTube link</label><input id="qc-video" name="videos" type="url" placeholder="https://youtu.be/…"></div>
      </div>
      <p class="help" style="margin-top:0">Pass mark 80%, 10 questions per test. Change these later in the chapter's settings if needed.</p>
      <button class="btn btn-primary" type="submit">${icon('plus', 'sm')} Create chapter</button>
    </form>
    ${form('courses', c.data)}`);
}

async function viewModule(id) {
  const [m, q, t, ts, cpq] = await Promise.all([
    sb.from('modules').select('*, courses(id,title)').eq('id', id).single(),
    sb.from('questions').select('*').eq('module_id', id).order('created_at'),
    sb.from('tasks').select('*').eq('module_id', id).maybeSingle(),
    sb.from('task_submissions').select('answer,submitted_at,user_id,profiles(full_name)').eq('module_id', id).order('submitted_at', { ascending: false }),
    sb.from('video_checkpoints').select('*, checkpoint_answers(*)').eq('module_id', id).order('video_id').order('at_sec'),
  ]);
  const err = m.error || q.error || t.error || ts.error;
  if (err) throw err;
  const mod = m.data, pool = q.data.length, task = t.data;
  const cps = cpq.error ? null : cpq.data; // null until checkpoints.sql is run: the card hides
  const vidIds = [...(mod.videos || '').matchAll(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/g)].map(x => x[1]);
  bank = q.data;
  aiCtx = { moduleId: id, title: mod.title, perTest: mod.questions_per_test, videoId: vidIds[0] || null, checkpoints: !!cps };
  adminShow(`
    <a class="crumb" href="#/course/${mod.courses.id}">${icon('left', 'sm')} ${esc(mod.courses.title)}</a>
    <div class="page-head"><div><span class="eyebrow" style="color:#8A6A2B">Chapter ${mod.seq}</span><h1>${esc(mod.title)}</h1></div>${pubBadge(mod.published)}</div>
    <section class="card">
      <div class="card-head"><h2>${icon('clipboard')} Question bank</h2><a class="small" href="#/guide">${icon('book', 'sm')} How to add questions</a></div>
      ${!pool ? `<div class="notice info">${icon('clipboard')}<span>No test yet. Add questions below, or leave it empty for a task-only chapter.</span></div>` : ''}
      <div class="table-wrap" style="margin-bottom:16px"><table>
        <thead><tr><th>Level</th><th>Questions</th><th>Status <span class="sub">(${mod.questions_per_test} per test)</span></th></tr></thead>
        <tbody>${Object.keys(LEVELS).map(l => {
          const n = q.data.filter(x => (x.level || 'moderate') === l).length, need = mod.questions_per_test;
          return `<tr><td>${levelBadge(l)}</td><td class="num">${n}</td><td class="small">${
            !pool ? '—'
            : !n ? `<span class="badge b-warn">${icon('alert')} None</span> ${LEVELS[l][1]} will get questions from all levels`
            : n < need ? `<span class="badge b-warn">${icon('alert')} Too few</span> add ${need - n} more`
            : n < 2 * need ? `<span class="badge b-blue">${icon('retry')} OK</span> add ${2 * need - n} more for fresh retries`
            : `<span class="badge b-ok">${icon('check')} Ready</span>`}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${pool ? `<div class="seg" role="group" aria-label="Show questions" id="qb-filter" style="margin-bottom:12px"></div><div id="qb-list"></div>` : ''}
      <div class="seg" role="group" aria-label="How to add" style="margin:24px 0 0">
        <button id="tab-ai" class="on" aria-pressed="true" onclick="qTab('ai')">${icon('clipboard', 'sm')} Paste from AI <span class="sub">fastest</span></button>
        <button id="tab-one" aria-pressed="false" onclick="qTab('one')">${icon('plus', 'sm')} Add one question</button>
        <button id="tab-bulk" aria-pressed="false" onclick="qTab('bulk')">${icon('download', 'sm')} Excel</button>
      </div>
      <div id="q-ai" class="ai-steps">
        <div class="ai-step">
          <h3><span class="n">1</span> Copy the prompt</h3>
          <p class="help" style="margin:0 0 10px">It tells ChatGPT / Claude / Gemini exactly how to write the questions for this chapter, so they paste here without any changes.</p>
          <button class="btn" onclick="copyAiPrompt(this)">${icon('clipboard', 'sm')} Copy AI prompt</button>
        </div>
        <div class="ai-step">
          <h3><span class="n">2</span> Give it to the AI with the video script</h3>
          <p class="help" style="margin:0">Open the AI, paste the prompt, then paste this chapter's video script (or transcript) where it says so, and send.</p>
        </div>
        <div class="ai-step">
          <h3><span class="n">3</span> Paste the AI's answer here</h3>
          <textarea id="ai-text" rows="10" oninput="previewAi()" placeholder="Q: In which city is Akshardham Associates based?&#10;A) Kota&#10;B) Jhalawar&#10;C) Jaipur&#10;Answer: B&#10;Level: Easy"></textarea>
          <div id="ai-preview"></div>
          <button class="btn btn-primary" id="ai-save" onclick="saveAi()" disabled>${icon('check', 'sm')} Save questions</button>
        </div>
      </div>
      <div id="q-one" hidden><div id="qform-wrap"></div></div>
      <div id="q-bulk" hidden>
      <div class="field" style="margin-top:20px">
        <label for="bulk-level">These questions are for</label>
        ${levelSelect('id="bulk-level" onchange="previewQuestions()"', qbLevel)}
      </div>
      <div class="field">
        <label for="bulk">Paste questions (one per line)</label>
        <p class="help" style="margin:0 0 8px">
        <strong>One answer:</strong> <code>Question | Option 1 | Option 2 | Option 3 | 2</code><br>
        <strong>Multiple answers:</strong> <code>Question | Option 1 | Option 2 | Option 3 | 1,3</code><br>
        <strong>Written answer:</strong> <code>Question | = answer ; other accepted answer</code><br>
        <strong>True/False:</strong> <code>Question | True | False | 1</code> · <a href="#/guide">full guide</a></p>
        <div class="notice info" style="margin:0 0 10px">${icon('download')}<span><strong>Fastest way:</strong> fill an Excel template,
          select the rows, copy (Ctrl+C) and paste here (Ctrl+V). No | signs needed, and its Level column sets each row's level.<br>
          <button class="link" onclick="downloadTemplate('mcq')">MCQ / short answer template</button> ·
          <button class="link" onclick="downloadTemplate('descriptive')">Descriptive (long answer) template</button></span></div>
        <textarea id="bulk" rows="7" oninput="previewQuestions()" placeholder="In which city is Akshardham Associates based? | Kota | Jhalawar | Jaipur | 2"></textarea>
      </div>
      <div id="qb-preview"></div>
      <button class="btn btn-primary" onclick="addQuestions('${id}')">${icon('plus', 'sm')} Add questions</button>
      </div>
    </section>
    ${cps && vidIds.length ? `<section class="card">
      <div class="card-head"><h2>${icon('video')} Video checkpoints</h2><span class="badge b-blue">${cps.length}</span></div>
      <p class="help" style="margin-top:0">The video stops at each checkpoint and continues only after the learner answers. A wrong answer shows the right one and your explanation.
        The video counts as watched only when every checkpoint is answered. One every 3–4 minutes keeps attention without annoying.</p>
      ${cps.map(c => {
        const ans = c.checkpoint_answers || [], right = ans.filter(a => a.correct).length;
        return `<div class="qb-item"><div style="min-width:0">
          <span class="badge b-gold">${icon('clock')} ${vidIds.length > 1 ? `Video ${vidIds.indexOf(c.video_id) + 1} · ` : ''}${fmtClock(c.at_sec)}</span>
          <strong style="margin-left:6px">${esc(c.text)}</strong>
          <ol>${c.options.map((o, j) => `<li class="${j === c.correct ? 'ok-t' : ''}">${esc(o)}${j === c.correct ? ' ✓' : ''}</li>`).join('')}</ol>
          ${c.explanation ? `<p class="small muted" style="margin:4px 0 0">Explanation: ${esc(c.explanation)}</p>` : ''}
          ${ans.length ? `<p class="small" style="margin:4px 0 0">${right} of ${ans.length} learners right first time${(() => {
            const t = ans.filter(a => a.response_ms != null);
            return t.length ? ` · average answer time <strong>${secs(t.reduce((x, a) => x + a.response_ms, 0) / t.length)}</strong>` : '';
          })()}</p>` : ''}</div>
          <button class="btn btn-sm btn-danger" onclick="delCheckpoint('${c.id}')" aria-label="Delete checkpoint">${icon('trash', 'sm')}</button></div>`;
      }).join('') || '<p class="muted">No checkpoints yet.</p>'}
      <form id="cp-new" onsubmit="addCheckpoint(event,'${id}')" style="margin-top:16px" novalidate>
        <h3>Add a checkpoint</h3>
        <div class="grid-2">
          ${vidIds.length > 1 ? `<div class="field"><label for="cpn-video">Video</label><select id="cpn-video" name="video">${vidIds.map((v, k) => `<option value="${v}">Video ${k + 1}</option>`).join('')}</select></div>`
            : `<input type="hidden" name="video" value="${vidIds[0]}">`}
          <div class="field"><label for="cpn-at">Stop at (minutes:seconds)</label><input id="cpn-at" name="at" type="text" placeholder="2:30" inputmode="numeric" required></div>
        </div>
        <div class="field"><label for="cpn-q">Question</label><textarea id="cpn-q" name="text" rows="2" required placeholder="e.g. According to the video, what should you ask the customer first?"></textarea></div>
        <label>Options <span class="muted">— tick the correct one</span></label>
        ${[0, 1, 2, 3].map(j => `<div class="qf-row"><input class="qf-ok" type="radio" name="correct" value="${j}" ${j === 0 ? 'checked' : ''} aria-label="Option ${j + 1} is correct">
          <input type="text" name="opt" placeholder="Option ${j + 1}${j > 1 ? ' (optional)' : ''}" aria-label="Option ${j + 1}"></div>`).join('')}
        <div class="field"><label for="cpn-ex">Explanation <span class="muted">(shown after the answer)</span></label><input id="cpn-ex" name="explanation" type="text" placeholder="e.g. Understand the need first, then suggest a plot"></div>
        <p class="form-error" id="cpn-err" role="alert"></p>
        <button class="btn btn-primary" type="submit">${icon('plus', 'sm')} Add checkpoint</button>
      </form>
    </section>` : ''}
    <section class="card">
      <div class="card-head"><h2>${icon('briefcase')} Practical task</h2>${task ? `<span class="badge b-ok">${icon('check')} Active</span>` : '<span class="badge">None</span>'}</div>
      <p class="help" style="margin-top:0">Learners answer in text or with a link (photos, PDFs or videos via Google Drive). It's approved automatically and they then see your model answer.
        The chapter is complete when the test is passed and the task is submitted.</p>
      <form onsubmit="saveTask(event,'${id}')">
        <div class="field"><label for="t-ins">Instructions</label><textarea id="t-ins" name="instructions" required placeholder="e.g. Visit 2 nearby colonies, note plot rates and share a photo of your notes.">${esc(task?.instructions)}</textarea></div>
        <div class="field"><label for="t-type">How learners answer</label><select id="t-type" name="submit_type">
          <option value="text" ${task?.submit_type !== 'link' ? 'selected' : ''}>Written answer</option>
          <option value="link" ${task?.submit_type === 'link' ? 'selected' : ''}>Link (Google Drive photo/PDF, YouTube…)</option></select></div>
        <div class="field"><label for="t-model">Model answer <span class="muted">(shown to the learner after they submit)</span></label><textarea id="t-model" name="model_answer">${esc(task?.model_answer)}</textarea></div>
        <div class="row"><button class="btn btn-primary" type="submit">${icon('save', 'sm')} ${task ? 'Save task' : 'Add task'}</button>
          ${task ? `<button type="button" class="btn btn-danger" onclick="removeTask('${id}')">${icon('trash', 'sm')} Remove task</button>` : ''}</div>
      </form>
      ${ts.data.length ? `<h3 style="margin-top:24px">Submissions (${ts.data.length})</h3>
        ${ts.data.map(x => `<div class="qb-item"><div style="min-width:0">
          <a href="#/user/${x.user_id}" style="font-weight:600">${esc(x.profiles?.full_name)}</a> <span class="sub">${when(x.submitted_at)}</span>
          <div style="margin-top:6px">${showAnswer(x.answer)}</div></div></div>`).join('')}` : ''}
    </section>
    ${form('modules', mod)}`);
  if (pool) drawBank();
  qfModule = id;
  renderQForm();
}

let bank = [], qbFilter = 'all', qbLevel = 'moderate'; // question bank on the open chapter page
let aiCtx = null; // the open chapter, for the AI prompt and the paste

// the prompt makes the AI answer in exactly the format parseAiText reads
function aiPrompt() {
  const n = Math.max(2 * aiCtx.perTest, 5); // 2× per test, so a retry gets fresh questions
  const cp = aiCtx.videoId && aiCtx.checkpoints;
  return `Write test questions from the training video script below.

Training: the sales team of Akshardham Associates (real estate, Jhalawar).
Chapter: ${aiCtx.title}

Create:
- ${n} Easy questions (for agents: direct, the basics of the video)
- ${n} Moderate questions (for sales executives: understanding and use)
- ${n} Hard questions (for managers: situations, decisions, team handling)
- 2 Descriptive questions (Moderate or Hard, needing 100-150 words)
${cp ? '- 4 Checkpoint questions that pause the video, every 3-4 minutes (use the times in the script if it has them)\n' : ''}
Base every question only on the script. Put the correct option in a different place (A, B, C, D) each time.

FORMAT (exactly like this, one blank line between questions; no headings, numbering or extra text):

Q: In which city is Akshardham Associates based?
A) Kota
B) Jhalawar
C) Jaipur
D) Udaipur
Answer: B
Level: Easy

Q: What should you take on a site visit? (more than one is correct)
A) Plot map
B) Lunch
C) Price list
D) Brochure
Answer: A, C, D
Level: Moderate

Q: Which state is Jhalawar in?
Answer: Rajasthan
Level: Easy

Q: How would you make the first call to a new customer? Answer in detail.
Type: Descriptive
Level: Moderate
Keywords: budget; family; site visit
Model answer: Greet the customer, introduce yourself, then ask about their budget and needs...
Words: 100-150
${cp ? `
Q: According to the video, what should you ask the customer first?
A) Budget
B) Name and needs
C) Plot size
Answer: B
Time: 2:30
Explanation: Understand the customer first, then suggest a plot.
` : ''}
Rules:
- One correct answer: "Answer: B"; more than one: "Answer: A, C".
- Short written answers (1-3 words) have no options; write the answer after "Answer:" and separate other accepted forms with ";".
- Descriptive questions need "Keywords:" (words a good answer should contain, separated by ";").
${cp ? '- Checkpoint questions need "Time:" (minutes:seconds) and "Explanation:", with exactly one correct answer.\n' : ''}
SCRIPT:
<<< paste the video script or transcript here >>>`;
}

async function copyAiPrompt(btn) {
  try { await navigator.clipboard.writeText(aiPrompt()); }
  catch { return prompt('Copy this prompt (Ctrl+C):', aiPrompt()); }
  btn.innerHTML = `${icon('check', 'sm')} Copied! Now paste it in the AI`;
  toast('Prompt copied');
}

function previewAi() {
  const { rows, cps, bad } = parseAiText(document.getElementById('ai-text').value, '', 'moderate', aiCtx.videoId);
  const out = document.getElementById('ai-preview'), btn = document.getElementById('ai-save');
  btn.disabled = !rows.length && !cps.length;
  btn.innerHTML = `${icon('check', 'sm')} Save ${rows.length} question${rows.length === 1 ? '' : 's'}${cps.length ? ` + ${cps.length} checkpoint${cps.length === 1 ? '' : 's'}` : ''}`;
  if (!rows.length && !cps.length && !bad.length) { out.innerHTML = ''; return; }
  const byLevel = Object.keys(LEVELS).map(l => [l, rows.filter(r => r.level === l).length]).filter(([, n]) => n).map(([l, n]) => `${n} ${LEVELS[l][0]}`).join(', ');
  out.innerHTML = `
    <div class="notice ${bad.length ? '' : 'ok'}">${icon(bad.length ? 'alert' : 'check')}<span>
      <strong>${rows.length} question${rows.length === 1 ? '' : 's'} ready</strong>${byLevel ? ` (${byLevel})` : ''}${cps.length ? ` · <strong>${cps.length} video checkpoint${cps.length === 1 ? '' : 's'}</strong>` : ''}.
      ${bad.length ? `<strong>${bad.length} need fixing</strong> (shown in red below). Fix them in the box above, or save the rest and skip them.` : 'Check the ✓ answers below, then save.'}</span></div>
    ${bad.map(b => `<div class="qb-item ai-bad"><div><strong>Question ${b.n}: ${esc(b.text)}</strong><p class="small" style="margin:4px 0 0;color:var(--err)">${esc(b.why)}</p></div></div>`).join('')}
    ${rows.map((x, i) => questionItem(x, i, false)).join('')}
    ${cps.map(c => `<div class="qb-item"><div><span class="badge b-gold">${icon('clock')} Checkpoint ${fmtClock(c.at_sec)}</span> <strong>${esc(c.text)}</strong>
      <ol>${c.options.map((o, j) => `<li class="${j === c.correct ? 'ok-t' : ''}">${esc(o)}${j === c.correct ? ' ✓' : ''}</li>`).join('')}</ol></div></div>`).join('')}`;
}

async function saveAi() {
  const { rows, cps, bad } = parseAiText(document.getElementById('ai-text').value, aiCtx.moduleId, 'moderate', aiCtx.videoId);
  if (bad.length && !confirm(`${bad.length} question${bad.length > 1 ? 's have' : ' has'} a problem and will be skipped. Save the other ${rows.length + cps.length}?`)) return;
  const btn = document.getElementById('ai-save');
  btn.disabled = true;
  const [qr, cr] = await Promise.all([
    rows.length ? sb.from('questions').insert(rows) : {},
    cps.length ? sb.from('video_checkpoints').insert(cps) : {},
  ]);
  const error = qr.error || cr.error;
  if (error) { btn.disabled = false; return toast(error.message, 'err'); }
  toast(`Saved ${rows.length} question${rows.length === 1 ? '' : 's'}${cps.length ? ` and ${cps.length} checkpoint${cps.length === 1 ? '' : 's'}` : ''}`);
  route();
}

// ---- "Add one question" form: type the question, type each option in its own box, tick the right one ----
const QF_TYPES = { single: 'One correct answer', multi: 'More than one correct answer', tf: 'True / False', text: 'Written answer (1–3 words)', essay: 'Descriptive answer (trainer checks)' };
const qfBlank = kind => ({
  kind, text: '', editing: null,
  options: kind === 'tf' ? ['True', 'False'] : ['', '', '', ''],
  correct: kind === 'tf' ? [0] : [], accepted: [''], model_answer: '', min_words: '', max_words: '',
});
let qf = qfBlank('single'), qfModule = null;

function qTab(which) {
  for (const t of ['ai', 'one', 'bulk']) {
    document.getElementById(`q-${t}`).hidden = t !== which;
    const b = document.getElementById(`tab-${t}`);
    b.classList.toggle('on', t === which);
    b.setAttribute('aria-pressed', t === which);
  }
}

function renderQForm() {
  const wrap = document.getElementById('qform-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <form id="qform" onsubmit="saveQuestion(event)" novalidate>
      ${qf.editing ? `<div class="notice info">${icon('save')}<span>Editing a saved question. Past test results are not changed.</span></div>` : ''}
      <div class="grid-2">
        <div class="field"><label for="qf-level">Level</label>${levelSelect('id="qf-level"', qbLevel)}</div>
        <div class="field"><label for="qf-kind">Question type</label>
          <select id="qf-kind" onchange="qfSetKind(this.value)">${Object.entries(QF_TYPES).map(([k, l]) => `<option value="${k}" ${k === qf.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="qf-text">Question</label>
        <textarea id="qf-text" rows="3" placeholder="e.g. In which city is Akshardham Associates based?">${esc(qf.text)}</textarea></div>
      <div id="qf-answers"></div>
      <p id="qf-err" class="form-error" role="alert"></p>
      <div class="row">
        <button class="btn btn-primary" type="submit">${icon('check', 'sm')} ${qf.editing ? 'Save changes' : 'Save question'}</button>
        ${qf.editing ? `<button type="button" class="btn" onclick="qf = qfBlank(qf.kind === 'text' ? 'text' : 'single'); renderQForm()">Cancel</button>` : ''}
      </div>
    </form>`;
  drawQAnswers();
}

function drawQAnswers() {
  const box = document.getElementById('qf-answers');
  if (qf.kind === 'essay') {
    box.innerHTML = `<div class="field"><span class="label">Answer length <span class="muted">(words, optional)</span></span>
        <div class="row">
          <input id="qf-min" type="number" min="1" max="2000" value="${esc(qf.min_words)}" placeholder="Min" aria-label="Minimum words" style="width:110px">
          <span>to</span>
          <input id="qf-max" type="number" min="1" max="2000" value="${esc(qf.max_words)}" placeholder="Max" aria-label="Maximum words" style="width:110px">
          <button type="button" class="btn btn-sm" onclick="qfWords(30, 50)">Short 30–50</button>
          <button type="button" class="btn btn-sm" onclick="qfWords(100, 150)">Long 100–150</button>
          <button type="button" class="btn btn-sm" onclick="qfWords('', '')">No limit</button>
        </div>
        <p class="help">The learner sees a live word count and can't submit until the answer is inside this range.</p></div>
      <div class="field"><label for="qf-model">Model answer <span class="muted">(for the trainer while checking)</span></label>
        <textarea id="qf-model" rows="3" placeholder="e.g. Ask about the budget and family needs, then offer a site visit">${esc(qf.model_answer)}</textarea></div>
      <label>Keywords <span class="muted">— points a good answer must mention</span></label>
      ${qf.accepted.map((a, j) => `<div class="qf-row">
        <input class="qf-acc" type="text" value="${esc(a)}" placeholder="${j ? 'Another keyword' : 'e.g. budget / budgets'}" aria-label="Keyword ${j + 1}">
        ${j ? `<button type="button" class="icon-btn qf-x" onclick="qfRemoveAccepted(${j})" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}</div>`).join('')}
      <button type="button" class="btn btn-sm" onclick="qfAddAccepted()">${icon('plus', 'sm')} Add keyword</button>
      <p class="help">The learner writes freely. Each keyword found gives part marks right away (2 of 3 found = 0.67). Put other spellings on the same line with / , e.g. <code>budget / budgets</code>.
        A trainer then checks every answer on the Reviews page and gives the final mark.</p>`;
    return;
  }
  if (qf.kind === 'text') {
    box.innerHTML = `<label>Correct answer</label>
      ${qf.accepted.map((a, j) => `<div class="qf-row">
        <input class="qf-acc" type="text" value="${esc(a)}" placeholder="${j ? 'Another accepted spelling (optional)' : 'e.g. Rajasthan'}" aria-label="Accepted answer ${j + 1}">
        ${j ? `<button type="button" class="icon-btn qf-x" onclick="qfRemoveAccepted(${j})" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}</div>`).join('')}
      <button type="button" class="btn btn-sm" onclick="qfAddAccepted()">${icon('plus', 'sm')} Another spelling</button>
      <p class="help">The learner types the answer. Capitals and extra spaces are ignored, so keep it short (1 to 3 words) and add every spelling you accept, e.g. Rajasthan and Rajastan.</p>`;
    return;
  }
  const multi = qf.kind === 'multi', tf = qf.kind === 'tf';
  box.innerHTML = `<label>Options <span class="muted">— tick ${multi ? 'every correct answer' : 'the correct answer'}</span></label>
    ${qf.options.map((o, j) => `<div class="qf-row ${qf.correct.includes(j) ? 'on' : ''}">
      <input class="qf-ok" type="${multi ? 'checkbox' : 'radio'}" name="qf-ok" ${qf.correct.includes(j) ? 'checked' : ''} onchange="qfSync(); drawQAnswers()" aria-label="Option ${j + 1} is correct">
      <input class="qf-opt" type="text" value="${esc(o)}" placeholder="Option ${j + 1}" aria-label="Option ${j + 1}">
      ${!tf && qf.options.length > 2 ? `<button type="button" class="icon-btn qf-x" onclick="qfRemoveOption(${j})" aria-label="Remove option ${j + 1}">${icon('x', 'sm')}</button>` : ''}
    </div>`).join('')}
    ${!tf && qf.options.length < 6 ? `<button type="button" class="btn btn-sm" onclick="qfAddOption()">${icon('plus', 'sm')} Add option</button>` : ''}
    ${multi ? '<p class="help">The learner must pick all the ticked options to get it right.</p>' : ''}`;
}

// read what has been typed before the form is redrawn
function qfSync() {
  const f = document.getElementById('qform');
  if (!f) return;
  qf.text = f.querySelector('#qf-text').value;
  qbLevel = f.querySelector('#qf-level').value;
  if (qf.kind === 'essay') {
    qf.model_answer = f.querySelector('#qf-model').value;
    qf.min_words = f.querySelector('#qf-min').value;
    qf.max_words = f.querySelector('#qf-max').value;
  }
  if (qf.kind === 'text' || qf.kind === 'essay') qf.accepted = [...f.querySelectorAll('.qf-acc')].map(i => i.value);
  else {
    qf.options = [...f.querySelectorAll('.qf-opt')].map(i => i.value);
    qf.correct = [...f.querySelectorAll('.qf-ok')].flatMap((c, j) => (c.checked ? [j] : []));
  }
}

function qfSetKind(kind) {
  qfSync();
  const was = qf.kind;
  if (kind === 'tf') Object.assign(qf, { options: ['True', 'False'], correct: [0] });
  else if (was === 'tf' && kind !== 'text' && kind !== 'essay') Object.assign(qf, { options: ['', '', '', ''], correct: [] });
  if (kind === 'single') qf.correct = qf.correct.slice(0, 1);
  qf.kind = kind;
  drawQAnswers();
}
function qfWords(min, max) { qfSync(); Object.assign(qf, { min_words: min, max_words: max }); drawQAnswers(); }
function qfAddOption() { qfSync(); qf.options.push(''); drawQAnswers(); [...document.querySelectorAll('.qf-opt')].at(-1).focus(); }
function qfRemoveOption(j) {
  qfSync();
  qf.options.splice(j, 1);
  qf.correct = qf.correct.filter(x => x !== j).map(x => (x > j ? x - 1 : x));
  drawQAnswers();
}
function qfAddAccepted() { qfSync(); qf.accepted.push(''); drawQAnswers(); [...document.querySelectorAll('.qf-acc')].at(-1).focus(); }
function qfRemoveAccepted(j) { qfSync(); qf.accepted.splice(j, 1); drawQAnswers(); }

// the row the database expects, or an error message for the person filling the form
function qfRow(f = qf) {
  const text = f.text.trim();
  if (!text) return 'Write the question first.';
  if (f.kind === 'text' || f.kind === 'essay') {
    const accepted = f.accepted.map(a => a.trim()).filter(Boolean);
    if (!accepted.length) return f.kind === 'essay' ? 'Add at least one keyword.' : 'Write the correct answer.';
    if (f.kind === 'text') return { kind: 'text', text, options: [], correct: null, accepted, model_answer: null };
    const num = v => (String(v ?? '').trim() === '' ? null : Number(v));
    const min = num(f.min_words), max = num(f.max_words);
    if ([min, max].some(n => n !== null && !(Number.isInteger(n) && n >= 1 && n <= 2000))) return 'Word limits must be whole numbers from 1 to 2000.';
    if (min !== null && max !== null && max < min) return 'Maximum words must be more than the minimum.';
    return { kind: 'essay', text, options: [], correct: null, accepted, model_answer: (f.model_answer || '').trim() || null, min_words: min, max_words: max };
  }
  const kept = f.options.map((o, j) => [o.trim(), f.correct.includes(j)]).filter(([o]) => o);
  if (kept.length < 2) return 'Give at least 2 options.';
  const options = kept.map(([o]) => o), right = kept.flatMap(([, ok], j) => (ok ? [j] : []));
  if (!right.length) return 'Tick the correct answer.';
  return f.kind === 'multi'
    ? { kind: 'multi', text, options, correct: null, accepted: right, model_answer: null }
    : { kind: 'single', text, options, correct: right[0], accepted: null, model_answer: null };
}

async function saveQuestion(e) {
  e.preventDefault();
  qfSync();
  const row = qfRow();
  if (typeof row === 'string') return (document.getElementById('qf-err').textContent = row);
  e.submitter.disabled = true;
  const data = { ...row, level: qbLevel, module_id: qfModule };
  const { error } = qf.editing
    ? await sb.from('questions').update(data).eq('id', qf.editing)
    : await sb.from('questions').insert(data);
  if (error) { e.submitter.disabled = false; return (document.getElementById('qf-err').textContent = error.message); }
  toast(qf.editing ? 'Question updated' : 'Question saved. Add the next one.');
  qf = qfBlank(qf.kind); // keep the type and level for the next question
  await route();
  const t = document.getElementById('qf-text');
  t?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  t?.focus();
}

function editQuestion(id) {
  const x = bank.find(q => q.id === id);
  if (!x) return;
  const kind = x.kind || 'single';
  qbLevel = x.level || 'moderate';
  qf = {
    ...qfBlank(kind), editing: id, text: x.text,
    ...(kind === 'text' || kind === 'essay' ? { accepted: [...x.accepted], model_answer: x.model_answer || '', min_words: x.min_words ?? '', max_words: x.max_words ?? '' }
      : { options: [...x.options], correct: kind === 'multi' ? [...x.accepted] : [x.correct] }),
  };
  qTab('one');
  renderQForm();
  document.getElementById('qform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function questionItem(x, i, deletable) {
  return `<div class="qb-item">
    <div><strong>${i + 1}. ${esc(x.text)}</strong> ${levelBadge(x.level)} <span class="badge">${KIND_LABEL[x.kind || 'single']}</span>
      ${x.kind === 'essay'
        ? `<p class="small" style="margin:6px 0 0">${x.min_words || x.max_words ? `Answer length: ${wordRange(x.min_words, x.max_words)}<br>` : ''}Keywords: <span class="ok-t">${(x.accepted || []).map(esc).join(' · ')}</span>${x.model_answer ? `<br>Model answer: ${esc(x.model_answer)}` : ''}</p>`
        : x.kind === 'text'
        ? `<p class="small" style="margin:6px 0 0">Accepted answers: <span class="ok-t">${(x.accepted || []).map(esc).join(' / ')}</span></p>`
        : `<ol>${x.options.map((o, j) => `<li class="${isRight(x, j) ? 'ok-t' : ''}">${esc(o)}${isRight(x, j) ? ' ✓' : ''}</li>`).join('')}</ol>`}</div>
    ${deletable ? `<div class="row" style="flex-wrap:nowrap">
      <button class="btn btn-sm" onclick="editQuestion('${x.id}')" aria-label="Edit question ${i + 1}">${icon('save', 'sm')} Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delQuestion('${x.id}')" aria-label="Delete question ${i + 1}">${icon('trash', 'sm')}</button></div>` : ''}
  </div>`;
}

function drawBank() {
  const n = l => bank.filter(x => l === 'all' || (x.level || 'moderate') === l).length;
  document.getElementById('qb-filter').innerHTML = [['all', 'All'], ...Object.keys(LEVELS).map(l => [l, LEVELS[l][0]])].map(([l, label]) =>
    `<button class="${l === qbFilter ? 'on' : ''}" aria-pressed="${l === qbFilter}" onclick="qbFilter='${l}';drawBank()">${label} <span class="sub">${n(l)}</span></button>`).join('');
  const rows = bank.filter(x => qbFilter === 'all' || (x.level || 'moderate') === qbFilter);
  document.getElementById('qb-list').innerHTML = rows.map((x, i) => questionItem(x, i, true)).join('')
    || `<p class="muted">No ${LEVELS[qbFilter]?.[0] || ''} questions yet.</p>`;
}

// CSV that opens in Excel (BOM keeps Hindi readable); rows copied back out of Excel paste straight into the box
const TEMPLATES = {
  mcq: ['question-template.csv', [
    ['Level', 'Question', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6', 'Answer'],
    ['Easy', 'In which city is Akshardham Associates based?', 'Kota', 'Jhalawar', 'Jaipur', 'Udaipur', '', '', '2'],
    ['Easy', 'Check the registry papers before buying a plot.', 'True', 'False', '', '', '', '', '1'],
    ['Moderate', 'What should you take on a site visit?', 'Plot map', 'Brochure', 'Lunch', 'Price list', '', '', '1+2+4'],
    ['Hard', 'Which state is Jhalawar in?', '', '', '', '', '', '', 'Rajasthan'],
  ]],
  descriptive: ['descriptive-template.csv', [
    ['Type', 'Level', 'Question', 'Keywords (separate with ;)', 'Model answer', 'Min words', 'Max words'],
    ['Descriptive', 'Moderate', 'How would you make the first call to a new customer? Answer in detail.',
     'budget; family; site visit',
     'Greet the customer and introduce yourself and Akshardham Associates.\nAsk about their budget and the family\'s needs.\nSuggest the right plot and fix a site visit time.', '100', '150'],
    ['Descriptive', 'Hard', 'Your team\'s conversion rate is falling. What steps would you take as manager?',
     'call recording; training; follow up; target', '', '100', '150'],
  ]],
};

function downloadTemplate(kind = 'mcq') {
  const [file, rows] = TEMPLATES[kind];
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = file;
  a.click();
}

// live check while typing: shows exactly what will be saved, and which lines are wrong
function previewQuestions() {
  qbLevel = document.getElementById('bulk-level').value;
  const { rows, bad } = parseQuestions(document.getElementById('bulk').value, '', qbLevel);
  const out = document.getElementById('qb-preview');
  if (!rows.length && !bad.length) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="notice ${bad.length ? '' : 'ok'}">${icon(bad.length ? 'alert' : 'check')}<span>
      <strong>${rows.length} question${rows.length === 1 ? '' : 's'} ready</strong>
      (${Object.keys(LEVELS).map(l => [l, rows.filter(r => r.level === l).length]).filter(([, n]) => n).map(([l, n]) => `${n} ${LEVELS[l][0]}`).join(', ') || 'none'})
      ${bad.length ? `· <strong>row ${bad.join(', ')} has a problem</strong>. Check the answer number (or the | signs); for descriptive rows, the keywords and word limits.` : '· check the ✓ answers below, then click Add questions.'}</span></div>
    ${rows.map((x, i) => questionItem(x, i, false)).join('')}`;
}

async function addQuestions(moduleId) {
  const { rows, bad } = parseQuestions(document.getElementById('bulk').value, moduleId, document.getElementById('bulk-level').value);
  if (bad.length) return toast(`Line ${bad.join(', ')} has the wrong format. Nothing was saved.`, 'err');
  if (!rows.length) return;
  const { error } = await sb.from('questions').insert(rows);
  if (error) return toast(error.message, 'err');
  toast(`${rows.length} question${rows.length === 1 ? '' : 's'} added`);
  route();
}

const fmtClock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// "2:30", "150" or "1:02:30" → seconds; null if it isn't a time
function parseClock(v) {
  const parts = String(v).trim().split(':');
  if (!parts.every(x => /^\d+$/.test(x)) || parts.length > 3) return null;
  return parts.reduce((t, x) => t * 60 + Number(x), 0);
}

async function addCheckpoint(e, moduleId) {
  e.preventDefault();
  const fd = new FormData(e.target), err = m => (document.getElementById('cpn-err').textContent = m);
  const at = parseClock(fd.get('at')), text = fd.get('text').trim();
  const opts = fd.getAll('opt').map(o => o.trim()), correct = Number(fd.get('correct'));
  if (at === null) return err('Write the time like 2:30.');
  if (!text) return err('Write the question.');
  const kept = opts.map((o, j) => [o, j]).filter(([o]) => o);
  if (kept.length < 2) return err('Give at least 2 options.');
  if (!opts[correct]) return err('Tick an option that has text.');
  const { error } = await sb.from('video_checkpoints').insert({
    module_id: moduleId, video_id: fd.get('video'), at_sec: at, text, options: kept.map(([o]) => o),
    correct: kept.findIndex(([, j]) => j === correct), explanation: fd.get('explanation').trim() || null,
  });
  if (error) return err(error.message);
  toast(`Checkpoint added at ${fmtClock(at)}`);
  await route();
  document.getElementById('cp-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function delCheckpoint(id) {
  if (!confirm('Delete this checkpoint? Learners\' answers to it are deleted too.')) return;
  const { error } = await sb.from('video_checkpoints').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  route();
}

async function saveTask(e, moduleId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await sb.from('tasks').upsert({
    module_id: moduleId, instructions: fd.get('instructions').trim(), submit_type: fd.get('submit_type'),
    model_answer: fd.get('model_answer').trim() || null, updated_at: new Date().toISOString(),
  });
  if (error) return toast(error.message, 'err');
  toast('Task saved');
  route();
}

async function removeTask(moduleId) {
  if (!confirm('Remove this practical task? Past submissions are kept.')) return;
  const { error } = await sb.from('tasks').delete().eq('module_id', moduleId);
  if (error) return toast(error.message, 'err');
  route();
}

async function delQuestion(id) {
  if (!confirm('Delete this question? Past attempt records will be kept.')) return;
  const { error } = await sb.from('questions').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  route();
}

if (typeof module === 'object') module.exports = { parseQuestions, qfRow, parseClock, parseAiText, cpFlag }; // node test.js
else { addEventListener('hashchange', route); initTips(); boot(); }
