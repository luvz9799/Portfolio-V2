/* PMS demo backend: stands in for the Apps Script web app (Google Sheet) with the same actions and
   response shapes, in memory. The app code is unchanged; only fetch() to demo:// is answered here.
   ponytail: state lives for one page load (reload = fresh sample data); no persistence needed for a demo. */
(() => {
  const q = new URLSearchParams(location.search);
  // Fresh session every load: drop the app's caches, sign in as the chosen person (?as=member|coord)
  try {
    Object.keys(localStorage).filter(k => /^(ts_|pms_)/.test(k)).forEach(k => localStorage.removeItem(k));
    const code = q.get('as') === 'member' ? 'M1' : 'C1';
    if (q.get('as') !== 'none') { localStorage.setItem('ts_token', 'demo-' + code); localStorage.setItem('ts_code', code) }
  } catch (e) { }

  const TEAM = [
    ['C1', 'Amit Saini', '9000000101'], ['M1', 'Rohit Meena', '9000000102'], ['M2', 'Pooja Verma', '9000000103'],
    ['M3', 'Sunil Gurjar', '9000000104'], ['M4', 'Kiran Sharma', '9000000105'], ['M5', 'Vikas Nagar', '9000000106']
  ].map(([code, naam, mobile]) => ({ code, naam, mobile }));
  const P = c => TEAM.find(m => m.code === c);
  const COORD = 'C1';

  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) };
  const TODAY = day(0);
  const nice = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const diff = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(TODAY + 'T00:00:00')) / 864e5);

  // [id, page, task, A, R, startOffset, days, priority, status, done-when, steps]
  const G = 'Phase 1 · Ground work', M = 'Phase 2 · Marketing', S = 'Phase 3 · Sales launch';
  let tasks = [
    ['P1-01', G, 'Survey all 12 villages around the site', 'C1', ['M1', 'M3'], -20, 14, 'High', 'Done', 'Every village has a sarpanch, a contact and a photo in the Field database', '1. Visit each village\n2. Meet the sarpanch\n3. Add details in Field data'],
    ['P1-02', G, 'Get the boundary wall quotation from 3 vendors', 'M2', ['M3'], -12, 7, 'Normal', 'WIP', '3 written quotes shared in the group', '1. Shortlist vendors\n2. Site visit with each\n3. Collect written quotes'],
    ['P1-03', G, 'Mark plot numbers on site with pillars', 'M1', ['M3', 'M5'], -6, 4, 'High', 'Blocked', 'Every plot has a numbered pillar matching the layout plan', '1. Collect the layout plan\n2. Mark corners\n3. Paint numbers'],
    ['P1-04', G, 'Clear and level the internal road', 'M3', ['M5'], -4, 10, 'Normal', 'WIP', 'Road levelled end to end, photos shared', ''],
    ['P2-01', M, 'Put up 5 hoardings on the highway', 'C1', ['M1'], -5, 3, 'High', 'Verify Pending', '5 hoardings up, photo of each shared', '1. Finalise locations\n2. Get vendor rates\n3. Install and photograph'],
    ['P2-02', M, 'Print 2,000 pamphlets with the site map', 'M2', ['M4'], -3, 5, 'Normal', 'WIP', 'Pamphlets delivered to the office', ''],
    ['P2-03', M, 'Run a Facebook lead campaign for 10 days', 'C1', ['M2'], -2, 10, 'Normal', 'WIP', 'Campaign live; leads flowing into Plot CRM', '1. Creative and copy\n2. Audience: 40 km radius\n3. Connect lead form to CRM'],
    ['P2-04', M, 'Village meetings: show the project in 4 villages', 'M1', ['M4', 'M5'], 0, 6, 'Normal', 'Not Started', 'Meeting held in 4 villages with attendance photos', ''],
    ['P2-05', M, 'Shoot a drone video of the site', 'M2', [], 1, 5, 'Normal', 'Not Started', 'Edited 60-second video ready for WhatsApp', ''],
    ['P3-01', S, 'Prepare the price list and payment plan', 'C1', ['M2'], -9, 4, 'High', 'Done', 'Price list approved and printed', ''],
    ['P3-02', S, 'Set up a site office with seating for 10', 'M3', ['M5'], -1, 7, 'Normal', 'WIP', 'Office ready with chairs, table, banner and water', ''],
    ['P3-03', S, 'Train the telecalling team on the project pitch', 'M1', ['M4'], 0, 3, 'Normal', 'Not Started', 'Every caller passes a mock call', ''],
    ['P3-04', S, 'Book 10 site visits for the launch weekend', 'M4', ['M1', 'M2'], 0, 9, 'High', 'Not Started', '10 confirmed visits in Plot CRM', '']
  ].map(([id, page, kaam, a, r, s, din, priority, status, done, steps]) => ({ id, page, kaam, a, r, start: day(s), din, priority, status, done, steps, note: '', reports: [], acc: {} }));
  const T = id => tasks.find(t => t.id === id);

  // Who has accepted what: everyone except a few, so the accept flow and a question show up
  tasks.forEach(t => [t.a, ...t.r].forEach(c => t.acc[c] = true));
  ['P2-04', 'P3-03'].forEach(id => delete T(id).acc.M1);              // Rohit has 2 new tasks to accept
  delete T('P3-04').acc.M1; delete T('P2-04').acc.M5;
  T('P2-04').acc.M4 = { doubt: 'Which 4 villages first? Should I take pamphlets along?' };
  delete T('P2-05').acc.M2;

  const rep = (id, off, c, status, kya, kal = '', rukawat = '') => T(id).reports.push({ date: day(off), code: c, status, kya, kal, rukawat });
  rep('P1-01', -8, 'M3', 'WIP', 'Covered 8 villages, sarpanch contacts added.', 'Remaining 4 villages tomorrow');
  rep('P1-01', -6, 'M1', 'Done', 'All 12 villages done and entered in Field data.');
  rep('P1-02', -3, 'M3', 'WIP', 'Two quotes received, third vendor visiting on Monday.', 'Follow up with vendor 3');
  rep('P1-03', -2, 'M5', 'WIP', 'Pillars marked for row A and B.', 'Rows C and D');
  rep('P1-03', -1, 'M3', 'Blocked', 'Could not continue the marking.', '', 'Final layout plan not received from the architect. Need the coordinator to call him.');
  rep('P1-04', -5, 'M5', 'WIP', 'JCB arrived, first 200 m levelled.');
  rep('P2-01', -2, 'M1', 'WIP', 'Three hoardings installed at the toll and bypass.', 'Last two near the bus stand');
  rep('P2-01', -1, 'M1', 'Done', 'All 5 hoardings up. Photos shared in the group.');
  rep('P2-02', -1, 'M4', 'WIP', 'Design approved, printer delivering on Friday.');
  rep('P2-03', -1, 'M2', 'WIP', 'Campaign live. 23 leads in the first day, all synced to Plot CRM.', 'Pause the weakest ad');
  rep('P3-01', -6, 'M2', 'Done', 'Price list approved and 200 copies printed.');
  rep('P3-02', -3, 'M5', 'WIP', 'Tent and chairs arranged.', 'Banner and water dispenser');
  rep('P2-03', 0, 'M2', 'WIP', 'Paused one ad set, cost per lead down to ₹41.');
  rep('P1-02', 0, 'M3', 'WIP', 'Third quote received. Comparing all three.');

  /* ---------------- views, shaped like the Apps Script responses ---------------- */
  const OPEN = s => s !== 'Done' && s !== 'Verify Pending';
  const names = cs => cs.map(c => P(c).naam).join(', ');
  const last = t => { const r = t.reports[t.reports.length - 1]; return r && { status: r.status, date: nice(r.date), naam: P(r.code).naam, kya: r.kya, kal: r.kal, rukawat: r.rukawat, proof: r.proof || '' } };
  const deadline = t => { const d = new Date(t.start + 'T00:00:00'); d.setDate(d.getDate() + t.din); return d.toLocaleDateString('en-CA') };
  function view(t) {
    const dl = deadline(t), repToday = c => t.reports.find(r => r.date === TODAY && r.code === c);
    return { id: t.id, page: t.page, kaam: t.kaam, status: t.status, deadline: nice(dl), daysLeft: diff(dl), start: t.start, din: t.din, priority: t.priority,
      done: t.done, steps: t.steps, note: t.note, aNames: t.a ? P(t.a).naam : '', rNames: names(t.r), aRaw: t.a ? [t.a] : [], rRaw: [...t.r], rCodes: [...t.r],
      noOwner: !t.a || !t.r.length, last: last(t), today: t.r.filter(c => t.acc[c] === true).map(c => { const r = repToday(c); return { naam: P(c).naam, status: r ? r.status : '' } }) };
  }
  function meTasks(code) {
    return tasks.filter(t => t.a === code || t.r.includes(code)).map(t => {
      const v = view(t), isR = t.r.includes(code), acc = t.acc[code], r = t.reports.find(x => x.date === TODAY && x.code === code);
      return Object.assign(v, { roles: [t.a === code ? 'A' : null, isR ? 'R' : null].filter(Boolean), needsAccept: acc !== true,
        doubtPending: acc && acc.doubt || '', canReport: OPEN(t.status), mustReport: isR, reportedToday: r ? { status: r.status, kya: r.kya } : null,
        canVerify: t.a === code && t.status === 'Verify Pending' });
    });
  }
  function dash() {
    const V = tasks.map(view), counts = {};
    V.forEach(t => counts[t.status] = (counts[t.status] || 0) + 1);
    const people = TEAM.filter(m => m.code !== COORD).map(m => {
      const mine = tasks.filter(t => t.a === m.code || t.r.includes(m.code)), st = {};
      mine.forEach(t => st[t.status] = (st[t.status] || 0) + 1);
      const due = tasks.filter(t => t.r.includes(m.code) && t.acc[m.code] === true && OPEN(t.status));
      const slots = mine.flatMap(t => [t.a === m.code, t.r.includes(m.code)].filter(Boolean).map(() => t.acc[m.code] === true));
      return { code: m.code, naam: m.naam, mobile: m.mobile, total: mine.length, st, late: mine.filter(t => OPEN(t.status) && diff(deadline(t)) < 0).length,
        dueToday: due.length, repToday: due.filter(t => t.reports.some(r => r.date === TODAY && r.code === m.code)).length, accepted: slots.filter(Boolean).length, accTotal: slots.length };
    });
    const doubts = tasks.flatMap(t => Object.entries(t.acc).filter(([, v]) => v && v.doubt).map(([c, v]) => ({ naam: P(c).naam, doubt: v.doubt, kaam: t.kaam, mobile: P(c).mobile })));
    const silent = [];
    tasks.filter(t => OPEN(t.status) && t.status !== 'Not Started').forEach(t => t.r.forEach(c => {
      const lr = [...t.reports].reverse().find(r => r.code === c), days = lr ? -diff(lr.date) : -diff(t.start);
      if (t.acc[c] === true && days >= 3) silent.push({ naam: P(c).naam, days, kaam: t.kaam, mobile: P(c).mobile });
    }));
    return { today: nice(TODAY), updated: 'updated ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), total: V.length, counts, tasks: V, people, doubts, silent,
      growth: { ok: true, newToday: Array(14), newYday: 11, fuToday: 37, fuYday: 41, visits: 6, booked: 2, total: 186,
        byStatus: { fresh: 74, warm: 58, hot: 31, visit: 17, booked: 6 }, overdue: 4,
        changes: [{ name: 'Rakesh J.', prev: 'Warm', next: 'Hot', by: 'Pooja' }, { name: 'Meena D.', prev: 'Hot', next: 'Site visit', by: 'Rohit' }, { name: 'Harish P.', prev: 'Site visit', next: 'Booked', by: 'Pooja' }] } };
  }
  const me = code => ({ code, naam: P(code).naam, isCoordinator: code === COORD, today: nice(TODAY), tasks: meTasks(code), coordinator: { naam: P(COORD).naam, mobile: P(COORD).mobile } });
  const withMe = (code, extra) => Object.assign({ me: me(code) }, code === COORD ? { dash: dash() } : {}, extra || {});

  function messages() {
    const open = tasks.filter(t => OPEN(t.status));
    const lines = TEAM.filter(m => m.code !== COORD).map(m => {
      const L = open.filter(t => t.r.includes(m.code)); return L.length ? `*${m.naam}*\n` + L.map(t => `• ${t.kaam} (${nice(deadline(t))})`).join('\n') : '' }).filter(Boolean);
    const rep = TEAM.filter(m => m.code !== COORD).map(m => {
      const R = tasks.flatMap(t => t.reports.filter(r => r.date === TODAY && r.code === m.code).map(r => `${t.kaam}: ${r.kya}`));
      return R.length ? `✅ *${m.naam}*\n` + R.map(x => '• ' + x).join('\n') : `⏳ *${m.naam}*: no report yet` });
    const late = open.filter(t => diff(deadline(t)) < 0), blk = tasks.filter(t => t.status === 'Blocked');
    return { date: nice(TODAY),
      morning: `Good morning team 🙏\n*Project Sarola · today's work*\n\n${lines.join('\n\n')}\n\nPlease send your report in the app by 6 PM.`,
      evening: `*Evening update · ${nice(TODAY)}*\n\n${rep.join('\n\n')}\n\nThank you, see you tomorrow.`,
      alerts: [...blk.map(t => `🔴 Blocked: ${t.kaam}\n   ${last(t) ? last(t).rukawat : ''}`), ...late.map(t => `⚠️ Overdue: ${t.kaam} (A: ${P(t.a).naam})`), ...dash().silent.map(s => `📵 ${s.naam}: no report for ${s.days} days`)].join('\n') || 'No alerts today.',
      director: `Project Sarola · ${nice(TODAY)}\n${tasks.filter(t => t.status === 'Done').length} of ${tasks.length} tasks done · ${late.length} overdue · ${blk.length} blocked\nLeads today: 14 new, 6 site visits, 2 bookings.`,
      sent: '' };
  }

  /* ---------------- actions ---------------- */
  const who = b => { const c = String(b.token || '').replace('demo-', ''); if (!P(c)) throw new Error('Login expired. Please sign in again.'); return c };
  const A = {
    team: () => TEAM.map(({ code, naam }) => ({ code, naam })),
    boot(b) { const code = b.code || who(b); if (!P(code)) throw new Error('Choose your name'); if (b.code && !/^\d{4,6}$/.test(String(b.pin || ''))) throw new Error('PIN must be 4 digits');
      return Object.assign(me(code), { token: 'demo-' + code }, code === COORD ? { dash: dash() } : {}) },
    dashboard: () => dash(),
    accept(b) { const c = who(b); b.items.forEach(i => { T(i.taskId).acc[c] = i.response === 'Doubt' ? { doubt: i.doubt } : true }); return withMe(c) },
    report(b) { const c = who(b), t = T(b.taskId);
      t.reports = t.reports.filter(r => !(r.date === TODAY && r.code === c));
      t.reports.push({ date: TODAY, code: c, status: b.status, kya: b.kya, kal: b.kal, rukawat: b.rukawat, proof: b.photo ? 'data:image/jpeg;base64,' + b.photo.data : '' });
      t.status = b.status === 'Done' ? (t.a === c ? 'Done' : 'Verify Pending') : b.status;
      return withMe(c, { status: t.status }) },
    verify(b) { const c = who(b), t = T(b.taskId); if (t.a !== c) throw new Error('Only the accountable person can verify');
      if (b.decision === 'approve') t.status = 'Done'; else { t.status = 'WIP'; t.note = 'Sent back: ' + b.comment } return withMe(c) },
    taskSave(b) { const c = who(b), x = b.task; let t = x.id && T(x.id);
      if (!t) { const n = tasks.filter(y => y.id.startsWith('P3-')).length + 1; t = { id: 'P3-' + String(n).padStart(2, '0'), page: S, start: TODAY, status: 'Not Started', reports: [], acc: {}, note: '' }; tasks.push(t) }
      Object.assign(t, { kaam: x.kaam, a: x.a, r: x.r.split(',').filter(Boolean), din: +x.din, priority: x.priority, done: x.done, steps: x.steps });
      [t.a, ...t.r].forEach(p => { if (t.acc[p] !== true && p !== COORD) delete t.acc[p]; if (p === COORD) t.acc[p] = true });
      return withMe(c, { id: t.id }) },
    taskDelete(b) { const c = who(b); tasks = tasks.filter(t => t.id !== b.taskId); return withMe(c) },
    messages: () => messages(),
    markSent: b => ({ sent: `${b.which} · ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` })
  };
  A.login = A.boot;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt) => {
    if (!String(url).startsWith('demo://')) return realFetch(url, opt);
    await new Promise(r => setTimeout(r, 250));
    const b = JSON.parse(opt.body); let out;
    try { if (!A[b.action]) throw new Error('Unknown action: ' + b.action); out = { ok: true, data: JSON.parse(JSON.stringify(A[b.action](b))) } }
    catch (e) { out = { ok: false, error: e.message } }
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  };
  window.DEMO_TASKS = () => tasks;   // for the self-check
})();
